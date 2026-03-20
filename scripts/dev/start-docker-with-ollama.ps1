# Starts Ollama (if needed) and then boots the full Docker stack.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$composeFile = Join-Path $repoRoot 'infra/compose/docker-compose.dev.yml'
$envFile = Join-Path $repoRoot '.env'

function Test-OllamaEndpoint {
    try {
        $null = Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 2
        return $true
    } catch {
        return $false
    }
}

Write-Host ''
Write-Host '=== Fitness Assistant Docker Startup ===' -ForegroundColor Green
Write-Host ''

Write-Host '1) Checking Docker...' -ForegroundColor Cyan
$null = docker ps 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Docker is not running. Please start Docker Desktop first.' -ForegroundColor Red
    exit 1
}
Write-Host 'Docker is running.' -ForegroundColor Green

Write-Host ''
Write-Host '2) Ensuring Ollama is reachable at http://localhost:11434 ...' -ForegroundColor Cyan

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host 'Ollama CLI was not found in PATH. Install Ollama first.' -ForegroundColor Red
    exit 1
}

if (Test-OllamaEndpoint) {
    Write-Host 'Ollama is already running.' -ForegroundColor Green
} else {
    Write-Host 'Starting Ollama in background (OLLAMA_HOST=0.0.0.0:11434)...' -ForegroundColor Yellow
    $ollamaStart = "$env:OLLAMA_HOST='0.0.0.0:11434'; ollama serve"
    Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $ollamaStart -WindowStyle Hidden | Out-Null

    $ready = $false
    foreach ($i in 1..30) {
        Start-Sleep -Seconds 1
        if (Test-OllamaEndpoint) {
            $ready = $true
            break
        }
    }

    if (-not $ready) {
        Write-Host 'Ollama did not become ready in 30 seconds.' -ForegroundColor Red
        Write-Host 'Try starting it manually: $env:OLLAMA_HOST="0.0.0.0:11434"; ollama serve' -ForegroundColor Yellow
        exit 1
    }

    Write-Host 'Ollama is now ready.' -ForegroundColor Green
}

Write-Host ''
Write-Host '3) Starting Docker Compose stack...' -ForegroundColor Cyan
if (-not (Test-Path $composeFile)) {
    Write-Host "Compose file not found: $composeFile" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $envFile)) {
    Write-Host ".env file not found: $envFile" -ForegroundColor Red
    exit 1
}

Push-Location $repoRoot
try {
    docker compose -f $composeFile --env-file $envFile up --build -d
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Docker compose failed.' -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host '4) Quick health check...' -ForegroundColor Cyan
$checks = @(
    'http://localhost:3000/health',
    'http://localhost:3003/health',
    'http://localhost:5173'
)

foreach ($url in $checks) {
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
        Write-Host ("OK  " + $url + " -> " + $resp.StatusCode) -ForegroundColor Green
    } catch {
        Write-Host ("WARN " + $url + " -> not ready yet") -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host 'Done. Open http://localhost:5173' -ForegroundColor Green
