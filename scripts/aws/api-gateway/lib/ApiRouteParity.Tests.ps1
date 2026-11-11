<#
.SYNOPSIS
  Phase 15A regression tests for route normalization/parity logic. FAKE
  route metadata only - no AWS calls, no dependency on the real live API.
#>
Import-Module (Join-Path $PSScriptRoot "ApiRouteParity.psm1") -Force

Describe "ConvertTo-NormalizedRoutePath" {
    It "2) Express :id becomes API Gateway {id}" {
        ConvertTo-NormalizedRoutePath -Path "/auth/users/:userId/role" | Should Be "/auth/users/{userId}/role"
    }
    It "9) a trailing slash is stripped" {
        ConvertTo-NormalizedRoutePath -Path "/notifications/" | Should Be "/notifications"
    }
    It "a bare '/' stays '/'" {
        ConvertTo-NormalizedRoutePath -Path "/" | Should Be "/"
    }
    It "a path without a leading slash still normalizes correctly" {
        ConvertTo-NormalizedRoutePath -Path "notifications" | Should Be "/notifications"
    }
}

Describe "Test-RouteMatches (1, 3, 4, 5, 8)" {
    It "1) an exact method+path match" {
        Test-RouteMatches -SourceMethod "GET" -SourcePath "/health" -LiveMethod "GET" -LivePath "/health" | Should Be $true
    }
    It "2b) :id vs {id} match through the full comparison path" {
        Test-RouteMatches -SourceMethod "PATCH" -SourcePath "/auth/users/:userId/role" -LiveMethod "PATCH" -LivePath "/auth/users/{userId}/role" | Should Be $true
    }
    It "3) a method mismatch at the same path is not a match" {
        Test-RouteMatches -SourceMethod "POST" -SourcePath "/auth/verify" -LiveMethod "GET" -LivePath "/auth/verify" | Should Be $false
    }
    It "4) a missing route (no live counterpart at all) is not a match" {
        Test-RouteMatches -SourceMethod "POST" -SourcePath "/auth/password-reset/request" -LiveMethod "POST" -LivePath "/auth/login" | Should Be $false
    }
    It "8) a wildcard route covers a deeper real path" {
        Test-RouteMatches -SourceMethod "GET" -SourcePath "/notifications/unread-count" -LiveMethod "ANY" -LivePath "/notifications/{proxy+}" | Should Be $true
    }
    It "8b) a wildcard route covers its own bare prefix too" {
        Test-RouteMatches -SourceMethod "GET" -SourcePath "/notifications" -LiveMethod "ANY" -LivePath "/notifications/{proxy+}" | Should Be $true
    }
    It "a wildcard for a DIFFERENT prefix does not cover an unrelated path" {
        Test-RouteMatches -SourceMethod "GET" -SourcePath "/workouts" -LiveMethod "ANY" -LivePath "/notifications/{proxy+}" | Should Be $false
    }
    It "an ANY live route matches any source method at the same exact path" {
        Test-RouteMatches -SourceMethod "DELETE" -SourcePath "/me/wallet" -LiveMethod "ANY" -LivePath "/me/wallet" | Should Be $true
    }
}

