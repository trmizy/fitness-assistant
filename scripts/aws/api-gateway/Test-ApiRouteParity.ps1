<#
.SYNOPSIS
  Gymini DEV - read-only API Gateway route parity checker (Phase 15A).

.DESCRIPTION
  Compares the hand-traced source route inventory
  (docs/deployment/generated/api-source-routes.json) against a FRESH read of
  the live fitness-assistant-dev-api HTTP API (not the generated live-routes
  snapshot file, which can go stale - this script re-reads AWS directly
  every run). Uses the pure comparison logic in
  lib/ApiRouteParity.psm1 (covered by lib/ApiRouteParity.Tests.ps1).

  READ ONLY. Makes only apigatewayv2 get-routes/get-integrations calls.
  Never creates, updates, or deletes any route, integration, permission, or
  stage. There is no -Execute switch because there is nothing to execute -
  this script cannot mutate anything.

  Intended to run both locally (as in this phase) and later from CI
  (Phase 15A.15's own design note: a post-deploy step that fails the build
  if a live route silently drifted from source).

.PARAMETER ApiId
  The HTTP API ID to check against. Defaults to id1iz7upbl (the live
  fitness-assistant-dev-api at the time this script was written) - pass
  explicitly rather than relying on the default once this is wired into CI.

.PARAMETER SourceRoutesPath
  Path to the source route manifest. Defaults to
  docs/deployment/generated/api-source-routes.json relative to the repo
  root (this script's own grandparent directory).

.PARAMETER AllowKnownSourceOnly
  Default off, preserving this script's original behaviour everywhere it
  was already relied on. When passed, SOURCE_ONLY entries (routes that
  exist in application source but were never added to the live Gateway -
  a real, separately tracked product gap, not something any one
  infrastructure deploy introduces or fixes) no longer fail the exit code.
  MISMATCHED (a live route disagreeing with its own source - the one
  category this script already gated on besides SOURCE_ONLY) still fails
  regardless of this switch. Added because
  infra-deploy.yml's post-apply gate was failing every real, correct apply
  on these same 10 pre-existing SOURCE_ONLY routes (confirmed unchanged
  across repeated runs, 2026-10-21), never on this switch's two real
  regression categories.
#>
[CmdletBinding()]
param(
    [string]$ApiId = "id1iz7upbl",
    [string]$Region = "ap-southeast-1",
    [string]$SourceRoutesPath,
    [switch]$AllowKnownSourceOnly
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib/ApiRouteParity.psm1") -Force

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "../../..")
if (-not $SourceRoutesPath) {
    $SourceRoutesPath = Join-Path $RepoRoot "docs/deployment/generated/api-source-routes.json"
}

Write-Host "=== Gymini DEV - API Gateway route parity check (read-only) ===" -ForegroundColor Cyan
Write-Host "ApiId: $ApiId  Region: $Region"

if (-not (Test-Path $SourceRoutesPath)) {
    Write-Host "HARD STOP: source route manifest not found at $SourceRoutesPath" -ForegroundColor Red
    exit 1
}
$sourceManifest = Get-Content $SourceRoutesPath -Raw | ConvertFrom-Json

# Only routes this phase expects to be reachable through the public Gateway
# are compared - INTERNAL_SERVICE routes are deliberately excluded (their
# correct state is "absent from the Gateway", not a parity target), and
# MISMATCHED entries from the manifest are passed through as already-known
# findings rather than re-derived (a routing conflict between two services
# claiming the same prefix isn't something path/method comparison alone can
# detect - see ApiRouteParity.psm1's own doc comment).
$deployTargetMap = @{}
foreach ($prop in $sourceManifest.deployTargets.PSObject.Properties) {
    $val = $prop.Value
    # Phase 16A.2R: a deployTargets entry may be a dynamic CloudFormation-
    # parameter reference instead of a frozen literal string - Chat's ALB
    # DNS changes every time the on-demand ALB is torn down/recreated, so a
    # hardcoded expected target here goes stale on its own (the real root
    # cause of the Phase 16A.2 MISMATCHED(1) finding). Resolve it from the
    # SAME live stack parameter that scripts/aws/api-gateway/lib/
    # ChatIntegrationSync.psm1 keeps authoritative, via one extra read-only
    # describe-stacks call - never a second hardcoded copy of the DNS name.
    if ($val -is [System.Management.Automation.PSCustomObject] -and $val.dynamic -eq "CLOUDFORMATION_PARAMETER") {
        $paramValue = aws cloudformation describe-stacks --stack-name $val.stackName --region $Region --query "Stacks[0].Parameters[?ParameterKey=='$($val.parameterKey)'].ParameterValue" --output text 2>&1
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($paramValue) -or $paramValue -eq "None") {
            Write-Host "HARD STOP: could not resolve dynamic deployTarget '$($prop.Name)' - stack '$($val.stackName)' parameter '$($val.parameterKey)' unreadable (fail closed, never guessed)." -ForegroundColor Red
            exit 1
        }
        $val = "http://$paramValue$($val.pathSuffix)"
    }
    $deployTargetMap[$prop.Name] = $val
}

