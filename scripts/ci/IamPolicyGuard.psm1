# Phase 16B.1A - pure, offline static-audit helpers for the Gymini CI/CD IAM
# plan (infra/cloudformation/ci-cd-oidc.yaml). AWS IAM MUTATIONS = 0 for this
# whole phase - none of these functions call AWS. They operate only on the
# already-resolved policy JSON produced by cfn-iam-policy-extract.mjs
# (scripts/ci/__fixtures__/ci-cd-oidc-resolved-policies.json), which is a
# real transform of the real template's own declared Parameter defaults -
# not fabricated test data.

function Get-StatementList {
    param($PolicyDocument)
    if (-not $PolicyDocument) { return @() }
    return @(, $PolicyDocument.Statement) | ForEach-Object { $_ }
}

# Pure GitHub OIDC `sub` claim matcher. Mirrors exactly what AWS STS itself
# evaluates for a StringEquals condition - no wildcard/StringLike semantics,
# since every role in this template deliberately uses StringEquals only
# (StringLike on a sub claim is the exact fork-PR-exposure mistake this
# phase is designed to catch).
function Test-GitHubSubClaim {
    param(
        [Parameter(Mandatory)] [string] $Sub,
        [Parameter(Mandatory)] [string] $ExpectedRepository,
        [Parameter(Mandatory)] [ValidateSet("branch", "environment", "pull_request")] [string] $ExpectedType,
        [string] $ExpectedBranchOrEnv
    )
    if ($Sub -match '\*') {
        return @{ Valid = $false; Reason = "WILDCARD_IN_SUB" }
    }
    $prefix = "repo:$ExpectedRepository"
    if (-not $Sub.StartsWith($prefix)) {
        return @{ Valid = $false; Reason = "REPOSITORY_MISMATCH" }
    }
    switch ($ExpectedType) {
        "pull_request" {
            if ($Sub -eq "${prefix}:pull_request") { return @{ Valid = $true; Reason = "OK" } }
            return @{ Valid = $false; Reason = "NOT_PULL_REQUEST_SCOPED" }
        }
        "branch" {
            $want = "${prefix}:ref:refs/heads/$ExpectedBranchOrEnv"
            if ($Sub -eq $want) { return @{ Valid = $true; Reason = "OK" } }
            return @{ Valid = $false; Reason = "BRANCH_MISMATCH" }
        }
        "environment" {
            $want = "${prefix}:environment:$ExpectedBranchOrEnv"
            if ($Sub -eq $want) { return @{ Valid = $true; Reason = "OK" } }
            return @{ Valid = $false; Reason = "ENVIRONMENT_MISMATCH" }
        }
    }
}

# Flattens Action (string or array) on a single statement to a string array.
function Get-StatementActions {
    param($Statement)
    if (-not $Statement.Action) { return @() }
    return @($Statement.Action)
}

function Get-StatementResources {
    param($Statement)
    if (-not $Statement.Resource) { return @() }
    return @($Statement.Resource)
}

# True if any statement in the policy has an Action ENTRY whose own wildcard
# pattern covers $ActionPattern (e.g. entry "iam:*" covers probe "iam:*" or
# "iam:PassRole"; entry "secretsmanager:*" covers probe
# "secretsmanager:GetSecretValue"). Deliberately one-directional: a narrow,
# specific entry such as "iam:PassRole" must NEVER be treated as covering the
# broad probe "iam:*" - that was a real bug caught by this module's own test
# suite (Phase 16B.1A), which falsely flagged InfraPlanRole/InfraApplyRole's
# intentionally-scoped iam:PassRole grants as "effectively grants iam:*".
# Only the entry-covers-probe direction answers "does this policy grant the
# dangerous breadth being probed for", never the reverse.
function Test-PolicyGrantsAction {
    param(
        [Parameter(Mandatory)] $PolicyDocument,
        [Parameter(Mandatory)] [string] $ActionPattern
    )
    $allowed = $false
    $denied = $false
    foreach ($stmt in (Get-StatementList $PolicyDocument)) {
        $actions = Get-StatementActions $stmt
        $covers = $actions | Where-Object {
            $entryRegex = "^" + [regex]::Escape($_).Replace('\*', '.*') + "$"
            $ActionPattern -match $entryRegex
        }
        if (@($covers).Count -gt 0) {
            if ($stmt.Effect -eq "Allow") { $allowed = $true }
            if ($stmt.Effect -eq "Deny") { $denied = $true }
        }
    }
    return @{ Allowed = $allowed; Denied = $denied; EffectivelyGranted = ($allowed -and -not $denied) }
}

# True if the policy grants iam:PassRole with Resource "*" (unrestricted) -
# as opposed to a PassRole scoped to specific role ARNs, which every role in
# this template uses.
function Test-HasUnrestrictedPassRole {
    param([Parameter(Mandatory)] $PolicyDocument)
    foreach ($stmt in (Get-StatementList $PolicyDocument)) {
        if ($stmt.Effect -ne "Allow") { continue }
        $actions = Get-StatementActions $stmt
        if ($actions -notcontains "iam:PassRole") { continue }
        $resources = Get-StatementResources $stmt
        if ($resources -contains "*") { return $true }
    }
    return $false
}

# True if the policy grants an action on Resource "*" with NO scoping
# Condition at all for that specific statement (a secondary check beyond
# Test-PolicyGrantsAction, for actions that are legitimately Resource:"*" by
# AWS design, e.g. ecr:GetAuthorizationToken, vs. ones that should have been
# scoped but weren't).
function Test-StatementHasCondition {
    param($Statement)
    return [bool]$Statement.Condition
}

function Get-AllowedActionsForResourcePrefix {
    param(
        [Parameter(Mandatory)] $PolicyDocument,
        [Parameter(Mandatory)] [string] $ResourcePrefix
    )
    $actions = @()
    foreach ($stmt in (Get-StatementList $PolicyDocument)) {
        if ($stmt.Effect -ne "Allow") { continue }
        $resources = Get-StatementResources $stmt
        $matches = $resources | Where-Object { $_ -eq $ResourcePrefix -or $_.StartsWith($ResourcePrefix) -or $ResourcePrefix.StartsWith($_.TrimEnd('*')) }
        if (@($matches).Count -gt 0) { $actions += Get-StatementActions $stmt }
    }
    return @($actions | Select-Object -Unique)
}

function Test-ActionDeniedOnResource {
    param(
        [Parameter(Mandatory)] $PolicyDocument,
        [Parameter(Mandatory)] [string] $Action,
        [string] $Resource
    )
    foreach ($stmt in (Get-StatementList $PolicyDocument)) {
        if ($stmt.Effect -ne "Deny") { continue }
        $actions = Get-StatementActions $stmt
        if ($actions -notcontains $Action) { continue }
        if (-not $Resource) { return $true }
        $resources = Get-StatementResources $stmt
        if ($resources -contains "*" -or $resources -contains $Resource) { return $true }
    }
    return $false
}

Export-ModuleMember -Function Test-GitHubSubClaim, Get-StatementActions, Get-StatementResources, `
    Test-PolicyGrantsAction, Test-HasUnrestrictedPassRole, Test-StatementHasCondition, `
    Get-AllowedActionsForResourcePrefix, Test-ActionDeniedOnResource, Get-StatementList
