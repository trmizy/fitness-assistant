<#
.SYNOPSIS
  Gymini DEV - bring up on-demand, hourly-cost infrastructure for a work session.

.DESCRIPTION
  Phase 1 skeleton (see docs/deployment/AWS_DEV_ON_DEMAND_INFRA_DESIGN_2026-10-01.md).
  Phase 2 wired real execution for -Network. Phase 3 wired -Chat (ALB +
  listener + target group, then ECS reconnect + API Gateway reconnect +
  frontend runtime-config.json push). Phase 4 wired -Ai (OpenSearch
  Serverless VPC endpoint + network-policy reconnect via
  Set-AossNetworkPolicyVpce).

  Phase 7 (2026-10-01, docs/deployment/AWS_DEV_PERSISTENT_BASELINE_REDUCTION_2026-10-01.md)
  adds:
    -Backend : starts Aurora (handles every transitional status safely -
               never blindly re-issues an operation against starting/
               stopping/backing-up/modifying) and restores EventBridge
               Scheduler jobs to their pre-freeze state afterward.
    -Secrets : makes the Secrets Manager VPC Interface endpoint on-demand
               too (EnableSecretsManagerEndpoint=true). -Chat, -Ai, and
               -Backend all AUTO-IMPLY -Secrets (every VPC-attached Lambda
               needs it or NAT to fetch its DB secret on a cold start) -
               the operator never has to remember it separately. -Network
               does NOT imply it (NAT serves a different purpose - Bedrock/
               external outbound - and reaches Secrets Manager's public
               endpoint on its own if ever needed that way).

  Order matters: the stack deploy (which can create Secrets/NAT/Chat/AI
  resources together, in any combination, in one CloudFormation call)
  always completes BEFORE Aurora is started, and Aurora is confirmed
  AVAILABLE before any EventBridge schedule is re-enabled - so no
  scheduled Lambda can wake up while its DB or Secrets Manager path is
  still unavailable.

.PARAMETER Network
  Switch. Enables NAT Gateway (EnableNatGateway=true).

.PARAMETER Chat
  Switch. Enables the Chat ALB + listener + target group, then (with
  -Execute) the 3 reconnect steps. Implies -Secrets.

.PARAMETER Ai
  Switch. Enables the OpenSearch Serverless VPC endpoint, then (with
  -Execute) the network-policy reconnect. Implies -Secrets.

.PARAMETER Backend
  Switch. Starts Aurora and restores paused EventBridge schedules. Implies
  -Secrets.

.PARAMETER Secrets
  Switch. Enables the Secrets Manager VPC endpoint on its own
  (EnableSecretsManagerEndpoint=true). Auto-implied by -Chat/-Ai/-Backend;
  only needed standalone for connectivity diagnostics.

.PARAMETER Execute
  Without this switch, the script only prints what it would do.
#>
[CmdletBinding()]
param(
    [switch]$Network,
    [switch]$Chat,
    [switch]$Ai,
    [switch]$Backend,
    [switch]$Secrets,
    [switch]$Execute
)

$ErrorActionPreference = "Stop"

