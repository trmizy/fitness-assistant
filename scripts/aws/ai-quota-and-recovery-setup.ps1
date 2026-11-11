<#
.SYNOPSIS
  V-T012 DEP-01 — creates the AWS pieces the AI generation flow needs (additive only). DRY-RUN by default: prints every command.

.DESCRIPTION
  Evidence (read-only audit 2026-10-20, docs/architecture/gymini-implementation/V-T012_DEP01_AWS_CONFIG_REVIEW.md):
    * DynamoDB table fitness-assistant-dev-ai-rate-limit does NOT exist and no AI role may call DynamoDB, so the shared quota
      (RATE_LIMIT_PROVIDER=dynamodb) cannot be enabled yet.
    * No EventBridge schedule triggers the `ai-generation-recovery` job of the ai-jobs Lambda.
  Steps (each is additive and independently reversible; rollback commands are printed at the end):
    1. DynamoDB table (on-demand, PK `key` S) + TTL attribute `expiresAt`.
    2. Inline IAM policy (dynamodb:UpdateItem on that table only) for the roles that run AI HTTP/worker code.
    3. EventBridge Scheduler `fitness-assistant-dev-ai-generation-recovery`, rate(5 minutes), created DISABLED (dev is intentionally
       powered down; enable it with the normal aws-dev-power flow).
  NOT done here (deliberately): setting RATE_LIMIT_PROVIDER / AI_GENERATION_LEASE_SECONDS on the Lambdas. `update-function-configuration`
  REPLACES the whole environment block (which holds secrets) and the deployed code does not contain the new provider yet, so do it with
  -ApplyLambdaEnv only AFTER the new ai-service build is deployed and the table exists (order matters: with the provider on and no table the
  limiter fails closed and blocks every paid AI call).

.PARAMETER Apply            actually run the commands (default: print only)
.PARAMETER ApplyLambdaEnv   merge the quota/lease variables into the AI Lambdas' existing environment (never prints values)
#>
param(
  [switch]$Apply,
  [switch]$ApplyLambdaEnv,
  [string]$Profile = "gymini-admin",
  [string]$Region = "ap-southeast-1",
  [string]$Account = "191798898985"
)
$ErrorActionPreference = "Stop"
$env:AWS_PROFILE = $Profile; $env:AWS_REGION = $Region; $env:AWS_DEFAULT_REGION = $Region
$Table = "fitness-assistant-dev-ai-rate-limit"
$TableArn = "arn:aws:dynamodb:${Region}:${Account}:table/$Table"
$Roles = @("fitness-assistant-dev-ai-lambda-role", "fitness-assistant-dev-ai-worker-role")
$ScheduleName = "fitness-assistant-dev-ai-generation-recovery"
$JobsArn = "arn:aws:lambda:${Region}:${Account}:function:fitness-assistant-dev-ai-jobs"
$SchedulerRole = "arn:aws:iam::${Account}:role/fitness-assistant-dev-ai-jobs-scheduler-role"

function Run([string[]]$cmd) {
  Write-Host ("> aws " + ($cmd -join " ")) -ForegroundColor Cyan
  if ($Apply) { & aws @cmd; if ($LASTEXITCODE -ne 0) { throw "aws failed: $($cmd[0]) $($cmd[1])" } }
}

# sanity: right account
$who = (& aws sts get-caller-identity --query Account --output text)
if ($who -ne $Account) { throw "Wrong AWS account ($who), expected $Account" }

Write-Host "== 1. DynamoDB table + TTL" -ForegroundColor Yellow
Run @("dynamodb", "create-table", "--table-name", $Table, "--attribute-definitions", "AttributeName=key,AttributeType=S", "--key-schema", "AttributeName=key,KeyType=HASH", "--billing-mode", "PAY_PER_REQUEST", "--tags", "Key=Project,Value=fitness-assistant", "Key=Env,Value=dev", "Key=Purpose,Value=ai-quota")
if ($Apply) { & aws dynamodb wait table-exists --table-name $Table }
Run @("dynamodb", "update-time-to-live", "--table-name", $Table, "--time-to-live-specification", "Enabled=true,AttributeName=expiresAt")

Write-Host "== 2. IAM: UpdateItem on the quota table only" -ForegroundColor Yellow
$policy = @{ Version = "2012-10-17"; Statement = @(@{ Effect = "Allow"; Action = @("dynamodb:UpdateItem"); Resource = $TableArn }) } | ConvertTo-Json -Depth 6 -Compress
$policyFile = Join-Path $env:TEMP "ai-quota-policy.json"
Set-Content -Path $policyFile -Value $policy -Encoding ascii
foreach ($role in $Roles) {
  Run @("iam", "put-role-policy", "--role-name", $role, "--policy-name", "fitness-assistant-dev-ai-rate-limit-access", "--policy-document", "file://$policyFile")
}

Write-Host "== 3. EventBridge Scheduler (DISABLED)" -ForegroundColor Yellow
$target = @{ Arn = $JobsArn; RoleArn = $SchedulerRole; Input = '{"job":"ai-generation-recovery"}'; RetryPolicy = @{ MaximumEventAgeInSeconds = 300; MaximumRetryAttempts = 2 } } | ConvertTo-Json -Depth 6 -Compress
$targetFile = Join-Path $env:TEMP "ai-recovery-target.json"
Set-Content -Path $targetFile -Value $target -Encoding ascii
Run @("scheduler", "create-schedule", "--name", $ScheduleName, "--schedule-expression", "rate(5 minutes)", "--flexible-time-window", "Mode=OFF", "--state", "DISABLED", "--target", "file://$targetFile", "--description", "V-T012: recovers stranded AI generation operations and replays missed nutrition auto-saves (kept DISABLED while dev is powered down)")

if ($ApplyLambdaEnv) {
  Write-Host "== 4. Lambda environment (merge, values never printed)" -ForegroundColor Yellow
  $add = @{ RATE_LIMIT_PROVIDER = "dynamodb"; AI_GENERATION_LEASE_SECONDS = "330" }
  foreach ($fn in @("fitness-assistant-dev-ai", "fitness-assistant-dev-ai-worker")) {
    $cur = (& aws lambda get-function-configuration --function-name $fn --query "Environment.Variables" --output json) | ConvertFrom-Json
    $merged = @{}; foreach ($p in $cur.PSObject.Properties) { $merged[$p.Name] = $p.Value }
    foreach ($k in $add.Keys) { $merged[$k] = $add[$k] }
    $file = Join-Path $env:TEMP "$fn-env.json"
    (@{ Variables = $merged } | ConvertTo-Json -Depth 4 -Compress) | Set-Content -Path $file -Encoding ascii
    Write-Host "> aws lambda update-function-configuration --function-name $fn --environment file://<merged env: $($merged.Count) variables, +$($add.Keys -join ',')>" -ForegroundColor Cyan
    if ($Apply) { & aws lambda update-function-configuration --function-name $fn --environment "file://$file" --query "LastUpdateStatus" --output text; Remove-Item $file -Force }
  }
}

Write-Host ""
Write-Host "Rollback (all additive):" -ForegroundColor Green
Write-Host "  aws scheduler delete-schedule --name $ScheduleName"
foreach ($role in $Roles) { Write-Host "  aws iam delete-role-policy --role-name $role --policy-name fitness-assistant-dev-ai-rate-limit-access" }
Write-Host "  aws dynamodb delete-table --table-name $Table      # only after RATE_LIMIT_PROVIDER is removed from the Lambdas"
if (-not $Apply) { Write-Host "`nDRY-RUN: nothing was changed. Re-run with -Apply." -ForegroundColor Yellow }
