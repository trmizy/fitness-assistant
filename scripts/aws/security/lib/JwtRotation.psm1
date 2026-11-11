<#
.SYNOPSIS
  Zero-exposure JWT secret rotation — pure logic only (Phase 13B-A).

.DESCRIPTION
  Every function in this file is PURE: no AWS calls, no file I/O, no console
  output of sensitive values. They operate on plain hashtables the caller
  supplies and return plain hashtables/objects. This is deliberate so the
  merge/validation logic can be unit-tested with Pester using entirely FAKE
  values (see JwtRotation.Tests.ps1) without ever touching AWS or real
  secrets.

  The orchestration script that actually talks to AWS
  (Invoke-JwtSecretRotation.ps1) imports this module and is responsible for
  (a) never printing what these functions return when it contains secret
  material, and (b) only ever logging the sanitized summary object these
  functions are explicitly designed to produce.
#>

Set-StrictMode -Version Latest

$Script:JwtKeys = @('JWT_SECRET', 'JWT_REFRESH_SECRET')
$Script:SafeSummaryFields = @(
    'TargetFunction', 'Account', 'Region', 'EnvironmentKeysFound',
    'JwtSecretPresent', 'JwtRefreshSecretPresent', 'RotationReady',
    'UpdateStatus', 'NewLastModified', 'NewRevisionId'
)

<#
.SYNOPSIS
  PURE. Checks the three fail-closed preconditions that must hold before any
  AWS mutation is attempted: account, region, and target function name.

.OUTPUTS
  @{ Ok = $bool; Reason = $string-or-$null }
#>
function Test-RotationPreconditions {
    param(
        [Parameter(Mandatory)] [string]$ActualAccount,
        [Parameter(Mandatory)] [string]$ExpectedAccount,
        [Parameter(Mandatory)] [string]$ActualRegion,
        [Parameter(Mandatory)] [string]$ExpectedRegion,
        [Parameter(Mandatory)] [string]$ActualFunctionName,
        [Parameter(Mandatory)] [string]$ExpectedFunctionName
    )
    if ($ActualAccount -ne $ExpectedAccount) {
        return @{ Ok = $false; Reason = "Account '$ActualAccount' != expected '$ExpectedAccount'" }
    }
    if ($ActualRegion -ne $ExpectedRegion) {
        return @{ Ok = $false; Reason = "Region '$ActualRegion' != expected '$ExpectedRegion'" }
    }
    if ($ActualFunctionName -ne $ExpectedFunctionName) {
        return @{ Ok = $false; Reason = "Target function '$ActualFunctionName' != expected '$ExpectedFunctionName'" }
    }
    return @{ Ok = $true; Reason = $null }
}

<#
.SYNOPSIS
  PURE. Validates that the current environment already contains both JWT
  keys (fail-closed if either is missing - never partially rotate).

.PARAMETER CurrentEnv
  Hashtable of the CURRENT environment variable NAMES -> VALUES, as read
  from the live Lambda. The caller is responsible for never having printed
  this before calling here.
#>
function Test-JwtKeysPresent {
    param([Parameter(Mandatory)] [hashtable]$CurrentEnv)
    $missing = @()
    foreach ($k in $Script:JwtKeys) {
        if (-not $CurrentEnv.ContainsKey($k)) { $missing += $k }
    }
    if ($missing.Count -gt 0) {
        return @{ Ok = $false; Reason = "Missing from current environment: $($missing -join ', ')" }
    }
    return @{ Ok = $true; Reason = $null }
}

<#
.SYNOPSIS
  PURE. The core merge: returns a NEW hashtable equal to CurrentEnv except
  JWT_SECRET and JWT_REFRESH_SECRET are replaced by NewSecrets' values.
  Every other key/value is carried over completely untouched - same key
  set, same values, same casing, nothing added or removed.

  Atomic by construction: if NewSecrets is missing either key, this
  function refuses to produce ANY merged result (returns Ok=$false) rather
  than rotating only one of the two secrets.

.PARAMETER CurrentEnv
  Hashtable of ALL current environment variable NAMES -> VALUES.

.PARAMETER NewSecrets
  Hashtable with exactly the two keys JWT_SECRET and JWT_REFRESH_SECRET,
  mapped to their new values.

.OUTPUTS
  @{ Ok = $bool; Reason = $string-or-$null; MergedEnv = $hashtable-or-$null }
