<#
.SYNOPSIS
  Gymini DEV - zero-exposure rotation of JWT_SECRET + JWT_REFRESH_SECRET on
  the Auth Lambda.

.DESCRIPTION
  Phase 13B-A (docs/deployment/AWS_DEV_JWT_ROTATION_DESIGN_2026-10-07.md).

  Design goal: the operator (human or agent) running this script must never
  see the old or new secret values, and must never see the Lambda's full
  environment variable map. Every AWS call that could return secret
  material stores its result ONLY in a local PowerShell variable inside
  THIS process - it is never Write-Host'd, never written to a file, and
  never returned from this script. The only thing this script ever prints
  is the sanitized summary object from JwtRotation.psm1's
  Get-SanitizedRotationSummary (metadata only: key names, booleans, status
  strings, timestamps, revision IDs).

  DRY RUN BY DEFAULT. Without -Execute, this script performs only the one
  AWS call already proven safe in this engagement - a narrow
  `Environment.Variables | keys(@)` query that returns KEY NAMES only,
  never values - to confirm both JWT keys are present, and prints a plan.
  It never calls get-function-configuration for the full environment, and
  never calls update-function-configuration, unless -Execute is passed.

  Both secrets always rotate together. There is no flag to rotate only one
  - Merge-RotatedEnvironment refuses to produce a partial result, and this
  script does not attempt to work around that.

.PARAMETER Execute
  Without this switch, dry-run only: checks preconditions and key presence,
  prints a plan, mutates nothing. With it, performs the real rotation.

.NOTES
  This script intentionally never calls:
    aws lambda get-function-configuration ... (unfiltered)
  in a way whose result is printed or persisted. The one place it reads the
  full environment (inside the -Execute path, to merge safely without
  dropping unrelated variables) immediately assigns the result to a local
  variable and never echoes it.