Describe "Compare-ApiRoutes (5, 6, 7, 10, 11, 12)" {
    It "1/5) exact match, live-only, and source-only are bucketed correctly" {
        $source = @(
            @{ Method = "GET"; Path = "/health" },
            @{ Method = "POST"; Path = "/auth/password-reset/request" }   # 6 - will be SOURCE_ONLY
        )
        $live = @(
            @{ Method = "GET"; Path = "/health"; Integration = "fitness-assistant-dev-auth" },
            @{ Method = "ANY"; Path = "/chat/{proxy+}"; Integration = "chat-alb" }   # 6 - will be GATEWAY_ONLY
        )
        $result = Compare-ApiRoutes -SourceRoutes $source -LiveRoutes $live
        $result.Match.Count | Should Be 1
        $result.SourceOnly.Count | Should Be 1
        $result.SourceOnly[0].Path | Should Be "/auth/password-reset/request"
        $result.GatewayOnly.Count | Should Be 1
        $result.GatewayOnly[0].Path | Should Be "/chat/{proxy+}"
    }

    It "7) wrong integration target at an otherwise-matching path is MISMATCH, not MATCH" {
        $source = @(@{ Method = "ANY"; Path = "/pt/gym-affiliations"; ExpectedDeployTarget = "fitness-assistant-dev-gym" })
        $live = @(@{ Method = "ANY"; Path = "/pt/{proxy+}"; Integration = "fitness-assistant-dev-user" })
        $result = Compare-ApiRoutes -SourceRoutes $source -LiveRoutes $live
        $result.Match.Count | Should Be 0
        $result.Mismatched.Count | Should Be 1
        $result.Mismatched[0].Reason | Should Match "fitness-assistant-dev-user"
    }

    It "10) a duplicate source route pointing at the same live route is detected as two matches, not silently collapsed" {
        $source = @(
            @{ Method = "GET"; Path = "/workouts" },
            @{ Method = "GET"; Path = "/workouts" }
        )
        $live = @(@{ Method = "ANY"; Path = "/workouts/{proxy+}"; Integration = "fitness-assistant-dev-fitness" })
        $result = Compare-ApiRoutes -SourceRoutes $source -LiveRoutes $live
        $result.Match.Count | Should Be 2
    }

    It "11) PATCH /auth/me/password is represented and resolves to MATCH" {
        $source = @(@{ Method = "PATCH"; Path = "/auth/me/password"; ExpectedDeployTarget = "fitness-assistant-dev-auth" })
        $live = @(@{ Method = "PATCH"; Path = "/auth/me/password"; Integration = "fitness-assistant-dev-auth" })
        $result = Compare-ApiRoutes -SourceRoutes $source -LiveRoutes $live
        $result.Match.Count | Should Be 1
        $result.SourceOnly.Count | Should Be 0
    }

    It "12) POST /auth/password-reset/request is represented and resolves to SOURCE_ONLY (the known gap)" {
        $source = @(@{ Method = "POST"; Path = "/auth/password-reset/request"; ExpectedDeployTarget = "fitness-assistant-dev-auth" })
        $live = @(@{ Method = "PATCH"; Path = "/auth/me/password"; Integration = "fitness-assistant-dev-auth" })
        $result = Compare-ApiRoutes -SourceRoutes $source -LiveRoutes $live
        $result.Match.Count | Should Be 0
        $result.SourceOnly.Count | Should Be 1
        $result.SourceOnly[0].Path | Should Be "/auth/password-reset/request"
    }

    It "Phase 15B-A regression: a bare-less wildcard live route (chat's own shape) matched by only ITS OWN proxy-form source entry is exactly 1 match, not 2 - this is the exact root cause behind MATCHING_ROUTES (108) exceeding LIVE_ROUTE_COUNT (107) in the first Phase 15A run" {
        $source = @(@{ Method = "ANY"; Path = "/chat/{proxy+}"; ExpectedDeployTarget = "chat" })
        $live = @(@{ Method = "ANY"; Path = "/chat/{proxy+}"; Integration = "chat" })
        $result = Compare-ApiRoutes -SourceRoutes $source -LiveRoutes $live
        $result.Match.Count | Should Be 1
    }

    It "one live wildcard matched by two legitimately distinct source routes (bare + deeper path) both resolve to the SAME single live route, not two" {
        $source = @(
            @{ Method = "GET"; Path = "/notifications" },
            @{ Method = "GET"; Path = "/notifications/unread-count" }
        )
        $live = @(@{ Method = "ANY"; Path = "/notifications/{proxy+}"; Integration = "fitness-assistant-dev-user" })
        $result = Compare-ApiRoutes -SourceRoutes $source -LiveRoutes $live
        $result.Match.Count | Should Be 2
        $result.Match[0].Live.Path | Should Be "/notifications/{proxy+}"
        $result.Match[1].Live.Path | Should Be "/notifications/{proxy+}"
        $result.GatewayOnly.Count | Should Be 0
    }

    It "duplicate normalization: :id and {id} forms of the SAME source route both resolve to one live route, without inflating GatewayOnly" {
        $source = @(
            @{ Method = "PATCH"; Path = "/auth/users/:userId/role" },
            @{ Method = "PATCH"; Path = "/auth/users/{userId}/role" }
        )
        $live = @(@{ Method = "PATCH"; Path = "/auth/users/{userId}/role"; Integration = "fitness-assistant-dev-auth" })
        $result = Compare-ApiRoutes -SourceRoutes $source -LiveRoutes $live
        $result.Match.Count | Should Be 2
        $result.GatewayOnly.Count | Should Be 0
    }
}

