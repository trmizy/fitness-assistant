@echo off
echo.
echo === Starting API Gateway (Port 3000) ===
echo.
cd /d "%~dp0..\..\backend\gateway"
set PORT=3000
pnpm dev
pause