Import-Module (Join-Path $PSScriptRoot "lib/DevLifecycle.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "api-gateway/lib/ChatIntegrationSync.psm1") -Force

# -- Safety guards --------------------------------------------------------
$ExpectedAccount = "191798898985"
$ExpectedRegion  = "ap-southeast-1"
$StackName       = "gymini-dev-on-demand"
$ApiId           = "id1iz7upbl"
$ChatIntegrationId = "ebe69nj"
$EcsCluster      = "fitness-assistant-dev-cluster"
$EcsService      = "fitness-assistant-dev-chat-service"
$EcsContainerName = "chat-service"
$EcsContainerPort = 3005
$FrontendBucket  = "fitness-assistant-frontend-dev-191798898985"
$AossNetworkPolicyName = "auto-fitness-assistant-dev-ai-ve"
$AuroraClusterId = "fitness-assistant-dev-aurora"
$SchedulerStateFile = ".dev/aws/scheduler-state.json"
# Every schedule this automation is allowed to touch (and the one it must
# never touch, in either direction) now live in one shared place - see
# scripts/aws/lib/DevLifecycle.psm1 - instead of being duplicated here and
# in dev-stop.ps1.
$DevPausableSchedules = Get-DevPausableSchedules

# Re-reads the CURRENT network policy immediately before updating (never a
# blind overwrite from a stale local copy - AOSS's policyVersion is an
# optimistic-concurrency token that changes on every update). Removes
# $OldVpceId if present, adds $NewVpceId if given, and leaves every other
# field (Rules, AllowFromPublic, any other SourceVPCEs entry) untouched.
#
# AWS schema constraint (confirmed empirically 2026-10-01, not assumed): a
# network policy rule-group requires SourceVPCEs to have >= 1 entry UNLESS
# AllowFromPublic=true - there is no valid "neither" state. So removing
# $OldVpceId WITHOUT a $NewVpceId replacement is deliberately a no-op.
function Set-AossNetworkPolicyVpce {
    param(
        [string]$PolicyName,
        [string]$OldVpceId,
        [string]$NewVpceId,
        [string]$Region
    )
    if (-not $NewVpceId) {
        Write-Host "   Skipping network policy update: no replacement VPCE given." -ForegroundColor Yellow
        return 0
    }
    $current = aws opensearchserverless get-security-policy --name $PolicyName --type network --region $Region --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
    $policyVersion = $current.securityPolicyDetail.policyVersion
    $policyDoc = $current.securityPolicyDetail.policy
    $sourceList = @($policyDoc[0].SourceVPCEs | Where-Object { $_ -and $_ -ne $OldVpceId })
    $sourceList += $NewVpceId
    $policyDoc[0].SourceVPCEs = @($sourceList)
    $policyJsonPath = Join-Path $env:TEMP "gymini-aoss-network-policy.json"
    # IMPORTANT: piping a 1-element array to ConvertTo-Json unwraps it back
    # to a bare object - pass via -InputObject instead (confirmed empirically).
    $policyJson = ConvertTo-Json -InputObject $policyDoc -Depth 10 -Compress
    Set-Content -Path $policyJsonPath -Value $policyJson -Encoding ASCII
    aws opensearchserverless update-security-policy --name $PolicyName --type network --policy-version $policyVersion --policy "file://$policyJsonPath" --region $Region --output json | Out-Null
    return $LASTEXITCODE
}

# Handles every Aurora status safely - never blindly re-issues an operation
# against a cluster that is already starting/stopping/backing-up/modifying.
# Returns $true only if the cluster ends up AVAILABLE.
function Start-AuroraCluster {
    param([string]$ClusterId, [string]$Region)
    $status = aws rds describe-db-clusters --db-cluster-identifier $ClusterId --region $Region --query "DBClusters[0].Status" --output text
    Write-Host "   Current Aurora status: $status"
    switch ($status) {
        "available" {
            Write-Host "   Already available - nothing to do." -ForegroundColor Green
            return $true
        }
        "stopped" {
            Write-Host "   Starting cluster..."
            aws rds start-db-cluster --db-cluster-identifier $ClusterId --region $Region --output json | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Host "   start-db-cluster call failed (exit $LASTEXITCODE)." -ForegroundColor Red
                return $false
            }
        }
        { $_ -in @("starting") } {
            Write-Host "   Already starting - waiting, not re-issuing start." -ForegroundColor Yellow
        }
        default {
            Write-Host "   Status '$status' is not safe to act on automatically (stopping/backing-up/modifying/unknown). Refusing to issue any operation - re-run once it settles." -ForegroundColor Red
            return $false
        }
    }
    Write-Host "   Waiting for db-cluster-available (this can take several minutes)..."
    aws rds wait db-cluster-available --db-cluster-identifier $ClusterId --region $Region
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   Wait failed or timed out (exit $LASTEXITCODE)." -ForegroundColor Red
        return $false
    }
    $finalStatus = aws rds describe-db-clusters --db-cluster-identifier $ClusterId --region $Region --query "DBClusters[0].Status" --output text
    Write-Host "   Final status: $finalStatus"
    return ($finalStatus -eq "available")
}

