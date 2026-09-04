param(
  [int]$WslMemoryGb = 6,
  [int]$WslSwapGb = 6,
  [int]$WslProcessors = 6
)

$ErrorActionPreference = "Stop"

$settingsPath = Join-Path $env:APPDATA "Docker\settings-store.json"
if (Test-Path $settingsPath) {
  $backup = "$settingsPath.bak-$(Get-Date -Format yyyyMMddHHmmss)"
  Copy-Item -LiteralPath $settingsPath -Destination $backup

  $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
  $settings.AutoStart = $false
  $settings.OpenUIOnStartupDisabled = $true
  $settings.DisableHardwareAcceleration = $true
  $settings.EnableDockerAI = $false
  $settings.EnableInference = $false
  $settings.EnableInferenceGPUVariant = $false
  $settings.InferenceCanUseGPUVariant = $false
  $settings.EnableCloudGPUSupport = $false

  $settings | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $settingsPath -Encoding UTF8
  Write-Host "[local-low-resource] Docker Desktop settings updated. Backup: $backup" -ForegroundColor Green
} else {
  Write-Host "[local-low-resource] Docker settings file not found: $settingsPath" -ForegroundColor Yellow
}

$wslConfigPath = Join-Path $env:USERPROFILE ".wslconfig"
if (Test-Path $wslConfigPath) {
  $backup = "$wslConfigPath.bak-$(Get-Date -Format yyyyMMddHHmmss)"
  Copy-Item -LiteralPath $wslConfigPath -Destination $backup
  Write-Host "[local-low-resource] Existing .wslconfig backed up: $backup" -ForegroundColor Green
}

$wslConfig = @"
[wsl2]
memory=${WslMemoryGb}GB
processors=$WslProcessors
swap=${WslSwapGb}GB
localhostForwarding=true
pageReporting=true
autoMemoryReclaim=gradual
"@

$wslConfig | Set-Content -LiteralPath $wslConfigPath -Encoding ASCII
Write-Host "[local-low-resource] WSL limits written to $wslConfigPath" -ForegroundColor Green
Write-Host ""
Write-Host "To apply WSL memory limits, close Docker Desktop and run:" -ForegroundColor Cyan
Write-Host "  wsl --shutdown"
Write-Host "Then open Docker Desktop again and start the project with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/dev-lite.ps1"
