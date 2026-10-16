<#
.SYNOPSIS
  Rotates the admin@example.com password using the EXISTING, already-audited
  self-service change-password endpoint (PATCH /auth/me/password) - no new
  endpoint, no direct database write.

.DESCRIPTION
  See docs/deployment/AWS_DEV_AUTH_ROTATION_RUNBOOK.md (Group A) and
  docs/deployment/AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md.

  This is a thin interactive wrapper around scripts/lib/AdminPasswordRotation.ps1
  (dot-sourced below), which holds the actual login/rotate/verify HTTP logic
  in a plain, parameterized, non-interactive function - split out specifically
  so that logic can be tested directly (see
  scripts/auth-admin-rotation-helper.mock-server.mjs) without depending on
  Read-Host, which cannot be driven non-interactively in every environment
  this might be exercised from.

  Flow:
    1. Prompts for the CURRENT password with no console echo (SecureString).
    2. Generates a new password locally with a CSPRNG - never hardcoded,
       never derived from anything guessable.
    3. Requires the literal word CONFIRM before anything is sent.
    4. Calls Invoke-AdminPasswordRotation (login, rotate, verify).
    5. Prints the new password to the console EXACTLY ONCE at the end, with
       an explicit instruction to store it immediately - never written to a
       file, environment variable, or log by this script.

  Timeout handling: if the rotation call itself fails with a network error,
  this script does NOT assume failure and does NOT retry automatically - see
  Invoke-AdminPasswordRotation's own notes. It prints the generated password
  and manual recovery instructions instead of guessing.

.PARAMETER BaseUrl
  Defaults to the real AWS DEV API Gateway endpoint. Pass a local mock
  server URL to test this script without ever touching AWS.

.PARAMETER AdminEmail
  Defaults to admin@example.com (this repo's one seeded ADMIN account).
#>

[CmdletBinding()]
param(
    [string]$BaseUrl = "https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com",
    [string]$AdminEmail = "admin@example.com"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\AdminPasswordRotation.ps1")

Write-Host "=== Gymini Auth: ADMIN Credential Rotation Helper ===" -ForegroundColor Cyan
Write-Host "Target base URL : $BaseUrl"
Write-Host "Account         : $AdminEmail"
Write-Host ""
Write-Host "This calls the EXISTING self-service endpoints only:" -ForegroundColor Yellow
Write-Host "  POST  /auth/login"
Write-Host "  PATCH /auth/me/password"
Write-Host "No account is created. No other account is touched. No refresh token"
Write-Host "or JWT is ever printed or written to disk by this script."
Write-Host ""

$currentSecure = Read-Host -Prompt "Current password for $AdminEmail" -AsSecureString
$currentPlain = ConvertFrom-SecureStringPlain -Secure $currentSecure
$newPassword = New-CsprngPassword

Write-Host ""
Write-Host "A new password has been generated locally (CSPRNG, 256 bits). It will be" -ForegroundColor Yellow
Write-Host "shown to you exactly once, at the very end - have a password manager or" -ForegroundColor Yellow
Write-Host "secret store open and ready BEFORE you confirm below." -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Type CONFIRM (exactly) to proceed, or anything else to abort"
if ($confirm -ne "CONFIRM") {
    Write-Host "Aborted before sending anything. No request was made." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Running login -> rotate -> verify..."
$result = Invoke-AdminPasswordRotation -BaseUrl $BaseUrl -AdminEmail $AdminEmail `
    -CurrentPassword $currentPlain -NewPassword $newPassword
$currentPlain = $null

switch ($result.Stage) {
    "login" {
        Write-Host "Login failed - aborting. No mutation was attempted." -ForegroundColor Red
        Write-Host $result.Error -ForegroundColor Red
        exit 1
    }
    "rotate" {
        Write-Host ""
        Write-Host "Rotation call did not return success. State is UNKNOWN, not failed -" -ForegroundColor Red
        Write-Host "changePassword() runs atomically (see AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md)," -ForegroundColor Red
        Write-Host "so it either fully committed or fully did not, but a network error alone" -ForegroundColor Red
        Write-Host "cannot tell you which. This script will NOT retry automatically." -ForegroundColor Red
        Write-Host $result.Error -ForegroundColor Red
        Write-Host ""
        Write-Host "Manual recovery: try logging in with the password below. If it works," -ForegroundColor Yellow
        Write-Host "rotation succeeded despite the error. If not, the OLD password is still" -ForegroundColor Yellow
        Write-Host "active and you may re-run this script from the start." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "New password (for manual recovery only - store it now):" -ForegroundColor Yellow
        Write-Host $result.NewPassword
        exit 1
    }
    default {
        Write-Host "    Logged in. id=$($result.BeforeId) role=$($result.BeforeRole)"
        Write-Host "    Rotation call succeeded." -ForegroundColor Green
        if ($result.OldPasswordRejected) {
            Write-Host "    OK: old default password is now rejected." -ForegroundColor Green
        } else {
            Write-Host "    WARNING: the OLD password still logs in! Investigate immediately." -ForegroundColor Red
        }
        if ($result.NewPasswordWorks -and $result.IdentityUnchanged) {
            Write-Host "    OK: new password works; id/role unchanged (id=$($result.AfterId) role=$($result.AfterRole))." -ForegroundColor Green
        } elseif ($result.NewPasswordWorks) {
            Write-Host "    WARNING: new password works but id/role CHANGED (before id=$($result.BeforeId) role=$($result.BeforeRole), after id=$($result.AfterId) role=$($result.AfterRole)). Investigate immediately." -ForegroundColor Red
        } else {
            Write-Host "    WARNING: new password login failed to verify ($($result.Error)). Do not assume rotation failed - see manual recovery note." -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "=== New password (shown once - store it now, then clear your scrollback) ===" -ForegroundColor Cyan
Write-Host $result.NewPassword
Write-Host "============================================================================="  -ForegroundColor Cyan
