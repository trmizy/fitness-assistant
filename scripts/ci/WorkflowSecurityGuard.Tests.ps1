# Phase 16B.2 - static security guards for the two workflow files this phase
# activates: the PERMANENT .github/workflows/pr-validation.yml (must stay
# AWS-credential-free forever) and the TEMPORARY
# .github/workflows/pr-validation-oidc-smoke.yml (removed before this PR
# merges - see docs/deployment/AWS_DEV_CICD_PR_VALIDATION_ACTIVATION_2026-10-12.md).
# Pure text/regex static checks, no AWS calls, no YAML object model needed -
# consistent with this repo's existing *.Tests.ps1 convention (Pester 3.x).

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $here "..\..")
$permanentPath = Join-Path $repoRoot ".github\workflows\pr-validation.yml"
$temporaryPath = Join-Path $repoRoot ".github\workflows\pr-validation-oidc-smoke.yml"

Describe "Phase 16B.2 permanent PR validation workflow stays AWS-credential-free" {

    BeforeAll {
        $script:PermanentExists = Test-Path $permanentPath
        if ($script:PermanentExists) { $script:Permanent = Get-Content -Raw $permanentPath }
    }

    It "the permanent workflow file exists" {
        $script:PermanentExists | Should Be $true
    }

    It "has no id-token permission anywhere" {
        $script:Permanent | Should Not Match "id-token\s*:\s*write"
    }

    It "never assumes an AWS role (no configure-aws-credentials action)" {
        $script:Permanent | Should Not Match "configure-aws-credentials"
    }

    It "never references role-to-assume" {
        $script:Permanent | Should Not Match "role-to-assume"
    }

    It "never uses pull_request_target" {
        $script:Permanent | Should Not Match "pull_request_target"
    }

    It "contains no static AWS access key id pattern" {
        $script:Permanent | Should Not Match "AKIA[0-9A-Z]{16}"
    }

    It "never references AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN env names" {
        $script:Permanent | Should Not Match "AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)"
    }

    It "contains no AWS mutating deploy command" {
        foreach ($pattern in @(
                "aws lambda update-function-code",
                "aws lambda update-function-configuration",
                "aws ecs update-service",
                "aws ecr put-image",
                "cloudformation execute-change-set",
                "cloudformation create-stack",
                "cloudformation update-stack",
                "cloudformation delete-stack"
            )) {
            $script:Permanent | Should Not Match ([regex]::Escape($pattern))
        }
    }

    It "top-level permissions block is contents: read only" {
        # The workflow's own top-level `permissions:` block (not a job-level one)
        # appears once, right after the on: trigger, before any `jobs:` key.
        $topLevelChunk = ($script:Permanent -split "(?m)^jobs:", 2)[0]
        $topLevelChunk | Should Match "permissions:\s*\r?\n\s*contents:\s*read"
        $topLevelChunk | Should Not Match "id-token"
    }

    It "every checkout step sets persist-credentials: false" {
        $checkoutBlocks = [regex]::Matches($script:Permanent, "actions/checkout@v4[\s\S]{0,80}")
        @($checkoutBlocks).Count | Should BeGreaterThan 0
        foreach ($m in $checkoutBlocks) {
            $m.Value | Should Match "persist-credentials:\s*false"
        }
    }
}

Describe "Phase 16B.2 temporary OIDC smoke workflow (removed before merge)" {

    BeforeAll {
        $script:TemporaryExists = Test-Path $temporaryPath
        if ($script:TemporaryExists) { $script:Temporary = Get-Content -Raw $temporaryPath }
    }

    It "while present, never checks out repository code (no actions/checkout step)" {
        if (-not $script:TemporaryExists) { return }
        $script:Temporary | Should Not Match "uses:\s*actions/checkout"
    }

    It "while present, assumes only GyminiDevCiReadRole, never another role" {
        if (-not $script:TemporaryExists) { return }
        $roleMatches = [regex]::Matches($script:Temporary, "role-to-assume:\s*(\S+)")
        @($roleMatches).Count | Should BeGreaterThan 0
        foreach ($m in $roleMatches) {
            $m.Groups[1].Value | Should Be "arn:aws:iam::191798898985:role/GyminiDevCiReadRole"
        }
    }

    It "while present, enforces the same-repository (non-fork) condition" {
        if (-not $script:TemporaryExists) { return }
        $script:Temporary | Should Match "head\.repo\.full_name\s*==\s*github\.repository"
    }

    It "while present, enforces the exact activation branch condition" {
        if (-not $script:TemporaryExists) { return }
        $script:Temporary | Should Match "head\.ref\s*==\s*'ci/phase-16b2-pr-validation'"
    }

    It "while present, never echoes the OIDC JWT or raw AWS credential values" {
        if (-not $script:TemporaryExists) { return }
        $script:Temporary | Should Not Match "ACTIONS_ID_TOKEN_REQUEST_TOKEN"
        $script:Temporary | Should Not Match "echo.*AWS_SESSION_TOKEN"
        $script:Temporary | Should Not Match "echo.*AWS_SECRET_ACCESS_KEY"
    }

    It "while present, contains no AWS mutating command" {
        if (-not $script:TemporaryExists) { return }
        foreach ($pattern in @("update-function-code", "update-service", "execute-change-set", "create-stack", "update-stack", "delete-stack", "put-image")) {
            $script:Temporary | Should Not Match ([regex]::Escape($pattern))
        }
    }

    It "while present, job-level permissions request only contents:read and id-token:write" {
        if (-not $script:TemporaryExists) { return }
        $script:Temporary | Should Match "id-token:\s*write"
        $script:Temporary | Should Not Match "contents:\s*write"
    }
}

Describe "Phase 16B.2 activation state (flips to Removed before merge)" {
    It "records whether the temporary OIDC smoke workflow is currently present" {
        $state = if (Test-Path $temporaryPath) { "PRESENT (pre-merge activation PR)" } else { "REMOVED (ready to merge)" }
        Write-Host "pr-validation-oidc-smoke.yml state: $state"
        $true | Should Be $true
    }
}