# Sets one schedule's State without touching any other field. AWS's own
# update-schedule docs warn it is a FULL REPLACE - "uses all values,
# including empty values... if you do not set an optional field, that
# field will be set to its system-default value" (confirmed via
# `aws scheduler update-schedule help`, not assumed). So this always reads
# the CURRENT full schedule first, strips only the 3 output-only fields
# get-schedule returns that update-schedule's own input skeleton does NOT
# accept (Arn, CreationDate, LastModificationDate), changes State, and
# resubmits everything else (Description, ScheduleExpressionTimezone,
# Target.RetryPolicy, Target.RoleArn, etc.) completely unchanged via
# --cli-input-json - never a partial/reconstructed call.
function Set-DevScheduleState {
    param([string]$Name, [string]$TargetState, [string]$Region)
    $full = aws scheduler get-schedule --name $Name --region $Region --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
    if ($full.State -eq $TargetState) {
        Write-Host "   $Name : already $TargetState"
        return 0
    }
    Write-Host "   $Name : $($full.State) -> $TargetState"
    $full.PSObject.Properties.Remove("Arn")
    $full.PSObject.Properties.Remove("CreationDate")
    $full.PSObject.Properties.Remove("LastModificationDate")
    $full.State = $TargetState
    $inputJsonPath = Join-Path $env:TEMP "gymini-schedule-$Name.json"
    (ConvertTo-Json -InputObject $full -Depth 10) | Set-Content -Path $inputJsonPath -Encoding ASCII
    aws scheduler update-schedule --cli-input-json "file://$inputJsonPath" --region $Region --output json | Out-Null
    return $LASTEXITCODE
}

# Restores each DEV-pausable schedule to the state captured in
# $SchedulerStateFile at the last freeze. If the file is missing (first
# run, or deleted), falls back to the LIVE current state as "previous"
# (a safe no-op) rather than guessing, and warns clearly.
function Restore-DevSchedules {
    param([string]$StateFile, [string[]]$Names, [string]$Region)
    $previous = @{}
    if (Test-Path $StateFile) {
        try {
            $raw = Get-Content $StateFile -Raw | ConvertFrom-Json
            $raw.PSObject.Properties | ForEach-Object { $previous[$_.Name] = $_.Value }
            Write-Host "   Loaded previous schedule states from $StateFile"
        } catch {
            Write-Host "   Could not parse $StateFile - falling back to live current state (no-op)." -ForegroundColor Yellow
        }
    } else {
        Write-Host "   No state file at $StateFile (first run?) - falling back to live current state (no-op)." -ForegroundColor Yellow
    }
    foreach ($name in $Names) {
        $target = $previous[$name]
        if (-not $target) {
            $target = aws scheduler get-schedule --name $name --region $Region --query "State" --output text
        }
        Set-DevScheduleState -Name $name -TargetState $target -Region $Region | Out-Null
    }
}

Write-Host "=== Gymini DEV - dev-start ===" -ForegroundColor Cyan

$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
if ($identity.Account -ne $ExpectedAccount) {
    Write-Host "HARD STOP: account $($identity.Account) != $ExpectedAccount" -ForegroundColor Red
    exit 1
}
Write-Host "Account OK: $($identity.Account)"

$region = aws configure get region
if ($region -ne $ExpectedRegion) {
    Write-Host "HARD STOP: region '$region' != '$ExpectedRegion'" -ForegroundColor Red
    exit 1
}
Write-Host "Region OK: $region"

if ($StackName -ne "gymini-dev-on-demand") {
    Write-Host "HARD STOP: refusing non-dev stack name '$StackName'" -ForegroundColor Red
    exit 1
}
Write-Host "Stack name guard: $StackName (DEV environment only, no paid/prod stack name accepted)"

if (-not ($Network -or $Chat -or $Ai -or $Backend -or $Secrets)) {
    Write-Host "No feature flags passed - nothing to start." -ForegroundColor Yellow
}

