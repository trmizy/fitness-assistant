<#
.SYNOPSIS
  Gymini DEV - run by the Gymini-DEV-AutoStop scheduled task (armed by
  dev-start.ps1). Turns off every on-demand service that is on RIGHT NOW by
  calling dev-stop.ps1 -Execute, so all of dev-stop's safety checks apply.

.DESCRIPTION
  - Re-reads the live state (CloudFormation stack parameters + Aurora status)
    instead of trusting the flags dev-start used hours ago.
  - If dev-stop refuses or something is still on afterwards (e.g. an AI job
    in flight, Aurora still starting, stack mid-update), waits RetryMinutes
    and tries again, up to MaxAttempts.
  - Success is judged by re-reading the state (everything off), not by
    $LASTEXITCODE, which dev-stop.ps1 can leave non-zero after a successful
    run (its read-only "is the ALB gone" check fails by design).
  - Writes a transcript to .dev/aws/auto-stop-<time>.log and a summary to
    .dev/aws/auto-stop-last.json. Can be run by hand to test the stop path.
#>
[CmdletBinding()]
param(
    [string]$AwsProfile,
    [int]$MaxAttempts = 4,
    [int]$RetryMinutes = 15
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Set-Location $repoRoot
if ($AwsProfile) { $env:AWS_PROFILE = $AwsProfile }

Import-Module (Join-Path $PSScriptRoot "lib/DevLifecycle.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "lib/DevAutoStop.psm1") -Force

$StackName       = "gymini-dev-on-demand"
$AuroraClusterId = "fitness-assistant-dev-aurora"
$ExpectedRegion  = "ap-southeast-1"
$logDir = Join-Path $repoRoot ".dev/aws"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir ("auto-stop-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
Start-Transcript -Path $log | Out-Null

function Get-OnNow {
    $stack = Get-CurrentStackState -StackName $StackName -Region $ExpectedRegion
    $aurora = Get-CurrentAuroraState -ClusterId $AuroraClusterId -Region $ExpectedRegion
    return @{ Stack = $stack; Aurora = $aurora; Flags = (Get-AutoStopFlags -Stack $stack -Aurora $aurora) }
}

$result = "FAILED"; $lastFlags = @(); $attempt = 0
Write-Host "=== Gymini DEV - auto-stop ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) ===" -ForegroundColor Cyan
for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
        $now = Get-OnNow
        $lastFlags = $now.Flags
        if ($now.Stack.StackExists -and -not $now.Stack.Safe) {
            Write-Host "Attempt $attempt : stack is '$($now.Stack.StackStatus)' (transitional) - not touching it now." -ForegroundColor Yellow
        } elseif ($now.Flags.Count -eq 0) {
            Write-Host "Attempt $attempt : nothing on-demand is on (Aurora: $($now.Aurora.Status)) - nothing to stop." -ForegroundColor Green
            $result = "NOTHING_ON"; break
        } else {
            Write-Host "Attempt $attempt : on now -> $($now.Flags -join ', '). Running dev-stop.ps1 -Execute for exactly these." -ForegroundColor Yellow
            $splat = @{ Execute = $true; FromAutoStop = $true }
            foreach ($f in $now.Flags) { $splat[$f] = $true }
            try { & (Join-Path $PSScriptRoot "dev-stop.ps1") @splat } catch { Write-Host "dev-stop.ps1 threw: $($_.Exception.Message)" -ForegroundColor Red }
            $after = Get-OnNow
            $lastFlags = $after.Flags
            if ($after.Flags.Count -eq 0) { Write-Host "Verified: everything is off (Aurora: $($after.Aurora.Status))." -ForegroundColor Green; $result = "STOPPED"; break }
            Write-Host "Still on after attempt $attempt : $($after.Flags -join ', ')" -ForegroundColor Red
        }
    } catch {
        Write-Host "Attempt $attempt failed: $($_.Exception.Message)" -ForegroundColor Red
    }
    if ($attempt -lt $MaxAttempts) { Write-Host "Waiting $RetryMinutes minutes before retrying..."; Start-Sleep -Seconds ($RetryMinutes * 60) }
}

$summary = [ordered]@{ finishedAt = (Get-Date).ToString("o"); result = $result; attempts = [Math]::Min($attempt, $MaxAttempts); stillOn = @($lastFlags); log = $log }
(ConvertTo-Json -InputObject $summary -Depth 4) | Set-Content -Path (Join-Path $logDir "auto-stop-last.json") -Encoding UTF8
if ($result -eq "FAILED") { Write-Host "AUTO-STOP FAILED - still on: $($lastFlags -join ', '). Run dev-stop.ps1 by hand." -ForegroundColor Red }
Stop-Transcript | Out-Null
if ($result -eq "FAILED") { exit 1 } else { exit 0 }