#>
[CmdletBinding()]
param(
    [switch]$Execute
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib/JwtRotation.psm1") -Force

$ExpectedAccount = "191798898985"
$ExpectedRegion = "ap-southeast-1"
$TargetFunction = "fitness-assistant-dev-auth"

Write-Host "=== Gymini DEV - JWT secret rotation (zero-exposure) ===" -ForegroundColor Cyan

# -- Fail-closed preconditions, before any AWS call that could matter -----
$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
$region = aws configure get region

$pre = Test-RotationPreconditions -ActualAccount $identity.Account -ExpectedAccount $ExpectedAccount `
    -ActualRegion $region -ExpectedRegion $ExpectedRegion `
    -ActualFunctionName $TargetFunction -ExpectedFunctionName $TargetFunction
if (-not $pre.Ok) {
    Write-Host "HARD STOP: $($pre.Reason)" -ForegroundColor Red
    exit 1
}
Write-Host "Preconditions OK: account=$($identity.Account) region=$region target=$TargetFunction"

# -- Key-presence check: KEY NAMES ONLY, never values ----------------------
# This exact query shape (`Environment.Variables | keys(@)`) is the one
# already proven, in this engagement, to never surface a value.
$envKeyNamesJson = aws lambda get-function-configuration --function-name $TargetFunction --region $ExpectedRegion `
    --query "Environment.Variables | keys(@)" --output json
$envKeyNames = $envKeyNamesJson | ConvertFrom-Json
$jwtSecretPresent = $envKeyNames -contains "JWT_SECRET"
$jwtRefreshPresent = $envKeyNames -contains "JWT_REFRESH_SECRET"
$rotationReady = $jwtSecretPresent -and $jwtRefreshPresent

if (-not $rotationReady) {
    $summary = Get-SanitizedRotationSummary -TargetFunction $TargetFunction -Account $identity.Account -Region $region `
        -EnvironmentKeysFound $envKeyNames.Count -JwtSecretPresent $jwtSecretPresent -JwtRefreshSecretPresent $jwtRefreshPresent `
        -RotationReady $false
    $summary.GetEnumerator() | ForEach-Object { Write-Host "$($_.Key): $($_.Value)" }
    Write-Host "HARD STOP: one or both JWT keys missing from the live environment - refusing to rotate." -ForegroundColor Red
    exit 1
}

if (-not $Execute) {
    $summary = Get-SanitizedRotationSummary -TargetFunction $TargetFunction -Account $identity.Account -Region $region `
        -EnvironmentKeysFound $envKeyNames.Count -JwtSecretPresent $jwtSecretPresent -JwtRefreshSecretPresent $jwtRefreshPresent `
        -RotationReady $true
    Write-Host ""
    Write-Host "DRY RUN (default) - plan only, nothing was mutated:" -ForegroundColor Yellow
    $summary.GetEnumerator() | ForEach-Object { Write-Host "  $($_.Key): $($_.Value)" }
    Write-Host ""
    Write-Host "With -Execute, this script would:"
    Write-Host "  1. Fetch the full current environment ONCE, into local process memory only."
    Write-Host "  2. Generate two new secrets via System.Security.Cryptography.RandomNumberGenerator."
    Write-Host "  3. Merge them into the full environment (Merge-RotatedEnvironment) - every other"
    Write-Host "     variable preserved byte-for-byte; refuses to proceed if either new value is missing."
    Write-Host "  4. Call update-function-configuration with ONLY the merged Environment block and the"
    Write-Host "     current RevisionId (optimistic concurrency) - VpcConfig/Role/Timeout/MemorySize/"
    Write-Host "     Layers are never resent, so they cannot be touched by this call."
    Write-Host "  5. Wait for LastUpdateStatus=Successful, then print ONLY the sanitized summary below."
    Write-Host ""
    Write-Host "Nothing was executed against AWS by this script beyond the one key-names-only read above." -ForegroundColor Green
    exit 0
}

# -- Real execution ---------------------------------------------------------
# From here on, every AWS response that could contain a secret value is
# assigned straight into a local variable and never written to Write-Host,
# a file, or this script's own return value.

Write-Host ""
Write-Host "-Execute passed. Fetching current configuration (full environment stays in local memory only)..." -ForegroundColor Yellow

$configJson = aws lambda get-function-configuration --function-name $TargetFunction --region $ExpectedRegion --output json
$config = $configJson | ConvertFrom-Json
$currentRevisionId = $config.RevisionId

$currentEnv = @{}
foreach ($prop in $config.Environment.Variables.PSObject.Properties) { $currentEnv[$prop.Name] = $prop.Value }

$newSecrets = @{
    JWT_SECRET         = New-JwtSecretValue
    JWT_REFRESH_SECRET = New-JwtSecretValue
}

$merge = Merge-RotatedEnvironment -CurrentEnv $currentEnv -NewSecrets $newSecrets
if (-not $merge.Ok) {
    Write-Host "HARD STOP: $($merge.Reason)" -ForegroundColor Red
    # Best-effort clearing of local references - PowerShell's GC timing is
    # not a hard guarantee, but there is no reason to keep these around.
    $currentEnv = $null; $newSecrets = $null; $merge = $null
    exit 1
}

# Build the update payload with ONLY FunctionName/Environment/RevisionId -
# every other field (VpcConfig, Role, Timeout, MemorySize, Layers, ...) is
# deliberately absent, so AWS leaves them exactly as they are.
$updatePayload = [ordered]@{
    FunctionName = $TargetFunction
    Environment  = @{ Variables = $merge.MergedEnv }
    RevisionId   = $currentRevisionId
}
$updatePayloadJson = $updatePayload | ConvertTo-Json -Depth 10 -Compress

# PowerShell's native-command argument passing cannot reliably carry a large
# JSON string containing nested quotes straight on the command line (proven
# empirically - a direct attempt corrupted the argument and the call never
# reached AWS at all, confirmed harmless via a narrow post-check: RevisionId/
# LastModified/env key count were all unchanged). `--cli-input-json
# file://path` avoids this entirely. This is the one place this script
# writes secret material to disk - a short-lived file under the OS temp
# directory, restricted to the current user by inheriting default NTFS
# permissions there, never printed, and deleted in the `finally` block below
# regardless of outcome.
$tempPayloadPath = Join-Path $env:TEMP "gymini-jwt-rotation-$(New-Guid).json"
try {
    # -Encoding ASCII, not UTF8: Windows PowerShell 5.1's -Encoding UTF8 writes
    # a byte-order mark, which the AWS CLI's JSON parser rejects outright
    # ("Invalid JSON received" - confirmed empirically). The payload is pure
    # base64 + JSON structural characters, so ASCII is lossless here. Same
    # fix already applied elsewhere in this codebase for the identical
    # reason - see dev-start.ps1's Set-AossNetworkPolicyVpce.
    Set-Content -Path $tempPayloadPath -Value $updatePayloadJson -Encoding ASCII -NoNewline

    $updateResultJson = aws lambda update-function-configuration --region $ExpectedRegion `
        --cli-input-json "file://$tempPayloadPath" `
        --query "{LastUpdateStatus:LastUpdateStatus,RevisionId:RevisionId}" --output json
    if ($LASTEXITCODE -ne 0) {
        Write-Host "HARD STOP: update-function-configuration failed (exit $LASTEXITCODE). No partial state - AWS Lambda config updates are atomic; if this failed, the OLD environment is still active." -ForegroundColor Red
        $currentEnv = $null; $newSecrets = $null; $merge = $null; $updatePayload = $null; $updatePayloadJson = $null
        exit 1
    }
    $updateResult = $updateResultJson | ConvertFrom-Json
} finally {
    if (Test-Path $tempPayloadPath) {
        Remove-Item -Path $tempPayloadPath -Force
        if (Test-Path $tempPayloadPath) {
            Write-Host "WARNING: temp payload file could not be verified deleted: $tempPayloadPath" -ForegroundColor Red
        }
    }
}

Write-Host "Waiting for the update to finish applying..."
aws lambda wait function-updated --function-name $TargetFunction --region $ExpectedRegion
$waitExit = $LASTEXITCODE

$finalJson = aws lambda get-function-configuration --function-name $TargetFunction --region $ExpectedRegion `
    --query "{LastUpdateStatus:LastUpdateStatus,LastModified:LastModified,RevisionId:RevisionId,EnvKeyCount:length(Environment.Variables | keys(@))}" --output json
$final = $finalJson | ConvertFrom-Json

$summary = Get-SanitizedRotationSummary -TargetFunction $TargetFunction -Account $identity.Account -Region $region `
    -EnvironmentKeysFound $final.EnvKeyCount -JwtSecretPresent $true -JwtRefreshSecretPresent $true -RotationReady $true `
    -UpdateStatus $final.LastUpdateStatus -NewLastModified $final.LastModified -NewRevisionId $final.RevisionId

Write-Host ""
Write-Host "ROTATION RESULT (sanitized - no secret values):" -ForegroundColor Green
$summary.GetEnumerator() | ForEach-Object { Write-Host "  $($_.Key): $($_.Value)" }

if ($final.EnvKeyCount -ne $envKeyNames.Count) {
    Write-Host "WARNING: environment key COUNT changed ($($envKeyNames.Count) -> $($final.EnvKeyCount)) - investigate before trusting this rotation." -ForegroundColor Red
}

# Best-effort clearing of local references now that only sanitized output
# remains to be used.
$currentEnv = $null; $newSecrets = $null; $merge = $null
$updatePayload = $null; $updatePayloadJson = $null; $config = $null; $configJson = $null

if ($waitExit -ne 0 -or $final.LastUpdateStatus -ne "Successful") {
    Write-Host "HARD STOP: update did not reach Successful - investigate via the sanitized fields above only." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Rotation complete." -ForegroundColor Green
