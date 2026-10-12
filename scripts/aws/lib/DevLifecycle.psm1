<#
.SYNOPSIS
  Gymini DEV on-demand lifecycle — pure state-resolution logic, shared by
  dev-start.ps1 and dev-stop.ps1.

.DESCRIPTION
  Phase 12A (docs/deployment/AWS_DEV_LIFECYCLE_STATE_FIX_2026-10-07.md).

  Root cause being fixed: dev-start.ps1/dev-stop.ps1 used to compute the
  desired CloudFormation parameter set from ONLY the switches passed to that
  one invocation, defaulting every unmentioned flag to "false" (start) or
  leaving it unexamined (stop). Calling `dev-start.ps1 -Network -Execute`
  after an earlier, separate `-Backend -Execute` call had turned
  EnableSecretsManagerEndpoint on therefore silently turned it back OFF -
  "START" was not additive.

  Fix: every resolution function here is PURE (no AWS calls, no I/O) and
  takes the CURRENT state (read by the caller from the live CloudFormation
  stack parameters + Aurora's live status) plus the flags REQUESTED this
  invocation, and returns the DESIRED state as their set union (start) or
  set difference with dependency protection (stop). This file has no
  dependency on AWS - every function here can be unit-tested with Pester
  using synthetic hashtables only (see
  scripts/aws/lib/DevLifecycle.Tests.ps1).

  Subsystem model (confirmed by reading infra/cloudformation/dev-on-demand.yaml
  and the live stack, not assumed from documentation):
    - Network, Chat, Ai, Secrets are REAL CloudFormation parameters
      (EnableNatGateway / EnableChat / EnableOpenSearchEndpoint /
      EnableSecretsManagerEndpoint) - their current value is only knowable by
      reading the live stack's Parameters (or "all false" if the stack does
      not exist).
    - Backend is NOT a CloudFormation parameter at all - Aurora is started/
      stopped directly via the RDS API, entirely outside this stack. Its
      current state is Aurora's own live cluster status (available = ON).
      It still participates in the Secrets dependency calculation below.

  Dependency rule (confirmed in the original scripts' own comments, preserved
  here unchanged): Backend, Chat, and Ai each require Secrets. Network does
  not.
#>

Set-StrictMode -Version Latest

# The one true list of DEV-pausable EventBridge schedules, and the one
# schedule that must never be touched by this automation in either
# direction (independently DISABLED for an unrelated product reason).
# Previously duplicated verbatim in both dev-start.ps1 and dev-stop.ps1 -
# hoisted here so there is exactly one place to get this list right.
$Script:DevPausableSchedules = @(
    "fitness-assistant-dev-ai-autoaccept",
    "fitness-assistant-dev-ai-pubmed",
    "fitness-assistant-dev-payment-reconciliation",
    "fitness-assistant-dev-user-session-auto-confirm",
    "fitness-assistant-dev-user-session-settlement",
    "fitness-assistant-dev-ai-rss",
    "fitness-assistant-dev-workout-unfinished-reminder",
    "fitness-assistant-dev-ai-local-evidence",
    "fitness-assistant-dev-user-reschedule-expiry",
    "fitness-assistant-dev-ai-web",
    "fitness-assistant-dev-gym-membership-payout",
    "fitness-assistant-dev-gym-referral-settlement",
    "fitness-assistant-dev-workout-upcoming-reminder"
)
$Script:IndependentSchedule = "fitness-assistant-dev-gym-partner-upload-sweep"
$Script:AllKnownSchedules = $Script:DevPausableSchedules + @($Script:IndependentSchedule)

function Get-DevPausableSchedules { $Script:DevPausableSchedules }
function Get-DevIndependentSchedule { $Script:IndependentSchedule }
function Get-DevAllKnownSchedules { $Script:AllKnownSchedules }

# Subsystems that imply Secrets=true when requested ON (unchanged rule,
# just now expressed as data instead of being re-derived ad hoc in two
# places).
$Script:SecretsDependents = @('Backend', 'Chat', 'Ai')

<#
.SYNOPSIS
  Reads the current desired-state of the 4 CloudFormation-tracked flags
  (Network/Chat/Ai/Secrets) from the live stack. Read-only AWS call.

.OUTPUTS
  Hashtable: StackExists (bool), Safe (bool - $false for a transitional/
  failed stack status that must not be trusted), StackStatus (string, only
  when StackExists), Network/Chat/Ai/Secrets (bool, "all false" when the
  stack does not exist).
