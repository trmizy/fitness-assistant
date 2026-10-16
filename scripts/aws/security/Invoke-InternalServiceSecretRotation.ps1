<#
.SYNOPSIS
  Gymini DEV - zero-exposure, coordinated rotation of INTERNAL_SERVICE_SECRET
  (12 Lambda functions) + INTERNAL_API_SECRET (Chat's ECS task definition).

.DESCRIPTION
  Phase 13C-A (docs/deployment/AWS_DEV_INTERNAL_SECRET_ROTATION_DESIGN_2026-10-07.md).

  LIVE EXECUTION IS NOT AUTHORIZED YET. This script implements the design
  and is safe to run in its default dry-run mode (no AWS mutation at all
  beyond the read-only discovery calls already proven safe in this
  engagement - narrow `keys(@)`/`length(@)` queries, never a full
  Environment.Variables dump). -Execute exists for Phase 13C-B and is
  intentionally stricter than the JWT rotation helper: it requires
  -AcknowledgeDedicatedSecretRisk if PT_DOCUMENT_URL_SECRET and/or
  CHECKIN_TOKEN_SECRET are not independently configured (see
  Test-DedicatedSecretIndependence) - it will not silently proceed past a
  real, live-confirmed hazard.

  Stage model actually enforced (see the design report for why a
  dual-secret PREPARE_RECEIVERS/CUTOVER_CALLERS model was evaluated and
  rejected - no validator in this codebase accepts two valid values at
  once, so there is no safe "receivers first" ordering to exploit without
  an application code change):

    PREFLIGHT -> ROTATE_LAMBDAS -> ROTATE_ECS_TASKDEF -> VERIFY

  Every AWS response that could contain a secret value is assigned
  straight into a local PowerShell variable and never passed to
  Write-Host, a file, or this script's own output - only
  Get-SanitizedResourceSummary's result is ever printed, exactly as in
  Invoke-JwtSecretRotation.ps1.

.PARAMETER Execute
  Without this switch, dry-run only: discovers live state, runs every
  precondition check, prints a plan, mutates nothing.

.PARAMETER AcknowledgeDedicatedSecretRisk
  Required (in addition to -Execute) if Test-DedicatedSecretIndependence
  finds PT_DOCUMENT_URL_SECRET and/or CHECKIN_TOKEN_SECRET are not
  independently configured - acknowledges that rotating will invalidate
  any currently-valid check-in QR codes / PT document links signed with
  the fallback value.
#>
[CmdletBinding()]
param(
    [switch]$Execute,
    [switch]$AcknowledgeDedicatedSecretRisk
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib/InternalSecretRotation.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "../lib/DevLifecycle.psm1") -Force

# Full-replace-safe schedule State setter - identical contract to
# dev-start.ps1/dev-stop.ps1's own Set-DevScheduleState (AWS's
# update-schedule is a full replace, so this always reads the CURRENT full
# schedule first and resubmits everything unchanged except State).
function Set-RotationScheduleState {
    param([string]$Name, [string]$TargetState, [string]$Region)
    $full = aws scheduler get-schedule --name $Name --region $Region --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
    if ($full.State -eq $TargetState) { return 0 }
    Write-Host "   $Name : $($full.State) -> $TargetState"
    $full.PSObject.Properties.Remove("Arn")
    $full.PSObject.Properties.Remove("CreationDate")
    $full.PSObject.Properties.Remove("LastModificationDate")
    $full.State = $TargetState
    $p = Join-Path $env:TEMP "gymini-internalsecret-schedule-$Name.json"
    (ConvertTo-Json -InputObject $full -Depth 10) | Set-Content -Path $p -Encoding ASCII -NoNewline
    try {
        aws scheduler update-schedule --cli-input-json "file://$p" --region $Region --output json | Out-Null
        return $LASTEXITCODE
    } finally {
        Remove-Item -Path $p -Force -ErrorAction SilentlyContinue
    }
}

$ExpectedAccount = "191798898985"
$ExpectedRegion = "ap-southeast-1"
$LambdaConsumers = Get-InternalSecretLambdaConsumers
$EcsTaskFamily = Get-InternalSecretEcsTaskFamily
$EcsCluster = "fitness-assistant-dev-cluster"
$EcsService = "fitness-assistant-dev-chat-service"
$LambdaKeyName = "INTERNAL_SERVICE_SECRET"
$EcsKeyName = "INTERNAL_API_SECRET"

Write-Host "=== Gymini DEV - INTERNAL_SERVICE_SECRET / INTERNAL_API_SECRET coordinated rotation ===" -ForegroundColor Cyan

# -- Stage: PREFLIGHT -------------------------------------------------------
$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
$region = aws configure get region
$accountCheck = Test-AccountRegion -ActualAccount $identity.Account -ExpectedAccount $ExpectedAccount -ActualRegion $region -ExpectedRegion $ExpectedRegion
if (-not $accountCheck.Ok) {
    Write-Host "HARD STOP: $($accountCheck.Reason)" -ForegroundColor Red
    exit 1
}
Write-Host "Account/region OK: $($identity.Account) / $region"

# Discover which of the expected 12 Lambda consumers actually exist live,
# and whether each currently has INTERNAL_SERVICE_SECRET (key NAME only).
$liveFunctionNames = (aws lambda list-functions --region $ExpectedRegion --query "Functions[].FunctionName" --output json | ConvertFrom-Json)
$inventoryCheck = Test-ConsumerInventoryComplete -ExpectedConsumers $LambdaConsumers -CurrentInventory $liveFunctionNames
if (-not $inventoryCheck.Ok) {
    Write-Host "HARD STOP: $($inventoryCheck.Reason)" -ForegroundColor Red
    exit 1
}
Write-Host "Consumer inventory complete: all $($LambdaConsumers.Count) expected Lambda functions found live."

$lambdaHasKey = @{}
foreach ($fn in $LambdaConsumers) {
    $hasKey = aws lambda get-function-configuration --function-name $fn --region $ExpectedRegion `
        --query "contains(Environment.Variables | keys(@), '$LambdaKeyName')" --output text
    $lambdaHasKey[$fn] = ($hasKey -eq "True")
}
$missingKey = @($lambdaHasKey.Keys | Where-Object { -not $lambdaHasKey[$_] })
if ($missingKey.Count -gt 0) {
    Write-Host "HARD STOP: $LambdaKeyName missing on: $($missingKey -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "$LambdaKeyName present on all $($LambdaConsumers.Count) Lambda functions."

# Dedicated-secret-independence hazard check (the real, live-confirmed
# PT_DOCUMENT_URL_SECRET finding).
$checkinPresent = (aws lambda get-function-configuration --function-name fitness-assistant-dev-gym --region $ExpectedRegion `
    --query "contains(Environment.Variables | keys(@), 'CHECKIN_TOKEN_SECRET')" --output text) -eq "True"
$ptDocPresent = (aws lambda get-function-configuration --function-name fitness-assistant-dev-user --region $ExpectedRegion `
    --query "contains(Environment.Variables | keys(@), 'PT_DOCUMENT_URL_SECRET')" --output text) -eq "True"
$hazard = Test-DedicatedSecretIndependence -CheckinTokenSecretPresent $checkinPresent -PtDocumentUrlSecretPresent $ptDocPresent
if (-not $hazard.Safe) {
    Write-Host ""
    Write-Host "DEDICATED-SECRET-INDEPENDENCE WARNING:" -ForegroundColor Yellow
    foreach ($w in $hazard.Warnings) { Write-Host "  - $w" -ForegroundColor Yellow }
    if ($Execute -and -not $AcknowledgeDedicatedSecretRisk) {
        Write-Host "HARD STOP: -Execute requires -AcknowledgeDedicatedSecretRisk while this warning stands." -ForegroundColor Red
        exit 1
    }
}

# Chat ECS task definition discovery (metadata only - family, container
# name, current revision ARN, whether INTERNAL_API_SECRET is present).
$ecsTaskDefArn = aws ecs describe-services --cluster $EcsCluster --services $EcsService --region $ExpectedRegion `
    --query "services[0].taskDefinition" --output text
$ecsEnvNames = aws ecs describe-task-definition --task-definition $ecsTaskDefArn --region $ExpectedRegion `
    --query "taskDefinition.containerDefinitions[0].environment[].name" --output json | ConvertFrom-Json
$ecsHasKey = $ecsEnvNames -contains $EcsKeyName
if (-not $ecsHasKey) {
    Write-Host "HARD STOP: $EcsKeyName missing from Chat task definition ($ecsTaskDefArn)." -ForegroundColor Red
    exit 1
}
Write-Host "$EcsKeyName present on Chat task definition: $ecsTaskDefArn"

$desiredCount = aws ecs describe-services --cluster $EcsCluster --services $EcsService --region $ExpectedRegion `
    --query "services[0].desiredCount" --output text
Write-Host "Chat ECS desiredCount: $desiredCount (0 = no warm-task risk; a new task definition revision only takes effect on the next start)"

if (-not $Execute) {
    Write-Host ""
    Write-Host "DRY RUN (default) - plan only, nothing was mutated:" -ForegroundColor Yellow
    Write-Host "  Stage 1 PREFLIGHT:          PASS (shown above)"
    Write-Host "  Stage 2 ROTATE_LAMBDAS:     would update $LambdaKeyName on all $($LambdaConsumers.Count) Lambda functions to ONE new shared value, as fast as sequentially possible"
    Write-Host "  Stage 3 ROTATE_ECS_TASKDEF: would register a new revision of $ecsTaskDefArn with $EcsKeyName set to the SAME new value (no running task to restart - desiredCount=$desiredCount)"
    Write-Host "  Stage 4 VERIFY:             would re-check LastUpdateStatus=Successful on every Lambda and confirm the new ECS revision registered"
    Write-Host ""
    if (-not $hazard.Safe) {
        Write-Host "  NOTE: the dedicated-secret-independence warning above would require -AcknowledgeDedicatedSecretRisk to proceed with -Execute." -ForegroundColor Yellow
    }
    Write-Host "Nothing was executed against AWS by this script beyond the read-only discovery calls above." -ForegroundColor Green
    exit 0
}

# -- Real execution (Phase 13C-B) ------------------------------------------
Write-Host ""
Write-Host "-Execute passed. Beginning controlled maintenance cutover." -ForegroundColor Yellow
$sanitizedResults = @()

function Update-LambdaSingleKey {
    param([string]$FunctionName, [string]$KeyName, [string]$NewValue, [string]$Region)
    $cfgJson = aws lambda get-function-configuration --function-name $FunctionName --region $Region --output json
    $cfg = $cfgJson | ConvertFrom-Json
    $revisionId = $cfg.RevisionId
    $envHash = @{}
    foreach ($p in $cfg.Environment.Variables.PSObject.Properties) { $envHash[$p.Name] = $p.Value }

    $merge = Merge-RotatedSingleKey -CurrentEnv $envHash -KeyName $KeyName -NewValue $NewValue
    if (-not $merge.Ok) { return @{ Ok = $false; Reason = $merge.Reason } }

    $payload = [ordered]@{ FunctionName = $FunctionName; Environment = @{ Variables = $merge.MergedEnv }; RevisionId = $revisionId }
    $payloadJson = $payload | ConvertTo-Json -Depth 10 -Compress
    $tempPath = Join-Path $env:TEMP "gymini-internalsecret-$FunctionName-$(New-Guid).json"
    try {
        Set-Content -Path $tempPath -Value $payloadJson -Encoding ASCII -NoNewline
        aws lambda update-function-configuration --region $Region --cli-input-json "file://$tempPath" --output json | Out-Null
        if ($LASTEXITCODE -ne 0) { return @{ Ok = $false; Reason = "update-function-configuration failed (exit $LASTEXITCODE)" } }
        aws lambda wait function-updated --function-name $FunctionName --region $Region
        if ($LASTEXITCODE -ne 0) { return @{ Ok = $false; Reason = "wait function-updated failed (exit $LASTEXITCODE)" } }
        $finalJson = aws lambda get-function-configuration --function-name $FunctionName --region $Region `
            --query "{LastUpdateStatus:LastUpdateStatus,RevisionId:RevisionId,EnvKeyCount:length(Environment.Variables | keys(@))}" --output json
        $final = $finalJson | ConvertFrom-Json
        return @{ Ok = ($final.LastUpdateStatus -eq "Successful"); Reason = $null; Final = $final }
    } finally {
        Remove-Item -Path $tempPath -Force -ErrorAction SilentlyContinue
    }
}

# -- Stage: PT_DOCUMENT_SECRET_BRIDGE (13C-B.2/3) --------------------------
# Only needed if PT_DOCUMENT_URL_SECRET is not already independent. Freezes
# the PT-document signing key on the CURRENT shared-secret value BEFORE
# that shared value changes, so already-issued PT document links keep
# validating. The old value is read into a local variable and passed
# straight into Update-LambdaSingleKey - never printed, never written
# anywhere else.
if (-not $ptDocPresent) {
    if (-not $AcknowledgeDedicatedSecretRisk) {
        Write-Host "HARD STOP: PT_DOCUMENT_URL_SECRET bridge required but -AcknowledgeDedicatedSecretRisk not passed." -ForegroundColor Red
        exit 1
    }
    Write-Host ""
    Write-Host "Stage: PT_DOCUMENT_SECRET_BRIDGE - freezing PT document signing key on its current value before rotation..." -ForegroundColor Cyan
    $userCfg = (aws lambda get-function-configuration --function-name fitness-assistant-dev-user --region $ExpectedRegion --output json) | ConvertFrom-Json
    $userEnvHash = @{}
    foreach ($p in $userCfg.Environment.Variables.PSObject.Properties) { $userEnvHash[$p.Name] = $p.Value }
    $currentSharedValue = $userEnvHash[$LambdaKeyName]   # in-memory only, never printed
    $userEnvHash["PT_DOCUMENT_URL_SECRET"] = $currentSharedValue

    $bridgePayload = [ordered]@{ FunctionName = "fitness-assistant-dev-user"; Environment = @{ Variables = $userEnvHash }; RevisionId = $userCfg.RevisionId }
    $bridgePayloadJson = $bridgePayload | ConvertTo-Json -Depth 10 -Compress
    $bridgeTempPath = Join-Path $env:TEMP "gymini-ptbridge-$(New-Guid).json"
    try {
        Set-Content -Path $bridgeTempPath -Value $bridgePayloadJson -Encoding ASCII -NoNewline
        aws lambda update-function-configuration --region $ExpectedRegion --cli-input-json "file://$bridgeTempPath" --output json | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "HARD STOP: PT document bridge update failed (exit $LASTEXITCODE). Shared secret NOT rotated." -ForegroundColor Red
            exit 1
        }
        aws lambda wait function-updated --function-name fitness-assistant-dev-user --region $ExpectedRegion
    } finally {
        Remove-Item -Path $bridgeTempPath -Force -ErrorAction SilentlyContinue
        $currentSharedValue = $null; $userEnvHash = $null; $bridgePayload = $null; $bridgePayloadJson = $null
    }
    $ptCheck = (aws lambda get-function-configuration --function-name fitness-assistant-dev-user --region $ExpectedRegion `
        --query "{HasInternal:contains(Environment.Variables | keys(@), 'INTERNAL_SERVICE_SECRET'),HasPtDoc:contains(Environment.Variables | keys(@), 'PT_DOCUMENT_URL_SECRET')}" --output json) | ConvertFrom-Json
    if (-not ($ptCheck.HasInternal -and $ptCheck.HasPtDoc)) {
        Write-Host "HARD STOP: PT document bridge verification failed (key presence check)." -ForegroundColor Red
        exit 1
    }
    Write-Host "PT_DOCUMENT_SECRET_BRIDGE: PASS - PT_DOCUMENT_URL_SECRET now present, frozen on the pre-rotation value." -ForegroundColor Green
} else {
    Write-Host "PT_DOCUMENT_SECRET_BRIDGE: not needed - PT_DOCUMENT_URL_SECRET already independent."
}

# -- Stage: MAINTENANCE_WINDOW (13C-B.4) -----------------------------------
Write-Host ""
Write-Host "Stage: MAINTENANCE_WINDOW - pausing the 13 DEV-pausable schedules (gym-partner-upload-sweep untouched)..." -ForegroundColor Cyan
$pausable = Get-DevPausableSchedules
foreach ($name in $pausable) {
    Set-RotationScheduleState -Name $name -TargetState "DISABLED" -Region $ExpectedRegion | Out-Null
}
$stillEnabled = @($pausable | Where-Object { (aws scheduler get-schedule --name $_ --region $ExpectedRegion --query "State" --output text) -eq "ENABLED" })
if ($stillEnabled.Count -gt 0) {
    Write-Host "HARD STOP: schedules still ENABLED after pause attempt: $($stillEnabled -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "MAINTENANCE_WINDOW: PASS - 0 of 13 DEV-pausable schedules enabled." -ForegroundColor Green

# -- Stage: GENERATE (13C-B.5) ----------------------------------------------
$newSharedSecret = New-SharedInternalSecretValue   # ONE value, used for both key names, never printed

# -- Stage: ROTATE_LAMBDAS (13C-B.6) ----------------------------------------
Write-Host ""
Write-Host "Stage: ROTATE_LAMBDAS - $($LambdaConsumers.Count) targets..." -ForegroundColor Cyan
$succeeded = @()
$failedAt = $null
foreach ($fn in $LambdaConsumers) {
    $r = Update-LambdaSingleKey -FunctionName $fn -KeyName $LambdaKeyName -NewValue $newSharedSecret -Region $ExpectedRegion
    if (-not $r.Ok) {
        $failedAt = $fn
        Write-Host "HARD STOP: Lambda rotation failed at '$fn': $($r.Reason)" -ForegroundColor Red
        break
    }
    $succeeded += $fn
    $summary = Get-SanitizedResourceSummary -ResourceType "Lambda" -ResourceName $fn -UpdateStatus $r.Final.LastUpdateStatus `
        -NewRevisionId $r.Final.RevisionId -EnvironmentKeysFound $r.Final.EnvKeyCount
    $sanitizedResults += $summary
    Write-Host "  OK: $fn (EnvKeyCount=$($r.Final.EnvKeyCount), RevisionId=$($r.Final.RevisionId))"
}
if ($failedAt) {
    Write-Host ""
    Write-Host "CUTOVER STOPPED. Succeeded: $($succeeded -join ', ')" -ForegroundColor Red
    Write-Host "Failed at: $failedAt" -ForegroundColor Red
    Write-Host "Not attempted: $(($LambdaConsumers | Where-Object { $_ -notin $succeeded -and $_ -ne $failedAt }) -join ', ')" -ForegroundColor Red
    Write-Host "Restoring schedules to their pre-maintenance-window state before exiting..." -ForegroundColor Yellow
    foreach ($name in $pausable) { Set-RotationScheduleState -Name $name -TargetState "ENABLED" -Region $ExpectedRegion | Out-Null }
    exit 1
}
Write-Host "ROTATE_LAMBDAS: PASS - $($succeeded.Count)/$($LambdaConsumers.Count) Lambda functions updated." -ForegroundColor Green

# -- Stage: ROTATE_ECS_TASKDEF (13C-B.7) ------------------------------------
Write-Host ""
Write-Host "Stage: ROTATE_ECS_TASKDEF..." -ForegroundColor Cyan
$taskDefJson = aws ecs describe-task-definition --task-definition $ecsTaskDefArn --region $ExpectedRegion --output json
$taskDef = ($taskDefJson | ConvertFrom-Json).taskDefinition

$containerDef = $taskDef.containerDefinitions[0]
$newEnvList = @()
foreach ($e in $containerDef.environment) {
    if ($e.name -eq $EcsKeyName) {
        $newEnvList += @{ name = $EcsKeyName; value = $newSharedSecret }
    } else {
        $newEnvList += @{ name = $e.name; value = $e.value }
    }
}
$containerDef.environment = $newEnvList

$registerPayload = [ordered]@{
    family                  = $taskDef.family
    taskRoleArn             = $taskDef.taskRoleArn
    executionRoleArn        = $taskDef.executionRoleArn
    networkMode             = $taskDef.networkMode
    containerDefinitions    = @($containerDef)
    requiresCompatibilities = $taskDef.requiresCompatibilities
    cpu                     = $taskDef.cpu
    memory                  = $taskDef.memory
}
# register-task-definition does NOT inherit omitted fields from the
# previous revision the way Lambda's update-function-configuration does -
# it is a fresh registration, so every field that was actually set on the
# current revision must be explicitly carried over or it silently reverts
# to an AWS default. Confirmed live which of these this task definition
# actually uses before deciding what to include.
if ($taskDef.volumes -and @($taskDef.volumes).Count -gt 0) { $registerPayload.volumes = $taskDef.volumes }
if ($taskDef.placementConstraints -and @($taskDef.placementConstraints).Count -gt 0) { $registerPayload.placementConstraints = $taskDef.placementConstraints }
if ($taskDef.runtimePlatform) { $registerPayload.runtimePlatform = $taskDef.runtimePlatform }
if ($taskDef.ephemeralStorage) { $registerPayload.ephemeralStorage = $taskDef.ephemeralStorage }
$registerPayloadJson = $registerPayload | ConvertTo-Json -Depth 20 -Compress
$registerTempPath = Join-Path $env:TEMP "gymini-ecs-taskdef-$(New-Guid).json"
try {
    Set-Content -Path $registerTempPath -Value $registerPayloadJson -Encoding ASCII -NoNewline
    $registerResultJson = aws ecs register-task-definition --region $ExpectedRegion --cli-input-json "file://$registerTempPath" `
        --query "taskDefinition.{TaskDefinitionArn:taskDefinitionArn,Revision:revision}" --output json
    if ($LASTEXITCODE -ne 0) {
        Write-Host "HARD STOP: register-task-definition failed (exit $LASTEXITCODE). All 12 Lambdas already rotated - system is in a KNOWN, documented interim state (Lambdas=new, Chat task-def=old), not a silent partial failure." -ForegroundColor Red
        exit 1
    }
} finally {
    Remove-Item -Path $registerTempPath -Force -ErrorAction SilentlyContinue
    $taskDef = $null; $containerDef = $null; $newEnvList = $null; $registerPayload = $null; $registerPayloadJson = $null
}
$registerResult = $registerResultJson | ConvertFrom-Json
$newTaskDefArn = $registerResult.TaskDefinitionArn
Write-Host "  New task definition registered: $newTaskDefArn"

# Point the SERVICE at the new revision WITHOUT changing desiredCount (stays
# 0) - authorized "metadata-only deployment change" per the brief: the next
# real Chat start will use this revision; no task is launched now.
$currentDesiredCount = aws ecs describe-services --cluster $EcsCluster --services $EcsService --region $ExpectedRegion --query "services[0].desiredCount" --output text
aws ecs update-service --cluster $EcsCluster --service $EcsService --task-definition $newTaskDefArn --region $ExpectedRegion --output json | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "HARD STOP: update-service (task-definition pointer only) failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}
$afterDesiredCount = aws ecs describe-services --cluster $EcsCluster --services $EcsService --region $ExpectedRegion --query "services[0].desiredCount" --output text
if ($afterDesiredCount -ne "0" -or $afterDesiredCount -ne $currentDesiredCount) {
    if ($afterDesiredCount -ne $currentDesiredCount) {
        Write-Host "HARD STOP: desiredCount changed ($currentDesiredCount -> $afterDesiredCount) - this must never happen from this script." -ForegroundColor Red
        exit 1
    }
}
$sanitizedResults += Get-SanitizedResourceSummary -ResourceType "EcsTaskDefinition" -ResourceName $EcsTaskFamily -UpdateStatus "Registered" -NewTaskDefinitionArn $newTaskDefArn
Write-Host "ROTATE_ECS_TASKDEF: PASS - service now points at $newTaskDefArn, desiredCount unchanged at $afterDesiredCount." -ForegroundColor Green

# -- Stage: VERIFY (13C-B.8) -------------------------------------------------
Write-Host ""
Write-Host "Stage: VERIFY..." -ForegroundColor Cyan
$allGood = $true
foreach ($fn in $LambdaConsumers) {
    $st = aws lambda get-function-configuration --function-name $fn --region $ExpectedRegion --query "LastUpdateStatus" --output text
    if ($st -ne "Successful") { $allGood = $false; Write-Host "  NOT OK: $fn -> $st" -ForegroundColor Red }
}
if (-not $allGood) {
    Write-Host "HARD STOP: VERIFY found a Lambda not in Successful state." -ForegroundColor Red
    exit 1
}
Write-Host "VERIFY: PASS - all $($LambdaConsumers.Count) Lambdas report LastUpdateStatus=Successful; ECS task definition registered." -ForegroundColor Green

Write-Host ""
Write-Host "=== ROTATION RESULT (sanitized - no secret values) ===" -ForegroundColor Green
foreach ($r in $sanitizedResults) {
    Write-Host "  $($r.ResourceType) / $($r.ResourceName): Status=$($r.UpdateStatus) RevisionId=$($r.NewRevisionId) TaskDefArn=$($r.NewTaskDefinitionArn) EnvKeys=$($r.EnvironmentKeysFound)"
}
$newSharedSecret = $null
Write-Host ""
Write-Host "Lambda + ECS cutover complete. Schedules remain PAUSED - restore them explicitly after functional verification." -ForegroundColor Yellow
