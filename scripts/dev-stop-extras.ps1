$ErrorActionPreference = "Continue"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$containers = @(
  "gymcoach-n8n",
  "gymcoach-prometheus",
  "gymcoach-grafana",
  "gymcoach-pg-exporter",
  "gymcoach-redis-exporter",
  "gymcoach-knowledge-worker-dev",
  "gymcoach-db-seeder"
)

Write-Host "[dev-stop-extras] Disabling restart policy for optional containers..." -ForegroundColor Cyan
foreach ($name in $containers) {
  docker update --restart=no $name *> $null
}

Write-Host "[dev-stop-extras] Stopping optional containers..." -ForegroundColor Cyan
docker stop $containers

Write-Host "[dev-stop-extras] Optional containers stopped. Core app containers are untouched." -ForegroundColor Green
