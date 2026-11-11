<#
.SYNOPSIS
  Tests for the dev auto-stop safety net. ZERO AWS calls.

.DESCRIPTION
  Run with: Invoke-Pester scripts/aws/lib/DevAutoStop.Tests.ps1
  (Pester 3.4 syntax, as bundled with Windows PowerShell 5.1.)
  The last Describe registers a throw-away scheduled task with a unique name,
  reads it back and deletes it; it never touches Gymini-DEV-AutoStop and its
  action is a no-op ("exit 0") scheduled 23 hours ahead.
#>
Import-Module (Join-Path $PSScriptRoot "DevAutoStop.psm1") -Force

function St([bool]$n, [bool]$c, [bool]$a, [bool]$s) { @{ StackExists = $true; Safe = $true; Network = $n; Chat = $c; Ai = $a; Secrets = $s } }

Describe "Get-AutoStopFlags" {
    It "nothing on -> empty" {
        (Get-AutoStopFlags -Stack (St $false $false $false $false) -Aurora @{ Available = $false; Status = "stopped" }).Count | Should Be 0
    }
    It "everything on -> all five, Secrets last so dev-stop's dependency rule is satisfied in one call" {
        $f = Get-AutoStopFlags -Stack (St $true $true $true $true) -Aurora @{ Available = $true; Status = "available" }
        ($f -join ",") | Should Be "Network,Chat,Ai,Backend,Secrets"
    }
    It "Aurora starting counts as on (it bills; dev-stop will be retried)" {
        $f = Get-AutoStopFlags -Stack (St $false $false $false $true) -Aurora @{ Available = $false; Status = "starting" }
        ($f -join ",") | Should Be "Backend,Secrets"
    }
    It "Aurora stopping/stopped does not add Backend" {
        (Get-AutoStopFlags -Stack (St $false $false $false $false) -Aurora @{ Available = $false; Status = "stopping" }).Count | Should Be 0
    }
    It "stack absent (all false) + Aurora available -> Backend only" {
        $absent = @{ StackExists = $false; Safe = $true; Network = $false; Chat = $false; Ai = $false; Secrets = $false }
        (Get-AutoStopFlags -Stack $absent -Aurora @{ Available = $true; Status = "available" }) -join "," | Should Be "Backend"
    }
}

Describe "New-DevAutoStopTaskSpec" {
    $now = [datetime]"2026-11-03T09:00:00"
    It "fires exactly Hours after Now and runs dev-auto-stop.ps1 from the repo root" {
        $s = New-DevAutoStopTaskSpec -RepoRoot "C:\repo" -Hours 6 -Now $now -PowerShellExe "C:\ps.exe"
        $s.At | Should Be ([datetime]"2026-11-03T15:00:00")
        $s.TaskName | Should Be "Gymini-DEV-AutoStop"
        $s.WorkingDirectory | Should Be "C:\repo"
        $s.Execute | Should Be "C:\ps.exe"
        ($s.Argument -like '*-File "C:\repo\scripts\aws\dev-auto-stop.ps1"*') | Should Be $true
        ($s.Argument -like '*-AwsProfile*') | Should Be $false
    }
    It "passes the current AWS profile through" {
        $s = New-DevAutoStopTaskSpec -RepoRoot "C:\repo" -Hours 1.5 -Now $now -PowerShellExe "C:\ps.exe" -AwsProfile "gymini-admin"
        ($s.Argument -like '*-AwsProfile gymini-admin') | Should Be $true
        $s.At | Should Be ([datetime]"2026-11-03T10:30:00")
    }
    It "rejects a profile name that could inject arguments" {
        { New-DevAutoStopTaskSpec -RepoRoot "C:\repo" -Hours 6 -Now $now -PowerShellExe "C:\ps.exe" -AwsProfile 'x" -Command "evil' } | Should Throw
    }
    It "rejects 0, negative and > 24 hours" {
        { New-DevAutoStopTaskSpec -RepoRoot "C:\repo" -Hours 0 -Now $now -PowerShellExe "C:\ps.exe" } | Should Throw
        { New-DevAutoStopTaskSpec -RepoRoot "C:\repo" -Hours -1 -Now $now -PowerShellExe "C:\ps.exe" } | Should Throw
        { New-DevAutoStopTaskSpec -RepoRoot "C:\repo" -Hours 25 -Now $now -PowerShellExe "C:\ps.exe" } | Should Throw
    }
}

Describe "Register/Get/Unregister round trip (local Task Scheduler, throw-away task)" {
    $name = "Gymini-DEV-AutoStop-TEST-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
    $spec = New-DevAutoStopTaskSpec -RepoRoot $env:TEMP -Hours 23 -Now (Get-Date) -PowerShellExe (Get-Process -Id $PID).Path
    $spec.TaskName = $name; $spec.Argument = "-NoProfile -Command exit 0"
    It "registers with the expected settings, re-registering replaces it, and it can be removed" {
        try {
            $info = Register-DevAutoStop -Spec $spec
            $info.TaskName | Should Be $name
            ([math]::Abs(($info.NextRunTime - $spec.At).TotalMinutes) -lt 1) | Should Be $true
            $t = Get-ScheduledTask -TaskName $name
            $t.Settings.WakeToRun | Should Be $true
            $t.Settings.StartWhenAvailable | Should Be $true
            $t.Settings.DisallowStartIfOnBatteries | Should Be $false
            $spec.At = $spec.At.AddHours(-1)
            $info2 = Register-DevAutoStop -Spec $spec
            ([math]::Abs(($info2.NextRunTime - $spec.At).TotalMinutes) -lt 1) | Should Be $true
            @(Get-ScheduledTask -TaskName "$name*").Count | Should Be 1
        } finally {
            (Unregister-DevAutoStop -TaskName $name) | Should Be $true
        }
        (Get-DevAutoStopInfo -TaskName $name) | Should Be $null
        (Unregister-DevAutoStop -TaskName $name) | Should Be $false
    }
}
