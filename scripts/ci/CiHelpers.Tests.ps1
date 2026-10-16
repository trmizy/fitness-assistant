<#
.SYNOPSIS
  Phase 16A regression tests for scripts/ci/CiHelpers.psm1. FAKE metadata
  only - no AWS calls, no network, no repo mutation. Pester 3.x syntax
  (matches the repo's existing *.Tests.ps1 files).
  Run: Invoke-Pester scripts/ci/CiHelpers.Tests.ps1
#>
Import-Module (Join-Path $PSScriptRoot "CiHelpers.psm1") -Force
$map = Get-Content (Join-Path $PSScriptRoot "..\..\ci\service-impact-map.json") -Raw | ConvertFrom-Json
$smoke = Get-Content (Join-Path $PSScriptRoot "..\..\ci\smoke-matrix.json") -Raw | ConvertFrom-Json

Describe "Get-CiImpact (1-5, 23)" {
    It "1) user-only change selects User only" {
        $i = Get-CiImpact -ImpactMap $map -ChangedFiles @("backend/services/user-service/src/app.ts")
        ($i.LambdaServices -join ",") | Should Be "user"
        $i.EcsServices.Count | Should Be 0
        $i.Infra.Count | Should Be 0
    }
    It "2) shared change selects every consumer" {
        $i = Get-CiImpact -ImpactMap $map -ChangedFiles @("backend/shared/src/index.ts")
        ($i.LambdaServices -join ",") | Should Be "ai,auth,fitness,gym,payment,user"
        ($i.EcsServices -join ",") | Should Be "chat"
    }
    It "3) chat-only change selects Chat (ECS) and no Lambda" {
        $i = Get-CiImpact -ImpactMap $map -ChangedFiles @("backend/services/chat-service/src/server.ts")
        ($i.EcsServices -join ",") | Should Be "chat"
        $i.LambdaServices.Count | Should Be 0
    }
    It "4) infra-only change does not redeploy any Lambda or ECS service" {
        $i = Get-CiImpact -ImpactMap $map -ChangedFiles @("infra/cloudformation/api-gateway-baseline.yaml")
        $i.LambdaServices.Count | Should Be 0
        $i.EcsServices.Count | Should Be 0
    }
    It "5) API Gateway route change selects the infra pipeline" {
        $i = Get-CiImpact -ImpactMap $map -ChangedFiles @("infra/cloudformation/api-gateway-additions.yaml")
        ($i.Infra -join ",") | Should Be "apiGateway"
    }
    It "lockfile change selects all services" {
        $i = Get-CiImpact -ImpactMap $map -ChangedFiles @("pnpm-lock.yaml")
        $i.LambdaServices.Count | Should Be 6
    }
    It "markdown-only and docs changes select nothing and are not unclassified" {
        $i = Get-CiImpact -ImpactMap $map -ChangedFiles @("README.md", "docs/deployment/x.json")
        $i.Services.Count | Should Be 0
        $i.Unclassified.Count | Should Be 0
    }
    It "an unknown path is UNCLASSIFIED and blocks deploy" {
        $i = Get-CiImpact -ImpactMap $map -ChangedFiles @("mystery/file.bin")
        $i.DeployBlocked | Should Be $true
        $i.ValidateAll | Should Be $true
    }
    It "a migration file flags the owning service for review" {
        $i = Get-CiImpact -ImpactMap $map -ChangedFiles @("backend/services/gym-service/prisma/migrations/20261009_x/migration.sql")
        ($i.MigrationReview -join ",") | Should Be "gym"
    }
    It "backslash paths (Windows) normalise" {
        $i = Get-CiImpact -ImpactMap $map -ChangedFiles @("backend\services\auth-service\src\app.ts")
        ($i.LambdaServices -join ",") | Should Be "auth"
    }
}

Describe "Test-ChangeSetSafety (6, 7)" {
    $apiOk = @{ HttpApiId = "id1iz7upbl" }
    It "6) a Remove action blocks" {
        $r = Test-ChangeSetSafety -ParameterValues $apiOk -Changes @(@{ Action = "Remove"; ResourceType = "AWS::ApiGatewayV2::Route"; LogicalResourceId = "R1"; Replacement = "N/A" })
        $r.Verdict | Should Be "BLOCK"
    }
    It "6b) Modify with Conditional replacement blocks" {
        $r = Test-ChangeSetSafety -ParameterValues $apiOk -Changes @(@{ Action = "Modify"; ResourceType = "AWS::ApiGatewayV2::Integration"; LogicalResourceId = "I1"; Replacement = "Conditional" })
        $r.Verdict | Should Be "BLOCK"
    }
    It "7) API creation/replacement is a HARD block" {
        $r = Test-ChangeSetSafety -ParameterValues $apiOk -Changes @(@{ Action = "Add"; ResourceType = "AWS::ApiGatewayV2::Api"; LogicalResourceId = "Api"; Replacement = "N/A" })
        $r.Verdict | Should Be "BLOCK"
        $r.HardBlock | Should Be $true
    }
    It "7b) a HttpApiId other than the protected API is a HARD block" {
        $r = Test-ChangeSetSafety -ParameterValues @{ HttpApiId = "zzzzzzzzzz" } -Changes @()
        $r.HardBlock | Should Be $true
    }
    It "7c) stage recreation blocks" {
        $r = Test-ChangeSetSafety -ParameterValues $apiOk -Changes @(@{ Action = "Modify"; ResourceType = "AWS::ApiGatewayV2::Stage"; LogicalResourceId = "S"; Replacement = "True" })
        $r.Verdict | Should Be "BLOCK"
    }
    It "route Add needs approval but does not block" {
        $r = Test-ChangeSetSafety -ParameterValues $apiOk -Changes @(@{ Action = "Add"; ResourceType = "AWS::ApiGatewayV2::Route"; LogicalResourceId = "R2"; Replacement = "N/A" })
        $r.Verdict | Should Be "APPROVAL_REQUIRED"
    }
    It "permission Add requires review (broadening)" {
        $r = Test-ChangeSetSafety -ParameterValues $apiOk -Changes @(@{ Action = "Add"; ResourceType = "AWS::Lambda::Permission"; LogicalResourceId = "P"; Replacement = "N/A" })
        $r.Verdict | Should Be "APPROVAL_REQUIRED"
    }
    It "an empty change set is AUTO_OK" {
        (Test-ChangeSetSafety -ParameterValues $apiOk -Changes @()).Verdict | Should Be "AUTO_OK"
    }
    It "a valid unexpired allowlist entry downgrades a BLOCK route removal to approval" {
        $allow = @(@{ LogicalResourceId = "R1"; Action = "Remove"; ApprovedBy = "owner"; Reason = "intentional"; ExpiresOn = "2030-01-01" })
        $r = Test-ChangeSetSafety -ParameterValues $apiOk -AllowList $allow -Today ([datetime]"2026-10-09") -Changes @(@{ Action = "Remove"; ResourceType = "AWS::ApiGatewayV2::Route"; LogicalResourceId = "R1"; Replacement = "N/A" })
        $r.Verdict | Should Be "APPROVAL_REQUIRED"
    }
    It "an expired or reasonless allowlist entry does not help" {
        $allow = @(@{ LogicalResourceId = "R1"; Action = "Remove"; ApprovedBy = "owner"; Reason = ""; ExpiresOn = "2030-01-01" }, @{ LogicalResourceId = "R1"; Action = "Remove"; ApprovedBy = "o"; Reason = "x"; ExpiresOn = "2020-01-01" })
        $r = Test-ChangeSetSafety -ParameterValues $apiOk -AllowList $allow -Today ([datetime]"2026-10-09") -Changes @(@{ Action = "Remove"; ResourceType = "AWS::ApiGatewayV2::Route"; LogicalResourceId = "R1"; Replacement = "N/A" })
        $r.Verdict | Should Be "BLOCK"
    }
    It "the allowlist can never override an API HARD block" {
        $allow = @(@{ LogicalResourceId = "Api"; Action = "Add"; ApprovedBy = "owner"; Reason = "x"; ExpiresOn = "2030-01-01" })
        $r = Test-ChangeSetSafety -ParameterValues $apiOk -AllowList $allow -Today ([datetime]"2026-10-09") -Changes @(@{ Action = "Add"; ResourceType = "AWS::ApiGatewayV2::Api"; LogicalResourceId = "Api"; Replacement = "N/A" })
        $r.Verdict | Should Be "BLOCK"
    }
    # Phase 16A.1: a missing/blank actual HttpApiId is never a silent pass -
    # this is the policy half of the wrapper-bypass fix (the other half is
    # the wrapper independently deriving the real value instead of copying
    # ProtectedApiId - see "Test-DeploymentSafety.ps1" below).
    It "16A.1) a missing HttpApiId parameter is a HARD block (API_ID_MISSING), never a silent pass" {
        $r = Test-ChangeSetSafety -ParameterValues @{} -Changes @()
        $r.Verdict | Should Be "BLOCK"
        $r.HardBlock | Should Be $true
        @($r.Findings | Where-Object Rule -eq "API_ID_MISSING").Count | Should Be 1
    }
    It "16A.1) a blank HttpApiId value is also a HARD block, not treated as absent-and-ok" {
        $r = Test-ChangeSetSafety -ParameterValues @{ HttpApiId = "   " } -Changes @()
        $r.Verdict | Should Be "BLOCK"
        @($r.Findings | Where-Object Rule -eq "API_ID_MISSING").Count | Should Be 1
    }
    It "16A.1) a missing/blank ProtectedApiId is a configuration-error HARD block" {
        $r = Test-ChangeSetSafety -ProtectedApiId "" -ParameterValues $apiOk -Changes @()
        $r.Verdict | Should Be "BLOCK"
        @($r.Findings | Where-Object Rule -eq "PROTECTED_API_ID_MISSING").Count | Should Be 1
    }
}

Describe "Test-ChangeSetDigest (16A.1 - plan/apply identity binding)" {
    It "matching digests pass" {
        (Test-ChangeSetDigest -ActualDigest "ABC123" -ReviewedDigest "abc123").Match | Should Be $true
    }
    It "a mismatch is CHANGESET_DIGEST_MISMATCH" {
        $r = Test-ChangeSetDigest -ActualDigest "ABC123" -ReviewedDigest "DEF456"
        $r.Match | Should Be $false
        $r.Rule | Should Be "CHANGESET_DIGEST_MISMATCH"
    }
    It "a missing digest on either side never passes" {
        (Test-ChangeSetDigest -ActualDigest "" -ReviewedDigest "abc123").Match | Should Be $false
        (Test-ChangeSetDigest -ActualDigest "abc123" -ReviewedDigest "").Match | Should Be $false
    }
}

# ---------------------------------------------------------------------------
# Phase 16A.1 - REAL WRAPPER tests. Pure-function tests above prove the
# policy logic is correct in isolation; they do NOT prove the real CI
# entrypoint (scripts/ci/Test-DeploymentSafety.ps1) wires it up correctly -
# that was exactly how the original defect (wrapper hardcoding ParameterValues
# = @{ HttpApiId = $ProtectedApiId }) passed every pure-function test while
# being broken in every real draft workflow. These tests invoke the actual
# .ps1 file as a real child process (powershell.exe -File ...), the same way
# every draft workflow does, and assert on its real JSON stdout + real exit
# code (0 = safe, 2 = blocked).
# ---------------------------------------------------------------------------
Describe "Test-DeploymentSafety.ps1 (16A.1 - real wrapper, not just pure functions)" {
    $wrapper = Join-Path $PSScriptRoot "Test-DeploymentSafety.ps1"

    function Invoke-Wrapper {
        param([string[]]$WrapperArgs)
        $out = & powershell.exe -NoProfile -File $wrapper @WrapperArgs 2>&1
        [pscustomobject]@{ ExitCode = $LASTEXITCODE; Json = (($out | Out-String).Trim() | ConvertFrom-Json) }
    }
    function New-ChangeSetFixture {
        param([string]$Path, [string]$ActualHttpApiId, [string]$Action = "Modify", [string]$ResourceType = "AWS::ApiGatewayV2::Route", [string]$Replacement = "False", [switch]$NoParameters)
        $parameters = if ($NoParameters) { @() } else { @(@{ ParameterKey = "HttpApiId"; ParameterValue = $ActualHttpApiId }) }
        $obj = [ordered]@{
            Changes = @(@{ ResourceChange = @{ Action = $Action; ResourceType = $ResourceType; LogicalResourceId = "R1"; Replacement = $Replacement } })
            Parameters = $parameters
        }
        $obj | ConvertTo-Json -Depth 6 | Set-Content -Path $Path -Encoding utf8
    }

    It "1) protected == actual -> PASS (exit 0)" {
        $f = Join-Path $TestDrive "cs-match.json"
        New-ChangeSetFixture -Path $f -ActualHttpApiId "id1iz7upbl"
        $r = Invoke-Wrapper -WrapperArgs @("-ChangeSetFile", $f)
        $r.ExitCode | Should Be 0
        $r.Json.Verdict | Should Not Be "BLOCK"
    }
    It "2) protected != actual -> BLOCK / API_ID_MISMATCH (exit 2)" {
        $f = Join-Path $TestDrive "cs-mismatch.json"
        New-ChangeSetFixture -Path $f -ActualHttpApiId "zzzzzzzzzz"
        $r = Invoke-Wrapper -WrapperArgs @("-ChangeSetFile", $f)
        $r.ExitCode | Should Be 2
        $r.Json.Verdict | Should Be "BLOCK"
        @($r.Json.Findings | Where-Object Rule -eq "API_ID_MISMATCH").Count | Should Be 1
    }
    It "3) actual API ID missing from the real change-set metadata -> BLOCK / fail closed (exit 2)" {
        $f = Join-Path $TestDrive "cs-no-params.json"
        New-ChangeSetFixture -Path $f -ActualHttpApiId "id1iz7upbl" -NoParameters
        $r = Invoke-Wrapper -WrapperArgs @("-ChangeSetFile", $f)
        $r.ExitCode | Should Be 2
        @($r.Json.Findings | Where-Object Rule -eq "API_ID_MISSING").Count | Should Be 1
    }
    # 4) Protected API ID missing is covered at the pure-function level above
    # ("a missing/blank ProtectedApiId is a configuration-error HARD block").
    # The wrapper's -ProtectedApiId has a non-blank default ("id1iz7upbl") and
    # Windows PowerShell's own `-File` argv parser drops a deliberately-blank
    # `""` override before the script ever sees it (a pre-existing PowerShell
    # CLI limitation, not something this fix can or should work around) - so
    # this one case is exercised where the policy actually lives.
    It "5) a Delete/Remove action blocks even with a correct API ID (exit 2)" {
        $f = Join-Path $TestDrive "cs-delete.json"
        New-ChangeSetFixture -Path $f -ActualHttpApiId "id1iz7upbl" -Action "Remove"
        $r = Invoke-Wrapper -WrapperArgs @("-ChangeSetFile", $f)
        $r.ExitCode | Should Be 2
        @($r.Json.Findings | Where-Object Rule -eq "ROUTE_REMOVAL").Count | Should Be 1
    }
    It "6) a Replacement action blocks even with a correct API ID (exit 2)" {
        $f = Join-Path $TestDrive "cs-replace.json"
        New-ChangeSetFixture -Path $f -ActualHttpApiId "id1iz7upbl" -ResourceType "AWS::ApiGatewayV2::Integration" -Replacement "True"
        $r = Invoke-Wrapper -WrapperArgs @("-ChangeSetFile", $f)
        $r.ExitCode | Should Be 2
        @($r.Json.Findings | Where-Object Rule -eq "INTEGRATION_REPLACEMENT").Count | Should Be 1
    }
    It "7) a safe, unrelated resource update is allowed through when the API ID matches (exit 0)" {
        $f = Join-Path $TestDrive "cs-safe.json"
        New-ChangeSetFixture -Path $f -ActualHttpApiId "id1iz7upbl" -Action "Add" -ResourceType "AWS::Lambda::Permission" -Replacement "N/A"
        $r = Invoke-Wrapper -WrapperArgs @("-ChangeSetFile", $f)
        $r.ExitCode | Should Be 0
        $r.Json.Verdict | Should Be "APPROVAL_REQUIRED"
    }
    It "8) wrong AWS account identity metadata blocks (via the test-only -IdentityFile injection point, exit 2)" {
        $f = Join-Path $TestDrive "identity-wrong-account.json"
        @{ Account = "999999999999"; Arn = "arn:aws:iam::999999999999:user/someone" } | ConvertTo-Json | Set-Content $f -Encoding utf8
        $r = Invoke-Wrapper -WrapperArgs @("-Identity", "-IdentityFile", $f, "-Context", "Local")
        $r.ExitCode | Should Be 2
        $r.Json.Class | Should Be "BLOCK_WRONG_ACCOUNT"
    }
    It "9) plan/apply identity mismatch: a change-set digest that does not match what was reviewed blocks before any content evaluation (exit 2)" {
        $f = Join-Path $TestDrive "cs-digest.json"
        New-ChangeSetFixture -Path $f -ActualHttpApiId "id1iz7upbl"
        $r = Invoke-Wrapper -WrapperArgs @("-ChangeSetFile", $f, "-ReviewedDigest", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
        $r.ExitCode | Should Be 2
        @($r.Json.Findings | Where-Object Rule -eq "CHANGESET_DIGEST_MISMATCH").Count | Should Be 1
    }
    It "9b) the matching digest for the SAME file passes the binding check and proceeds to normal evaluation" {
        $f = Join-Path $TestDrive "cs-digest-ok.json"
        New-ChangeSetFixture -Path $f -ActualHttpApiId "id1iz7upbl"
        $digest = (Get-FileHash $f -Algorithm SHA256).Hash
        $r = Invoke-Wrapper -WrapperArgs @("-ChangeSetFile", $f, "-ReviewedDigest", $digest)
        $r.ExitCode | Should Be 0
    }
    It "10) regression proof: the wrapper does NOT substitute ProtectedApiId for the real actual value" {
        # Before the 16A.1 fix this exact fixture (actual = a deliberately
        # different decoy ID, Protected = id1iz7upbl) would have PASSED,
        # because the wrapper hardcoded ParameterValues = @{ HttpApiId =
        # $ProtectedApiId } - i.e. it compared the protected ID against
        # itself and could never observe a real mismatch. It must now BLOCK.
        $f = Join-Path $TestDrive "cs-regression-proof.json"
        New-ChangeSetFixture -Path $f -ActualHttpApiId "zzzzzzzzzz"
        $r = Invoke-Wrapper -WrapperArgs @("-ChangeSetFile", $f, "-ProtectedApiId", "id1iz7upbl")
        $r.ExitCode | Should Be 2
        $r.Json.Verdict | Should Be "BLOCK"
        @($r.Json.Findings | Where-Object Rule -eq "API_ID_MISMATCH").Count | Should Be 1
    }
}

Describe "Test-AwsIdentityGate (8-11)" {
    It "8) missing identity blocks" {
        (Test-AwsIdentityGate -Identity $null).Class | Should Be "BLOCK_MISSING_IDENTITY"
        (Test-AwsIdentityGate -Identity @{ Account = ""; Arn = "" }).Allowed | Should Be $false
    }
    It "9) wrong account blocks" {
        $r = Test-AwsIdentityGate -Identity @{ Account = "111111111111"; Arn = "arn:aws:sts::111111111111:assumed-role/GyminiDevAppDeployRole/s" }
        $r.Class | Should Be "BLOCK_WRONG_ACCOUNT"
    }
    It "10) root blocks even for read" {
        $r = Test-AwsIdentityGate -Mode Read -Context Local -Identity @{ Account = "191798898985"; Arn = "arn:aws:iam::191798898985:root" }
        $r.Class | Should Be "BLOCK_ROOT"
    }
    It "11) vmimport-admin mutation blocks" {
        $r = Test-AwsIdentityGate -Mode Mutate -Context Local -Identity @{ Account = "191798898985"; Arn = "arn:aws:iam::191798898985:user/vmimport-admin" }
        $r.Class | Should Be "BLOCK_VMIMPORT_MUTATION"
    }
    It "CI rejects gymini-admin (static IAM user)" {
        $r = Test-AwsIdentityGate -Mode Read -Context CI -Identity @{ Account = "191798898985"; Arn = "arn:aws:iam::191798898985:user/gymini-admin" }
        $r.Class | Should Be "BLOCK_STATIC_USER_IN_CI"
    }
    It "CI accepts the OIDC deploy role session" {
        $r = Test-AwsIdentityGate -Mode Mutate -Context CI -Identity @{ Account = "191798898985"; Arn = "arn:aws:sts::191798898985:assumed-role/GyminiDevAppDeployRole/gh-123" }
        $r.Allowed | Should Be $true
    }
    It "CI rejects an unrelated assumed role" {
        $r = Test-AwsIdentityGate -Mode Read -Context CI -Identity @{ Account = "191798898985"; Arn = "arn:aws:sts::191798898985:assumed-role/SomeOtherRole/x" }
        $r.Class | Should Be "BLOCK_ROLE_NOT_ALLOWED"
    }
    It "Local accepts gymini-admin" {
        (Test-AwsIdentityGate -Mode Read -Context Local -Identity @{ Account = "191798898985"; Arn = "arn:aws:iam::191798898985:user/gymini-admin" }).Allowed | Should Be $true
    }
}

Describe "Get-CiFailureClass (12)" {
    It "12) Bedrock authorization is BLOCKED and non-blocking, not DEPLOY_FAIL" {
        $r = Get-CiFailureClass -Stage smoke -Message "BEDROCK_ACCOUNT_AUTHORIZATION: authorizationStatus is not AUTHORIZED"
        $r.Class | Should Be "BEDROCK_ACCOUNT_AUTHORIZATION_BLOCKED"
        $r.Blocking | Should Be $false
        $r.Status | Should Be "BLOCKED"
    }
    It "Bedrock AccessDenied text is classified even from the deploy stage" {
        (Get-CiFailureClass -Stage deploy -Message "AccessDeniedException: not authorized to invoke model on bedrock").Class | Should Be "BEDROCK_ACCOUNT_AUTHORIZATION_BLOCKED"
    }
    It "missing local Postgres is INTEGRATION_ENV_UNAVAILABLE, not a code failure" {
        $r = Get-CiFailureClass -Stage integration -Message "connect ECONNREFUSED 127.0.0.1:5433"
        $r.Class | Should Be "INTEGRATION_ENV_UNAVAILABLE"
        $r.Blocking | Should Be $false
    }
    It "a Prisma call with no DATABASE_URL set is also INTEGRATION_ENV_UNAVAILABLE, not a code failure (Phase 16B.2, real evidence: a *.integration.test.ts file swept up by the unit job's *.test.ts glob fails this way - never ECONNREFUSED - because Prisma refuses to even attempt a connection with no URL configured)" {
        $r = Get-CiFailureClass -Stage unit -Message "PrismaClientInitializationError: `n  error: Environment variable not found: DATABASE_URL.`n   9 |   url      = env(`"DATABASE_URL`")"
        $r.Class | Should Be "INTEGRATION_ENV_UNAVAILABLE"
        $r.Blocking | Should Be $false
    }
    It "plain stages map to their class" {
        (Get-CiFailureClass -Stage build -Message "TS2322").Class | Should Be "BUILD_FAIL"
        (Get-CiFailureClass -Stage unit -Message "1 failed").Class | Should Be "UNIT_TEST_FAIL"
        (Get-CiFailureClass -Stage deploy -Message "update failed").Class | Should Be "DEPLOY_FAIL"
        (Get-CiFailureClass -Stage smoke -Message "HTTP 500").Class | Should Be "SMOKE_FAIL"
        (Get-CiFailureClass -Stage approval -Message "").Class | Should Be "MANUAL_APPROVAL_REQUIRED"
    }
}

Describe "Find-SecretLikeOutput (13)" {
    It "13) detects a JWT without returning its value" {
        $jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk"
        $r = Find-SecretLikeOutput -Text "token: $jwt"
        ($r | ForEach-Object Type) -contains "JWT" | Should Be $true
        (($r | Out-String) -match "abcdefghijk") | Should Be $false
    }
    It "detects an assigned named secret but ignores a bare name or a masked value" {
        @(Find-SecretLikeOutput -Text "JWT_SECRET=hunter2hunter2").Count | Should Be 1
        @(Find-SecretLikeOutput -Text "JWT_SECRET=***").Count | Should Be 0
        @(Find-SecretLikeOutput -Text "env names: JWT_SECRET, SMTP_PASS").Count | Should Be 0
    }
    It "detects a Lambda Environment.Variables dump" {
        $t = '{ "Environment": { "Variables": { "A": "b" } } }'
        (Find-SecretLikeOutput -Text $t | ForEach-Object Type) -contains "LAMBDA_ENV_DUMP" | Should Be $true
    }
    It "detects an AWS access key id" {
        (Find-SecretLikeOutput -Text "AKIAABCDEFGHIJKLMNOP" | ForEach-Object Type) -contains "AWS_ACCESS_KEY" | Should Be $true
    }
    It "clean text is clean" {
        @(Find-SecretLikeOutput -Text "CodeSha256 abc, LastUpdateStatus Successful").Count | Should Be 0
    }
}

Describe "Get-SmokePlan (14)" {
    It "14) payment smoke never includes a mutation or POST" {
        $p = @(Get-SmokePlan -Matrix $smoke -Services @("payment"))
        $p.Count | Should BeGreaterThan 0
        @($p | Where-Object { $_.mutation -or $_.method -eq "POST" }).Count | Should Be 0
    }
    It "no selected entry anywhere is a mutation, SMTP, register or AI chat call" {
        $p = @(Get-SmokePlan -Matrix $smoke -ChatRunning $true)
        @($p | Where-Object { $_.mutation }).Count | Should Be 0
        @($p | Where-Object { $_.path -match "password-reset|register|/ai/chat" }).Count | Should Be 0
    }
    It "Chat is smoked only when running" {
        @(Get-SmokePlan -Matrix $smoke -Services @("chat") -ChatRunning $false).Count | Should Be 0
        @(Get-SmokePlan -Matrix $smoke -Services @("chat") -ChatRunning $true).Count | Should Be 1
    }
}

Describe "Test-DeployPlanSafety / lifecycle + scheduler (15, 16)" {
    It "15) a code deploy that calls dev-start/dev-stop is rejected" {
        (Test-DeployPlanSafety -PlannedActions @("pwsh scripts/aws/dev-start.ps1 -Backend -Execute")).Safe | Should Be $false
        (Test-DeployPlanSafety -PlannedActions @("pwsh scripts/aws/dev-stop.ps1 -Execute")).Violations[0].Rule | Should Be "LIFECYCLE_SCRIPT"
    }
    It "15b) forcing Chat desiredCount is rejected unless explicitly allowed" {
        $cmd = "aws ecs update-service --cluster c --service s --desired-count 1"
        (Test-DeployPlanSafety -PlannedActions @($cmd)).Safe | Should Be $false
        (Test-DeployPlanSafety -PlannedActions @($cmd) -AllowChatPowerChange).Safe | Should Be $true
    }
    It "16) scheduler enable/update is always rejected in CI" {
        (Test-DeployPlanSafety -PlannedActions @("aws scheduler update-schedule --name x --state ENABLED") -AllowChatPowerChange).Safe | Should Be $false
    }
    It "16b) unchanged schedule states are preserved; any drift is reported" {
        $before = @{ a = "DISABLED"; b = "ENABLED" }
        (Test-ScheduleStatePreserved -Before $before -After @{ a = "DISABLED"; b = "ENABLED" }).Preserved | Should Be $true
        $r = Test-ScheduleStatePreserved -Before $before -After @{ a = "ENABLED"; b = "ENABLED" }
        $r.Preserved | Should Be $false
        ($r.Changed -join ",") | Should Be "a"
    }
    It "ad-hoc gateway route mutation, secret rotation and migrations are rejected in a code deploy" {
        (Test-DeployPlanSafety -PlannedActions @("aws apigatewayv2 create-route --api-id x")).Safe | Should Be $false
        (Test-DeployPlanSafety -PlannedActions @("aws secretsmanager put-secret-value --secret-id x")).Safe | Should Be $false
        (Test-DeployPlanSafety -PlannedActions @("aws lambda invoke --function-name fitness-assistant-dev-gym-migrate out.json")).Safe | Should Be $false
    }
    It "update-function-configuration only passes in ConfigDeploy mode" {
        $cmd = "aws lambda update-function-configuration --function-name f --timeout 30"
        (Test-DeployPlanSafety -PlannedActions @($cmd)).Safe | Should Be $false
        (Test-DeployPlanSafety -PlannedActions @($cmd) -Mode ConfigDeploy).Safe | Should Be $true
    }
    It "an unscoped get-function-configuration (prints env vars) is rejected; a --query one passes" {
        (Test-DeployPlanSafety -PlannedActions @("aws lambda get-function-configuration --function-name f")).Safe | Should Be $false
        (Test-DeployPlanSafety -PlannedActions @("aws lambda get-function-configuration --function-name f --query LastUpdateStatus")).Safe | Should Be $true
    }
    It "the normal code-deploy commands pass" {
        $plan = @("aws lambda update-function-code --function-name f --s3-bucket b --s3-key k --query CodeSha256", "aws lambda wait function-updated-v2 --function-name f")
        (Test-DeployPlanSafety -PlannedActions $plan).Safe | Should Be $true
    }
}

Describe "Get-ChatDeployMode" {
    It "desiredCount 0 -> register + pin task definition, never passes desired-count, Chat stays off" {
        $m = Get-ChatDeployMode -DesiredCount 0
        $m.Mode | Should Be "REGISTER_AND_PIN_ONLY"
        $m.PassDesiredCount | Should Be $false
        $m.TargetDesiredCount | Should Be 0
    }
    It "desiredCount 1 -> rolling update that does not pass a desired count" {
        $m = Get-ChatDeployMode -DesiredCount 1
        $m.Mode | Should Be "ROLLING_UPDATE"
        $m.PassDesiredCount | Should Be $false
        $m.TargetDesiredCount | Should Be 1
    }
    It "turning Chat on requires the explicit flag" {
        $m = Get-ChatDeployMode -DesiredCount 0 -ForceOn
        $m.Mode | Should Be "FORCE_ON_EXPLICIT"
        $m.PassDesiredCount | Should Be $true
    }
}
