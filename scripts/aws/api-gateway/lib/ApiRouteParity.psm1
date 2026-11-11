<#
.SYNOPSIS
  Pure route-normalization/parity logic for the Gymini DEV API Gateway drift
  checker (Phase 15A). No AWS I/O here - same pure-logic/AWS-I-O separation
  as DevLifecycle.psm1/JwtRotation.psm1/etc. in this repo, so the comparison
  logic can be reviewed and tested independently of any live AWS call.

.DESCRIPTION
  A "source route" comes from docs/deployment/generated/api-source-routes.json
  (hand-traced from router/controller registrations). A "live route" comes
  from docs/deployment/generated/api-gateway-live-routes.json (a real
  apigatewayv2 get-routes/get-integrations read). Both use path syntax that
  needs normalizing before comparison:

    - Express param syntax (:id) vs API Gateway syntax ({id}) are the SAME
      parameter position and must not be reported as different routes.
    - A live "{proxy+}" wildcard covers every deeper source path under that
      prefix - a source route one level under an existing {proxy+} is a
      MATCH via the wildcard, not a missing route.
    - A live route's method is "ANY" when the Gateway integration accepts
      every HTTP method (this project's own established pattern for every
      service except auth, which registers one explicit method per route).
      A source route with any specific method matches an "ANY" live route
      at the same (normalized) path.
    - Trailing slashes are insignificant.
#>

Set-StrictMode -Version Latest

<#
.SYNOPSIS
  PURE. Normalizes one path segment-list for comparison: Express ":param"
  syntax becomes API-Gateway "{param}" syntax, trailing slashes are
  stripped, and a leading/trailing empty segment from a bare "/" is removed.
#>
function ConvertTo-NormalizedRoutePath {
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$Path
    )
    $p = $Path.Trim()
    if ($p -eq "") { return "/" }
    if (-not $p.StartsWith("/")) { $p = "/$p" }
    if ($p.Length -gt 1 -and $p.EndsWith("/")) { $p = $p.Substring(0, $p.Length - 1) }

    $segments = $p.Split("/") | ForEach-Object {
        if ($_ -match '^:(.+)$') { "{$($Matches[1])}" } else { $_ }
    }
    return ($segments -join "/")
}

<#
.SYNOPSIS
  PURE. True if a normalized live path is the given normalized source path,
  OR a {proxy+} (or {param+}) wildcard ancestor of it. Does not handle
  method matching - see Test-RouteMatches for the combined check.
#>
function Test-PathCoveredByLiveRoute {
    param(
        [Parameter(Mandatory)] [string]$NormalizedSourcePath,
        [Parameter(Mandatory)] [string]$NormalizedLivePath
    )
    if ($NormalizedSourcePath -eq $NormalizedLivePath) { return $true }

    # A live "{proxy+}"-suffixed path covers every deeper path under its
    # prefix (its own parent segment, with the greedy-wildcard segment
    # stripped), e.g. /profile/{proxy+} covers /profile/agent/draft.
    if ($NormalizedLivePath -match '^(.*)/\{[A-Za-z0-9_]+\+\}$') {
        $prefix = $Matches[1]
        if ($prefix -eq "") { $prefix = "/" }
        if ($NormalizedSourcePath -eq $prefix) { return $true }
        if ($NormalizedSourcePath.StartsWith("$prefix/")) { return $true }
        if ($prefix -eq "/" -and $NormalizedSourcePath.StartsWith("/")) { return $true }
    }
    return $false
}

<#
.SYNOPSIS
  PURE. True if a source route (method + path) is satisfied by a live route
  (method + path), after normalizing both paths and treating a live "ANY"
  method as matching every source method.
#>
function Test-RouteMatches {
    param(
        [Parameter(Mandatory)] [string]$SourceMethod,
        [Parameter(Mandatory)] [string]$SourcePath,
        [Parameter(Mandatory)] [string]$LiveMethod,
        [Parameter(Mandatory)] [string]$LivePath
    )
    $methodOk = ($LiveMethod -eq "ANY") -or ($SourceMethod -eq "ANY") -or ($LiveMethod -ieq $SourceMethod)
    if (-not $methodOk) { return $false }

    $normSource = ConvertTo-NormalizedRoutePath -Path $SourcePath
    $normLive = ConvertTo-NormalizedRoutePath -Path $LivePath
    return Test-PathCoveredByLiveRoute -NormalizedSourcePath $normSource -NormalizedLivePath $normLive
}

<#
.SYNOPSIS
  PURE. Compares a list of source routes against a list of live routes.
  Each input route is a hashtable with at least Method/Path (source) or
  Method/Path/Integration (live). Returns Match/SourceOnly/GatewayOnly/
  Mismatched buckets - Mismatched is same-path routes whose Integration
  target differs from what the source route expects (ExpectedDeployTarget),
  when both are supplied; omit ExpectedDeployTarget/Integration to skip that
  check for a given pair.
