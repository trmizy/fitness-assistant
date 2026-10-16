@echo off
chcp 65001 >nul
title FitnessAssistant - Cloudflare Tunnel (trang web)
color 0B

echo ============================================================
echo    MO DUONG HAM CLOUDFLARE CHO TRANG WEB (cong 5173)
echo ============================================================
echo.
echo  Dung khi muon mo app tren dien thoai / may khac qua Internet,
echo  va de link trong email (dang ky doi tac, dat lai mat khau) mo
echo  duoc tu bat ky dau thay vi chi tren may nay.
echo.
echo  (App Android van dung Khoi-dong-Tunnel.bat - tunnel toi gateway.
echo   Chay ca hai cung luc cung duoc.)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev\tunnel-web.ps1"

echo.
pause
