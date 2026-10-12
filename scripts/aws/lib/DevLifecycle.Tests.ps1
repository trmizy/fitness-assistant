<#
.SYNOPSIS
  Phase 12A regression tests for the on-demand lifecycle state-resolution
  logic. Pure unit tests - make ZERO AWS calls, create ZERO AWS resources.

.DESCRIPTION
  Run with: Invoke-Pester scripts/aws/lib/DevLifecycle.Tests.ps1
  (Pester 3.4, the version bundled with Windows PowerShell 5.1 - uses only
  Describe/It/Should Be, no v4/v5-only syntax).
#>
Import-Module (Join-Path $PSScriptRoot "DevLifecycle.psm1") -Force

function AllOff { @{ Network = $false; Chat = $false; Ai = $false; Secrets = $false } }

Describe "Resolve-DesiredStartState (Phase 12A Case 1, 2, 5)" {

    It "Case 1: frozen + start Backend -> Backend/Secrets ON, everything else OFF" {
        $current = AllOff
        $requested = @{ Backend = $true; Network = $false; Chat = $false; Ai = $false; Secrets = $false }
        $desired = Resolve-DesiredStartState -Current $current -Requested $requested

        $desired.Secrets | Should Be $true
        $desired.Network | Should Be $false
        $desired.Ai | Should Be $false
        $desired.Chat | Should Be $false
        ($desired.SecretsImpliedBy -contains "Backend") | Should Be $true
    }

    It "Case 2 (the originally reported bug): Backend already ON (Secrets already ON) + start Network -> Secrets stays ON, Network turns ON" {
        $current = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $true }
        $requested = @{ Backend = $false; Network = $true; Chat = $false; Ai = $false; Secrets = $false }
        $desired = Resolve-DesiredStartState -Current $current -Requested $requested

        $desired.Network | Should Be $true
        $desired.Secrets | Should Be $true
    }

    It "Backend + Network already ON + start Ai -> Backend/Network preserved ON, Ai turns ON" {
        $current = @{ Network = $true; Chat = $false; Ai = $false; Secrets = $true }
        $requested = @{ Backend = $false; Network = $false; Chat = $false; Ai = $true; Secrets = $false }
        $desired = Resolve-DesiredStartState -Current $current -Requested $requested

        $desired.Network | Should Be $true
        $desired.Ai | Should Be $true
        $desired.Secrets | Should Be $true
    }

    It "Case 5: Ai already ON + start Backend -> Ai remains ON" {
        $current = @{ Network = $false; Chat = $false; Ai = $true; Secrets = $true }
        $requested = @{ Backend = $true; Network = $false; Chat = $false; Ai = $false; Secrets = $false }
        $desired = Resolve-DesiredStartState -Current $current -Requested $requested

        $desired.Ai | Should Be $true
        $desired.Secrets | Should Be $true
    }

    It "start with no flags at all preserves current state exactly (no-op)" {
        $current = @{ Network = $true; Chat = $true; Ai = $false; Secrets = $true }
        $requested = @{ Backend = $false; Network = $false; Chat = $false; Ai = $false; Secrets = $false }
        $desired = Resolve-DesiredStartState -Current $current -Requested $requested

        $desired.Network | Should Be $true
        $desired.Chat | Should Be $true
        $desired.Ai | Should Be $false
        $desired.Secrets | Should Be $true
    }
}

