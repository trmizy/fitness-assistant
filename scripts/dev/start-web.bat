@echo off
echo.
echo === Starting Web App (Port 5173) ===
echo.
cd /d "%~dp0..\..\frontend\web"
pnpm dev
pause