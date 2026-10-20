<#
.SYNOPSIS
  Gymini CI (Phase 16A DRAFT) - builds ONE Lambda service artifact with the
  repository's own packaging script, then records an immutable manifest
  (service, git sha, sha256, size, handler files present).

  Default = DRY RUN: prints what it would do. -Execute runs the existing
  `pnpm --filter <svc> run build:lambda-zip` (ai: build:lambda:package),
  which only writes a local zip under <service>/artifacts/ (gitignored).
  This script NEVER touches AWS and never uploads anything.

.PARAMETER Service
  auth | user | fitness | gym | payment | ai
.PARAMETER OutDir
  Where to copy the zip + <service>.manifest.json (default: ./.ci-out).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidateSet("auth", "user", "fitness", "gym", "payment", "ai")] [string]$Service,
    [string]$OutDir = ".ci-out",
    [switch]$Execute
)
$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$map = Get-Content (Join-Path $repoRoot "ci\service-impact-map.json") -Raw | ConvertFrom-Json
$svc = $map.services.$Service
$script = if ($Service -eq "ai") { "build:lambda:package" } else { "build:lambda-zip" }
$zipSrc = Join-Path $repoRoot "$($svc.path)\artifacts\$($svc.artifact)"
$handlers = switch ($Service) {
    "ai"    { @("dist/lambda.js", "dist/worker-lambda.js", "dist/jobs-lambda.js") }
    "auth"  { @("dist/lambda.js") }
    default { @("dist/lambda.js", "dist/jobs-lambda.js") }
}

Write-Host "Service     : $Service ($($svc.pnpmFilter))"
Write-Host "Command     : pnpm --filter $($svc.pnpmFilter) run $script"
Write-Host "Artifact    : $zipSrc"
Write-Host "Handler chk : $($handlers -join ', ')"
if (-not $Execute) { Write-Host "DRY RUN - pass -Execute to build. No AWS access either way."; return }

# AI's package command only archives existing dist/generated files; unlike the
# other services' build:lambda-zip commands it does not compile a clean checkout.
if ($Service -eq "ai") {
    & pnpm --filter $svc.pnpmFilter run db:generate
    if ($LASTEXITCODE -ne 0) { throw "BUILD_FAIL: AI Prisma generation exited $LASTEXITCODE" }
    & pnpm --filter "$($svc.pnpmFilter)..." --recursive run build
    if ($LASTEXITCODE -ne 0) { throw "BUILD_FAIL: AI and dependency compilation exited $LASTEXITCODE" }
}
& pnpm --filter $svc.pnpmFilter run $script
if ($LASTEXITCODE -ne 0) { throw "BUILD_FAIL: $script exited $LASTEXITCODE" }
if (-not (Test-Path $zipSrc)) { throw "BUILD_FAIL: expected artifact not found: $zipSrc" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipSrc)
try { $entries = @($zip.Entries | ForEach-Object { $_.FullName }) } finally { $zip.Dispose() }
$missing = @($handlers | Where-Object { $_ -notin $entries })
$required = @($svc.functions | ForEach-Object { $_ })
if ($missing.Count -gt 0) { throw "BUILD_FAIL: artifact is missing handler file(s): $($missing -join ', ')" }

$sha = (Get-FileHash $zipSrc -Algorithm SHA256).Hash.ToLower()
$gitSha = (git -C $repoRoot rev-parse HEAD).Trim()
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item $zipSrc (Join-Path $OutDir "$Service-$gitSha.zip") -Force
[ordered]@{
    service = $Service; gitSha = $gitSha; sha256 = $sha
    sizeBytes = (Get-Item $zipSrc).Length; handlerFiles = $handlers
    targetFunctions = $required; builtAtUtc = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content (Join-Path $OutDir "$Service-$gitSha.manifest.json") -Encoding utf8
Write-Host "OK sha256=$sha"
