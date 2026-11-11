<#
.SYNOPSIS
  Phase 13D regression tests for the SMTP_PASS rotation logic. FAKE values
  only. Zero AWS calls, zero real credentials.
#>
Import-Module (Join-Path $PSScriptRoot "SmtpRotation.psm1") -Force

function FakeAuthEnv {
    @{
        SMTP_PASS               = "FAKE-OLD-SMTP-not-real"
        SMTP_HOST                = "smtp.gmail.com"
        SMTP_PORT                = "465"
        SMTP_USER                = "fake-user@example.test"
        SMTP_FROM                = "Fake <fake-user@example.test>"
        JWT_SECRET                = "FAKE-JWT-not-real"
        JWT_REFRESH_SECRET       = "FAKE-REFRESH-not-real"
        INTERNAL_SERVICE_SECRET = "FAKE-INTERNAL-not-real"
        NODE_ENV                 = "production"
        DATABASE_SECRET_ID      = "fitness-assistant/dev/database"
    }
}

Describe "Test-SmtpRotationPreconditions (4, 5 - wrong account/region fail-closed)" {
    It "correct account/region/function -> Ok" {
        $r = Test-SmtpRotationPreconditions -ActualAccount "191798898985" -ExpectedAccount "191798898985" `
            -ActualRegion "ap-southeast-1" -ExpectedRegion "ap-southeast-1" `
            -ActualFunctionName "fitness-assistant-dev-auth" -ExpectedFunctionName "fitness-assistant-dev-auth"
        $r.Ok | Should Be $true
    }
    It "4) wrong account -> fail" {
        $r = Test-SmtpRotationPreconditions -ActualAccount "999999999999" -ExpectedAccount "191798898985" `
            -ActualRegion "ap-southeast-1" -ExpectedRegion "ap-southeast-1" `
            -ActualFunctionName "fitness-assistant-dev-auth" -ExpectedFunctionName "fitness-assistant-dev-auth"
        $r.Ok | Should Be $false
    }
    It "5) wrong region -> fail" {
        $r = Test-SmtpRotationPreconditions -ActualAccount "191798898985" -ExpectedAccount "191798898985" `
            -ActualRegion "us-east-1" -ExpectedRegion "ap-southeast-1" `
            -ActualFunctionName "fitness-assistant-dev-auth" -ExpectedFunctionName "fitness-assistant-dev-auth"
        $r.Ok | Should Be $false
    }
}

Describe "Merge-RotatedSmtpPassword (1, 2, 3, 8, 12)" {
    It "1) SMTP_PASS is replaced with the new value" {
        $r = Merge-RotatedSmtpPassword -CurrentEnv (FakeAuthEnv) -NewValue "FAKE-NEW-SMTP-not-real"
        $r.Ok | Should Be $true
        $r.MergedEnv.SMTP_PASS | Should Be "FAKE-NEW-SMTP-not-real"
    }
    It "2) every unrelated env var preserved exactly" {
        $r = Merge-RotatedSmtpPassword -CurrentEnv (FakeAuthEnv) -NewValue "FAKE-NEW-SMTP-not-real"
        $r.MergedEnv.SMTP_HOST | Should Be "smtp.gmail.com"
        $r.MergedEnv.SMTP_USER | Should Be "fake-user@example.test"
        $r.MergedEnv.JWT_SECRET | Should Be "FAKE-JWT-not-real"
        $r.MergedEnv.JWT_REFRESH_SECRET | Should Be "FAKE-REFRESH-not-real"
        $r.MergedEnv.INTERNAL_SERVICE_SECRET | Should Be "FAKE-INTERNAL-not-real"
        $r.MergedEnv.NODE_ENV | Should Be "production"
    }
    It "12) the merge changes ONLY SMTP_PASS - key set and every other value identical" {
        $before = FakeAuthEnv
        $r = Merge-RotatedSmtpPassword -CurrentEnv $before -NewValue "FAKE-NEW-SMTP-not-real"
        foreach ($k in $before.Keys) {
            if ($k -eq "SMTP_PASS") { continue }
            $r.MergedEnv[$k] | Should Be $before[$k]
        }
        ($r.MergedEnv.Keys.Count) | Should Be ($before.Keys.Count)
    }
    It "3) missing SMTP_PASS in current env -> fails, no merged result" {
        $env = FakeAuthEnv
        $env.Remove("SMTP_PASS")
        $r = Merge-RotatedSmtpPassword -CurrentEnv $env -NewValue "FAKE-NEW-SMTP-not-real"
        $r.Ok | Should Be $false
        $r.MergedEnv | Should Be $null
    }
    It "empty new value -> refuses" {
        $r = Merge-RotatedSmtpPassword -CurrentEnv (FakeAuthEnv) -NewValue ""
        $r.Ok | Should Be $false
    }
    It "8) failure Reason never contains a fake secret value" {
        $env = FakeAuthEnv
        $env.Remove("SMTP_PASS")
        $r = Merge-RotatedSmtpPassword -CurrentEnv $env -NewValue "FAKE-NEW-SMTP-not-real"
        $r.Reason | Should Not Match "FAKE-"
    }
}

