# Start All Services for Fitness Assistant
# Simple version without complex error handling

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

Write-Host "`n=== Fitness Assistant - Starting All Services ===`n" -ForegroundColor Green

# Check Docker
Write-Host "Checking Docker..." -ForegroundColor Cyan
$dockerRunning = docker ps 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker is not running. Please start Docker Desktop first." -ForegroundColor Red
    exit 1
}
Write-Host "Docker OK" -ForegroundColor Green

# Kill old processes
Write-Host "`nCleaning old processes..." -ForegroundColor Cyan
Get-NetTCPConnection -LocalPort 3000,3001,3002,3003,3004,5173 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# Start services in hidden windows
Write-Host "`nStarting services..." -ForegroundColor Cyan

Write-Host "  Starting auth-service (port 3001)..." -ForegroundColor White
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend\services\auth-service'; `$env:PORT=3001; pnpm dev" -WindowStyle Hidden

Write-Host "  Starting user-service (port 3004)..." -ForegroundColor White
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend\services\user-service'; `$env:PORT=3004; pnpm dev" -WindowStyle Hidden

Write-Host "  Starting fitness-service (port 3002)..." -ForegroundColor White
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend\services\fitness-service'; `$env:PORT=3002; pnpm dev" -WindowStyle Hidden

Write-Host "  Starting ai-service (port 3003)..." -ForegroundColor White
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend\services\ai-service'; `$env:PORT=3003; pnpm dev" -WindowStyle Hidden

Write-Host "  Starting api-gateway (port 3000)..." -ForegroundColor White
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend\gateway'; `$env:PORT=3000; pnpm dev" -WindowStyle Hidden

Write-Host "  Starting web (port 5173)..." -ForegroundColor White
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend\web'; pnpm dev" -WindowStyle Hidden

# Wait for startup
Write-Host "`nWaiting 10 seconds for services to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Health check
Write-Host "`nChecking service health..." -ForegroundColor Cyan

$services = @(
    @{Name="Auth Service"; Port=3001; Path="/health"},
    @{Name="User Service"; Port=3004; Path="/health"},
    @{Name="Fitness Service"; Port=3002; Path="/health"},
    @{Name="AI Service"; Port=3003; Path="/health"},
    @{Name="API Gateway"; Port=3000; Path="/health"},
    @{Name="Web App"; Port=5173; Path="/"}
)

foreach ($service in $services) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$($service.Port)$($service.Path)" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        Write-Host "  $($service.Name) on port $($service.Port) - OK" -ForegroundColor Green
    } catch {
        Write-Host "  $($service.Name) on port $($service.Port) - FAILED" -ForegroundColor Red
    }
}

# Open browser
Write-Host "`nOpening browser..." -ForegroundColor Cyan
Start-Process "http://localhost:5173"

Write-Host "`n=== All Services Started ===`n" -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host "API Gateway: http://localhost:3000" -ForegroundColor Cyan
Write-Host "`nPress any key to STOP all services..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Stop all services
Write-Host "`nStopping services..." -ForegroundColor Yellow
Get-NetTCPConnection -LocalPort 3000,3001,3002,3003,3004,5173 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}

Write-Host "All services stopped" -ForegroundColor Green
