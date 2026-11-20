<#
.SYNOPSIS
  Local test mode: Nova Pro (chat) + Cohere (embeddings) via the AWS CLI profile, vectors in a SEPARATE Qdrant.

.DESCRIPTION
  Only the LLM and the embedding model come from AWS; databases, services and the web app stay local.
  Vectors go to a dedicated Qdrant container on :6340 (volume gymini-qdrant-bedrock-data, 1024 dims) so the
  existing 768-dim nomic collections on :6333 are never touched or deleted. Removing this mode is `-Down -RemoveData`.

  Actions (combine freely):
    -Status    show Docker / Qdrant / collections / AWS identity
    -Up        start the dedicated Qdrant (creates it if missing)
    -Ingest    embed + load the RAG CSVs and evidence into it (idempotent: ids are overwritten, safe to re-run)
                 -Collection exercises|fitness_knowledge|fitness_faq|evidence|all   (default all)
    -Down      stop the Qdrant container       (-RemoveData also deletes ITS volume only)
    -Env       print the environment variables this mode sets

  Then start the test stack with:   $env:LOCAL_BEDROCK="1"; node test/ai-chat-full-verification/stack.mjs up --web
  Cost: Cohere embeddings for ~13,200 rows (about 2M tokens) = well under US$1; chat calls to Nova Pro are paid per use.
  Nothing secret is stored or printed: the AWS SDK reads the profile.
#>
param(
  [switch]$Status, [switch]$Up, [switch]$Ingest, [switch]$Down, [switch]$RemoveData, [switch]$Env,
  [ValidateSet("all", "exercises", "fitness_knowledge", "fitness_faq", "evidence")][string]$Collection = "all",
  [string]$AwsProfile = "divuzha"
)
$ErrorActionPreference = "Stop"
$Container = "gymini-qdrant-bedrock"; $Volume = "gymini-qdrant-bedrock-data"; $HostPort = 6340
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$AiDir = Join-Path $Root "backend\services\ai-service"

function Get-BedrockEnv {
  return [ordered]@{
    LLM_PROVIDER = "bedrock"; BEDROCK_CHAT_MODEL = "apac.amazon.nova-pro-v1:0"
    EMBEDDING_PROVIDER = "bedrock"; BEDROCK_EMBEDDING_MODEL = "cohere.embed-multilingual-v3"; KNOWLEDGE_VECTOR_SIZE = "1024"; EMBEDDING_DIMENSIONS = "1024"
    BEDROCK_REGION = "ap-southeast-1"; AWS_REGION = "ap-southeast-1"; AWS_PROFILE = $AwsProfile; AWS_SDK_LOAD_CONFIG = "1"
    QDRANT_HOST = "localhost"; QDRANT_PORT = "$HostPort"
  }
}
# ingest has no retry of its own and a transient socket error aborts the run; every step is idempotent (ids are overwritten), so retry.
function Invoke-Retry([string]$Label, [scriptblock]$Block, [int]$Tries = 4) {
  for ($t = 1; $t -le $Tries; $t++) {
    & $Block
    if ($LASTEXITCODE -eq 0) { return }
    Write-Host "!! $Label failed (attempt $t/$Tries)"; Start-Sleep -Seconds (5 * $t)
  }
  throw "$Label failed after $Tries attempts"
}
function Test-Docker { docker version --format '{{.Server.Version}}' 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) }
function Assert-Docker { if (-not (Test-Docker)) { throw "Docker is not running. Start Docker Desktop, wait for it to be ready, then re-run." } }

if ($Env) { (Get-BedrockEnv).GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value } }

if ($Up) {
  Assert-Docker
  $exists = docker ps -a --filter "name=^$Container$" --format "{{.Names}}"
  if (-not $exists) {
    docker run -d --name $Container --restart unless-stopped -p "${HostPort}:6333" -v "${Volume}:/qdrant/storage" qdrant/qdrant:latest | Out-Null
    Write-Host "Created $Container on :$HostPort"
  } else { docker start $Container | Out-Null; Write-Host "Started $Container" }
  for ($i = 0; $i -lt 30; $i++) { try { Invoke-RestMethod "http://localhost:$HostPort/collections" -TimeoutSec 2 | Out-Null; Write-Host "Qdrant :$HostPort is ready"; break } catch { Start-Sleep 2 } }
}

if ($Ingest) {
  $vars = Get-BedrockEnv
  foreach ($k in $vars.Keys) { Set-Item -Path "Env:$k" -Value $vars[$k] }
  try { Invoke-RestMethod "http://localhost:$HostPort/collections" -TimeoutSec 3 | Out-Null } catch { throw "Qdrant on :$HostPort is not reachable. Run -Up first." }
  Push-Location $AiDir
  try {
    $csv = @("exercises", "fitness_knowledge", "fitness_faq")
    if ($Collection -ne "evidence") {
      $targets = if ($Collection -eq "all") { $csv } else { @($Collection) }
      foreach ($c in $targets) { Write-Host "== ingest $c"; Invoke-Retry "ingest $c" { npx tsx src/ingest.ts "--collection=$c" } }
    }
    if ($Collection -eq "all" -or $Collection -eq "evidence") {
      Write-Host "== ingest evidence"; Invoke-Retry "data:ingest" { npm run data:ingest }
      Invoke-Retry "ingest:training-methods" { npm run ingest:training-methods }
    }
  } finally { Pop-Location }
}

if ($Down) {
  Assert-Docker
  docker stop $Container 2>$null | Out-Null
  if ($RemoveData) { docker rm $Container 2>$null | Out-Null; docker volume rm $Volume 2>$null | Out-Null; Write-Host "Removed $Container and its volume $Volume (nothing else)." }
  else { Write-Host "Stopped $Container (data kept)." }
}

if ($Status -or (-not ($Up -or $Ingest -or $Down -or $Env))) {
  Write-Host ("Docker:   " + $(if (Test-Docker) { "running" } else { "NOT running" }))
  try {
    $cols = (Invoke-RestMethod "http://localhost:$HostPort/collections" -TimeoutSec 3).result.collections
    Write-Host "Qdrant :$HostPort  collections: $((@($cols).Count))"
    foreach ($c in $cols) { $i = (Invoke-RestMethod "http://localhost:$HostPort/collections/$($c.name)").result; "  {0,-20} points={1,6} dims={2}" -f $c.name, $i.points_count, $i.config.params.vectors.size }
  } catch { Write-Host "Qdrant :$HostPort  not reachable" }
  Write-Host ("AWS profile ${AwsProfile}: account " + (aws sts get-caller-identity --profile $AwsProfile --query Account --output text 2>$null))
}
