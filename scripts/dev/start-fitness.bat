@echo off
echo.
echo === Starting Fitness Service (Port 3002) ===
echo.
cd /d "%~dp0..\..\backend\services\fitness-service"
set PORT=3002
pnpm dev
pause