Describe "Find-DestructiveChangeSetActions (Phase 15B-A.11 change-set safety guard)" {
    It "a pure IMPORT/no-op change set is reported safe" {
        $changes = @(
            @{ ResourceChange = @{ Action = "Import"; ResourceType = "AWS::ApiGatewayV2::Route"; Replacement = "N/A"; LogicalResourceId = "AuthLoginRoute" } }
        )
        (Find-DestructiveChangeSetActions -Changes $changes).Safe | Should Be $true
    }

    It "a Remove action is always destructive" {
        $changes = @(
            @{ ResourceChange = @{ Action = "Remove"; ResourceType = "AWS::ApiGatewayV2::Route"; Replacement = "N/A"; LogicalResourceId = "AuthLoginRoute" } }
        )
        $result = Find-DestructiveChangeSetActions -Changes $changes
        $result.Safe | Should Be $false
        $result.DestructiveActions.Count | Should Be 1
    }

    It "API_ID_REPLACEMENT_RISK: a Modify with Replacement=True is destructive" {
        $changes = @(
            @{ ResourceChange = @{ Action = "Modify"; ResourceType = "AWS::ApiGatewayV2::Api"; Replacement = "True"; LogicalResourceId = "HttpApi" } }
        )
        $result = Find-DestructiveChangeSetActions -Changes $changes
        $result.Safe | Should Be $false
        $result.DestructiveActions[0].Reason | Should Match "Replacement=True"
    }

    It "a Conditional replacement is treated as destructive, never assumed safe" {
        $changes = @(
            @{ ResourceChange = @{ Action = "Modify"; ResourceType = "AWS::ApiGatewayV2::Integration"; Replacement = "Conditional"; LogicalResourceId = "UserIntegration" } }
        )
        (Find-DestructiveChangeSetActions -Changes $changes).Safe | Should Be $false
    }

    It "an Add action creating a brand-new AWS::ApiGatewayV2::Api is destructive (must only ever import the existing one)" {
        $changes = @(
            @{ ResourceChange = @{ Action = "Add"; ResourceType = "AWS::ApiGatewayV2::Api"; Replacement = "N/A"; LogicalResourceId = "ANewApi" } }
        )
        $result = Find-DestructiveChangeSetActions -Changes $changes
        $result.Safe | Should Be $false
        $result.DestructiveActions[0].Reason | Should Match "second one"
    }

    It "an ordinary Add for a genuinely new route (not an Api) is NOT destructive" {
        $changes = @(
            @{ ResourceChange = @{ Action = "Add"; ResourceType = "AWS::ApiGatewayV2::Route"; Replacement = "N/A"; LogicalResourceId = "AuthPasswordResetRequestRoute" } }
        )
        (Find-DestructiveChangeSetActions -Changes $changes).Safe | Should Be $true
    }
}

Describe "Adoption baseline / proposed changes separation (Phase 15B-A.6)" {
    $repoRoot = Join-Path $PSScriptRoot "../../../.."
    $baselinePath = Join-Path $repoRoot "docs/deployment/generated/api-gateway-adoption-baseline.json"
    $proposedPath = Join-Path $repoRoot "docs/deployment/generated/api-gateway-proposed-changes.json"

    It "the adoption baseline contains ONLY routes already confirmed live (no sourceOnly/mismatched fields)" {
        Test-Path $baselinePath | Should Be $true
        $baseline = Get-Content $baselinePath -Raw | ConvertFrom-Json
        foreach ($r in $baseline.routes) {
            $r.PSObject.Properties.Name -contains "recommendedAction" | Should Be $false
        }
    }

    It "the proposed-changes manifest's sourceOnlyRoutes never overlaps the adoption baseline's routes" {
        Test-Path $proposedPath | Should Be $true
        $baseline = Get-Content $baselinePath -Raw | ConvertFrom-Json
        $proposed = Get-Content $proposedPath -Raw | ConvertFrom-Json
        $baselinePaths = $baseline.routes | ForEach-Object { "$($_.method) $($_.path)" }
        foreach ($p in $proposed.sourceOnlyRoutes) {
            $key = "$($p.method) $($p.path)"
            $baselinePaths -contains $key | Should Be $false
        }
    }

    It "every proposed source-only route has a non-empty recommendedAction classification" {
        $proposed = Get-Content $proposedPath -Raw | ConvertFrom-Json
        $allowed = @("ADD_LATER", "INTENTIONALLY_UNDEPLOYED", "INTERNAL_ONLY", "DEAD_OR_STALE_CODE", "NEEDS_PRODUCT_DECISION", "NEEDS_SECURITY_REVIEW")
        foreach ($p in $proposed.sourceOnlyRoutes) {
            $allowed -contains $p.recommendedAction | Should Be $true
        }
    }
}
