param(
  [switch]$Build,
  [switch]$WithAutomation,
  [switch]$WithObservability
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$composeFiles = @(
  "-f", "infra/compose/docker-compose.dev.yml",
  "-f", "infra/compose/docker-compose.low-resource.yml"
)

$profiles = @()
if ($WithAutomation) {
  $profiles += @("--profile", "automation")
}
if ($WithObservability) {
  $profiles += @("--profile", "observability")
}

$buildArgs = @()
if ($Build) {
  $buildArgs += "--build"
}

$coreServices = @(
  "postgres",
  "redis",
  "qdrant",
  "ollama",
  "ollama-model-puller",
  "auth-service",
  "user-service",
  "fitness-service",
  "ai-service",
  "chat-service",
  "api-gateway",
  "web"
)

Write-Host "[dev-lite] Starting core services with low-resource limits..." -ForegroundColor Cyan
& docker compose @composeFiles @profiles up -d @buildArgs @coreServices

Write-Host ""
Write-Host "[dev-lite] Ready:" -ForegroundColor Green
Write-Host "  Web:     http://localhost:5173"
Write-Host "  Gateway: http://localhost:3000"
Write-Host "  AI:      http://localhost:3003/health"
Write-Host ""
Write-Host "Optional services are not started. Add -WithAutomation for n8n, -WithObservability for Grafana/Prometheus."
