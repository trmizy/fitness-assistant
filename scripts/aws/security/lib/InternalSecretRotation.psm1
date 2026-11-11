<#
.SYNOPSIS
  Zero-exposure INTERNAL_SERVICE_SECRET / INTERNAL_API_SECRET coordinated
  rotation — pure logic only (Phase 13C-A).

.DESCRIPTION
  Same pure-logic/AWS-I-O separation as scripts/aws/security/lib/
  JwtRotation.psm1. Every function here is PURE: no AWS calls, no I/O, no
  console output of sensitive values. Unit-tested with Pester using FAKE
  values only (InternalSecretRotation.Tests.ps1).

  Why this is a bigger problem than the JWT rotation (Phase 13B):
    - JWT_SECRET/JWT_REFRESH_SECRET had exactly ONE consumer (Auth Lambda).
    - INTERNAL_SERVICE_SECRET is a single shared literal duplicated across
      12 Lambda functions (confirmed via live key-presence queries:
      auth, user, fitness, gym, payment, ai, ai-worker, fitness-jobs,
      ai-jobs, payment-jobs, gym-jobs, user-jobs), PLUS a differently-named
      sibling, INTERNAL_API_SECRET, on chat-service's ECS task definition
      (a historical naming inconsistency, documented in chat-service's own
      source comments - chat.policy.ts falls back
      `INTERNAL_SERVICE_SECRET || INTERNAL_API_SECRET`, but joinToken.ts
      accepts ONLY INTERNAL_API_SECRET with no fallback).
    - No validator in this codebase accepts more than one literal value at
      once (every check is `received === configured`, confirmed by reading
      every middleware) - there is no native "accept OLD or NEXT
      simultaneously" support today. A true dual-secret staged rotation
      would require code changes to 7+ middleware files, which is out of
      this phase's scope (design/tooling only, no application code
      changes). The selected protocol (see the design report) is
      therefore a fast, sequenced HARD CUTOVER across all 13 resources
      (12 Lambdas + 1 ECS task definition), not a dual-secret stage model.
    - INTERNAL_SERVICE_SECRET is also used as a FALLBACK HMAC signing key
      for two unrelated purposes if their own dedicated secret is unset:
      gym-service's check-in QR tokens (CHECKIN_TOKEN_SECRET) and
      user-service's PT document signed URLs (PT_DOCUMENT_URL_SECRET).
      Confirmed live: CHECKIN_TOKEN_SECRET IS set independently on the gym
      Lambda (safe), but PT_DOCUMENT_URL_SECRET is NOT set on the user
      Lambda (real hazard - rotating INTERNAL_SERVICE_SECRET would
      silently invalidate any currently-valid PT document signed URL).
      This module's precondition check surfaces that as a blocking
      warning, not a silent proceed.
#>

Set-StrictMode -Version Latest

$Script:LambdaConsumers = @(
    "fitness-assistant-dev-auth", "fitness-assistant-dev-user", "fitness-assistant-dev-fitness",
    "fitness-assistant-dev-gym", "fitness-assistant-dev-payment", "fitness-assistant-dev-ai",
    "fitness-assistant-dev-ai-worker", "fitness-assistant-dev-fitness-jobs", "fitness-assistant-dev-ai-jobs",
    "fitness-assistant-dev-payment-jobs", "fitness-assistant-dev-gym-jobs", "fitness-assistant-dev-user-jobs"
)
$Script:EcsTaskFamily = "fitness-assistant-dev-chat"
$Script:LambdaKeyName = "INTERNAL_SERVICE_SECRET"
$Script:EcsKeyName = "INTERNAL_API_SECRET"

function Get-InternalSecretLambdaConsumers { $Script:LambdaConsumers }
function Get-InternalSecretEcsTaskFamily { $Script:EcsTaskFamily }

<#
.SYNOPSIS
  PURE. Fail-closed account/region check (1, 2 - wrong account/wrong region).
#>
function Test-AccountRegion {
    param(
        [Parameter(Mandatory)] [string]$ActualAccount,
        [Parameter(Mandatory)] [string]$ExpectedAccount,
        [Parameter(Mandatory)] [string]$ActualRegion,
        [Parameter(Mandatory)] [string]$ExpectedRegion
    )
    if ($ActualAccount -ne $ExpectedAccount) {
        return @{ Ok = $false; Reason = "Account '$ActualAccount' != expected '$ExpectedAccount'" }
    }
    if ($ActualRegion -ne $ExpectedRegion) {
        return @{ Ok = $false; Reason = "Region '$ActualRegion' != expected '$ExpectedRegion'" }
    }
    return @{ Ok = $true; Reason = $null }
}

<#
.SYNOPSIS
  PURE. Verifies the discovered consumer inventory is complete (3 - missing
  consumer -> fail, 18 - all discovered consumers included) before any
  mutation is attempted. CurrentInventory is what was actually found live
  (e.g. via `lambda list-functions`); ExpectedConsumers is the known-good
  list this module declares.