#>
function Compare-ApiRoutes {
    param(
        [Parameter(Mandatory)] [array]$SourceRoutes,
        [Parameter(Mandatory)] [array]$LiveRoutes
    )
    $match = [System.Collections.Generic.List[object]]::new()
    $sourceOnly = [System.Collections.Generic.List[object]]::new()
    $mismatched = [System.Collections.Generic.List[object]]::new()
    $matchedLiveIndexes = [System.Collections.Generic.HashSet[int]]::new()

    foreach ($sr in $SourceRoutes) {
        # Two passes: an exact (non-wildcard) match always wins over a
        # wildcard-covered one, regardless of array order - AWS does not
        # guarantee get-routes returns results in any particular order, so
        # a {proxy+} entry appearing before its own exact-path sibling must
        # never "steal" the slot an exact match would otherwise take (that
        # previously left the real exact-match live route falsely reported
        # as GATEWAY_ONLY).
        $found = $null
        $foundIndex = -1
        for ($i = 0; $i -lt $LiveRoutes.Count; $i++) {
            $lr = $LiveRoutes[$i]
            $normSource = ConvertTo-NormalizedRoutePath -Path $sr.Path
            $normLive = ConvertTo-NormalizedRoutePath -Path $lr.Path
            $methodOk = ($lr.Method -eq "ANY") -or ($sr.Method -eq "ANY") -or ($lr.Method -ieq $sr.Method)
            if ($methodOk -and ($normSource -eq $normLive)) {
                $found = $lr
                $foundIndex = $i
                break
            }
        }
        if ($null -eq $found) {
            for ($i = 0; $i -lt $LiveRoutes.Count; $i++) {
                $lr = $LiveRoutes[$i]
                if (Test-RouteMatches -SourceMethod $sr.Method -SourcePath $sr.Path -LiveMethod $lr.Method -LivePath $lr.Path) {
                    $found = $lr
                    $foundIndex = $i
                    break
                }
            }
        }
        if ($null -eq $found) {
            $sourceOnly.Add($sr)
            continue
        }
        $matchedLiveIndexes.Add($foundIndex) | Out-Null
        $expectedTarget = if ($sr.Contains("ExpectedDeployTarget")) { $sr["ExpectedDeployTarget"] } else { $null }
        $actualTarget = if ($found.Contains("Integration")) { $found["Integration"] } else { $null }
        if ($expectedTarget -and $actualTarget -and ($expectedTarget -ne $actualTarget)) {
            $mismatched.Add([ordered]@{ Source = $sr; Live = $found; Reason = "integration target '$actualTarget' != expected '$expectedTarget'" })
        } else {
            $match.Add([ordered]@{ Source = $sr; Live = $found })
        }
    }

    $gatewayOnly = [System.Collections.Generic.List[object]]::new()
    for ($i = 0; $i -lt $LiveRoutes.Count; $i++) {
        if (-not $matchedLiveIndexes.Contains($i)) { $gatewayOnly.Add($LiveRoutes[$i]) }
    }

    return [ordered]@{
        Match        = $match
        SourceOnly   = $sourceOnly
        GatewayOnly  = $gatewayOnly
        Mismatched   = $mismatched
    }
}

<#
.SYNOPSIS
  PURE (Phase 15B-A.11 change-set safety design). Scans a CloudFormation
  change set's own Changes array (as returned by describe-change-set, or any
  fake array shaped the same way for testing) for any action this adoption
  must never allow to proceed unattended: a Replace or Remove on an existing
  physical resource, or the creation of a brand-new AWS::ApiGatewayV2::Api
  (this adoption must only ever IMPORT the one existing API, never create a
  second one).

.PARAMETER Changes
  An array of hashtables, each shaped like one entry of a real
  DescribeChangeSet response's .Changes[].ResourceChange: Action
  (Add/Modify/Remove/Import), ResourceType, Replacement
  (True/False/Conditional/N/A), LogicalResourceId.
#>
function Find-DestructiveChangeSetActions {
    param(
        [Parameter(Mandatory)] [array]$Changes
    )
    $destructive = [System.Collections.Generic.List[object]]::new()
    foreach ($c in $Changes) {
        $rc = if ($c.Contains("ResourceChange")) { $c["ResourceChange"] } else { $c }
        $action = $rc["Action"]
        $resourceType = $rc["ResourceType"]
        $replacement = if ($rc.Contains("Replacement")) { $rc["Replacement"] } else { "N/A" }
        $logicalId = $rc["LogicalResourceId"]

        $isDestructive = $false
        $reason = $null
        if ($action -eq "Remove") {
            $isDestructive = $true
            $reason = "Remove action on $logicalId ($resourceType)"
        } elseif ($action -eq "Modify" -and $replacement -in @("True", "Conditional")) {
            $isDestructive = $true
            $reason = "Modify with Replacement=$replacement on $logicalId ($resourceType) - a Conditional replacement must be treated as destructive until proven otherwise, never assumed safe"
        } elseif ($action -eq "Add" -and $resourceType -eq "AWS::ApiGatewayV2::Api") {
            $isDestructive = $true
            $reason = "Add action would CREATE a new AWS::ApiGatewayV2::Api ($logicalId) - this adoption must only ever import the one existing API, never create a second one"
        }
        if ($isDestructive) {
            $destructive.Add([ordered]@{ LogicalResourceId = $logicalId; ResourceType = $resourceType; Action = $action; Replacement = $replacement; Reason = $reason })
        }
    }
    return [ordered]@{
        Safe = ($destructive.Count -eq 0)
        DestructiveActions = $destructive
    }
}

Export-ModuleMember -Function @(
    'ConvertTo-NormalizedRoutePath',
    'Test-PathCoveredByLiveRoute',
    'Test-RouteMatches',
    'Compare-ApiRoutes',
    'Find-DestructiveChangeSetActions'
)