Describe "Resolve-DesiredStopState (Phase 12A Case 3, 4, 6, 7, 8)" {

    It "Case 3: Backend + Network ON + stop Network -> Backend/Secrets stay ON, Network OFF" {
        $current = @{ Network = $true; Chat = $false; Ai = $false; Secrets = $true; Backend = $true }
        $requestedOff = @{ Network = $true; Chat = $false; Ai = $false; Secrets = $false; Backend = $false }
        $result = Resolve-DesiredStopState -Current $current -RequestedOff $requestedOff

        $result.Blocked | Should Be $false
        $result.Desired.Backend | Should Be $true
        $result.Desired.Secrets | Should Be $true
        $result.Desired.Network | Should Be $false
    }

    It "Case 4: Backend + Network ON + stop Backend -> Backend OFF, Network stays ON, Secrets preserved (not explicitly requested off)" {
        $current = @{ Network = $true; Chat = $false; Ai = $false; Secrets = $true; Backend = $true }
        $requestedOff = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $false; Backend = $true }
        $result = Resolve-DesiredStopState -Current $current -RequestedOff $requestedOff

        $result.Blocked | Should Be $false
        $result.Desired.Backend | Should Be $false
        $result.Desired.Network | Should Be $true
        $result.Desired.Secrets | Should Be $true
    }

    It "Case 6: Backend + Ai ON + stop Backend -> Ai remains ON, Secrets remains ON (Ai still needs it)" {
        $current = @{ Network = $false; Chat = $false; Ai = $true; Secrets = $true; Backend = $true }
        $requestedOff = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $false; Backend = $true }
        $result = Resolve-DesiredStopState -Current $current -RequestedOff $requestedOff

        $result.Blocked | Should Be $false
        $result.Desired.Ai | Should Be $true
        $result.Desired.Secrets | Should Be $true
        $result.Desired.Backend | Should Be $false
    }

    It "Case 7: no dependent subsystem ON + stop Secrets -> Secrets OFF" {
        $current = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $true; Backend = $false }
        $requestedOff = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $true; Backend = $false }
        $result = Resolve-DesiredStopState -Current $current -RequestedOff $requestedOff

        $result.Blocked | Should Be $false
        $result.Desired.Secrets | Should Be $false
    }

    It "Case 8: Backend still ON + stop Secrets -> safe refusal, nothing changed" {
        $current = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $true; Backend = $true }
        $requestedOff = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $true; Backend = $false }
        $result = Resolve-DesiredStopState -Current $current -RequestedOff $requestedOff

        $result.Blocked | Should Be $true
        $result.Reason | Should Not BeNullOrEmpty
        $result.Desired.Secrets | Should Be $true
        $result.Desired.Backend | Should Be $true
    }

    It "Case 8b: Secrets + Backend stopped together (no conflict) -> both OFF" {
        $current = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $true; Backend = $true }
        $requestedOff = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $true; Backend = $true }
        $result = Resolve-DesiredStopState -Current $current -RequestedOff $requestedOff

        $result.Blocked | Should Be $false
        $result.Desired.Secrets | Should Be $false
        $result.Desired.Backend | Should Be $false
    }

    It "Chat ON + stop Network -> Chat (and whatever Chat needs) is preserved, only Network turns off" {
        $current = @{ Network = $true; Chat = $true; Ai = $false; Secrets = $true; Backend = $false }
        $requestedOff = @{ Network = $true; Chat = $false; Ai = $false; Secrets = $false; Backend = $false }
        $result = Resolve-DesiredStopState -Current $current -RequestedOff $requestedOff

        $result.Blocked | Should Be $false
        $result.Desired.Chat | Should Be $true
        $result.Desired.Secrets | Should Be $true
        $result.Desired.Network | Should Be $false
    }

    It "stop -Secrets when Secrets is already off and Backend is still on -> harmless no-op, not blocked" {
        $current = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $false; Backend = $true }
        $requestedOff = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $true; Backend = $false }
        $result = Resolve-DesiredStopState -Current $current -RequestedOff $requestedOff

        $result.Blocked | Should Be $false
        $result.Desired.Secrets | Should Be $false
        $result.Desired.Backend | Should Be $true
    }

    It "stop with no flags at all preserves current state exactly (no-op)" {
        $current = @{ Network = $true; Chat = $false; Ai = $true; Secrets = $true; Backend = $true }
        $requestedOff = @{ Network = $false; Chat = $false; Ai = $false; Secrets = $false; Backend = $false }
        $result = Resolve-DesiredStopState -Current $current -RequestedOff $requestedOff

        $result.Blocked | Should Be $false
        $result.Desired.Network | Should Be $true
        $result.Desired.Ai | Should Be $true
        $result.Desired.Secrets | Should Be $true
        $result.Desired.Backend | Should Be $true
    }
}

Describe "Scheduler protection (Phase 12A Case 9, 10)" {

    It "Case 9: gym-partner-upload-sweep is never in the pausable list" {
        (Get-DevPausableSchedules) -contains "fitness-assistant-dev-gym-partner-upload-sweep" | Should Be $false
        Get-DevIndependentSchedule | Should Be "fitness-assistant-dev-gym-partner-upload-sweep"
    }

    It "the pausable list has exactly the 13 historically-verified schedules" {
        (Get-DevPausableSchedules).Count | Should Be 13
        (Get-DevAllKnownSchedules).Count | Should Be 14
    }

    It "Case 10a: all schedules ENABLED -> snapshot SHOULD be captured" {
        $states = @{}
        foreach ($name in (Get-DevPausableSchedules)) { $states[$name] = "ENABLED" }
        Test-ShouldCaptureScheduleSnapshot -CurrentStates $states -PausableNames (Get-DevPausableSchedules) | Should Be $true
    }

    It "Case 10b: all pausable schedules already DISABLED (idempotent re-run) -> snapshot must NOT be re-captured" {
        $states = @{}
        foreach ($name in (Get-DevPausableSchedules)) { $states[$name] = "DISABLED" }
        Test-ShouldCaptureScheduleSnapshot -CurrentStates $states -PausableNames (Get-DevPausableSchedules) | Should Be $false
    }

    It "Case 10c: one schedule still ENABLED among otherwise-disabled ones -> snapshot SHOULD be captured" {
        $states = @{}
        foreach ($name in (Get-DevPausableSchedules)) { $states[$name] = "DISABLED" }
        $states[(Get-DevPausableSchedules)[0]] = "ENABLED"
        Test-ShouldCaptureScheduleSnapshot -CurrentStates $states -PausableNames (Get-DevPausableSchedules) | Should Be $true
    }
}
