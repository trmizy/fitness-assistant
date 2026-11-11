<#
.SYNOPSIS
  Gymini DEV - zero-exposure rotation of SMTP_PASS on the Auth Lambda (the
  sole SMTP consumer in this codebase - confirmed by reading
  email.service.ts: no other file anywhere imports nodemailer or reads
  SMTP_PASS; every other service calls auth-service's own
  POST /auth/internal/send-email instead of holding its own credential).

.DESCRIPTION
  Phase 13D (docs/deployment/AWS_DEV_SMTP_SECURITY_REMEDIATION_2026-10-07.md).

  The new credential is a Gmail App Password and MUST be human-created (this
  script never logs into Google and never generates one). It is entered
  ONLY via a non-echoing secure prompt (`Read-Host -AsSecureString`) at
  -Execute time - there is deliberately no `-SmtpPassword` string
  parameter anywhere in this file (verified by
  lib/SmtpRotation.Tests.ps1's own AST-level checks), because a CLI
  argument would be exposed in process listings and shell history.

  DRY RUN BY DEFAULT. Without -Execute: confirms account/region/target,
  confirms SMTP_PASS key presence via a narrow `keys(@)` query (never a
  value), reads RevisionId/EnvKeyCount, prints the sanitized plan. Mutates
  nothing and never prompts for input.

  Same zero-exposure discipline as Invoke-JwtSecretRotation.ps1 /
  Invoke-InternalServiceSecretRotation.ps1: every AWS response that could
  contain a secret value is assigned straight into a local variable and
  never passed to Write-Host, a file, or this script's own output - only
  Get-SanitizedSmtpSummary's result is ever printed. The plaintext
  password exists in memory only between the secure prompt and the
  AWS update call, and is explicitly cleared immediately afterward.

.PARAMETER Execute
  Without this switch, dry-run only. With it, prompts securely for the new
  SMTP_PASS value and performs the live update.
#>
[CmdletBinding()]
param(
    [switch]$Execute
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib/SmtpRotation.psm1") -Force

$ExpectedAccount = "191798898985"
$ExpectedRegion = "ap-southeast-1"
$TargetFunction = Get-SmtpTargetFunction
$SmtpKeyName = Get-SmtpKeyName

Write-Host "=== Gymini DEV - SMTP_PASS rotation (zero-exposure) ===" -ForegroundColor Cyan

$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
$region = aws configure get region
$pre = Test-SmtpRotationPreconditions -ActualAccount $identity.Account -ExpectedAccount $ExpectedAccount `
    -ActualRegion $region -ExpectedRegion $ExpectedRegion `
    -ActualFunctionName $TargetFunction -ExpectedFunctionName $TargetFunction
if (-not $pre.Ok) {
    Write-Host "HARD STOP: $($pre.Reason)" -ForegroundColor Red
    exit 1
}
Write-Host "Preconditions OK: account=$($identity.Account) region=$region target=$TargetFunction"

$cfgMeta = aws lambda get-function-configuration --function-name $TargetFunction --region $ExpectedRegion `
    --query "{SmtpPassPresent:contains(Environment.Variables | keys(@), '$SmtpKeyName'),RevisionId:RevisionId,EnvKeyCount:length(Environment.Variables | keys(@))}" --output json | ConvertFrom-Json

if (-not $cfgMeta.SmtpPassPresent) {
    $summary = Get-SanitizedSmtpSummary -TargetFunction $TargetFunction -SmtpPassPresent $false -RotationReady $false -RevisionId $cfgMeta.RevisionId -EnvironmentKeysFound $cfgMeta.EnvKeyCount
    $summary.GetEnumerator() | ForEach-Object { Write-Host "$($_.Key): $($_.Value)" }
    Write-Host "HARD STOP: SMTP_PASS missing from the live environment - refusing to rotate." -ForegroundColor Red
    exit 1
}

if (-not $Execute) {
    $summary = Get-SanitizedSmtpSummary -TargetFunction $TargetFunction -SmtpPassPresent $true -RotationReady $true -RevisionId $cfgMeta.RevisionId -EnvironmentKeysFound $cfgMeta.EnvKeyCount
    Write-Host ""
    Write-Host "DRY RUN (default) - plan only, nothing was mutated, no prompt shown:" -ForegroundColor Yellow
    $summary.GetEnumerator() | ForEach-Object { Write-Host "  $($_.Key): $($_.Value)" }
    Write-Host ""
    Write-Host "With -Execute, this script would:"
    Write-Host "  1. Prompt securely (Read-Host -AsSecureString) for the new Gmail App Password - never echoed, never a CLI parameter."
    Write-Host "  2. Fetch the full current environment ONCE, into local process memory only."
    Write-Host "  3. Replace ONLY SMTP_PASS, preserving every other variable (JWT_SECRET, JWT_REFRESH_SECRET, INTERNAL_SERVICE_SECRET, etc.) byte-for-byte."
    Write-Host "  4. Call update-function-configuration with the current RevisionId (optimistic concurrency)."
    Write-Host "  5. Wait for LastUpdateStatus=Successful, then print ONLY the sanitized summary - never the password."
    Write-Host ""
    Write-Host "Nothing was executed against AWS by this script beyond the one key-names-only read above." -ForegroundColor Green
    exit 0
}

# -- Real execution ---------------------------------------------------------
Write-Host ""
Write-Host "-Execute passed." -ForegroundColor Yellow
Write-Host "Create the new Gmail App Password in your Google Account FIRST if you have not already." -ForegroundColor Yellow
Write-Host "Do NOT paste it anywhere else - this prompt does not echo what you type." -ForegroundColor Yellow
$secureNewPassword = Read-Host -Prompt "Enter new SMTP credential (Gmail App Password)" -AsSecureString

$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secureNewPassword)
try {
    $plainNewPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($bstr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($bstr)
}
$secureNewPassword = $null

if ([string]::IsNullOrEmpty($plainNewPassword)) {
    Write-Host "HARD STOP: empty input - refusing to rotate to an empty credential." -ForegroundColor Red
    $plainNewPassword = $null
    exit 1
}

$cfgJson = aws lambda get-function-configuration --function-name $TargetFunction --region $ExpectedRegion --output json
$cfg = $cfgJson | ConvertFrom-Json
$revisionId = $cfg.RevisionId
$concurrency = Test-SmtpConcurrencyToken -ExpectedRevisionId $cfgMeta.RevisionId -ActualRevisionId $revisionId
if (-not $concurrency.Ok) {
    Write-Host "HARD STOP: $($concurrency.Reason)" -ForegroundColor Red
    $plainNewPassword = $null; $cfg = $null; $cfgJson = $null
    exit 1
}

$envHash = @{}
foreach ($p in $cfg.Environment.Variables.PSObject.Properties) { $envHash[$p.Name] = $p.Value }

$merge = Merge-RotatedSmtpPassword -CurrentEnv $envHash -NewValue $plainNewPassword
$plainNewPassword = $null   # cleared the instant it has been consumed by the merge
if (-not $merge.Ok) {
    Write-Host "HARD STOP: $($merge.Reason)" -ForegroundColor Red
    $envHash = $null; $cfg = $null; $cfgJson = $null
    exit 1
}

$payload = [ordered]@{ FunctionName = $TargetFunction; Environment = @{ Variables = $merge.MergedEnv }; RevisionId = $revisionId }
$payloadJson = $payload | ConvertTo-Json -Depth 10 -Compress
$tempPath = Join-Path $env:TEMP "gymini-smtp-rotation-$(New-Guid).json"
try {
    # -Encoding ASCII, not UTF8: Windows PowerShell 5.1's -Encoding UTF8 writes
    # a byte-order mark that breaks the AWS CLI's JSON parser - the same
    # real bug found and fixed during the JWT rotation (Phase 13B-B).
    Set-Content -Path $tempPath -Value $payloadJson -Encoding ASCII -NoNewline
    aws lambda update-function-configuration --region $ExpectedRegion --cli-input-json "file://$tempPath" --output json | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "HARD STOP: update-function-configuration failed (exit $LASTEXITCODE). No partial state - AWS Lambda config updates are atomic." -ForegroundColor Red
        exit 1
    }
    aws lambda wait function-updated --function-name $TargetFunction --region $ExpectedRegion
} finally {
    Remove-Item -Path $tempPath -Force -ErrorAction SilentlyContinue
    $envHash = $null; $merge = $null; $payload = $null; $payloadJson = $null; $cfg = $null; $cfgJson = $null
}

$finalJson = aws lambda get-function-configuration --function-name $TargetFunction --region $ExpectedRegion `
    --query "{LastUpdateStatus:LastUpdateStatus,LastModified:LastModified,RevisionId:RevisionId,EnvKeyCount:length(Environment.Variables | keys(@))}" --output json
$final = $finalJson | ConvertFrom-Json

$summary = Get-SanitizedSmtpSummary -TargetFunction $TargetFunction -SmtpPassPresent $true -RotationReady $true `
    -RevisionId $revisionId -UpdateStatus $final.LastUpdateStatus -NewRevisionId $final.RevisionId `
    -LastModified $final.LastModified -EnvironmentKeysFound $final.EnvKeyCount

Write-Host ""
Write-Host "ROTATION RESULT (sanitized - no secret values):" -ForegroundColor Green
$summary.GetEnumerator() | ForEach-Object { Write-Host "  $($_.Key): $($_.Value)" }

if ($final.LastUpdateStatus -ne "Successful") {
    Write-Host "HARD STOP: update did not reach Successful." -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "SMTP_PASS rotation complete." -ForegroundColor Green