#>
function Merge-RotatedEnvironment {
    param(
        [Parameter(Mandatory)] [hashtable]$CurrentEnv,
        [Parameter(Mandatory)] [hashtable]$NewSecrets
    )
    $presence = Test-JwtKeysPresent -CurrentEnv $CurrentEnv
    if (-not $presence.Ok) { return @{ Ok = $false; Reason = $presence.Reason; MergedEnv = $null } }

    $missingNew = @()
    foreach ($k in $Script:JwtKeys) {
        if (-not $NewSecrets.ContainsKey($k) -or [string]::IsNullOrEmpty($NewSecrets[$k])) { $missingNew += $k }
    }
    if ($missingNew.Count -gt 0) {
        return @{
            Ok = $false
            Reason = "Refusing partial rotation - new value(s) missing for: $($missingNew -join ', '). Both JWT_SECRET and JWT_REFRESH_SECRET must rotate together."
            MergedEnv = $null
        }
    }

    $merged = @{}
    foreach ($key in $CurrentEnv.Keys) { $merged[$key] = $CurrentEnv[$key] }
    foreach ($key in $Script:JwtKeys) { $merged[$key] = $NewSecrets[$key] }

    # Structural self-check: same key SET before and after (nothing silently
    # dropped or added by the merge itself).
    $beforeKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]$CurrentEnv.Keys)
    $afterKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]$merged.Keys)
    if (-not $beforeKeys.SetEquals($afterKeys)) {
        return @{ Ok = $false; Reason = "Internal error: merged key set does not match original key set - refusing to proceed."; MergedEnv = $null }
    }

    return @{ Ok = $true; Reason = $null; MergedEnv = $merged }
}

<#
.SYNOPSIS
  PURE (no AWS call). Confirms every non-JWT key kept an identical value
  across a before/after environment pair - the explicit "unrelated env vars
  preserved" and "VPC/role/etc never touched via this path" check, usable
  directly in tests and reusable by the live post-update verification step
  (comparing KEY NAMES and, for non-secret keys only, their values; secret
  keys are deliberately never compared here since that would require
  printing or hashing them - see Get-SanitizedRotationSummary instead for
  what a live run is allowed to report).
#>
function Test-UnrelatedKeysUnchanged {
    param(
        [Parameter(Mandatory)] [hashtable]$Before,
        [Parameter(Mandatory)] [hashtable]$After
    )
    $beforeKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]$Before.Keys)
    $afterKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]$After.Keys)
    if (-not $beforeKeys.SetEquals($afterKeys)) { return $false }

    foreach ($key in $Before.Keys) {
        if ($Script:JwtKeys -contains $key) { continue }
        if ($Before[$key] -ne $After[$key]) { return $false }
    }
    return $true
}

<#
.SYNOPSIS
  Builds the ONLY object the orchestration script is allowed to print or
  log after a rotation attempt. An explicit field whitelist, not a
  pass-through of whatever the caller has lying around - this is what
  makes "no secret values appear in normal output" structurally true
  instead of merely a convention someone could forget.
#>
function Get-SanitizedRotationSummary {
    param(
        [Parameter(Mandatory)] [string]$TargetFunction,
        [Parameter(Mandatory)] [string]$Account,
        [Parameter(Mandatory)] [string]$Region,
        [Parameter(Mandatory)] [int]$EnvironmentKeysFound,
        [Parameter(Mandatory)] [bool]$JwtSecretPresent,
        [Parameter(Mandatory)] [bool]$JwtRefreshSecretPresent,
        [Parameter(Mandatory)] [bool]$RotationReady,
        [string]$UpdateStatus = $null,
        [string]$NewLastModified = $null,
        [string]$NewRevisionId = $null
    )
    # Explicit field-by-field construction - there is no code path here that
    # could accidentally forward an arbitrary extra property (like a secret
    # value) that happened to be on a caller's object.
    return [ordered]@{
        TargetFunction          = $TargetFunction
        Account                 = $Account
        Region                  = $Region
        EnvironmentKeysFound    = $EnvironmentKeysFound
        JwtSecretPresent        = $JwtSecretPresent
        JwtRefreshSecretPresent = $JwtRefreshSecretPresent
        RotationReady           = $RotationReady
        UpdateStatus            = $UpdateStatus
        NewLastModified         = $NewLastModified
        NewRevisionId           = $NewRevisionId
    }
}

<#
.SYNOPSIS
  Generates one cryptographically secure random secret value. Uses
  System.Security.Cryptography.RandomNumberGenerator - never Get-Random
  (not cryptographically secure), never a timestamp or GUID.

  Not pure (real entropy source) but touches no AWS and is never logged by
  any caller in this module. 48 random bytes (384 bits) base64-encoded,
  comfortably enough entropy for HMAC-signed JWTs.
#>
function New-JwtSecretValue {
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
    'Test-RotationPreconditions',
    'Test-JwtKeysPresent',
    'Merge-RotatedEnvironment',
    'Test-UnrelatedKeysUnchanged',
    'Get-SanitizedRotationSummary',
    'New-JwtSecretValue'
)
