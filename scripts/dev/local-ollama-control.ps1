param([ValidateSet('Status','Block','Unblock')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$statePath = Join-Path $repo '.dev/local-ollama-block.json'
$composePath = Join-Path $repo 'infra/compose/docker-compose.dev.yml'
$utf8 = [Text.UTF8Encoding]::new($false)
function Save-State($value) {
  [IO.Directory]::CreateDirectory((Split-Path $statePath)) | Out-Null
  [IO.File]::WriteAllText($statePath, ($value | ConvertTo-Json -Depth 8), $utf8)
}
function Get-Containers {
  $json = & docker ps -a --format '{{json .}}'
  if ($LASTEXITCODE -ne 0) { throw 'Docker inventory failed; no containers were started.' }
  @($json | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.Names -in @('gymcoach-ollama','gymcoach-ollama-puller') -or $_.Image -match '(^|/)ollama/ollama([:@]|$)' })
}
if ($Action -eq 'Status') {
  if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath } else { Write-Output 'No local Ollama block record.' }
  Get-Containers | Select-Object Names,Status,Image
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*ollama*' } | Select-Object Id,ProcessName
  Get-NetTCPConnection -State Listen -LocalPort 11434 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort
  exit 0
}
if ($Action -eq 'Block') {
  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    if (-not $state.enabled) { throw 'An older unblock record exists; inspect it before creating a fresh block.' }
  } else {
    $targets = @(
      (Join-Path $env:LOCALAPPDATA 'Programs/Ollama/ollama.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs/Ollama/ollama app.exe'),
      (Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/Startup/Ollama.lnk')
    )
    $state = [pscustomobject]@{
      enabled = $true; requestedAtUtc = [DateTime]::UtcNow.ToString('o'); completedAtUtc = $null
      reason = 'Owner requested local Ollama fully off and blocked until explicitly re-enabled.'
      composePath = $composePath
      renamedFiles = @($targets | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { [pscustomobject]@{ original = $_; blocked = $_ + '.gymini-blocked' } })
      containers = @('gymcoach-ollama','gymcoach-ollama-puller')
      previousKnownRestartPolicy = 'unless-stopped'
    }
    Save-State $state # Preserve recovery information before any rename.
  }
  foreach ($c in (Get-Containers)) {
    & docker update --restart=no $c.Names | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Cannot disable restart for $($c.Names)" }
    & docker stop --timeout 15 $c.Names | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Cannot stop $($c.Names)" }
  }
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*ollama*' } | Stop-Process -Force
  foreach ($file in $state.renamedFiles) {
    if (Test-Path -LiteralPath $file.original) {
      if (Test-Path -LiteralPath $file.blocked) { throw "Recovery file already exists: $($file.blocked)" }
      Move-Item -LiteralPath $file.original -Destination $file.blocked
    } elseif (-not (Test-Path -LiteralPath $file.blocked)) { throw "Missing original and recovery file: $($file.original)" }
  }
  $text = [IO.File]::ReadAllText($composePath)
  foreach ($service in @('ollama','ollama-model-puller')) {
    $marker = "    # GYMINI_LOCAL_OLLAMA_BLOCK: owner must explicitly unblock before starting."
    $pattern = '(?m)^  ' + [regex]::Escape($service) + ':\r?\n'
    if (-not [regex]::IsMatch($text, $pattern + [regex]::Escape($marker))) {
      if (-not [regex]::IsMatch($text,$pattern)) { throw "Missing Compose service: $service" }
      $text = [regex]::Replace($text, $pattern, "  ${service}:`n$marker`n    scale: 0`n")
    }
  }
  [IO.File]::WriteAllText($composePath,$text,$utf8)
  $state.completedAtUtc = [DateTime]::UtcNow.ToString('o')
  Save-State $state
  Write-Output 'Local Ollama blocked: containers stopped/restart disabled, Windows launchers and startup shortcut disabled, dev Compose scale zero.'
  exit 0
}
# Only run Unblock after an explicit owner request. It restores capability,
# without starting any service, loading a model, or running ingestion.
if (-not (Test-Path -LiteralPath $statePath)) { throw 'No recovery record exists.' }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
if (-not $state.enabled) { throw 'Block is already disabled.' }
foreach ($file in $state.renamedFiles) {
  if (Test-Path -LiteralPath $file.blocked) {
    if (Test-Path -LiteralPath $file.original) { throw "Refusing to overwrite: $($file.original)" }
    Move-Item -LiteralPath $file.blocked -Destination $file.original
  }
}
$text = [IO.File]::ReadAllText($composePath)
$text = [regex]::Replace($text,'(?m)^    # GYMINI_LOCAL_OLLAMA_BLOCK: owner must explicitly unblock before starting\.\r?\n    scale: 0\r?\n','')
[IO.File]::WriteAllText($composePath,$text,$utf8)
foreach ($c in (Get-Containers)) {
  & docker update "--restart=$($state.previousKnownRestartPolicy)" $c.Names | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Cannot restore restart policy for $($c.Names)" }
}
$state.enabled = $false
Save-State $state
Write-Output 'Ollama capability restored. No service was started.'