#>
function Get-CurrentStackState {
    param(
        [Parameter(Mandatory)] [string]$StackName,
        [Parameter(Mandatory)] [string]$Region
    )
    $raw = aws cloudformation describe-stacks --stack-name $StackName --region $Region --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
        # Covers "stack does not exist" (the common case) - anything else
        # that also fails here (credentials, region) will already have been
        # caught by the caller's own earlier identity/region HARD STOP.
        return @{
            StackExists = $false
            Safe        = $true
            Network     = $false
            Chat        = $false
            Ai          = $false
            Secrets     = $false
        }
    }
    $parsed = $raw | ConvertFrom-Json
    $stack = $parsed.Stacks[0]

    # Statuses it is safe to read Parameters from and trust as "current
    # desired state". Anything else (*_IN_PROGRESS, ROLLBACK_COMPLETE,
    # DELETE_FAILED, REVIEW_IN_PROGRESS, ...) means the stack's own
    # parameters cannot be trusted to reflect reality - the caller must
    # HARD STOP rather than guess.
    $safeStatuses = @('CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE')
    $isSafe = $stack.StackStatus -in $safeStatuses

    $paramMap = @{}
    foreach ($p in $stack.Parameters) { $paramMap[$p.ParameterKey] = $p.ParameterValue }

    return @{
        StackExists = $true
        Safe        = $isSafe
        StackStatus = $stack.StackStatus
        Network     = ($paramMap['EnableNatGateway'] -eq 'true')
        Chat        = ($paramMap['EnableChat'] -eq 'true')
        Ai          = ($paramMap['EnableOpenSearchEndpoint'] -eq 'true')
        Secrets     = ($paramMap['EnableSecretsManagerEndpoint'] -eq 'true')
    }
}

<#
.SYNOPSIS
  Reads Aurora's live status as a simple boolean, for the Backend dimension
  of the lifecycle-state model. Read-only AWS call.

.OUTPUTS
  Hashtable: Available (bool), Status (string, the raw RDS status).
#>
function Get-CurrentAuroraState {
    param(
        [Parameter(Mandatory)] [string]$ClusterId,
        [Parameter(Mandatory)] [string]$Region
    )
    $status = aws rds describe-db-clusters --db-cluster-identifier $ClusterId --region $Region --query "DBClusters[0].Status" --output text 2>&1
    if ($LASTEXITCODE -ne 0) {
        return @{ Available = $false; Status = "unknown" }
    }
    return @{ Available = ($status -eq 'available'); Status = $status }
}

<#
.SYNOPSIS
  PURE. Resolves the desired on-demand state for a START operation as a
  set union of what is already on and what was newly requested, applying
  the Secrets dependency rule. No AWS calls.

.PARAMETER Current
  Hashtable with Network/Chat/Ai/Secrets (bool) - from Get-CurrentStackState.

.PARAMETER Requested
  Hashtable with Network/Chat/Ai/Secrets/Backend (bool) - which switches
  were passed to THIS invocation (true = "turn this on").

.OUTPUTS
  Hashtable: Network/Chat/Ai/Secrets (bool, the new desired CFN parameter
  values) and SecretsImpliedBy (string[], which requested subsystems forced
  Secrets on this call, empty if Secrets was already on or not implied).
#>
function Resolve-DesiredStartState {
    param(
        [Parameter(Mandatory)] [hashtable]$Current,
        [Parameter(Mandatory)] [hashtable]$Requested
    )
    $desired = @{
        Network = [bool]$Current.Network -or [bool]$Requested.Network
        Chat    = [bool]$Current.Chat    -or [bool]$Requested.Chat
        Ai      = [bool]$Current.Ai      -or [bool]$Requested.Ai
    }

    $impliedBy = @()
    foreach ($dep in $Script:SecretsDependents) {
        if ($Requested.ContainsKey($dep) -and $Requested[$dep]) { $impliedBy += $dep }
    }
    $desired.Secrets = [bool]$Current.Secrets -or [bool]$Requested.Secrets -or ($impliedBy.Count -gt 0)

    return @{
        Network         = $desired.Network
        Chat            = $desired.Chat
        Ai              = $desired.Ai
        Secrets         = $desired.Secrets
        SecretsImpliedBy = $impliedBy
    }
}

<#
.SYNOPSIS
  PURE. Resolves the desired on-demand state for a STOP operation as a set
  difference (only the explicitly requested subsystems turn off), with a
  safe refusal if Secrets is explicitly requested off while a dependent
  (Backend/Chat/Ai) would still be on afterward. No AWS calls.

  Secrets is intentionally NEVER auto-turned-off just because its last
  dependent stopped in this same call (matches the project's existing,
  deliberate "-Secrets is explicit-only on stop" design - something else
  may still need it, and the operator already has a proven, documented
  two-call convention for removing it afterward).

.PARAMETER Current
  Hashtable with Network/Chat/Ai/Secrets/Backend (bool) - Network/Chat/Ai/
  Secrets from Get-CurrentStackState, Backend from Get-CurrentAuroraState.

.PARAMETER RequestedOff
  Hashtable with Network/Chat/Ai/Secrets/Backend (bool) - which switches
  were passed to THIS invocation (true = "turn this off").

.OUTPUTS
  Hashtable: Blocked (bool), Reason (string or $null), Desired (hashtable
  with Network/Chat/Ai/Secrets/Backend - equal to Current, unchanged, when
  Blocked).
