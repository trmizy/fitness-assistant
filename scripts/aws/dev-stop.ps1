<#
.SYNOPSIS
  Gymini DEV - tear down on-demand, hourly-cost infrastructure at the end of a work session.

.DESCRIPTION
  Phase 1 skeleton. Phase 2 wired -Network. Phase 3 wired -Chat (graceful
  frontend disable push, generalized stack-flag teardown instead of a
  blanket delete-stack, ECS detach contingency). Phase 4 wired -Ai
  (captures the VPCE ID before teardown, leaves the network policy
  referencing the now-deleted ID rather than attempting an AWS-schema-
  invalid empty update).

  Phase 7 (2026-10-01, docs/deployment/AWS_DEV_PERSISTENT_BASELINE_REDUCTION_2026-10-01.md)
  adds:
    -Backend : pauses EventBridge schedules FIRST (capturing their current
               state to .dev/aws/scheduler-state.json so dev-start.ps1 can
               restore it exactly - a schedule that was already DISABLED
               stays DISABLED), then stops Aurora (handles every
               transitional status safely).
    -Secrets : targets the Secrets Manager VPC endpoint
               (EnableSecretsManagerEndpoint -> false) via the same
               generalized stack-flag mechanism as -Network/-Chat/-Ai.
               Always explicit - never auto-implied on stop (unlike
               dev-start.ps1, where enabling Chat/AI/Backend implies it).

  Order (derived from real dependencies, not assumed): schedules are
  disabled BEFORE Aurora stops, so no newly-woken schedule can race the
  stop. Secrets Manager teardown happens LAST among the on-demand
  resources, after Aurora is already stopped and schedules are already
  paused - by that point nothing in this stack still needs it.

.PARAMETER Network
  Switch. Targets the NAT on-demand resources (EnableNatGateway -> false).

.PARAMETER Chat
  Switch. Targets the Chat on-demand resources (EnableChat -> false).

.PARAMETER Ai
  Switch. Targets the OpenSearch on-demand VPC endpoint
  (EnableOpenSearchEndpoint -> false). Never touches the collection or data.

.PARAMETER Backend
  Switch. Pauses DEV-pausable EventBridge schedules, then stops Aurora.
  Never deletes the cluster, never touches schema/data.

.PARAMETER Secrets
  Switch. Targets the Secrets Manager VPC endpoint
  (EnableSecretsManagerEndpoint -> false). Explicit only - not implied by
  -Backend/-Chat/-Ai on stop (something else may still need it).

.PARAMETER Execute
  Without this switch, the script only prints what it would do. Requires at
  least one of -Network / -Chat / -Ai / -Backend / -Secrets.
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

$ExpectedAccount = "191798898985"
$ExpectedRegion  = "ap-southeast-1"
$StackName       = "gymini-dev-on-demand"
$EcsCluster      = "fitness-assistant-dev-cluster"
$EcsService      = "fitness-assistant-dev-chat-service"
$FrontendBucket  = "fitness-assistant-frontend-dev-191798898985"
$AossNetworkPolicyName = "auto-fitness-assistant-dev-ai-ve"
$AossCollectionName = "fitness-assistant-dev-ai-vectors"
$AuroraClusterId = "fitness-assistant-dev-aurora"
$SchedulerStateFile = ".dev/aws/scheduler-state.json"
$AiTasksQueueUrl = "https://sqs.ap-southeast-1.amazonaws.com/191798898985/fitness-assistant-dev-ai-tasks"
# Schedules this automation is allowed to pause/restore (and the one it must
# never touch) now live in one shared place - see
# scripts/aws/lib/DevLifecycle.psm1 - instead of being duplicated here and
# in dev-start.ps1.
$DevPausableSchedules = Get-DevPausableSchedules
$AllKnownSchedules = Get-DevAllKnownSchedules