Describe "Test-SmtpConcurrencyToken (6 - RevisionId mismatch -> fail)" {
    It "matching RevisionId -> Ok" {
        (Test-SmtpConcurrencyToken -ExpectedRevisionId "rev-1" -ActualRevisionId "rev-1").Ok | Should Be $true
    }
    It "6) mismatched RevisionId -> fail" {
        (Test-SmtpConcurrencyToken -ExpectedRevisionId "rev-1" -ActualRevisionId "rev-2-changed").Ok | Should Be $false
    }
}

Describe "Get-SanitizedSmtpSummary (7 - no plaintext in stdout)" {
    It "never includes SMTP_PASS or any secret-shaped value" {
        $s = Get-SanitizedSmtpSummary -TargetFunction "fitness-assistant-dev-auth" -SmtpPassPresent $true -RotationReady $true `
            -RevisionId "rev-1" -UpdateStatus "Successful" -NewRevisionId "rev-2" -LastModified "2026-10-07T12:00:00Z" -EnvironmentKeysFound 10
        ($s.Keys -contains "SMTP_PASS") | Should Be $false
        $text = ($s.Keys | ForEach-Object { "$_=$($s[$_])" }) -join " "
        $text | Should Not Match "FAKE-"
    }
    It "only exposes the explicit whitelisted field set" {
        $s = Get-SanitizedSmtpSummary -TargetFunction "f" -SmtpPassPresent $true -RotationReady $true
        $allowed = @('TargetFunction','SmtpPassPresent','RotationReady','RevisionId','UpdateStatus','NewRevisionId','LastModified','EnvironmentKeysFound')
        foreach ($k in $s.Keys) { $allowed -contains $k | Should Be $true }
    }
}

Describe "Orchestrator script shape (9, 10, 11 - dry-run default / -Execute required / no plaintext CLI param)" {
    $scriptPath = Join-Path $PSScriptRoot "../Invoke-SmtpCredentialRotation.ps1"

    It "9/10) -Execute is a switch parameter (dry-run is the default when absent)" {
        Test-Path $scriptPath | Should Be $true
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$null)
        $paramBlock = $ast.ParamBlock
        $executeParam = $paramBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq "Execute" }
        $executeParam | Should Not Be $null
        $executeParam.StaticType.Name | Should Be "SwitchParameter"
    }

    It "11) no parameter accepts the SMTP password as a plain [string] on the command line" {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$null)
        $paramBlock = $ast.ParamBlock
        $stringParams = $paramBlock.Parameters | Where-Object {
            $_.StaticType.Name -eq "String" -and $_.Name.VariablePath.UserPath -match "pass|password|credential|secret"
        }
        $stringParams.Count | Should Be 0
    }

    It "11b) the script body reads the password via Read-Host -AsSecureString, not a parameter" {
        $content = Get-Content $scriptPath -Raw
        $content | Should Match "Read-Host.*-AsSecureString"
    }
}
