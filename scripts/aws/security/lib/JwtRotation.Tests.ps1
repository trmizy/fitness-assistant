<#
.SYNOPSIS
  Phase 13B-A regression tests for the zero-exposure JWT rotation logic.
  Uses FAKE values only. Zero AWS calls, zero real secrets.
#>
Import-Module (Join-Path $PSScriptRoot "JwtRotation.psm1") -Force

function FakeCurrentEnv {
    @{
        JWT_SECRET              = "FAKE-OLD-ACCESS-SECRET-not-real"
        JWT_REFRESH_SECRET      = "FAKE-OLD-REFRESH-SECRET-not-real"
        INTERNAL_SERVICE_SECRET = "FAKE-INTERNAL-not-real"
        SMTP_PASS               = "FAKE-SMTP-not-real"
        SMTP_HOST               = "smtp.example.test"
        NODE_ENV                = "production"
        DATABASE_SECRET_ID      = "fitness-assistant/dev/database"
    }
}

function FakeNewSecrets {
    @{
        JWT_SECRET         = "FAKE-NEW-ACCESS-SECRET-not-real"
        JWT_REFRESH_SECRET = "FAKE-NEW-REFRESH-SECRET-not-real"
    }
}

Describe "Merge-RotatedEnvironment" {

    It "1) unrelated env vars are preserved exactly" {
        $result = Merge-RotatedEnvironment -CurrentEnv (FakeCurrentEnv) -NewSecrets (FakeNewSecrets)
        $result.Ok | Should Be $true
        $result.MergedEnv.INTERNAL_SERVICE_SECRET | Should Be "FAKE-INTERNAL-not-real"
        $result.MergedEnv.SMTP_PASS | Should Be "FAKE-SMTP-not-real"
        $result.MergedEnv.SMTP_HOST | Should Be "smtp.example.test"
        $result.MergedEnv.NODE_ENV | Should Be "production"
        $result.MergedEnv.DATABASE_SECRET_ID | Should Be "fitness-assistant/dev/database"
    }

    It "2) JWT_SECRET is replaced with the new value" {
        $result = Merge-RotatedEnvironment -CurrentEnv (FakeCurrentEnv) -NewSecrets (FakeNewSecrets)
        $result.MergedEnv.JWT_SECRET | Should Be "FAKE-NEW-ACCESS-SECRET-not-real"
        $result.MergedEnv.JWT_SECRET | Should Not Be "FAKE-OLD-ACCESS-SECRET-not-real"
    }

    It "3) JWT_REFRESH_SECRET is replaced with the new value" {
        $result = Merge-RotatedEnvironment -CurrentEnv (FakeCurrentEnv) -NewSecrets (FakeNewSecrets)
        $result.MergedEnv.JWT_REFRESH_SECRET | Should Be "FAKE-NEW-REFRESH-SECRET-not-real"
        $result.MergedEnv.JWT_REFRESH_SECRET | Should Not Be "FAKE-OLD-REFRESH-SECRET-not-real"
    }

    It "4) both secrets rotate together in the same merged result (atomic)" {
        $result = Merge-RotatedEnvironment -CurrentEnv (FakeCurrentEnv) -NewSecrets (FakeNewSecrets)
        $result.MergedEnv.JWT_SECRET | Should Be "FAKE-NEW-ACCESS-SECRET-not-real"
        $result.MergedEnv.JWT_REFRESH_SECRET | Should Be "FAKE-NEW-REFRESH-SECRET-not-real"
    }

    It "5) missing JWT_SECRET in current env -> fails, no merged result" {
        $current = FakeCurrentEnv
        $current.Remove("JWT_SECRET")
        $result = Merge-RotatedEnvironment -CurrentEnv $current -NewSecrets (FakeNewSecrets)
        $result.Ok | Should Be $false
        $result.MergedEnv | Should Be $null
    }

    It "6) missing JWT_REFRESH_SECRET in current env -> fails, no merged result" {
        $current = FakeCurrentEnv
        $current.Remove("JWT_REFRESH_SECRET")
        $result = Merge-RotatedEnvironment -CurrentEnv $current -NewSecrets (FakeNewSecrets)
        $result.Ok | Should Be $false
        $result.MergedEnv | Should Be $null
    }

    It "4b) new value missing for one secret -> refuses to partially rotate" {
        $newSecrets = FakeNewSecrets
        $newSecrets.Remove("JWT_REFRESH_SECRET")
        $result = Merge-RotatedEnvironment -CurrentEnv (FakeCurrentEnv) -NewSecrets $newSecrets
        $result.Ok | Should Be $false
        $result.MergedEnv | Should Be $null
    }

    It "9) unrelated config (represented here as extra env keys) is not mutated by the merge" {
        $current = FakeCurrentEnv
        $before = $current.Clone()
        $null = Merge-RotatedEnvironment -CurrentEnv $current -NewSecrets (FakeNewSecrets)
        # The function must not mutate its CurrentEnv input in place.
        foreach ($k in $before.Keys) { $current[$k] | Should Be $before[$k] }
    }
}