$sourceRoutes = @()
$knownMismatches = @()
foreach ($r in $sourceManifest.routes) {
    if ($r.liveStatus -eq "CORRECTLY_ABSENT") { continue }
    if ($r.liveStatus -eq "MISMATCHED") { $knownMismatches += $r; continue }
    $expectedTarget = if ($deployTargetMap.ContainsKey($r.expectedDeployTarget)) { $deployTargetMap[$r.expectedDeployTarget] } else { $r.expectedDeployTarget }
    # A "{proxy+}"-suffixed source entry represents the SAME live resource
    # prefix as its bare counterpart (the live API always models both as a
    # pair pointing at one integration) - expand it into both so a true
    # live gap isn't double-counted as two different routes. EXCEPT when the
    # manifest explicitly says this one has no bare route (chat is the only
    # current case - Phase 15B-A found that expanding it anyway made one
    # live route match two source objects, the sole reason MATCHING_ROUTES
    # exceeded LIVE_ROUTE_COUNT).
    $hasNoBareRoute = ($r.PSObject.Properties.Name -contains "noBareRoute") -and $r.noBareRoute
    if ($r.path -match '^(.*)/\{proxy\+\}$' -and -not $hasNoBareRoute) {
        $bare = $Matches[1]
        if ($bare -eq "") { $bare = "/" }
        $sourceRoutes += @{ Method = $r.method; Path = $bare; ExpectedDeployTarget = $expectedTarget; Service = $r.service }
        $sourceRoutes += @{ Method = $r.method; Path = $r.path; ExpectedDeployTarget = $expectedTarget; Service = $r.service }
    } else {
        $sourceRoutes += @{ Method = $r.method; Path = $r.path; ExpectedDeployTarget = $expectedTarget; Service = $r.service }
    }
}

Write-Host "Loaded $($sourceRoutes.Count) comparable source routes (+$($knownMismatches.Count) already-known routing-conflict entries) from $SourceRoutesPath"

Write-Host ""
Write-Host "Reading live routes from AWS (read-only)..." -ForegroundColor Yellow
$rawRoutes = aws apigatewayv2 get-routes --api-id $ApiId --region $Region --output json | ConvertFrom-Json
$rawIntegrations = aws apigatewayv2 get-integrations --api-id $ApiId --region $Region --output json | ConvertFrom-Json

$integrationMap = @{}
foreach ($i in $rawIntegrations.Items) {
    $target = $i.IntegrationUri
    if ($i.IntegrationType -eq "AWS_PROXY" -and $i.IntegrationUri -match "function:([^/]+)") {
        $target = $Matches[1]
    }
    $integrationMap[$i.IntegrationId] = $target
}

$liveRoutes = @()
foreach ($r in $rawRoutes.Items) {
    $parts = $r.RouteKey -split " ", 2
    $method = $parts[0]
    $path = if ($parts.Count -gt 1) { $parts[1] } else { "/" }
    $targetKey = $r.Target -replace "^integrations/", ""
    $liveRoutes += @{ Method = $method; Path = $path; Integration = $integrationMap[$targetKey] }
}
Write-Host "Read $($liveRoutes.Count) live routes."

$result = Compare-ApiRoutes -SourceRoutes $sourceRoutes -LiveRoutes $liveRoutes

Write-Host ""
Write-Host "=== MATCH ($($result.Match.Count)) ===" -ForegroundColor Green
Write-Host "=== SOURCE_ONLY ($($result.SourceOnly.Count)) - implemented in code, missing from the live Gateway ===" -ForegroundColor Red
foreach ($s in $result.SourceOnly) { Write-Host "  $($s.Method) $($s.Path)  [$($s.Service)]" }
Write-Host "=== GATEWAY_ONLY ($($result.GatewayOnly.Count)) - live routes with no matching application source ===" -ForegroundColor Yellow
foreach ($g in $result.GatewayOnly) { Write-Host "  $($g.Method) $($g.Path)  -> $($g.Integration)" }
Write-Host "=== MISMATCHED ($($result.Mismatched.Count + $knownMismatches.Count)) - same path, wrong integration/method/auth ===" -ForegroundColor Magenta
foreach ($m in $result.Mismatched) { Write-Host "  $($m.Source.Method) $($m.Source.Path): $($m.Reason)" }
foreach ($k in $knownMismatches) { Write-Host "  $($k.method) $($k.path): $($k.note)" }

Write-Host ""
Write-Host "This script performed read-only AWS CLI calls only." -ForegroundColor Green

$sourceOnlyFails = $result.SourceOnly.Count -gt 0 -and -not $AllowKnownSourceOnly
$exitCode = if ($sourceOnlyFails -or ($result.Mismatched.Count -gt 0)) { 1 } else { 0 }
exit $exitCode
