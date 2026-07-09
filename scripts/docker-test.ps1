param(
  [ValidateSet('fast', 'full')]
  [string]$Profile = 'fast',
  [switch]$Build,
  [switch]$KeepVolumes
)

$ErrorActionPreference = 'Stop'
$compose = @('compose', '-f', 'docker-compose.test.yml')
$profiles = @('--profile', $Profile)

if ($Profile -eq 'full' -and $env:USE_OLLAMA -eq 'true') {
  $profiles += @('--profile', 'ollama')
  $env:LLM_PROVIDER = 'ollama'
}

Write-Host "[docker-test] profile=$Profile use_ollama=$($env:USE_OLLAMA)"

$upArgs = $compose + $profiles + @('up', '--abort-on-container-exit', '--exit-code-from', "test-runner-$Profile")
if ($Build) { $upArgs += '--build' }

try {
  & docker @upArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  if (-not $KeepVolumes) {
    & docker @($compose + $profiles + @('down', '-v', '--remove-orphans')) | Write-Host
  }
}