@echo off
chcp 65001 >nul
title FitnessAssistant - Cloudflare Tunnel
color 0B

echo ============================================================
echo    KHOI DONG DUONG HAM CLOUDFLARE CHO APP FITNESS ASSISTANT
echo ============================================================
echo.

REM Dung 127.0.0.1 chu KHONG dung "localhost": tren Windows dual-stack, "localhost"
REM phan giai ra IPv6 ::1 truoc, trong khi Docker chi publish IPv4 -> cloudflared bao
REM 502 "dial tcp [::1]:3000 ... actively refused".

echo [1/2] Kiem tra may chu (gateway cong 3000)...
for /f %%c in ('curl -s -o nul -w "%%{http_code}" http://127.0.0.1:3000/health 2^>nul') do set CODE=%%c

if not "%CODE%"=="200" (
  echo.
  echo    [!] KHONG ket noi duoc may chu tai localhost:3000
  echo        Hay mo Docker Desktop va doi stack len het:
  echo          docker compose -f infra\compose\docker-compose.dev.yml up -d
  echo        roi chay lai file nay.
  echo.
  pause
  exit /b 1
)
echo        OK - may chu dang chay.
echo.

echo [2/2] Mo duong ham... GIU CUA SO NAY MO trong luc dung app.
echo.
echo    ^>^> Tim dong "https://....trycloudflare.com" ben duoi,
echo       copy va dan vao muc "Cau hinh may chu" o man hinh dang nhap
echo       cua app, roi bam "Luu va tai lai".
echo.
echo    Luu y: chi can 1 duong ham duy nhat - chat realtime da duoc
echo    gateway chuyen tiep qua /chat-socket.io.
echo.
echo ------------------------------------------------------------
echo.

"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:3000 --no-autoupdate

echo.
echo ------------------------------------------------------------
echo Duong ham da dong. Chay lai file nay de mo lai (URL se khac).
pause
