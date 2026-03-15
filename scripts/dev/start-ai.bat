@echo off
echo.
echo === Starting AI Service (Port 3003) ===
echo.
cd /d "%~dp0..\..\backend\services\ai-service"
set PORT=3003
pnpm dev
pause