#>
function Resolve-DesiredStopState {
    param(
        [Parameter(Mandatory)] [hashtable]$Current,
        [Parameter(Mandatory)] [hashtable]$RequestedOff
    )
    $keys = @('Network', 'Chat', 'Ai', 'Secrets', 'Backend')
    $desired = @{}
    foreach ($k in $keys) {
        $isOff = $RequestedOff.ContainsKey($k) -and $RequestedOff[$k]
        $desired[$k] = if ($isOff) { $false } else { [bool]$Current[$k] }
    }

    # Only worth refusing if Secrets is actually ON today - requesting -Secrets
    # redundantly while it's already off (e.g. the stack doesn't exist at all)
    # is a harmless no-op, not an unsafe transition.
    $secretsRequestedOff = ($RequestedOff.ContainsKey('Secrets') -and $RequestedOff.Secrets -and [bool]$Current.Secrets)
    if ($secretsRequestedOff) {
        $stillOnDependents = @()
        foreach ($dep in $Script:SecretsDependents) {
            if ($desired[$dep]) { $stillOnDependents += $dep }
        }
        if ($stillOnDependents.Count -gt 0) {
            return @{
                Blocked = $true
                Reason  = "Secrets Manager VPC endpoint cannot be stopped while $($stillOnDependents -join ', ') still ON - it needs this endpoint (or NAT) to fetch its DB secret. Stop $($stillOnDependents -join ', ') first, or drop -Secrets from this call."
                Desired = $Current
            }
        }
    }

    return @{ Blocked = $false; Reason = $null; Desired = $desired }
}

<#
.SYNOPSIS
  PURE. The exact condition the historical Phase 8 bug fix depends on:
  a schedule-state snapshot should only be (re-)captured when at least one
  pausable schedule is actually transitioning (currently ENABLED, about to
  be paused). An idempotent re-run against an already-all-DISABLED set must
  leave the saved file untouched, never overwrite a valid "13 enabled"
  snapshot with "all disabled".

.PARAMETER CurrentStates
  Hashtable mapping schedule name -> "ENABLED"/"DISABLED" (as returned by
  `aws scheduler get-schedule --query State`).

.PARAMETER PausableNames
  string[] - the schedules this automation is allowed to pause/restore.
#>
function Test-ShouldCaptureScheduleSnapshot {
    param(
        [Parameter(Mandatory)] [hashtable]$CurrentStates,
        [Parameter(Mandatory)] [string[]]$PausableNames
    )
    foreach ($name in $PausableNames) {
        if ($CurrentStates.ContainsKey($name) -and $CurrentStates[$name] -eq 'ENABLED') {
            return $true
        }
    }
    return $false
}

<#
.SYNOPSIS
  Renders a human-readable plan block (current / requested / resolved /
  dependency notes) for either a start or a stop resolution, with no secret
  values ever involved (every field here is a subsystem name or a boolean).
#>
function Format-LifecyclePlan {
    param(
        [Parameter(Mandatory)] [ValidateSet('Start', 'Stop')] [string]$Mode,
        [Parameter(Mandatory)] [hashtable]$Current,
        [Parameter(Mandatory)] [hashtable]$Requested,
        [Parameter(Mandatory)] [hashtable]$Desired
    )
    function OnOff($b) { if ($b) { "ON" } else { "OFF" } }
    $lines = @()
    $lines += "CURRENT STATE:"
    foreach ($k in @('Backend', 'Network', 'Chat', 'Ai', 'Secrets')) {
        if ($Current.ContainsKey($k)) { $lines += "  $k = $(OnOff $Current[$k])" }
    }
    $lines += "REQUESTED CHANGE ($Mode):"
    $requestedAny = $false
    foreach ($k in @('Backend', 'Network', 'Chat', 'Ai', 'Secrets')) {
        if ($Requested.ContainsKey($k) -and $Requested[$k]) {
            $verb = if ($Mode -eq 'Start') { 'turn ON' } else { 'turn OFF' }
            $lines += "  $k -> $verb"
            $requestedAny = $true
        }
    }
    if (-not $requestedAny) { $lines += "  (none)" }
    $lines += "RESOLVED TARGET STATE:"
    foreach ($k in @('Backend', 'Network', 'Chat', 'Ai', 'Secrets')) {
        if ($Desired.ContainsKey($k)) {
            $changed = $Current.ContainsKey($k) -and ($Current[$k] -ne $Desired[$k])
            $preserved = $Current.ContainsKey($k) -and ($Current[$k] -eq $Desired[$k]) -and (-not ($Requested.ContainsKey($k) -and $Requested[$k]))
            $tag = if ($changed) { "(changed)" } elseif ($preserved -and $Desired[$k]) { "(preserved)" } else { "" }
            $lines += "  $k = $(OnOff $Desired[$k]) $tag".TrimEnd()
        }
    }
    return ($lines -join "`n")
}

Export-ModuleMember -Function @(
    'Get-DevPausableSchedules',
    'Get-DevIndependentSchedule',
    'Get-DevAllKnownSchedules',
    'Get-CurrentStackState',
    'Get-CurrentAuroraState',
    'Resolve-DesiredStartState',
    'Resolve-DesiredStopState',
    'Test-ShouldCaptureScheduleSnapshot',
    'Format-LifecyclePlan'
)