# -- Resolve desired state additively (Phase 12A) -------------------------
# START must be a set UNION of whatever is already live and whatever was
# newly requested - never a blind re-derivation from only this call's own
# flags (that was the root cause of the Phase 11-discovered bug: calling
# -Network alone used to reset EnableSecretsManagerEndpoint back to false
# even though an earlier, separate -Backend call had turned it on).
$currentStack = Get-CurrentStackState -StackName $StackName -Region $ExpectedRegion
if ($currentStack.StackExists -and -not $currentStack.Safe) {
    Write-Host "HARD STOP: stack '$StackName' is in status '$($currentStack.StackStatus)', not safe to read parameters from (transitional or failed state). Resolve manually (check the CloudFormation console) before continuing." -ForegroundColor Red
    exit 1
}
$auroraForDisplay = Get-CurrentAuroraState -ClusterId $AuroraClusterId -Region $ExpectedRegion
$currentForDisplay = @{
    Network = $currentStack.Network; Chat = $currentStack.Chat; Ai = $currentStack.Ai
    Secrets = $currentStack.Secrets; Backend = $auroraForDisplay.Available
}
$requested = @{
    Backend = [bool]$Backend; Network = [bool]$Network; Chat = [bool]$Chat
    Ai      = [bool]$Ai;      Secrets = [bool]$Secrets
}
$desired = Resolve-DesiredStartState -Current $currentStack -Requested $requested
if ($desired.SecretsImpliedBy.Count -gt 0 -and -not $currentStack.Secrets) {
    Write-Host "Auto-enabling Secrets Manager connectivity: $($desired.SecretsImpliedBy -join '/') need it." -ForegroundColor Yellow
}

$enableNat = if ($desired.Network) { "true" } else { "false" }
$enableChat = if ($desired.Chat) { "true" } else { "false" }
$enableAi = if ($desired.Ai) { "true" } else { "false" }
$enableSecrets = if ($desired.Secrets) { "true" } else { "false" }

Write-Host ""
Write-Host (Format-LifecyclePlan -Mode Start -Current $currentForDisplay -Requested $requested -Desired (@{
    Network = $desired.Network; Chat = $desired.Chat; Ai = $desired.Ai; Secrets = $desired.Secrets
    Backend = ($auroraForDisplay.Available -or $Backend)
}))
Write-Host ""
Write-Host "Resolved CloudFormation parameters: EnableNatGateway=$enableNat EnableChat=$enableChat EnableOpenSearchEndpoint=$enableAi EnableSecretsManagerEndpoint=$enableSecrets"
Write-Host ""

