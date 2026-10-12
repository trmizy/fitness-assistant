<#
.SYNOPSIS
  Gymini CI (Phase 16A DRAFT) - maps a git diff to affected services using
  ci/service-impact-map.json. Read-only: runs `git diff --name-only` and
  prints JSON. Never touches AWS.

.PARAMETER Base
  Base ref/sha (e.g. the PR base or the previous deployed sha).
.PARAMETER Head
  Head ref/sha. Default HEAD.
.PARAMETER ChangedFile
  Skip git and use these paths instead (testing / workflow_dispatch overrides).
#>
[CmdletBinding()]
param(
    [string]$Base,
    [string]$Head = "HEAD",
    [string[]]$ChangedFile,
    [string]$ImpactMapPath
)
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "CiHelpers.psm1") -Force
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if (-not $ImpactMapPath) { $ImpactMapPath = Join-Path $repoRoot "ci\service-impact-map.json" }
$map = Get-Content $ImpactMapPath -Raw | ConvertFrom-Json

if (-not $ChangedFile) {
    if (-not $Base) { throw "Provide -Base (or -ChangedFile). Refusing to guess a diff base." }
    $ChangedFile = @(git -C $repoRoot diff --name-only "$Base...$Head")
    if ($LASTEXITCODE -ne 0) { throw "git diff failed" }
}
Get-CiImpact -ChangedFiles $ChangedFile -ImpactMap $map | ConvertTo-Json -Depth 5