Describe "Test-RotationPreconditions (7, 8 - wrong account/region fail-closed)" {

    It "correct account/region/function -> Ok" {
        $r = Test-RotationPreconditions -ActualAccount "191798898985" -ExpectedAccount "191798898985" `
            -ActualRegion "ap-southeast-1" -ExpectedRegion "ap-southeast-1" `
            -ActualFunctionName "fitness-assistant-dev-auth" -ExpectedFunctionName "fitness-assistant-dev-auth"
        $r.Ok | Should Be $true
    }

    It "7) wrong account -> fail" {
        $r = Test-RotationPreconditions -ActualAccount "999999999999" -ExpectedAccount "191798898985" `
            -ActualRegion "ap-southeast-1" -ExpectedRegion "ap-southeast-1" `
            -ActualFunctionName "fitness-assistant-dev-auth" -ExpectedFunctionName "fitness-assistant-dev-auth"
        $r.Ok | Should Be $false
    }

    It "8) wrong region -> fail" {
        $r = Test-RotationPreconditions -ActualAccount "191798898985" -ExpectedAccount "191798898985" `
            -ActualRegion "us-east-1" -ExpectedRegion "ap-southeast-1" `
            -ActualFunctionName "fitness-assistant-dev-auth" -ExpectedFunctionName "fitness-assistant-dev-auth"
        $r.Ok | Should Be $false
    }

    It "wrong target function name -> fail" {
        $r = Test-RotationPreconditions -ActualAccount "191798898985" -ExpectedAccount "191798898985" `
            -ActualRegion "ap-southeast-1" -ExpectedRegion "ap-southeast-1" `
            -ActualFunctionName "fitness-assistant-PROD-auth" -ExpectedFunctionName "fitness-assistant-dev-auth"
        $r.Ok | Should Be $false
    }
}

Describe "Test-UnrelatedKeysUnchanged" {
    It "detects a clean rotation (only JWT keys differ) as unchanged-elsewhere" {
        $before = FakeCurrentEnv
        $merge = Merge-RotatedEnvironment -CurrentEnv $before -NewSecrets (FakeNewSecrets)
        Test-UnrelatedKeysUnchanged -Before $before -After $merge.MergedEnv | Should Be $true
    }

    It "detects a non-JWT key that drifted as a real problem" {
        $before = FakeCurrentEnv
        $after = $before.Clone()
        $after["SMTP_HOST"] = "something-else.example.test"
        Test-UnrelatedKeysUnchanged -Before $before -After $after | Should Be $false
    }
}

Describe "Get-SanitizedRotationSummary (output sanitization)" {

    It "10) never includes any JWT/secret value, even if asked to summarize a merge result" {
        $summary = Get-SanitizedRotationSummary -TargetFunction "fitness-assistant-dev-auth" `
            -Account "191798898985" -Region "ap-southeast-1" -EnvironmentKeysFound 10 `
            -JwtSecretPresent $true -JwtRefreshSecretPresent $true -RotationReady $true `
            -UpdateStatus "Successful" -NewLastModified "2026-10-07T12:00:00Z" -NewRevisionId "abc-123"

        $summaryText = ($summary.Keys | ForEach-Object { "$_=$($summary[$_])" }) -join " "
        $summaryText | Should Not Match "FAKE-NEW-ACCESS-SECRET-not-real"
        $summaryText | Should Not Match "FAKE-OLD-ACCESS-SECRET-not-real"
        ($summary.Keys -contains "JWT_SECRET") | Should Be $false
        ($summary.Keys -contains "JWT_REFRESH_SECRET") | Should Be $false
    }

    It "only ever exposes the explicit whitelisted field set" {
        $summary = Get-SanitizedRotationSummary -TargetFunction "f" -Account "a" -Region "r" `
            -EnvironmentKeysFound 1 -JwtSecretPresent $true -JwtRefreshSecretPresent $true -RotationReady $true
        $allowed = @('TargetFunction','Account','Region','EnvironmentKeysFound','JwtSecretPresent',
                     'JwtRefreshSecretPresent','RotationReady','UpdateStatus','NewLastModified','NewRevisionId')
        foreach ($k in $summary.Keys) { $allowed -contains $k | Should Be $true }
    }
}

Describe "New-JwtSecretValue (11 - no secret values appear in errors; basic sanity only)" {
    It "produces a non-trivial, non-predictable-looking value without throwing" {
        $v1 = New-JwtSecretValue
        $v2 = New-JwtSecretValue
        $v1.Length | Should BeGreaterThan 40
        $v1 | Should Not Be $v2
        $v1 | Should Not Match "^0+$"
    }
}

Describe "Error messages never leak secret values (11)" {
    It "a failed merge's Reason string never contains an actual secret value" {
        $current = FakeCurrentEnv
        $current.Remove("JWT_SECRET")
        $result = Merge-RotatedEnvironment -CurrentEnv $current -NewSecrets (FakeNewSecrets)
        $result.Reason | Should Not Match "FAKE-"
    }
}
