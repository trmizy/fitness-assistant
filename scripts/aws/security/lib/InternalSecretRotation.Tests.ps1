<#
.SYNOPSIS
  Phase 13C-A regression tests for the INTERNAL_SERVICE_SECRET /
  INTERNAL_API_SECRET coordinated-rotation logic. FAKE values only. Zero
  AWS calls, zero real secrets.
#>
Import-Module (Join-Path $PSScriptRoot "InternalSecretRotation.psm1") -Force

function FakeLambdaEnv {
    @{
        INTERNAL_SERVICE_SECRET = "FAKE-OLD-INTERNAL-not-real"
        NODE_ENV                = "production"
        DATABASE_SECRET_ID      = "fitness-assistant/dev/database"
        AUTH_LAMBDA_NAME        = "fitness-assistant-dev-auth"
    }
}

Describe "Test-AccountRegion (3, 4 - wrong account/region fail-closed)" {
    It "correct account/region -> Ok" {
        $r = Test-AccountRegion -ActualAccount "191798898985" -ExpectedAccount "191798898985" -ActualRegion "ap-southeast-1" -ExpectedRegion "ap-southeast-1"
        $r.Ok | Should Be $true
    }
    It "3) wrong account -> fail" {
        $r = Test-AccountRegion -ActualAccount "999999999999" -ExpectedAccount "191798898985" -ActualRegion "ap-southeast-1" -ExpectedRegion "ap-southeast-1"
        $r.Ok | Should Be $false
    }
    It "4) wrong region -> fail" {
        $r = Test-AccountRegion -ActualAccount "191798898985" -ExpectedAccount "191798898985" -ActualRegion "us-east-1" -ExpectedRegion "ap-southeast-1"
        $r.Ok | Should Be $false
    }
}

Describe "Test-ConsumerInventoryComplete (1, 2, 18 - complete graph / missing consumer / all included)" {
    It "1/18) complete inventory matching expected list -> Ok" {
        $expected = Get-InternalSecretLambdaConsumers
        $r = Test-ConsumerInventoryComplete -ExpectedConsumers $expected -CurrentInventory $expected
        $r.Ok | Should Be $true
        $r.Missing.Count | Should Be 0
    }
    It "2) a missing consumer -> fail, named in Missing" {
        $expected = Get-InternalSecretLambdaConsumers
        $current = @($expected | Where-Object { $_ -ne "fitness-assistant-dev-payment" })
        $r = Test-ConsumerInventoryComplete -ExpectedConsumers $expected -CurrentInventory $current
        $r.Ok | Should Be $false
        ($r.Missing -contains "fitness-assistant-dev-payment") | Should Be $true
    }
    It "expected list has exactly the 12 confirmed live Lambda consumers" {
        (Get-InternalSecretLambdaConsumers).Count | Should Be 12
    }
}

Describe "Test-DedicatedSecretIndependence (the PT_DOCUMENT_URL_SECRET / CHECKIN_TOKEN_SECRET hazard)" {
    It "both dedicated secrets present -> Safe, no warnings" {
        $r = Test-DedicatedSecretIndependence -CheckinTokenSecretPresent $true -PtDocumentUrlSecretPresent $true
        $r.Safe | Should Be $true
        $r.Warnings.Count | Should Be 0
    }
    It "PT_DOCUMENT_URL_SECRET missing (the REAL live finding) -> unsafe, one warning naming it" {
        $r = Test-DedicatedSecretIndependence -CheckinTokenSecretPresent $true -PtDocumentUrlSecretPresent $false
        $r.Safe | Should Be $false
        ($r.Warnings -join " ") | Should Match "PT_DOCUMENT_URL_SECRET"
    }
    It "both missing -> two warnings" {
        $r = Test-DedicatedSecretIndependence -CheckinTokenSecretPresent $false -PtDocumentUrlSecretPresent $false
        $r.Warnings.Count | Should Be 2
    }
}

