<#
.SYNOPSIS
  Gymini DEV - read-only snapshot of every on-demand resource's current state.

.DESCRIPTION
  Phase 1 skeleton. This script is READ-ONLY by design (no -Execute switch
  exists - there is nothing here that should ever mutate AWS). Safe to run
  at any time, as often as wanted.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ExpectedAccount = "191798898985"
$ExpectedRegion  = "ap-southeast-1"

Write-Host "=== Gymini DEV - dev-status (read-only) ===" -ForegroundColor Cyan

$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
if ($identity.Account -ne $ExpectedAccount) {
    Write-Host "HARD STOP: account $($identity.Account) != $ExpectedAccount" -ForegroundColor Red
    exit 1
}

$auroraStatus = aws rds describe-db-clusters --db-cluster-identifier fitness-assistant-dev-aurora --region $ExpectedRegion --query "DBClusters[0].Status" --output text
Write-Host "Aurora:            $auroraStatus"

$natCount = (aws ec2 describe-nat-gateways --filter "Name=state,Values=available,pending" --region $ExpectedRegion --query "NatGateways" --output json | ConvertFrom-Json).Count
Write-Host "NAT Gateways (any): $natCount available/pending"

$albExists = "absent"
try {
    $result = aws elbv2 describe-load-balancers --names dev-chat-alb --region $ExpectedRegion --query "LoadBalancers[0].State.Code" --output text 2>&1
    if ($LASTEXITCODE -eq 0) { $albExists = $result }
} catch {
    # ALB does not exist - valid state, not an error
}
Write-Host "Chat ALB:          $albExists"

$ecsText = "service not found"
try {
    $result = aws ecs describe-services --cluster fitness-assistant-dev-cluster --services fitness-assistant-dev-chat-service --region $ExpectedRegion --query "services[0].{desired:desiredCount,running:runningCount}" --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
        $ecs = $result | ConvertFrom-Json
        $ecsText = "desired=$($ecs.desired) running=$($ecs.running)"
    }
} catch {
    # service does not exist - valid state, not an error
}
Write-Host "Chat ECS:          $ecsText"

$vpceCount = (aws ec2 describe-vpc-endpoints --filters "Name=vpc-endpoint-state,Values=available,pending" --region $ExpectedRegion --query "VpcEndpoints" --output json | ConvertFrom-Json).Count
Write-Host "VPC Interface Endpoints (any state available/pending): $vpceCount"

$secretsVpce = "absent"
try {
    $r = aws ec2 describe-vpc-endpoints --filters "Name=service-name,Values=com.amazonaws.$ExpectedRegion.secretsmanager" "Name=vpc-endpoint-state,Values=available,pending" --region $ExpectedRegion --query "VpcEndpoints[0].VpcEndpointId" --output text 2>&1
    if ($LASTEXITCODE -eq 0 -and $r -ne "None") { $secretsVpce = $r }
} catch {}
Write-Host "Secrets Manager VPCE: $secretsVpce"

# Phase 7 - EventBridge schedules that should be paused whenever Aurora is
# stopped (they all fail against an unreachable DB otherwise - confirmed
# empirically 2026-10-01, this is not a theoretical concern).
$devPausableSchedules = @(
    "fitness-assistant-dev-ai-autoaccept", "fitness-assistant-dev-ai-pubmed",
    "fitness-assistant-dev-payment-reconciliation", "fitness-assistant-dev-user-session-auto-confirm",
    "fitness-assistant-dev-user-session-settlement", "fitness-assistant-dev-ai-rss",
    "fitness-assistant-dev-workout-unfinished-reminder", "fitness-assistant-dev-ai-local-evidence",
    "fitness-assistant-dev-user-reschedule-expiry", "fitness-assistant-dev-ai-web",
    "fitness-assistant-dev-gym-membership-payout", "fitness-assistant-dev-gym-referral-settlement",
    "fitness-assistant-dev-workout-upcoming-reminder"
)
if ($auroraStatus -ne "available") {
    $enabledWhileFrozen = @()
    foreach ($name in $devPausableSchedules) {
        $s = aws scheduler get-schedule --name $name --region $ExpectedRegion --query "State" --output text 2>&1
        if ($s -eq "ENABLED") { $enabledWhileFrozen += $name }
    }
    Write-Host "Schedules ENABLED while Aurora is not available: $($enabledWhileFrozen.Count) of $($devPausableSchedules.Count)"
    if ($enabledWhileFrozen.Count -gt 0) {
        Write-Host "  WARNING: these will fail every time they fire until Aurora is started or they are paused:" -ForegroundColor Yellow
        $enabledWhileFrozen | ForEach-Object { Write-Host "    - $_" -ForegroundColor Yellow }
    }
} else {
    Write-Host "Aurora is available - schedule-pause check skipped (not expected to be frozen right now)."
}

$stackStatus = "not deployed"
try {
    $result = aws cloudformation describe-stacks --stack-name gymini-dev-on-demand --region $ExpectedRegion --query "Stacks[0].StackStatus" --output text 2>&1
    if ($LASTEXITCODE -eq 0) { $stackStatus = $result }
} catch {
    # stack does not exist - expected in Phase 1, no stack has been deployed yet
}
Write-Host "gymini-dev-on-demand stack: $stackStatus"

Write-Host ""
Write-Host "This script performed read-only AWS CLI calls only." -ForegroundColor Green
exit 0