if (-not $Execute) {
    Write-Host "1) Aurora status (read-only, dry run):"
    Write-Host "   Aurora status: $($auroraForDisplay.Status)"
    if ($Backend) {
        Write-Host "   # (with -Execute) aws rds start-db-cluster --db-cluster-identifier $AuroraClusterId --region $ExpectedRegion ; aws rds wait db-cluster-available ..."
    } else {
        Write-Host "   -Backend not passed - Aurora would not be touched."
    }

    Write-Host ""
    Write-Host "DRY RUN (default) - the following would run, nothing was executed:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "2) Deploy gymini-dev-on-demand stack:"
    Write-Host "   # aws cloudformation deploy ``"
    Write-Host "   #   --template-file infra/cloudformation/dev-on-demand.yaml ``"
    Write-Host "   #   --stack-name $StackName --region $ExpectedRegion ``"
    Write-Host "   #   --parameter-overrides ... EnableNatGateway=$enableNat EnableChat=$enableChat EnableOpenSearchEndpoint=$enableAi EnableSecretsManagerEndpoint=$enableSecrets ``"
    Write-Host "   #   --no-fail-on-empty-changeset"
    Write-Host ""
    Write-Host "3) Read stack outputs"
    if ($Chat) {
        Write-Host ""
        Write-Host "4) ECS reconnect - point the chat service at the NEW target group (desiredCount untouched):"
        Write-Host "   # aws ecs update-service --cluster $EcsCluster --service $EcsService --load-balancers `"containerName=$EcsContainerName,containerPort=$EcsContainerPort,targetGroupArn=<ChatTargetGroupArn output>`" --region $ExpectedRegion"
        Write-Host "5) API Gateway reconnect, 6) Frontend runtime-config.json reconnect"
    }
    if ($Ai) {
        Write-Host ""
        Write-Host "7) Re-point OpenSearch Serverless network policy at the new VPC endpoint ID"
    }
    if ($Backend) {
        Write-Host ""
        Write-Host "8) Start Aurora, wait available, then restore schedules from $SchedulerStateFile"
    }
    Write-Host ""
    Write-Host "Nothing was executed against AWS by this script." -ForegroundColor Green
    exit 0
}

# -- Real execution --------------------------------------------------------
Write-Host "1) Aurora status (read-only; actual start happens in step 8 if -Backend):"
Write-Host "   Aurora status: $($auroraForDisplay.Status)"

Write-Host ""
Write-Host "-Execute passed. Deploying gymini-dev-on-demand." -ForegroundColor Yellow

$VpcId = "vpc-010c13afd8920c8f1"
$PublicSubnetId = "subnet-0f1a5fcd6ed0401ee"
$PrivateSubnetIds = "subnet-09e3230f7bca04c8e,subnet-02b39d77762465ef8"
$ChatAlbSubnetIds = "subnet-043180192466a53b5,subnet-0f1a5fcd6ed0401ee"
$PrivateRouteTableId = "rtb-0f743d4fd0949f9aa"
$LambdaSecurityGroupId = "sg-0b38ab22927b284ab"
$ChatAlbSecurityGroupId = "sg-0ed91f8e8a4617d62"
$SecretsManagerVpceSecurityGroupId = "sg-0198527f052b3f386"

Write-Host ""
Write-Host "2) Deploying stack..."
aws cloudformation deploy `
    --template-file infra/cloudformation/dev-on-demand.yaml `
    --stack-name $StackName `
    --region $ExpectedRegion `
    --parameter-overrides EnvironmentName=dev VpcId=$VpcId PublicSubnetId=$PublicSubnetId PrivateSubnetIds=$PrivateSubnetIds ChatAlbSubnetIds=$ChatAlbSubnetIds PrivateRouteTableId=$PrivateRouteTableId LambdaSecurityGroupId=$LambdaSecurityGroupId ChatAlbSecurityGroupId=$ChatAlbSecurityGroupId ApiGatewayId=$ApiId OpenSearchCollectionName=fitness-assistant-dev-ai-vectors SecretsManagerVpceSecurityGroupId=$SecretsManagerVpceSecurityGroupId EnableNatGateway=$enableNat EnableChat=$enableChat EnableOpenSearchEndpoint=$enableAi EnableSecretsManagerEndpoint=$enableSecrets `
    --no-fail-on-empty-changeset
if ($LASTEXITCODE -ne 0) {
    Write-Host "HARD STOP: stack deploy failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}
Write-Host "Stack deploy succeeded." -ForegroundColor Green

Write-Host ""
Write-Host "3) Reading stack outputs..."
$outputs = aws cloudformation describe-stacks --stack-name $StackName --region $ExpectedRegion --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
$outputs | ForEach-Object { Write-Host "   $($_.OutputKey) = $($_.OutputValue)" }
$newNatId = ($outputs | Where-Object { $_.OutputKey -eq "NatGatewayId" }).OutputValue
$newTgArn = ($outputs | Where-Object { $_.OutputKey -eq "ChatTargetGroupArn" }).OutputValue
$newAlbDns = ($outputs | Where-Object { $_.OutputKey -eq "ChatLoadBalancerDnsName" }).OutputValue
$newVpceId = ($outputs | Where-Object { $_.OutputKey -eq "OpenSearchVpcEndpointId" }).OutputValue
$newSecretsVpceId = ($outputs | Where-Object { $_.OutputKey -eq "SecretsManagerVpcEndpointId" }).OutputValue

Write-Host ""
Write-Host "4) Verifying NAT/route (read-only, if -Network)..."
if ($enableNat -eq "true" -and $newNatId) {
    $natState = aws ec2 describe-nat-gateways --nat-gateway-ids $newNatId --region $ExpectedRegion --query "NatGateways[0].State" --output text
    Write-Host "   NAT $newNatId state: $natState"
}

if ($enableSecrets -eq "true" -and $newSecretsVpceId) {
    Write-Host ""
    Write-Host "4b) Verifying Secrets Manager VPC endpoint (read-only)..."
    $secretsVpceState = aws ec2 describe-vpc-endpoints --vpc-endpoint-ids $newSecretsVpceId --region $ExpectedRegion --query "VpcEndpoints[0].State" --output text
    Write-Host "   Secrets Manager VPCE $newSecretsVpceId state: $secretsVpceState"
}

if ($enableChat -eq "true" -and $newTgArn) {
    Write-Host ""
    Write-Host "5) ECS reconnect - pointing $EcsService at the new target group..."
    aws ecs update-service --cluster $EcsCluster --service $EcsService --load-balancers "containerName=$EcsContainerName,containerPort=$EcsContainerPort,targetGroupArn=$newTgArn" --region $ExpectedRegion --output json | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "HARD STOP: ecs update-service failed (exit $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
    $actualTgArn = aws ecs describe-services --cluster $EcsCluster --services $EcsService --region $ExpectedRegion --query "services[0].loadBalancers[0].targetGroupArn" --output text
    if ($actualTgArn -ne $newTgArn) {
        Write-Host "HARD STOP: ECS service still reports target group '$actualTgArn', expected '$newTgArn'." -ForegroundColor Red
        exit 1
    }
    Write-Host "   Verified: ECS service loadBalancers[0].targetGroupArn == $actualTgArn" -ForegroundColor Green

    Write-Host ""
    Write-Host "6) API Gateway reconnect - CloudFormation-owned sync of ChatAlbDnsName -> $newAlbDns..."
    # Phase 16A.2R: this used to be a direct `apigatewayv2 update-integration`
    # call - correct for the live resource, but invisible to CloudFormation,
    # so the API-Gateway stack's own ChatAlbDnsName parameter went stale on
    # every ALB recreation (CloudFormation drift detection can't catch it
    # either - AWS::ApiGatewayV2::Integration doesn't support drift
    # detection at all). CloudFormation is now authoritative: this creates,
    # safety-checks (reusing the Phase 16A.1-certified change-set guard), and
    # executes a narrowly-scoped UPDATE change set that may ONLY touch
    # ChatIntegration (Modify, Replacement=False) or be a true no-op -
    # anything else blocks before ever executing.
    $apiGatewayStackName = "fitness-assistant-dev-api-gateway"
    $apiGatewayTemplatePath = Join-Path $PSScriptRoot "../../infra/cloudformation/api-gateway-baseline.yaml"
    $syncResult = Sync-ChatApiGatewayIntegration -ApiGatewayStackName $apiGatewayStackName -CurrentAlbDns $newAlbDns `
        -TemplatePath $apiGatewayTemplatePath -ProtectedApiId $ApiId -Region $ExpectedRegion -Execute
    switch ($syncResult.Status) {
        "NO_SYNC_NEEDED" { Write-Host "   No sync needed ($($syncResult.Reason)) - stack ChatAlbDnsName already matches." -ForegroundColor Green }
        "NO_OP"          { Write-Host "   CloudFormation reported a true no-op ($($syncResult.Reason))." -ForegroundColor Green }
        "EXECUTED"       { Write-Host "   Reconciled via change set $($syncResult.ChangeSetName) ($($syncResult.Reason)); stack status $($syncResult.StackStatus)." -ForegroundColor Green }
        default {
            Write-Host "HARD STOP: Chat API Gateway CloudFormation sync did not complete safely (status '$($syncResult.Status)', reason '$($syncResult.Reason)')." -ForegroundColor Red
            exit 1
        }
    }
    $actualUri = aws apigatewayv2 get-integration --api-id $ApiId --integration-id $ChatIntegrationId --region $ExpectedRegion --query "IntegrationUri" --output text
    $expectedUri = "http://$newAlbDns/chat/{proxy}"
    if ($actualUri -ne $expectedUri) {
        Write-Host "HARD STOP: integration URI is '$actualUri', expected '$expectedUri'." -ForegroundColor Red
        exit 1
    }
    Write-Host "   Verified: integration $ChatIntegrationId IntegrationUri == $actualUri" -ForegroundColor Green

    Write-Host ""
    Write-Host "7) Frontend reconnect - writing + uploading runtime-config.json..."
    $runtimeConfigPath = Join-Path $env:TEMP "gymini-runtime-config.json"
    $runtimeConfig = @{ chatWsUrl = "http://$newAlbDns"; chatEnabled = $true } | ConvertTo-Json -Compress
    Set-Content -Path $runtimeConfigPath -Value $runtimeConfig -Encoding ASCII
    aws s3 cp $runtimeConfigPath "s3://$FrontendBucket/runtime-config.json" --cache-control "no-cache" --content-type "application/json" --region $ExpectedRegion
    if ($LASTEXITCODE -ne 0) {
        Write-Host "HARD STOP: s3 cp runtime-config.json failed (exit $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
    Write-Host "   Uploaded: $runtimeConfig" -ForegroundColor Green
}

if ($enableAi -eq "true" -and $newVpceId) {
    Write-Host ""
    Write-Host "9) Waiting for OpenSearch VPC endpoint to become ACTIVE..."
    $vpceState = "unknown"
    for ($i = 0; $i -lt 20; $i++) {
        $result = aws opensearchserverless batch-get-vpc-endpoint --ids $newVpceId --region $ExpectedRegion --query "vpcEndpointDetails[0].status" --output text 2>&1
        if ($LASTEXITCODE -eq 0) { $vpceState = $result }
        Write-Host "   [$i] VPCE $newVpceId status: $vpceState"
        if ($vpceState -eq "ACTIVE") { break }
        Start-Sleep -Seconds 10
    }
    if ($vpceState -ne "ACTIVE") {
        Write-Host "HARD STOP: VPC endpoint did not reach ACTIVE (last status '$vpceState')." -ForegroundColor Red
        exit 1
    }
    Write-Host "   Verified: VPCE $newVpceId is ACTIVE" -ForegroundColor Green

    Write-Host ""
    Write-Host "10) Re-pointing network policy '$AossNetworkPolicyName' at the new VPCE ID..."
    $policyExit = Set-AossNetworkPolicyVpce -PolicyName $AossNetworkPolicyName -OldVpceId "vpce-067d43742cdb6b4d4" -NewVpceId $newVpceId -Region $ExpectedRegion
    if ($policyExit -ne 0) {
        Write-Host "HARD STOP: network policy update failed (exit $policyExit)." -ForegroundColor Red
        exit 1
    }
    $verifyPolicy = aws opensearchserverless get-security-policy --name $AossNetworkPolicyName --type network --region $ExpectedRegion --output json | ConvertFrom-Json
    $verifySources = $verifyPolicy.securityPolicyDetail.policy[0].SourceVPCEs
    $verifyAllowPublic = $verifyPolicy.securityPolicyDetail.policy[0].AllowFromPublic
    if ($verifySources -notcontains $newVpceId -or $verifyAllowPublic -ne $false) {
        Write-Host "HARD STOP: policy verification failed after update." -ForegroundColor Red
        exit 1
    }
    Write-Host "   Verified: policy correctly references only the new VPCE, AllowFromPublic still false" -ForegroundColor Green
}

if ($Backend) {
    Write-Host ""
    Write-Host "8) Starting Aurora..."
    $auroraOk = Start-AuroraCluster -ClusterId $AuroraClusterId -Region $ExpectedRegion
    if (-not $auroraOk) {
        Write-Host "HARD STOP: Aurora did not reach AVAILABLE. Schedules will NOT be restored - re-run once Aurora is healthy." -ForegroundColor Red
        exit 1
    }
    Write-Host "   Aurora AVAILABLE." -ForegroundColor Green

    Write-Host ""
    Write-Host "8b) Restoring EventBridge schedules to their pre-freeze state..."
    Restore-DevSchedules -StateFile $SchedulerStateFile -Names $DevPausableSchedules -Region $ExpectedRegion
}

Write-Host ""
Write-Host "Real execution complete." -ForegroundColor Green