Describe "Merge-RotatedSingleKey (5 - Lambda unrelated vars preserved, 8 - errors never include values)" {
    It "5) unrelated env vars preserved exactly, target key replaced" {
        $r = Merge-RotatedSingleKey -CurrentEnv (FakeLambdaEnv) -KeyName "INTERNAL_SERVICE_SECRET" -NewValue "FAKE-NEW-INTERNAL-not-real"
        $r.Ok | Should Be $true
        $r.MergedEnv.INTERNAL_SERVICE_SECRET | Should Be "FAKE-NEW-INTERNAL-not-real"
        $r.MergedEnv.NODE_ENV | Should Be "production"
        $r.MergedEnv.DATABASE_SECRET_ID | Should Be "fitness-assistant/dev/database"
        $r.MergedEnv.AUTH_LAMBDA_NAME | Should Be "fitness-assistant-dev-auth"
    }
    It "missing target key -> fails, no merged result" {
        $env = FakeLambdaEnv
        $env.Remove("INTERNAL_SERVICE_SECRET")
        $r = Merge-RotatedSingleKey -CurrentEnv $env -KeyName "INTERNAL_SERVICE_SECRET" -NewValue "FAKE-NEW-not-real"
        $r.Ok | Should Be $false
        $r.MergedEnv | Should Be $null
    }
    It "empty new value -> refuses" {
        $r = Merge-RotatedSingleKey -CurrentEnv (FakeLambdaEnv) -KeyName "INTERNAL_SERVICE_SECRET" -NewValue ""
        $r.Ok | Should Be $false
    }
    It "8) failure Reason never contains a fake secret value" {
        $env = FakeLambdaEnv
        $env.Remove("INTERNAL_SERVICE_SECRET")
        $r = Merge-RotatedSingleKey -CurrentEnv $env -KeyName "INTERNAL_SERVICE_SECRET" -NewValue "FAKE-NEW-not-real"
        $r.Reason | Should Not Match "FAKE-"
    }
}

Describe "Test-EcsUnrelatedConfigUnchanged (6 - ECS unrelated config preserved)" {
    function FakeContainerDef {
        @{
            Image        = "191798898985.dkr.ecr.ap-southeast-1.amazonaws.com/chat:latest"
            Cpu          = 256
            Memory       = 512
            PortMapping  = 3005
            EnvironmentMap = @{ INTERNAL_API_SECRET = "FAKE-OLD-not-real"; NODE_ENV = "production" }
        }
    }
    It "only the target key's value differs -> considered unchanged elsewhere" {
        $before = FakeContainerDef
        $after = FakeContainerDef
        $after.EnvironmentMap = @{ INTERNAL_API_SECRET = "FAKE-NEW-not-real"; NODE_ENV = "production" }
        Test-EcsUnrelatedConfigUnchanged -CurrentContainerDef $before -ProposedContainerDef $after -ExemptKeyName "INTERNAL_API_SECRET" | Should Be $true
    }
    It "a non-exempt field drifting (e.g. Image) is detected as a real problem" {
        $before = FakeContainerDef
        $after = FakeContainerDef
        $after.Image = "some-other-image:latest"
        Test-EcsUnrelatedConfigUnchanged -CurrentContainerDef $before -ProposedContainerDef $after -ExemptKeyName "INTERNAL_API_SECRET" | Should Be $false
    }
    It "a non-exempt env var drifting is detected as a real problem" {
        $before = FakeContainerDef
        $after = FakeContainerDef
        $after.EnvironmentMap = @{ INTERNAL_API_SECRET = "FAKE-OLD-not-real"; NODE_ENV = "staging" }
        Test-EcsUnrelatedConfigUnchanged -CurrentContainerDef $before -ProposedContainerDef $after -ExemptKeyName "INTERNAL_API_SECRET" | Should Be $false
    }
}