function Set-AossNetworkPolicyVpce {
    param([string]$PolicyName, [string]$OldVpceId, [string]$NewVpceId, [string]$Region)
    if (-not $NewVpceId) {
        Write-Host "   Skipping network policy update: removing the old VPCE ID without a replacement would leave SourceVPCEs empty, which AWS's schema rejects unless AllowFromPublic=true (never set by this script). Leaving the policy as-is - a reference to an already-deleted endpoint is inert/harmless, not a security exposure." -ForegroundColor Yellow
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
    $policyJson = ConvertTo-Json -InputObject $policyDoc -Depth 10 -Compress
    Set-Content -Path $policyJsonPath -Value $policyJson -Encoding ASCII
    aws opensearchserverless update-security-policy --name $PolicyName --type network --policy-version $policyVersion --policy "file://$policyJsonPath" --region $Region --output json | Out-Null
    return $LASTEXITCODE
}

# Full-replace safe (see dev-start.ps1's identical function for the AWS
# update-schedule contract this guards against - confirmed via
# `aws scheduler update-schedule help`, not assumed).
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

# Captures ALL known schedules' CURRENT state (so the file is a complete,
# honest snapshot even though only $PausableNames are ever toggled), then
# disables only the ones in $PausableNames that are currently ENABLED.
function Suspend-DevSchedules {
    param([string]$StateFile, [string[]]$AllNames, [string[]]$PausableNames, [string]$Region)
    $snapshot = @{}
    foreach ($name in $AllNames) {
        $snapshot[$name] = aws scheduler get-schedule --name $name --region $Region --query "State" --output text
    }
    # BUG FIX (2026-10-01, found during Phase 8's first real -Backend stop):
    # this function used to unconditionally overwrite $StateFile with
    # whatever is live RIGHT NOW. That is only correct the FIRST time it
    # runs after a genuine thaw. If called again while already frozen (an
    # idempotent re-run, or a retry after a partial failure), "live right
    # now" is already all-DISABLED, and blindly snapshotting that would
    # overwrite the real pre-freeze record with a useless all-disabled
    # snapshot - exactly the corruption this state file exists to prevent.
    # Fix: only overwrite the file when at least one pausable schedule is
    # actually transitioning (i.e., currently ENABLED). If every pausable
    # schedule is already DISABLED, there is nothing new to capture -
    # leave whatever snapshot is already on disk untouched.
    if (Test-ShouldCaptureScheduleSnapshot -CurrentStates $snapshot -PausableNames $PausableNames) {
        $stateDir = Split-Path $StateFile -Parent
        if ($stateDir -and -not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
        (ConvertTo-Json -InputObject $snapshot -Depth 5) | Set-Content -Path $StateFile -Encoding ASCII
        Write-Host "   Captured current state of $($AllNames.Count) schedules to $StateFile"
    } else {
        Write-Host "   All pausable schedules already DISABLED - leaving the existing $StateFile untouched (nothing new to capture)." -ForegroundColor Yellow
    }
    foreach ($name in $PausableNames) {
        Set-DevScheduleState -Name $name -TargetState "DISABLED" -Region $Region | Out-Null
    }
}

function Stop-AuroraCluster {
    param([string]$ClusterId, [string]$Region)
    $status = aws rds describe-db-clusters --db-cluster-identifier $ClusterId --region $Region --query "DBClusters[0].Status" --output text
    Write-Host "   Current Aurora status: $status"
    switch ($status) {
        "stopped" {
            Write-Host "   Already stopped - nothing to do." -ForegroundColor Green
            return $true
        }
        "available" {
            Write-Host "   Stopping cluster..."
            aws rds stop-db-cluster --db-cluster-identifier $ClusterId --region $Region --output json | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Host "   stop-db-cluster call failed (exit $LASTEXITCODE)." -ForegroundColor Red
                return $false
            }
        }
        "stopping" {
            Write-Host "   Already stopping - waiting, not re-issuing stop." -ForegroundColor Yellow
        }
        default {
            Write-Host "   Status '$status' is not safe to act on automatically (starting/backing-up/modifying/unknown). Refusing to issue any operation - re-run once it settles." -ForegroundColor Red
            return $false
        }
    }
    Write-Host "   Waiting for cluster to stop (RDS has no stopped-waiter - polling manually)..."
    for ($i = 0; $i -lt 60; $i++) {
        $s = aws rds describe-db-clusters --db-cluster-identifier $ClusterId --region $Region --query "DBClusters[0].Status" --output text
        Write-Host "   [$i] status: $s"
        if ($s -eq "stopped") { Write-Host "   Stopped." -ForegroundColor Green; return $true }
        Start-Sleep -Seconds 15
    }
    Write-Host "   Did not reach stopped within 15 minutes." -ForegroundColor Red
    return $false
}

Write-Host "=== Gymini DEV - dev-stop ===" -ForegroundColor Cyan

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
Write-Host "Stack name guard: $StackName"

if ($Execute -and -not ($Network -or $Chat -or $Ai -or $Backend -or $Secrets)) {
    Write-Host "HARD STOP: -Execute requires at least one of -Network/-Chat/-Ai/-Backend/-Secrets." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "1) Precondition check - Chat ECS desiredCount AND runningCount must both be 0:"
$ecsDesired = 0
$ecsRunning = 0
try {
    $result = aws ecs describe-services --cluster $EcsCluster --services $EcsService --region $ExpectedRegion --query "services[0].{d:desiredCount,r:runningCount}" --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
        $svc = $result | ConvertFrom-Json
        $ecsDesired = $svc.d
        $ecsRunning = $svc.r
    }
} catch {}
Write-Host "   Chat ECS desiredCount=$ecsDesired runningCount=$ecsRunning"
if ($ecsDesired -ne 0 -or $ecsRunning -ne 0) {
    Write-Host "HARD STOP: Chat ECS is not fully at 0/0 - refusing to tear down out from under a running task." -ForegroundColor Red
    exit 1
}
Write-Host "   OK: desiredCount=0 and runningCount=0."

if ($Backend) {
    Write-Host ""
    Write-Host "1b) Precondition check - no in-flight AI jobs (SQS queue depth):"
    $inFlight = aws sqs get-queue-attributes --queue-url $AiTasksQueueUrl --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --region $ExpectedRegion --query "Attributes" --output json | ConvertFrom-Json
    Write-Host "   Visible=$($inFlight.ApproximateNumberOfMessages) NotVisible(in-flight)=$($inFlight.ApproximateNumberOfMessagesNotVisible)"
    if ([int]$inFlight.ApproximateNumberOfMessagesNotVisible -gt 0) {
        Write-Host "HARD STOP: messages are currently in-flight (being processed) - refusing to stop Aurora underneath an active job." -ForegroundColor Red
        exit 1
    }
    Write-Host "   OK: no in-flight messages."
}

# -- Resolve desired state subtractively, with dependency protection ------
# (Phase 12A) STOP must only turn off what was explicitly requested,
# preserving everything else - and must refuse outright (no partial
# mutation at all) rather than silently breaking a still-active dependent,
# if -Secrets is requested while Backend/Chat/Ai would still be ON
# afterward. Resolved BEFORE any mutation (schedules/Aurora/runtime-config/
# CloudFormation) so an unsafe request never gets partway applied.
$currentStack = Get-CurrentStackState -StackName $StackName -Region $ExpectedRegion
if ($currentStack.StackExists -and -not $currentStack.Safe) {
    Write-Host "HARD STOP: stack '$StackName' is in status '$($currentStack.StackStatus)', not safe to read parameters from (transitional or failed state). Resolve manually (check the CloudFormation console) before continuing." -ForegroundColor Red
    exit 1
}
$auroraForDisplay = Get-CurrentAuroraState -ClusterId $AuroraClusterId -Region $ExpectedRegion
$currentState = @{
    Network = $currentStack.Network; Chat = $currentStack.Chat; Ai = $currentStack.Ai
    Secrets = $currentStack.Secrets; Backend = $auroraForDisplay.Available
}
$requestedOff = @{
    Backend = [bool]$Backend; Network = [bool]$Network; Chat = [bool]$Chat
    Ai      = [bool]$Ai;      Secrets  = [bool]$Secrets
}
$resolution = Resolve-DesiredStopState -Current $currentState -RequestedOff $requestedOff

Write-Host ""
Write-Host (Format-LifecyclePlan -Mode Stop -Current $currentState -Requested $requestedOff -Desired $resolution.Desired)
Write-Host ""

if ($resolution.Blocked) {
    Write-Host "HARD STOP: $($resolution.Reason)" -ForegroundColor Red
    exit 1
}
$desired = $resolution.Desired

if (-not $Execute) {
    Write-Host "DRY RUN (default) - the following would run, nothing was executed:" -ForegroundColor Yellow
    Write-Host ""
    if ($Chat) {
        Write-Host "2) Push graceful-disable runtime-config.json BEFORE any teardown"
    }
    Write-Host ""
    Write-Host "3) Apply resolved target state to the stack (only the requested flag(s) change, everything else preserved)"
    if ($Backend) {
        Write-Host ""
        Write-Host "8) Suspend DEV-pausable schedules (capture state to $SchedulerStateFile first), then stop Aurora"
    }
    Write-Host ""
    Write-Host "9) Run the cost leak check separately: ./scripts/aws/dev-cost-leak-check.ps1"
    Write-Host ""
    Write-Host "Nothing was executed against AWS by this script." -ForegroundColor Green
    exit 0
}

# -- Real execution --------------------------------------------------------
Write-Host ""
Write-Host "-Execute passed. Tearing down requested on-demand resources." -ForegroundColor Yellow

if ($Backend) {
    Write-Host ""
    Write-Host "2a) Suspending DEV-pausable schedules (capturing state first)..."
    Suspend-DevSchedules -StateFile $SchedulerStateFile -AllNames $AllKnownSchedules -PausableNames $DevPausableSchedules -Region $ExpectedRegion
}

if ($Chat) {
    Write-Host ""
    Write-Host "2b) Pushing graceful-disable runtime-config.json BEFORE any teardown..."
    $runtimeConfigPath = Join-Path $env:TEMP "gymini-runtime-config-disable.json"
    $runtimeConfig = @{ chatWsUrl = ""; chatEnabled = $false } | ConvertTo-Json -Compress
    Set-Content -Path $runtimeConfigPath -Value $runtimeConfig -Encoding ASCII
    aws s3 cp $runtimeConfigPath "s3://$FrontendBucket/runtime-config.json" --cache-control "no-cache" --content-type "application/json" --region $ExpectedRegion
    if ($LASTEXITCODE -ne 0) {
        Write-Host "HARD STOP: s3 cp runtime-config.json (disable) failed (exit $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
    Write-Host "   Uploaded: $runtimeConfig" -ForegroundColor Green
}

if ($Backend) {
    Write-Host ""
    Write-Host "2c) Stopping Aurora..."
    $auroraOk = Stop-AuroraCluster -ClusterId $AuroraClusterId -Region $ExpectedRegion
    if (-not $auroraOk) {
        Write-Host "HARD STOP: Aurora did not reach stopped." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "3) Applying resolved target state (already computed above, before any mutation)..."
$stackExists = $currentStack.StackExists

if (-not $stackExists) {
    Write-Host "   Stack does not exist - nothing to tear down on the CloudFormation side." -ForegroundColor Yellow
    if (-not ($Network -or $Chat -or $Ai -or $Secrets)) { exit 0 }
} else {

$curAi = if ($currentStack.Ai) { "true" } else { "false" }

$targetNat = if ($desired.Network) { "true" } else { "false" }
$targetChat = if ($desired.Chat) { "true" } else { "false" }
$targetAi = if ($desired.Ai) { "true" } else { "false" }
$targetSecrets = if ($desired.Secrets) { "true" } else { "false" }
Write-Host "   Target:  EnableNatGateway=$targetNat EnableChat=$targetChat EnableOpenSearchEndpoint=$targetAi EnableSecretsManagerEndpoint=$targetSecrets"

$oldVpceIdBeforeTeardown = $null
if ($Ai -and $curAi -eq "true") {
    Write-Host ""
    Write-Host "   Capturing current on-demand VPCE ID (from the stack, before any teardown)..."
    try {
        $r = aws cloudformation describe-stacks --stack-name $StackName --region $ExpectedRegion --query "Stacks[0].Outputs[?OutputKey=='OpenSearchVpcEndpointId'].OutputValue | [0]" --output text 2>&1
        if ($LASTEXITCODE -eq 0 -and $r -ne "None") { $oldVpceIdBeforeTeardown = $r }
    } catch {}
    Write-Host "   Current on-demand VPCE ID: $oldVpceIdBeforeTeardown"
}

function Remove-OnDemandStackResources {
    param([string]$TargetNat, [string]$TargetChat, [string]$TargetAi, [string]$TargetSecrets, [switch]$AllFalse)
    if ($AllFalse) {
        aws cloudformation delete-stack --stack-name $StackName --region $ExpectedRegion
        if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
        aws cloudformation wait stack-delete-complete --stack-name $StackName --region $ExpectedRegion
        return $LASTEXITCODE
    } else {
        $VpcId = "vpc-010c13afd8920c8f1"
        $PublicSubnetId = "subnet-0f1a5fcd6ed0401ee"
        $PrivateSubnetIds = "subnet-09e3230f7bca04c8e,subnet-02b39d77762465ef8"
        $ChatAlbSubnetIds = "subnet-043180192466a53b5,subnet-0f1a5fcd6ed0401ee"
        $PrivateRouteTableId = "rtb-0f743d4fd0949f9aa"
        $LambdaSecurityGroupId = "sg-0b38ab22927b284ab"
        $ChatAlbSecurityGroupId = "sg-0ed91f8e8a4617d62"
        $SecretsManagerVpceSecurityGroupId = "sg-0198527f052b3f386"
        # IMPORTANT: unredirected native-command stdout inside a PowerShell
        # function becomes part of the function's own return pipeline when
        # the caller captures it (`$x = Some-Function`). `aws cloudformation
        # deploy` always prints progress text ("Waiting for changeset...",
        # "No changes to deploy...") even on success - without `| Out-Null`
        # that text gets mixed into $exitCode as a multi-element array, and
        # `-ne 0` against an array is always truthy, causing a false-positive
        # failure even when the deploy succeeded. Confirmed empirically
        # 2026-10-01 (Phase 8's first real -Backend stop hit exactly this).
        aws cloudformation deploy `
            --template-file infra/cloudformation/dev-on-demand.yaml `
            --stack-name $StackName `
            --region $ExpectedRegion `
            --parameter-overrides EnvironmentName=dev VpcId=$VpcId PublicSubnetId=$PublicSubnetId PrivateSubnetIds=$PrivateSubnetIds ChatAlbSubnetIds=$ChatAlbSubnetIds PrivateRouteTableId=$PrivateRouteTableId LambdaSecurityGroupId=$LambdaSecurityGroupId ChatAlbSecurityGroupId=$ChatAlbSecurityGroupId ApiGatewayId=id1iz7upbl OpenSearchCollectionName=fitness-assistant-dev-ai-vectors SecretsManagerVpceSecurityGroupId=$SecretsManagerVpceSecurityGroupId EnableNatGateway=$TargetNat EnableChat=$TargetChat EnableOpenSearchEndpoint=$TargetAi EnableSecretsManagerEndpoint=$TargetSecrets `
            --no-fail-on-empty-changeset | Out-Null
        return $LASTEXITCODE
    }
}

$allFalse = ($targetNat -eq "false" -and $targetChat -eq "false" -and $targetAi -eq "false" -and $targetSecrets -eq "false")
Write-Host ""
if ($allFalse) {
    Write-Host "4) All flags would be false - deleting the whole stack..."
} else {
    Write-Host "4) Updating stack (targeted flags off, others preserved)..."
}
$exitCode = Remove-OnDemandStackResources -TargetNat $targetNat -TargetChat $targetChat -TargetAi $targetAi -TargetSecrets $targetSecrets -AllFalse:$allFalse

if ($exitCode -ne 0 -and $Chat) {
    Write-Host "   Stack operation failed (exit $exitCode) - checking whether ECS's stored target-group reference is blocking deletion..." -ForegroundColor Yellow
    aws ecs update-service --cluster $EcsCluster --service $EcsService --load-balancers "[]" --region $ExpectedRegion --output json | Out-Null
    Write-Host "   Performed minimum safe detach. Retrying stack operation once..."
    $exitCode = Remove-OnDemandStackResources -TargetNat $targetNat -TargetChat $targetChat -TargetAi $targetAi -TargetSecrets $targetSecrets -AllFalse:$allFalse
}

if ($exitCode -ne 0) {
    Write-Host "HARD STOP: stack operation ultimately failed (exit $exitCode)." -ForegroundColor Red
    exit 1
}
Write-Host "Stack operation succeeded." -ForegroundColor Green

if ($Ai -and $oldVpceIdBeforeTeardown) {
    Write-Host ""
    Write-Host "4b) Network policy: AWS's schema requires SourceVPCEs to have >= 1 entry unless AllowFromPublic=true - leaving the policy referencing the now-deleted, inert VPCE ID rather than attempting an invalid empty update."
    Set-AossNetworkPolicyVpce -PolicyName $AossNetworkPolicyName -OldVpceId $oldVpceIdBeforeTeardown -NewVpceId $null -Region $ExpectedRegion | Out-Null
    $verifyPolicy = aws opensearchserverless get-security-policy --name $AossNetworkPolicyName --type network --region $ExpectedRegion --output json | ConvertFrom-Json
    if ($verifyPolicy.securityPolicyDetail.policy[0].AllowFromPublic -ne $false) {
        Write-Host "HARD STOP: AllowFromPublic is not false - refusing to continue." -ForegroundColor Red
        exit 1
    }
    $collStatus = aws opensearchserverless batch-get-collection --names $AossCollectionName --region $ExpectedRegion --query "collectionDetails[0].status" --output text
    Write-Host "   Collection status: $collStatus"
}

Write-Host ""
Write-Host "5) Verifying removal (read-only)..."
if ($Network) {
    $nats = aws ec2 describe-nat-gateways --filter "Name=state,Values=available,pending" --region $ExpectedRegion --query "NatGateways[].NatGatewayId" --output json | ConvertFrom-Json
    Write-Host "   NAT gateways still available/pending: $($nats.Count)"
}
if ($Chat) {
    $albState = "absent"
    try {
        $r = aws elbv2 describe-load-balancers --names dev-chat-alb --region $ExpectedRegion --query "LoadBalancers[0].State.Code" --output text 2>&1
        if ($LASTEXITCODE -eq 0) { $albState = $r }
    } catch {}
    Write-Host "   Chat ALB: $albState"
}
if ($Ai) {
    Write-Host "   (OpenSearch collection/indexes/data left intact.)"
}
if ($Secrets) {
    $sVpceCount = (aws ec2 describe-vpc-endpoints --filters "Name=vpc-endpoint-state,Values=available,pending" "Name=service-name,Values=com.amazonaws.$ExpectedRegion.secretsmanager" --region $ExpectedRegion --query "VpcEndpoints[?Tags[?Value=='gymini-dev-on-demand']] | length(@)" --output text)
    Write-Host "   On-demand Secrets Manager VPCEs still present: $sVpceCount"
}

} # end stackExists branch

Write-Host ""
Write-Host "6) Run the cost leak check separately: ./scripts/aws/dev-cost-leak-check.ps1"

Write-Host ""
Write-Host "Real execution complete." -ForegroundColor Green
if ($Backend) {
    Write-Host "Reminder: Aurora auto-restarts itself after 7 days of being stopped." -ForegroundColor Yellow
}
