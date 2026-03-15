@echo off
echo.
echo === Starting Auth Service (Port 3001) ===
echo.
cd /d "%~dp0..\..\backend\services\auth-service"
set PORT=3001
pnpm dev
pause
