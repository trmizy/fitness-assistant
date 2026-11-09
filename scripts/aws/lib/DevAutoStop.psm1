<#
.SYNOPSIS
  Gymini DEV - automatic shutdown N hours after dev-start.ps1 turns services on.

.DESCRIPTION
  dev-start.ps1 -Execute arms ONE Windows scheduled task (Gymini-DEV-AutoStop).
  When it fires, scripts/aws/dev-auto-stop.ps1 re-reads what is ACTUALLY on at
  that moment and runs dev-stop.ps1 -Execute for exactly those services, so
  every safety check of dev-stop.ps1 (ECS 0/0, in-flight AI jobs, schedule
  snapshot, dependency rules) still applies. Each new dev-start re-arms the
  timer from "now"; a manual dev-stop that leaves nothing on removes it.

  Why a scheduled task and not a background PowerShell job: it survives the
  console being closed and a reboot, can wake the PC from sleep (WakeToRun),
  and runs as soon as possible after a missed time (StartWhenAvailable).
  Limit: it runs on THIS PC as the current user. If the PC is off or the user
  is logged off at the deadline, the stop happens at the next logon - so
  dev-stop.ps1 is still the primary way to turn things off.

  Pure functions (no AWS, no Task Scheduler): Get-AutoStopFlags,
  New-DevAutoStopTaskSpec. Side-effecting: Register-/Unregister-DevAutoStop,
  Get-DevAutoStopInfo, Clear-DevAutoStopIfIdle.
#>

$Script:AutoStopTaskName = "Gymini-DEV-AutoStop"
function Get-DevAutoStopTaskName { $Script:AutoStopTaskName }

<#
.SYNOPSIS
  PURE. Which dev-stop.ps1 switches are needed to turn off everything that is
  on right now. Backend counts as on while Aurora is available or starting
  (a starting cluster bills and will be available soon; dev-stop refuses to
  act on "starting", so the caller retries later).
.OUTPUTS
  string[] subset of Network, Chat, Ai, Backend, Secrets (empty = nothing on).
#>
function Get-AutoStopFlags {
    param(
        [Parameter(Mandatory)] [hashtable]$Stack,
        [Parameter(Mandatory)] [hashtable]$Aurora
    )
    $flags = @()
    foreach ($name in @("Network", "Chat", "Ai")) { if ($Stack[$name]) { $flags += $name } }
    if ($Aurora.Status -in @("available", "starting")) { $flags += "Backend" }
    if ($Stack["Secrets"]) { $flags += "Secrets" }
    return ,$flags
}

<#
.SYNOPSIS
  PURE. Builds the scheduled-task definition (no side effects).
.PARAMETER Hours
  Hours after Now. Must be > 0 and <= 24.
#>
function New-DevAutoStopTaskSpec {
    param(
        [Parameter(Mandatory)] [string]$RepoRoot,
        [Parameter(Mandatory)] [double]$Hours,
        [Parameter(Mandatory)] [datetime]$Now,
        [Parameter(Mandatory)] [string]$PowerShellExe,
        [string]$AwsProfile
    )
    if ($Hours -le 0 -or $Hours -gt 24) { throw "AutoStopHours must be > 0 and <= 24 (got $Hours)." }
    $script = Join-Path $RepoRoot "scripts\aws\dev-auto-stop.ps1"
    $argument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
    if ($AwsProfile) {
        if ($AwsProfile -notmatch '^[A-Za-z0-9_.-]+$') { throw "Refusing AWS profile name with unexpected characters: '$AwsProfile'." }
        $argument += " -AwsProfile $AwsProfile"
    }
    return @{
        TaskName         = $Script:AutoStopTaskName
        At               = $Now.AddHours($Hours)
        Execute          = $PowerShellExe
        Argument         = $argument
        WorkingDirectory = $RepoRoot
        Description      = "Gymini DEV: auto-stop on-demand AWS services $Hours h after dev-start (armed $($Now.ToString('yyyy-MM-dd HH:mm')))."
    }
}

function Register-DevAutoStop {
    param([Parameter(Mandatory)] [hashtable]$Spec)
    $action = New-ScheduledTaskAction -Execute $Spec.Execute -Argument $Spec.Argument -WorkingDirectory $Spec.WorkingDirectory
    $trigger = New-ScheduledTaskTrigger -Once -At $Spec.At
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $Spec.TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
        -Description $Spec.Description -Force | Out-Null
    return Get-DevAutoStopInfo -TaskName $Spec.TaskName
}

function Get-DevAutoStopInfo {
    param([string]$TaskName = $Script:AutoStopTaskName)
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { return $null }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    return @{ TaskName = $TaskName; State = [string]$task.State; NextRunTime = $info.NextRunTime; LastRunTime = $info.LastRunTime; LastTaskResult = $info.LastTaskResult }
}

function Unregister-DevAutoStop {
    param([string]$TaskName = $Script:AutoStopTaskName)
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        return $true
    }
    return $false
}

<#
.SYNOPSIS
  Removes the pending auto-stop only if nothing on-demand is still on
  (called by a manual dev-stop.ps1; never by the auto-stop run itself).
#>
function Clear-DevAutoStopIfIdle {
    param(
        [Parameter(Mandatory)] [string]$StackName,
        [Parameter(Mandatory)] [string]$ClusterId,
        [Parameter(Mandatory)] [string]$Region
    )
    $flags = Get-AutoStopFlags -Stack (Get-CurrentStackState -StackName $StackName -Region $Region) -Aurora (Get-CurrentAuroraState -ClusterId $ClusterId -Region $Region)
    if ($flags.Count -eq 0) {
        if (Unregister-DevAutoStop) { Write-Host "Auto-stop: nothing on-demand is on any more - pending auto-stop cancelled." -ForegroundColor Green }
    } else {
        $i = Get-DevAutoStopInfo
        if ($i) { Write-Host "Auto-stop: still on ($($flags -join ', ')) - keeping the auto-stop at $($i.NextRunTime)." -ForegroundColor Yellow }
    }
}

Export-ModuleMember -Function @(
    'Get-DevAutoStopTaskName', 'Get-AutoStopFlags', 'New-DevAutoStopTaskSpec',
    'Register-DevAutoStop', 'Get-DevAutoStopInfo', 'Unregister-DevAutoStop', 'Clear-DevAutoStopIfIdle'
)
