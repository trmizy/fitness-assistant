<#
.SYNOPSIS
  Gymini DEV - read-only verification that no accidental hourly-cost resource
  remains after a dev-stop cycle.

.DESCRIPTION
  Phase 1 skeleton (see docs/deployment/AWS_DEV_EMERGENCY_COST_AUDIT_2026-10-01.md
  and AWS_DEV_ON_DEMAND_INFRA_DESIGN_2026-10-01.md). 100% READ-ONLY - no
  -Execute switch exists, nothing here should ever mutate AWS. Intended to
  be run right after dev-stop.ps1 to confirm the shutdown actually worked,
  and periodically as a standalone sanity check.

  Expected POST-SHUTDOWN state:
    Aurora:                         stopped or stopping
    NAT Gateways:                   0 (tagged managed-by=gymini-dev-on-demand)
    Chat ALB:                       absent (if the on-demand stack had it enabled)
    Chat ECS:                       desiredCount=0, runningCount=0
    OpenSearch Serverless endpoint: absent (if AI/RAG mode was enabled)
    Secrets Manager VPC endpoint:   Phase 7 - now ON-DEMAND. Only a leak if
                                       PRESENT while nothing else in the
                                       stack (Chat/AI/running ECS) needs it.
    EventBridge schedules:          all DEV-pausable ones DISABLED if Aurora
                                       is not available (they fail every
                                       cycle otherwise - confirmed empirically)
    EC2 instances:                  0 (this project has never used any)
    Unattached EBS volumes:         0 (flag any found - these are pure waste
                                       regardless of dev-start/dev-stop state)
    Unexpected public IPv4 allocations: 0 beyond what's explained by
                                       persistent resources

  Exit code: 0 if no leak found, 1 if any unexpected billable resource is
  still present.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ExpectedAccount = "191798898985"
$ExpectedRegion  = "ap-southeast-1"

Write-Host "=== Gymini DEV - dev-cost-leak-check (read-only) ===" -ForegroundColor Cyan

$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
if ($identity.Account -ne $ExpectedAccount) {
    Write-Host "HARD STOP: account $($identity.Account) != $ExpectedAccount" -ForegroundColor Red
    exit 1
}

$leaks = @()

# -- Aurora --------------------------------------------------------------
$auroraStatus = aws rds describe-db-clusters --db-cluster-identifier fitness-assistant-dev-aurora --region $ExpectedRegion --query "DBClusters[0].Status" --output text
Write-Host "Aurora status:                    $auroraStatus"
if ($auroraStatus -notin @("stopped", "stopping")) {
    $leaks += "Aurora is '$auroraStatus', not stopped/stopping - still accruing ACU-hour charges."
}
$auroraFrozen = $auroraStatus -in @("stopped", "stopping")

# -- NAT Gateways (any, not just tagged - belt and suspenders) ----------
$nats = aws ec2 describe-nat-gateways --filter "Name=state,Values=available,pending" --region $ExpectedRegion --query "NatGateways[].NatGatewayId" --output json | ConvertFrom-Json
Write-Host "NAT Gateways available/pending:   $($nats.Count)"
if ($nats.Count -gt 0) {
    $leaks += "NAT Gateway(s) still present: $($nats -join ', ') - ~`$0.059/hr each."
}

# -- Chat ALB --------------------------------------------------------------
$albState = "absent"
try {
    $result = aws elbv2 describe-load-balancers --names dev-chat-alb --region $ExpectedRegion --query "LoadBalancers[0].State.Code" --output text 2>&1
    if ($LASTEXITCODE -eq 0) { $albState = $result }
} catch {}
Write-Host "Chat ALB state:                   $albState"
if ($albState -eq "active") {
    $leaks += "Chat ALB is still active - idle hourly + LCU charges even with 0 healthy targets."
}

# -- Chat ECS --------------------------------------------------------------
$ecsDesired = 0
$ecsRunning = 0
try {
    $result = aws ecs describe-services --cluster fitness-assistant-dev-cluster --services fitness-assistant-dev-chat-service --region $ExpectedRegion --query "services[0].{desired:desiredCount,running:runningCount}" --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
        $ecs = $result | ConvertFrom-Json
        $ecsDesired = $ecs.desired
        $ecsRunning = $ecs.running
    }
} catch {}
Write-Host "Chat ECS desired/running:         $ecsDesired/$ecsRunning"
if ($ecsRunning -gt 0) {
    $leaks += "Chat ECS has $ecsRunning running task(s) - active Fargate compute charges."
}

