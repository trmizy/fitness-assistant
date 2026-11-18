<#
.SYNOPSIS
  Gymini DEV - on-demand RDS Proxy (+ read-only endpoint onto the Aurora reader). Dry run by default.

.DESCRIPTION
  Stack: fitness-assistant-dev-rds-proxy (infra/cloudformation/dev-rds-proxy.yaml). Standalone on purpose: it does
  not touch dev-on-demand.yaml or dev-start.ps1.

  -Action Status : show the stack, the proxy and which host every service secret points at.
  -Action Up     : deploy the stack (~17 min, Aurora must be available). It does NOT switch any service; use
                   `node scripts/aws/dev-rds-proxy-switch.mjs apply --service <name> --execute` for that.
  -Action Down   : restore EVERY service secret to the Aurora cluster endpoint (from the saved original hosts), recycle
                   the Lambdas, and only if that succeeded delete the stack. If the restore fails the stack is KEPT
                   (deleting a proxy that secrets still point at would take the services' database away); exit 1.

  dev-stop.ps1 -Backend calls `-Action Down -Execute` before it stops Aurora, so the proxy (billed per ACU-hour, an
  AWS-set minimum capacity applies) never outlives a DEV session.

.PARAMETER Execute
  Without it, the script only prints what it would do.
#>
[CmdletBinding()]
param(
    [ValidateSet("Status", "Up", "Down")] [string]$Action = "Status",
    [switch]$Execute
)

$ErrorActionPreference = "Stop"
$ExpectedAccount = "191798898985"
$Region = "ap-southeast-1"
$StackName = "fitness-assistant-dev-rds-proxy"
$Template = "infra/cloudformation/dev-rds-proxy.yaml"
$SwitchTool = Join-Path $PSScriptRoot "dev-rds-proxy-switch.mjs"
$AuroraClusterId = "fitness-assistant-dev-aurora"

$account = aws sts get-caller-identity --query Account --output text
if ($account -ne $ExpectedAccount) { Write-Host "HARD STOP: wrong AWS account '$account'." -ForegroundColor Red; exit 1 }

function Get-ProxyStackStatus {
    $s = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].StackStatus" --output text 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return $s
}

$status = Get-ProxyStackStatus
Write-Host "=== Gymini DEV - RDS Proxy ($Action$(if ($Execute) { ', EXECUTE' } else { ', dry run' })) ==="
Write-Host "Proxy stack: $(if ($status) { $status } else { 'absent' })"

switch ($Action) {
    "Status" {
        node $SwitchTool status
        exit $LASTEXITCODE
    }
    "Up" {
        if ($status) { Write-Host "Stack already exists ($status) - nothing to do."; exit 0 }
        $auroraStatus = aws rds describe-db-clusters --db-cluster-identifier $AuroraClusterId --region $Region --query "DBClusters[0].Status" --output text
        Write-Host "Aurora status: $auroraStatus"
        if ($auroraStatus -ne "available") { Write-Host "HARD STOP: Aurora must be available before creating the proxy." -ForegroundColor Red; exit 1 }
        $secretArn = aws secretsmanager describe-secret --secret-id fitness-assistant/dev/database --region $Region --query ARN --output text
        if (-not $Execute) {
            Write-Host "DRY RUN - would deploy $Template as $StackName (6 resources, ~17 min). Nothing executed."
            exit 0
        }
        aws cloudformation deploy --template-file $Template --stack-name $StackName --region $Region --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset `
            --parameter-overrides VpcId=vpc-010c13afd8920c8f1 DbSubnetIds=subnet-0a9c45024d2981cba,subnet-067e483879e5c50e0 LambdaSecurityGroupId=sg-0b38ab22927b284ab AuroraSecurityGroupId=sg-00e8e01671812bf44 DbSecretArn=$secretArn | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Host "HARD STOP: stack deploy failed." -ForegroundColor Red; exit 1 }
        Write-Host "Proxy stack deployed. No service was switched." -ForegroundColor Green
        exit 0
    }
    "Down" {
        if (-not $status) { Write-Host "No proxy stack - nothing to tear down." -ForegroundColor Green; exit 0 }
        if (-not $Execute) {
            Write-Host "DRY RUN - would (1) restore all service secrets to the Aurora cluster endpoint and recycle their Lambdas,"
            Write-Host "         (2) delete stack $StackName only if (1) succeeded. Nothing executed."
            node $SwitchTool rollback --all
            exit 0
        }
        Write-Host "1) Restoring every service secret to the cluster endpoint..."
        node $SwitchTool rollback --all --execute
        if ($LASTEXITCODE -ne 0) {
            Write-Host "RESTORE FAILED - proxy stack KEPT (secrets may still point at it). Fix, then re-run: dev-rds-proxy.ps1 -Action Down -Execute" -ForegroundColor Red
            exit 1
        }
        $left = (node $SwitchTool status | Select-String -Pattern "-> PROXY").Count
        if ($left -gt 0) { Write-Host "HARD STOP: $left secret(s) still point at the proxy - stack KEPT." -ForegroundColor Red; exit 1 }
        Write-Host "2) All hosts are back on the cluster endpoint. Deleting stack $StackName..."
        aws cloudformation delete-stack --stack-name $StackName --region $Region
        aws cloudformation wait stack-delete-complete --stack-name $StackName --region $Region
        if ($LASTEXITCODE -ne 0) { Write-Host "Stack delete did not complete - check CloudFormation events." -ForegroundColor Red; exit 1 }
        Write-Host "Proxy stack deleted." -ForegroundColor Green
        exit 0
    }
}