#>
function Test-ConsumerInventoryComplete {
    param(
        [Parameter(Mandatory)] [string[]]$ExpectedConsumers,
        [Parameter(Mandatory)] [string[]]$CurrentInventory
    )
    $missing = @($ExpectedConsumers | Where-Object { $CurrentInventory -notcontains $_ })
    if ($missing.Count -gt 0) {
        return @{ Ok = $false; Reason = "Expected consumer(s) not found live: $($missing -join ', ')"; Missing = $missing }
    }
    return @{ Ok = $true; Reason = $null; Missing = @() }
}

<#
.SYNOPSIS
  PURE. The dedicated-secret-independence check (the PT_DOCUMENT_URL_SECRET /
  CHECKIN_TOKEN_SECRET hazard). Returns warnings for any fallback path that
  is NOT independently secured - these are NOT fatal by themselves (the
  brief's mission is design/tooling, not a blanket refusal), but the
  orchestrator must surface them loudly and require an explicit
  acknowledgment flag before proceeding past this check in -Execute mode.
#>
function Test-DedicatedSecretIndependence {
    param(
        [Parameter(Mandatory)] [bool]$CheckinTokenSecretPresent,
        [Parameter(Mandatory)] [bool]$PtDocumentUrlSecretPresent
    )
    $warnings = @()
    if (-not $CheckinTokenSecretPresent) {
        $warnings += "CHECKIN_TOKEN_SECRET is not set on gym-service - it is currently falling back to INTERNAL_SERVICE_SECRET for check-in QR token signing. Rotating will invalidate any currently-valid check-in QR codes."
    }
    if (-not $PtDocumentUrlSecretPresent) {
        $warnings += "PT_DOCUMENT_URL_SECRET is not set on user-service - it is currently falling back to INTERNAL_SERVICE_SECRET for PT document signed-URL links. Rotating will invalidate any currently-valid PT document links."
    }
    return @{ Safe = ($warnings.Count -eq 0); Warnings = $warnings }
}

<#
.SYNOPSIS
  PURE. Single-key environment merge: returns a NEW hashtable equal to
  CurrentEnv except KeyName is replaced by NewValue, every other key
  untouched (5 - Lambda unrelated vars preserved). Fails closed if KeyName
  is not already present in CurrentEnv, or NewValue is empty.
#>
function Merge-RotatedSingleKey {
    param(
        [Parameter(Mandatory)] [hashtable]$CurrentEnv,
        [Parameter(Mandatory)] [string]$KeyName,
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$NewValue
    )
    if (-not $CurrentEnv.ContainsKey($KeyName)) {
        return @{ Ok = $false; Reason = "Key '$KeyName' not present in current environment - refusing to add a new key as part of a rotation."; MergedEnv = $null }
    }
    if ([string]::IsNullOrEmpty($NewValue)) {
        return @{ Ok = $false; Reason = "Refusing to rotate '$KeyName' to an empty value."; MergedEnv = $null }
    }
    $merged = @{}
    foreach ($k in $CurrentEnv.Keys) { $merged[$k] = $CurrentEnv[$k] }
    $merged[$KeyName] = $NewValue

    $beforeKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]$CurrentEnv.Keys)
    $afterKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]$merged.Keys)
    if (-not $beforeKeys.SetEquals($afterKeys)) {
        return @{ Ok = $false; Reason = "Internal error: merged key set does not match original key set - refusing to proceed."; MergedEnv = $null }
    }
    return @{ Ok = $true; Reason = $null; MergedEnv = $merged }
}

<#
.SYNOPSIS
  PURE (6 - ECS unrelated config preserved). Verifies a proposed new ECS
  container definition only differs from the current one in the single
  target environment-variable key's value - every other field (image, cpu,
  memory, port mappings, secrets, logging, health check, other env vars)
  must be byte-identical. This is the ECS equivalent of
  Test-UnrelatedKeysUnchanged in JwtRotation.psm1.
#>
function Test-EcsUnrelatedConfigUnchanged {
    param(
        [Parameter(Mandatory)] [hashtable]$CurrentContainerDef,
        [Parameter(Mandatory)] [hashtable]$ProposedContainerDef,
        [Parameter(Mandatory)] [string]$ExemptKeyName
    )
    foreach ($field in $CurrentContainerDef.Keys) {
        if ($field -eq 'EnvironmentMap') {
            $curEnv = $CurrentContainerDef[$field]
            $newEnv = $ProposedContainerDef[$field]
            $curKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]$curEnv.Keys)
            $newKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]$newEnv.Keys)
            if (-not $curKeys.SetEquals($newKeys)) { return $false }
            foreach ($k in $curEnv.Keys) {
                if ($k -eq $ExemptKeyName) { continue }
                if ($curEnv[$k] -ne $newEnv[$k]) { return $false }
            }
            continue
        }
        if ($CurrentContainerDef[$field] -ne $ProposedContainerDef[$field]) { return $false }
    }
    return $true
}

