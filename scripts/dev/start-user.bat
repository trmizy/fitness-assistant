@echo off
echo.
echo === Starting User Service (Port 3004) ===
echo.
cd /d "%~dp0..\..\backend\services\user-service"
set PORT=3004
pnpm dev
pause