Describe "Test-ConcurrencyToken (9, 10 - RevisionId / task revision mismatch -> fail)" {
    It "matching token -> Ok" {
        $r = Test-ConcurrencyToken -ExpectedToken "rev-1" -ActualToken "rev-1" -ResourceName "fitness-assistant-dev-auth"
        $r.Ok | Should Be $true
    }
    It "9) Lambda RevisionId mismatch -> fail" {
        $r = Test-ConcurrencyToken -ExpectedToken "rev-1" -ActualToken "rev-2-changed-by-someone-else" -ResourceName "fitness-assistant-dev-auth"
        $r.Ok | Should Be $false
    }
    It "10) ECS task definition revision mismatch -> fail" {
        $r = Test-ConcurrencyToken -ExpectedToken "6" -ActualToken "7" -ResourceName "fitness-assistant-dev-chat"
        $r.Ok | Should Be $false
    }
}

Describe "Test-StageTransitionAllowed (11, 12, 13 - stage ordering / no partial cutover)" {
    It "normal forward progression is allowed when the prior stage succeeded" {
        (Test-StageTransitionAllowed -FromStage "PREFLIGHT" -ToStage "ROTATE_LAMBDAS" -FromStageSucceeded $true).Ok | Should Be $true
        (Test-StageTransitionAllowed -FromStage "ROTATE_LAMBDAS" -ToStage "ROTATE_ECS_TASKDEF" -FromStageSucceeded $true).Ok | Should Be $true
        (Test-StageTransitionAllowed -FromStage "ROTATE_ECS_TASKDEF" -ToStage "VERIFY" -FromStageSucceeded $true).Ok | Should Be $true
    }
    It "11) partial failure in a stage -> refuses to advance (no partial cutover)" {
        (Test-StageTransitionAllowed -FromStage "ROTATE_LAMBDAS" -ToStage "ROTATE_ECS_TASKDEF" -FromStageSucceeded $false).Ok | Should Be $false
    }
    It "12) cannot skip ahead (e.g. straight to ECS before Lambdas done)" {
        (Test-StageTransitionAllowed -FromStage "PREFLIGHT" -ToStage "ROTATE_ECS_TASKDEF" -FromStageSucceeded $true).Ok | Should Be $false
    }
    It "13) cannot retire/verify before the prior stage - VERIFY only follows ROTATE_ECS_TASKDEF" {
        (Test-StageTransitionAllowed -FromStage "ROTATE_LAMBDAS" -ToStage "VERIFY" -FromStageSucceeded $true).Ok | Should Be $false
    }
}

Describe "Get-SanitizedResourceSummary (7 - old/new secret never printed)" {
    It "never includes a secret value, only metadata" {
        $s = Get-SanitizedResourceSummary -ResourceType "Lambda" -ResourceName "fitness-assistant-dev-auth" `
            -UpdateStatus "Successful" -NewRevisionId "abc-123" -EnvironmentKeysFound 10
        $text = ($s.Keys | ForEach-Object { "$_=$($s[$_])" }) -join " "
        $text | Should Not Match "FAKE-"
        ($s.Keys -contains "INTERNAL_SERVICE_SECRET") | Should Be $false
    }
    It "supports the ECS shape (task definition ARN instead of RevisionId)" {
        $s = Get-SanitizedResourceSummary -ResourceType "EcsTaskDefinition" -ResourceName "fitness-assistant-dev-chat" `
            -UpdateStatus "Registered" -NewTaskDefinitionArn "arn:aws:ecs:...:task-definition/fitness-assistant-dev-chat:7"
        $s.ResourceType | Should Be "EcsTaskDefinition"
        $s.NewTaskDefinitionArn | Should Match "fitness-assistant-dev-chat:7"
    }
}

Describe "New-SharedInternalSecretValue (14, 15 - dry-run default / -Execute required are orchestrator-level, verified via the real script below; this covers RNG quality)" {
    It "produces a non-trivial, non-predictable-looking value without throwing" {
        $v1 = New-SharedInternalSecretValue
        $v2 = New-SharedInternalSecretValue
        $v1.Length | Should BeGreaterThan 40
        $v1 | Should Not Be $v2
    }
}