# -- VPC Interface Endpoints --------------------------------------------
# Phase 7: Secrets Manager's endpoint is now ON-DEMAND too, not
# automatically persistent. It is only a leak if PRESENT while nothing
# else in the stack (Chat ALB active, OpenSearch VPCE, running ECS tasks)
# still needs it - any of those legitimately imply it on dev-start.ps1.
$secretsNeeded = ($albState -eq "active") -or ($ecsRunning -gt 0)
$vpces = aws ec2 describe-vpc-endpoints --filters "Name=vpc-endpoint-state,Values=available,pending" --region $ExpectedRegion --query "VpcEndpoints[].{Id:VpcEndpointId,Service:ServiceName}" --output json | ConvertFrom-Json
Write-Host "VPC Interface Endpoints present:  $($vpces.Count)"
foreach ($v in $vpces) {
    $isSecrets = $v.Service -like "*secretsmanager*"
    $tag = if ($isSecrets -and $secretsNeeded) { "(expected - Chat/ECS currently needs it)" }
           elseif ($isSecrets) { "(leak candidate - nothing currently needs it)" }
           else { "(likely OpenSearch Serverless - verify against -Ai state)" }
    Write-Host "  - $($v.Id) : $($v.Service) $tag"
}
$secretsEndpoints = $vpces | Where-Object { $_.Service -like "*secretsmanager*" }
if ($secretsEndpoints.Count -gt 0 -and -not $secretsNeeded) {
    $leaks += "Secrets Manager VPC endpoint present but nothing currently needs it (Chat ALB not active, no running ECS tasks) - ~`$14.60/month if left idle. Run dev-stop.ps1 -Secrets -Execute."
}
$nonSecretsEndpoints = $vpces | Where-Object { $_.Service -notlike "*secretsmanager*" }
if ($nonSecretsEndpoints.Count -gt 0) {
    $leaks += "Non-Secrets-Manager VPC endpoint(s) still present: $($nonSecretsEndpoints.Id -join ', ') - ~`$0.01/hr per AZ each. (Likely OpenSearch Serverless - verify against intended -Ai state.)"
}

# -- EventBridge schedules that should be paused while Aurora is frozen --
$devPausableSchedules = @(
    "fitness-assistant-dev-ai-autoaccept", "fitness-assistant-dev-ai-pubmed",
    "fitness-assistant-dev-payment-reconciliation", "fitness-assistant-dev-user-session-auto-confirm",
    "fitness-assistant-dev-user-session-settlement", "fitness-assistant-dev-ai-rss",
    "fitness-assistant-dev-workout-unfinished-reminder", "fitness-assistant-dev-ai-local-evidence",
    "fitness-assistant-dev-user-reschedule-expiry", "fitness-assistant-dev-ai-web",
    "fitness-assistant-dev-gym-membership-payout", "fitness-assistant-dev-gym-referral-settlement",
    "fitness-assistant-dev-workout-upcoming-reminder"
)
if ($auroraFrozen) {
    $enabledWhileFrozen = @()
    foreach ($name in $devPausableSchedules) {
        $s = aws scheduler get-schedule --name $name --region $ExpectedRegion --query "State" --output text 2>&1
        if ($s -eq "ENABLED") { $enabledWhileFrozen += $name }
    }
    Write-Host "EventBridge schedules ENABLED while Aurora frozen: $($enabledWhileFrozen.Count) of $($devPausableSchedules.Count)"
    if ($enabledWhileFrozen.Count -gt 0) {
        $leaks += "EventBridge schedule(s) still ENABLED while Aurora is frozen - each will fail every cycle: $($enabledWhileFrozen -join ', ')"
    }
}

# -- EC2 instances -----------------------------------------------------
$instances = aws ec2 describe-instances --region $ExpectedRegion --query "Reservations[].Instances[?State.Name!='terminated'].InstanceId" --output json | ConvertFrom-Json
$instanceCount = ($instances | ForEach-Object { $_ } | Measure-Object).Count
Write-Host "EC2 instances (non-terminated):   $instanceCount"
if ($instanceCount -gt 0) {
    $leaks += "EC2 instance(s) found - this project has never intentionally used EC2. Investigate."
}

# -- Unattached EBS volumes (always a leak, independent of dev-start/stop) --
$volumes = aws ec2 describe-volumes --filters "Name=status,Values=available" --region $ExpectedRegion --query "Volumes[].VolumeId" --output json | ConvertFrom-Json
Write-Host "Unattached EBS volumes:           $($volumes.Count)"
if ($volumes.Count -gt 0) {
    $leaks += "Unattached EBS volume(s): $($volumes -join ', ') - pure waste, no instance uses them."
}

# -- Public IPv4 allocations (informational count only - exact "expected" count depends on which on-demand resources are up) --
$eips = aws ec2 describe-addresses --region $ExpectedRegion --query "Addresses[].AllocationId" --output json | ConvertFrom-Json
Write-Host "Elastic IPs allocated:            $($eips.Count) (each bills ~`$0.005/hr while associated, per AWS's 2024 public-IPv4 pricing)"

Write-Host ""
if ($leaks.Count -eq 0) {
    Write-Host "No cost leak detected." -ForegroundColor Green
    exit 0
} else {
    Write-Host "COST LEAK(S) DETECTED:" -ForegroundColor Red
    foreach ($l in $leaks) { Write-Host "  - $l" -ForegroundColor Red }
    exit 1
}
