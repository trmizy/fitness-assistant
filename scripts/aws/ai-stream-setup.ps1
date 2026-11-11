<#
.SYNOPSIS
  Creates/updates the AI Coach response-streaming Lambda (POST /ai/ask/stream)
  and wires it into the frontend CloudFront distribution. Dry run by default.

.DESCRIPTION
  API Gateway buffers the whole Lambda response, so the SSE coach stream is
  served by a separate function instead:

    viewer --HTTPS--> CloudFront /ai/ask/stream --HTTPS--> Lambda Function URL
                      (CachingDisabled,                    (InvokeMode RESPONSE_STREAM,
                       AllViewerExceptHostHeader)           AuthType NONE, JWT verified in-app)

  1. Function <FunctionName>: same zip as the ai HTTP Lambda, handler
     dist/stream-lambda.handler. Role, VPC, memory, runtime, tracing and
     environment are copied from <SourceFunction> on every run (so it never
     drifts from it), plus RATE_LIMIT_PROVIDER=dynamodb: the per-user ask
     bucket is shared across instances, because this route has no API Gateway
     throttle in front of it. The ai role already has dynamodb:UpdateItem on
     fitness-assistant-dev-ai-rate-limit.
  2. Function URL (RESPONSE_STREAM, AuthType NONE) + the two resource-policy
     statements a public function URL needs (InvokeFunctionUrl, and
     InvokeFunction restricted to invocations via the function URL). CORS on
     the URL only matters for the legacy S3 website origin; the CloudFront
     origin is same-origin.
  3. CloudFront: origin "ai-stream-origin" + behavior "/ai/ask/stream",
     merged into the LIVE distribution config. The distribution has drifted
     from infra/cloudformation/frontend-cdn.yaml (the chat-alb origin and
     /socket.io/* behavior were added outside the stack), so redeploying that
     stack would delete chat — this script edits the live config instead and
     leaves every existing origin/behavior untouched.

  Reserved concurrency is NOT set: the account concurrency limit is 10, and
  Lambda refuses any reservation that leaves less than that unreserved.

.EXAMPLE
  .\scripts\aws\ai-stream-setup.ps1 -ZipPath backend\services\ai-service\artifacts\ai-lambda.zip
  .\scripts\aws\ai-stream-setup.ps1 -ZipPath backend\services\ai-service\artifacts\ai-lambda.zip -Execute
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [string]$Region = "ap-southeast-1",
  [string]$FunctionName = "fitness-assistant-dev-ai-stream",
  [string]$SourceFunction = "fitness-assistant-dev-ai",
  [string]$DistributionId = "E2MHD79JFC1700",
  [int]$TimeoutSeconds = 90,
  [string[]]$CorsOrigins = @(
    "https://gymini.vn",
    "https://www.gymini.vn",
    "https://d1ub83a48p566t.cloudfront.net",
    "http://fitness-assistant-frontend-dev-191798898985.s3-website-ap-southeast-1.amazonaws.com"
  ),
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$StreamHandler = "dist/stream-lambda.handler"
$OriginId = "ai-stream-origin"
$PathPattern = "/ai/ask/stream"
$CachingDisabled = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
$AllViewerExceptHostHeader = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Invoke-Aws {
  param([string[]]$Arguments, [switch]$AllowFailure)
  # PowerShell 5.1 turns any native stderr line into a terminating error under
  # ErrorActionPreference=Stop; the exit code is the real success signal here.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & aws @Arguments 2>&1 | ForEach-Object { "$_" }
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
    throw "aws $($Arguments -join ' ') failed (exit $LASTEXITCODE): $output"
  }
  return [pscustomobject]@{ Ok = ($LASTEXITCODE -eq 0); Text = ($output | Out-String) }
}

function Write-JsonFile([object]$Value, [string]$Name) {
  $path = Join-Path $env:TEMP $Name
  [IO.File]::WriteAllText($path, ($Value | ConvertTo-Json -Depth 30 -Compress), $Utf8NoBom)
  return $path
}

function Wait-FunctionReady {
  for ($i = 0; $i -lt 60; $i++) {
    $state = (Invoke-Aws @("lambda", "get-function-configuration", "--function-name", $FunctionName, "--region", $Region,
        "--query", "[State,LastUpdateStatus]", "--output", "text")).Text.Trim()
    if ($state -match "^Active\s+Successful$") { return }
    if ($state -match "Failed") { throw "Function $FunctionName entered a failed state: $state" }
    Start-Sleep -Seconds 5
  }
  throw "Timed out waiting for $FunctionName to become Active/Successful."
}

$mode = if ($Execute) { "EXECUTE" } else { "DRY RUN (pass -Execute to apply)" }
Write-Host "=== AI stream setup - $mode ===" -ForegroundColor Cyan

$identity = (Invoke-Aws @("sts", "get-caller-identity", "--output", "json")).Text | ConvertFrom-Json
Write-Host "Account: $($identity.Account)  Region: $Region"
if (-not (Test-Path $ZipPath)) { throw "Zip not found: $ZipPath" }
$zipFull = (Resolve-Path $ZipPath).Path
Write-Host ("Zip: {0} ({1:N0} bytes)" -f $zipFull, (Get-Item $zipFull).Length)

# --- 1. Function -------------------------------------------------------------
$src = (Invoke-Aws @("lambda", "get-function-configuration", "--function-name", $SourceFunction, "--region", $Region,
    "--output", "json")).Text | ConvertFrom-Json

$envVars = @{}
foreach ($p in $src.Environment.Variables.PSObject.Properties) { $envVars[$p.Name] = $p.Value }
$envVars["RATE_LIMIT_PROVIDER"] = "dynamodb"
$envFile = Write-JsonFile @{ Variables = $envVars } "ai-stream-env.json"
$vpcFile = Write-JsonFile @{ SubnetIds = @($src.VpcConfig.SubnetIds); SecurityGroupIds = @($src.VpcConfig.SecurityGroupIds) } "ai-stream-vpc.json"

$exists = (Invoke-Aws @("lambda", "get-function", "--function-name", $FunctionName, "--region", $Region) -AllowFailure).Ok
Write-Host ""
Write-Host "1) Function $FunctionName - $(if ($exists) { 'exists: update code + configuration' } else { 'create' })"
Write-Host "   handler=$StreamHandler timeout=${TimeoutSeconds}s memory=$($src.MemorySize) runtime=$($src.Runtime) role=$($src.Role)"
Write-Host "   env: $($envVars.Count) vars copied from $SourceFunction + RATE_LIMIT_PROVIDER=dynamodb"

if ($Execute) {
  if (-not $exists) {
    Invoke-Aws @("lambda", "create-function", "--function-name", $FunctionName, "--region", $Region,
      "--runtime", $src.Runtime, "--handler", $StreamHandler, "--role", $src.Role,
      "--zip-file", "fileb://$zipFull", "--timeout", "$TimeoutSeconds", "--memory-size", "$($src.MemorySize)",
      "--architectures", $src.Architectures[0], "--vpc-config", "file://$vpcFile",
      "--environment", "file://$envFile", "--tracing-config", "Mode=$($src.TracingConfig.Mode)",
      "--description", "AI Coach SSE (POST /ai/ask/stream) via Function URL RESPONSE_STREAM behind CloudFront") | Out-Null
    Wait-FunctionReady
  } else {
    Invoke-Aws @("lambda", "update-function-code", "--function-name", $FunctionName, "--region", $Region,
      "--zip-file", "fileb://$zipFull") | Out-Null
    Wait-FunctionReady
    Invoke-Aws @("lambda", "update-function-configuration", "--function-name", $FunctionName, "--region", $Region,
      "--handler", $StreamHandler, "--role", $src.Role, "--timeout", "$TimeoutSeconds",
      "--memory-size", "$($src.MemorySize)", "--vpc-config", "file://$vpcFile",
      "--environment", "file://$envFile", "--tracing-config", "Mode=$($src.TracingConfig.Mode)") | Out-Null
    Wait-FunctionReady
  }
  Write-Host "   done" -ForegroundColor Green
}

# --- 2. Function URL + permissions -------------------------------------------
$corsFile = Write-JsonFile @{
  AllowOrigins = @($CorsOrigins); AllowMethods = @("POST"); AllowHeaders = @("authorization", "content-type"); MaxAge = 300
} "ai-stream-cors.json"
Write-Host ""
Write-Host "2) Function URL (AuthType NONE, InvokeMode RESPONSE_STREAM, CORS: $($CorsOrigins -join ', '))"

$functionUrl = $null
if ($Execute) {
  $urlCfg = Invoke-Aws @("lambda", "get-function-url-config", "--function-name", $FunctionName, "--region", $Region,
      "--output", "json") -AllowFailure
  $verb = if ($urlCfg.Ok) { "update-function-url-config" } else { "create-function-url-config" }
  $functionUrl = ((Invoke-Aws @("lambda", $verb, "--function-name", $FunctionName, "--region", $Region,
        "--auth-type", "NONE", "--invoke-mode", "RESPONSE_STREAM", "--cors", "file://$corsFile",
        "--output", "json")).Text | ConvertFrom-Json).FunctionUrl

  $policy = Invoke-Aws @("lambda", "get-policy", "--function-name", $FunctionName, "--region", $Region,
      "--output", "text", "--query", "Policy") -AllowFailure
  $policyText = if ($policy.Ok) { $policy.Text } else { "" }
  if ($policyText -notmatch '"Sid":"FunctionUrlPublicInvoke"') {
    Invoke-Aws @("lambda", "add-permission", "--function-name", $FunctionName, "--region", $Region,
      "--statement-id", "FunctionUrlPublicInvoke", "--action", "lambda:InvokeFunctionUrl",
      "--principal", "*", "--function-url-auth-type", "NONE") | Out-Null
  }
  if ($policyText -notmatch '"Sid":"FunctionUrlInvokeFunction"') {
    Invoke-Aws @("lambda", "add-permission", "--function-name", $FunctionName, "--region", $Region,
      "--statement-id", "FunctionUrlInvokeFunction", "--action", "lambda:InvokeFunction",
      "--principal", "*", "--invoked-via-function-url") | Out-Null
  }
  Write-Host "   $functionUrl" -ForegroundColor Green
} else {
  Write-Host "   (URL is known only after -Execute creates it)"
}

# --- 3. CloudFront -----------------------------------------------------------
Write-Host ""
Write-Host "3) CloudFront $DistributionId - origin '$OriginId' + behavior '$PathPattern' (other origins/behaviors untouched)"
$dist = (Invoke-Aws @("cloudfront", "get-distribution-config", "--id", $DistributionId, "--output", "json")).Text | ConvertFrom-Json
$config = $dist.DistributionConfig
Write-Host "   live origins:   $(@($config.Origins.Items | ForEach-Object { $_.Id }) -join ', ')"
Write-Host "   live behaviors: $(@($config.CacheBehaviors.Items | ForEach-Object { $_.PathPattern }) -join ', ')"

if (-not $Execute) {
  Write-Host ""
  Write-Host "Dry run complete - nothing was changed." -ForegroundColor Yellow
  return
}

$originDomain = ([Uri]$functionUrl).Host
$origin = [pscustomobject]@{
  Id = $OriginId; DomainName = $originDomain; OriginPath = ""
  CustomHeaders = @{ Quantity = 0 }
  CustomOriginConfig = [pscustomobject]@{
    HTTPPort = 80; HTTPSPort = 443; OriginProtocolPolicy = "https-only"
    OriginSslProtocols = @{ Quantity = 1; Items = @("TLSv1.2") }
    OriginReadTimeout = 60; OriginKeepaliveTimeout = 5
  }
  ConnectionAttempts = 3; ConnectionTimeout = 10
  OriginShield = @{ Enabled = $false }
  OriginAccessControlId = ""
}
$behavior = [pscustomobject]@{
  PathPattern = $PathPattern; TargetOriginId = $OriginId
  TrustedSigners = @{ Enabled = $false; Quantity = 0 }
  TrustedKeyGroups = @{ Enabled = $false; Quantity = 0 }
  ViewerProtocolPolicy = "https-only"
  AllowedMethods = @{
    Quantity = 7; Items = @("GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE")
    CachedMethods = @{ Quantity = 2; Items = @("GET", "HEAD") }
  }
  SmoothStreaming = $false; Compress = $false
  LambdaFunctionAssociations = @{ Quantity = 0 }
  FunctionAssociations = @{ Quantity = 0 }
  FieldLevelEncryptionId = ""
  CachePolicyId = $CachingDisabled
  OriginRequestPolicyId = $AllViewerExceptHostHeader
}

$origins = @($config.Origins.Items | Where-Object { $_.Id -ne $OriginId }) + $origin
$config.Origins = [pscustomobject]@{ Quantity = $origins.Count; Items = $origins }
$existingBehaviors = @()
if ($config.CacheBehaviors.Quantity -gt 0) {
  $existingBehaviors = @($config.CacheBehaviors.Items | Where-Object { $_.PathPattern -ne $PathPattern })
}
$behaviors = @($behavior) + $existingBehaviors
$config.CacheBehaviors = [pscustomobject]@{ Quantity = $behaviors.Count; Items = $behaviors }

$configFile = Write-JsonFile $config "ai-stream-distribution-config.json"
Invoke-Aws @("cloudfront", "update-distribution", "--id", $DistributionId, "--if-match", $dist.ETag,
  "--distribution-config", "file://$configFile") | Out-Null
Write-Host "   distribution updated (propagation takes a few minutes; status InProgress -> Deployed)" -ForegroundColor Green

$domain = (Invoke-Aws @("cloudfront", "get-distribution", "--id", $DistributionId,
    "--query", "Distribution.DomainName", "--output", "text")).Text.Trim()
Write-Host ""
Write-Host "Stream endpoint: https://$domain$PathPattern"