<#
.SYNOPSIS
  PURE (9 - RevisionId mismatch -> fail, 10 - task revision mismatch ->
  fail). Confirms the live resource hasn't changed since it was read,
  before applying a write - optimistic concurrency for both Lambda
  (RevisionId) and ECS (task definition revision number) shapes.
#>
function Test-ConcurrencyToken {
    param(
        [Parameter(Mandatory)] [string]$ExpectedToken,
        [Parameter(Mandatory)] [string]$ActualToken,
        [Parameter(Mandatory)] [string]$ResourceName
    )
    if ($ExpectedToken -ne $ActualToken) {
        return @{ Ok = $false; Reason = "Concurrency token mismatch for '$ResourceName' - something else changed this resource between read and write. Refusing to overwrite." }
    }
    return @{ Ok = $true; Reason = $null }
}

<#
.SYNOPSIS
  PURE (11 - partial prepare failure -> no cutover, 12 - caller cannot move
  before receivers prepared, 13 - retire-old cannot run before
  verification). Explicit stage-ordering guard for this protocol's own
  stage sequence: PREFLIGHT -> ROTATE_LAMBDAS -> ROTATE_ECS_TASKDEF ->
  VERIFY. (A dual-secret PREPARE_RECEIVERS/CUTOVER_CALLERS/RETIRE_OLD model
  was evaluated and rejected for live execution - see the design report's
  "Selected Rotation Protocol" section - because no validator in this
  codebase accepts two valid values at once; adding that would be an
  application code change, out of this phase's scope. This simpler stage
  sequence is what the orchestrator actually enforces today.)
#>
function Test-StageTransitionAllowed {
    param(
        [Parameter(Mandatory)] [ValidateSet('PREFLIGHT', 'ROTATE_LAMBDAS', 'ROTATE_ECS_TASKDEF', 'VERIFY')] [string]$FromStage,
        [Parameter(Mandatory)] [ValidateSet('PREFLIGHT', 'ROTATE_LAMBDAS', 'ROTATE_ECS_TASKDEF', 'VERIFY')] [string]$ToStage,
        [Parameter(Mandatory)] [bool]$FromStageSucceeded
    )
    if (-not $FromStageSucceeded) {
        return @{ Ok = $false; Reason = "Stage '$FromStage' did not fully succeed - refusing to advance to '$ToStage'. No partial cutover." }
    }
    $order = @('PREFLIGHT', 'ROTATE_LAMBDAS', 'ROTATE_ECS_TASKDEF', 'VERIFY')
    $fromIdx = $order.IndexOf($FromStage)
    $toIdx = $order.IndexOf($ToStage)
    if ($toIdx -ne $fromIdx + 1) {
        return @{ Ok = $false; Reason = "Stage '$ToStage' is not the immediate successor of '$FromStage' - refusing to skip ahead." }
    }
    return @{ Ok = $true; Reason = $null }
}

<#
.SYNOPSIS
  Builds the ONLY per-resource record the orchestrator is allowed to print.
  Explicit field whitelist, same discipline as JwtRotation.psm1's
  Get-SanitizedRotationSummary - no secret value can pass through this.
#>
function Get-SanitizedResourceSummary {
    param(
        [Parameter(Mandatory)] [ValidateSet('Lambda', 'EcsTaskDefinition')] [string]$ResourceType,
        [Parameter(Mandatory)] [string]$ResourceName,
        [string]$UpdateStatus = $null,
        [string]$NewRevisionId = $null,
        [string]$NewTaskDefinitionArn = $null,
        [int]$EnvironmentKeysFound = 0
    )
    return [ordered]@{
        ResourceType         = $ResourceType
        ResourceName         = $ResourceName
        EnvironmentKeysFound = $EnvironmentKeysFound
        UpdateStatus         = $UpdateStatus
        NewRevisionId        = $NewRevisionId
        NewTaskDefinitionArn = $NewTaskDefinitionArn
    }
}

<#
.SYNOPSIS
  Generates one cryptographically secure shared secret value (used for both
  INTERNAL_SERVICE_SECRET and INTERNAL_API_SECRET - they are the same
  logical secret under two historical names). Same RNG as
  JwtRotation.psm1's New-JwtSecretValue - never Get-Random/Math.random/GUID/
  timestamp.
#>
function New-SharedInternalSecretValue {
    $bytes = [byte[]]::new(48)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return [Convert]::ToBase64String($bytes)
}

Export-ModuleMember -Function @(
    'Get-InternalSecretLambdaConsumers',
    'Get-InternalSecretEcsTaskFamily',
    'Test-AccountRegion',
    'Test-ConsumerInventoryComplete',
    'Test-DedicatedSecretIndependence',
    'Merge-RotatedSingleKey',
    'Test-EcsUnrelatedConfigUnchanged',
    'Test-ConcurrencyToken',
    'Test-StageTransitionAllowed',
    'Get-SanitizedResourceSummary',
    'New-SharedInternalSecretValue'
)
