<#
  Pure, non-interactive rotation logic - dot-sourced by
  scripts/auth-admin-rotation-helper.ps1 (the interactive wrapper) and, in
  this session, tested directly against a local mock server. Kept separate
  from Read-Host/console prompts specifically so it can be tested without any
  interactive input, since the harness this was built in runs PowerShell
  non-interactively (console prompts there read EOF immediately) - splitting
  pure logic out is what actually made it possible to exercise this for real
  instead of only eyeballing it.

  No secret is ever written to disk, an environment variable, or a log by
  this file. The caller decides whether/how to display $result.NewPassword.
#>

function New-CsprngPassword {
    # 32 random bytes -> URL-safe base64, no padding. ~43 chars, ~256 bits of entropy.
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    $b64 = [Convert]::ToBase64String($bytes)
    return ($b64 -replace '\+', '-' -replace '/', '_' -replace '=', '')
}

function ConvertFrom-SecureStringPlain {
    param([Parameter(Mandatory)][System.Security.SecureString]$Secure)
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Secure)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr)
    }
}

function Invoke-AdminPasswordRotation {
    <#
    .SYNOPSIS
      Pure rotation logic: login with the current password, PATCH
      /auth/me/password to the new one, verify old-rejected/new-works/
      id+role-unchanged. No prompts, no console output beyond what the
      caller does with the returned object.

    .OUTPUTS
      A hashtable:
        Success            [bool]   overall result
        Stage              [string] "login" | "rotate" | "verify" | "done"
        Error              [string] present when Success is $false
        NewPassword        [string] present only when the rotate call itself
                                     succeeded (even if verify then found a
                                     problem) - the caller needs it either way
        BeforeId/BeforeRole, AfterId/AfterRole
        OldPasswordRejected, NewPasswordWorks, IdentityUnchanged  [bool]
    #>
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$AdminEmail,
        [Parameter(Mandatory)][string]$CurrentPassword,
        [Parameter(Mandatory)][string]$NewPassword,
        [int]$TimeoutSec = 15
    )

    $result = @{ Success = $false; Stage = "login" }

    try {
        $loginResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/login" `
            -ContentType "application/json" `
            -Body (@{ email = $AdminEmail; password = $CurrentPassword } | ConvertTo-Json) `
            -TimeoutSec $TimeoutSec
    } catch {
        $result.Error = "Login failed: $($_.Exception.Message)"
        return $result
    }

    $result.BeforeId = $loginResp.user.id
    $result.BeforeRole = $loginResp.user.role
    $accessToken = $loginResp.accessToken

    $result.Stage = "rotate"
    try {
        $null = Invoke-RestMethod -Method Patch -Uri "$BaseUrl/auth/me/password" `
            -ContentType "application/json" `
            -Body (@{ currentPassword = $CurrentPassword; newPassword = $NewPassword } | ConvertTo-Json) `
            -Headers @{ Authorization = "Bearer $accessToken" } `
            -TimeoutSec $TimeoutSec
    } catch {
        $result.Error = "Rotation call failed (state unknown - see manual recovery guidance): $($_.Exception.Message)"
        $result.NewPassword = $NewPassword
        return $result
    }

    $result.NewPassword = $NewPassword
    $result.Stage = "verify"

    $result.OldPasswordRejected = $true
    try {
        $null = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/login" `
            -ContentType "application/json" `
            -Body (@{ email = $AdminEmail; password = $CurrentPassword } | ConvertTo-Json) `
            -TimeoutSec $TimeoutSec
        $result.OldPasswordRejected = $false
    } catch {
        # expected: old password must now fail
    }

    try {
        $newLoginResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/login" `
            -ContentType "application/json" `
            -Body (@{ email = $AdminEmail; password = $NewPassword } | ConvertTo-Json) `
            -TimeoutSec $TimeoutSec
        $result.NewPasswordWorks = $true
        $result.AfterId = $newLoginResp.user.id
        $result.AfterRole = $newLoginResp.user.role
        $result.IdentityUnchanged = ($result.AfterId -eq $result.BeforeId -and $result.AfterRole -eq $result.BeforeRole)
    } catch {
        $result.NewPasswordWorks = $false
        $result.Error = "New password did not verify: $($_.Exception.Message)"
    }

    $result.Stage = "done"
    $result.Success = $result.OldPasswordRejected -and $result.NewPasswordWorks -and $result.IdentityUnchanged
    return $result
}
