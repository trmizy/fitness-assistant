# Mở tunnel Cloudflare tới TRANG WEB (Vite, cổng 5173) để mở app từ bất kỳ đâu — điện thoại, máy khác —
# và để link trong email (magic link đăng ký đối tác, đặt lại mật khẩu, lời mời quản lý) trỏ về địa chỉ
# công khai này thay vì localhost.
#
# Cách hoạt động: chạy cloudflared, đọc URL https://....trycloudflare.com từ log, ghi vào
# infra/compose/runtime/public-web-origin. Gateway đọc tệp đó (backend/gateway/src/utils/publicWebOrigin.ts)
# để: (1) làm host cho link trong email, (2) cho CORS tin đúng địa chỉ này. Trong lúc tunnel chạy, tệp được
# "chạm" mỗi 30 giây; tunnel tắt / cửa sổ bị đóng thì tệp cũ đi và gateway tự bỏ qua sau 2 phút.
#
# API, chat realtime và tệp ảnh/giấy tờ đều đi qua Vite (same-origin) nên chỉ cần MỘT tunnel này cho web.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runtimeDir = Join-Path $repo 'infra\compose\runtime'
$originFile = Join-Path $runtimeDir 'public-web-origin'
$logFile = Join-Path $env:TEMP 'gymini-tunnel-web.log'
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path $cloudflared)) { $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source }
if (-not $cloudflared) { Write-Host '[!] Khong tim thay cloudflared.exe' -ForegroundColor Red; exit 1 }

# 127.0.0.1 chu KHONG phai "localhost": Windows dual-stack phan giai ::1 truoc, Docker chi publish IPv4.
try { $code = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 'http://127.0.0.1:5173').StatusCode } catch { $code = 0 }
if ($code -ne 200) {
  Write-Host '[!] Trang web (cong 5173) chua chay. Mo Docker Desktop va chay:' -ForegroundColor Yellow
  Write-Host '      docker compose -f infra\compose\docker-compose.dev.yml up -d'
  exit 1
}

New-Item -ItemType Directory -Force $runtimeDir | Out-Null
Remove-Item $originFile -ErrorAction SilentlyContinue
Remove-Item $logFile -ErrorAction SilentlyContinue

# -NoNewWindow: cloudflared dung chung cua so nay -> dong cua so la tat luon tunnel.
$proc = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:5173', '--no-autoupdate') `
  -NoNewWindow -PassThru -RedirectStandardError $logFile

try {
  $url = $null
  for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) { break }
    if (Test-Path $logFile) {
      $m = Select-String -Path $logFile -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value }
    }
  }
  if (-not $url) { Write-Host '[!] Khong lay duoc URL tunnel. Xem log:' $logFile -ForegroundColor Red; exit 1 }

  Set-Content -Path $originFile -Value $url -NoNewline -Encoding ascii
  Write-Host ''
  Write-Host '============================================================' -ForegroundColor Cyan
  Write-Host "  App dang mo tai:  $url" -ForegroundColor Green
  Write-Host '  - Mo link nay tren dien thoai / may khac de dung app.'
  Write-Host '  - Link trong email (dang ky doi tac, dat lai mat khau) se tro ve day.'
  Write-Host '  GIU CUA SO NAY MO trong luc dung. Dong cua so = tat tunnel.'
  Write-Host '============================================================' -ForegroundColor Cyan

  while (-not $proc.HasExited) {
    (Get-Item $originFile).LastWriteTime = Get-Date   # "con song" — gateway bo qua tep cu hon 2 phut
    Start-Sleep -Seconds 30
  }
}
finally {
  Remove-Item $originFile -ErrorAction SilentlyContinue
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Write-Host 'Tunnel da dong. Link email quay ve dia chi mac dinh.'
}
