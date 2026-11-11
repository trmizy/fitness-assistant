<#
.SYNOPSIS
  Phase 16A.2R - makes CloudFormation (not a direct `apigatewayv2
  update-integration` call) authoritative for ChatIntegration's
  IntegrationUri in the fitness-assistant-dev-api-gateway stack.

.DESCRIPTION
  Root cause this closes: the on-demand Chat ALB (gymini-dev-on-demand) is
  destroyed and recreated with a brand-new, randomly-suffixed DNS hostname
  every dev-stop/dev-start cycle. dev-start.ps1 used to repair the live
  ChatIntegration directly via `aws apigatewayv2 update-integration` -
  correct for the live resource, but invisible to CloudFormation, so the
  stack's own `ChatAlbDnsName` parameter went stale every time, and
  CloudFormation's native drift detection can't catch it either
  (AWS::ApiGatewayV2::Integration does not support drift detection at all -
  see docs/deployment/AWS_DEV_CFN_NORMAL_UPDATE_CERTIFICATION_2026-10-12.md).

  This module provides the DECISION logic as pure, unit-tested functions
  (no AWS calls - see ChatIntegrationSync.Tests.ps1) and reuses the Phase
  16A.1-certified change-set safety/digest functions from
  scripts/ci/CiHelpers.psm1 rather than re-implementing that policy here.
  The actual AWS orchestration (create/inspect/execute the change set) is a
  separate, explicitly-named function so the pure decision logic can be
  tested with zero AWS access.
#>

Import-Module (Join-Path $PSScriptRoot "..\..\..\ci\CiHelpers.psm1") -Force

# ---------------------------------------------------------------------------
# 16A.2R.11 cases 1, 2, 13, 14 - pure, no AWS calls.
# ---------------------------------------------------------------------------
<#
.SYNOPSIS
  Decides whether the stack's ChatAlbDnsName parameter needs reconciling
  against the real, current ALB DNS. Fails closed (SyncNeeded=$true,
  FailClosed=$true) on any input it cannot resolve - never silently
  "nothing to do" on missing/ambiguous data.
#>
function Test-ChatAlbSyncNeeded {
    param(
        [string]$CurrentAlbDns,
        [string]$StackChatAlbDnsName
    )
    if ([string]::IsNullOrWhiteSpace($CurrentAlbDns)) {
        return [pscustomobject]@{ SyncNeeded = $true; FailClosed = $true; Reason = 'ALB_LOOKUP_FAILED' }
    }
    if ([string]::IsNullOrWhiteSpace($StackChatAlbDnsName)) {
        return [pscustomobject]@{ SyncNeeded = $true; FailClosed = $true; Reason = 'STACK_PARAMETER_MISSING' }
    }
    if ($CurrentAlbDns -eq $StackChatAlbDnsName) {
        return [pscustomobject]@{ SyncNeeded = $false; FailClosed = $false; Reason = 'ALREADY_IN_SYNC' }
    }
    [pscustomobject]@{ SyncNeeded = $true; FailClosed = $false; Reason = 'ALB_DNS_CHANGED' }
}

# ---------------------------------------------------------------------------
# 16A.2R.5/6/7/11 cases 3-9 - pure, no AWS calls. Stricter than
# Test-ChangeSetSafety alone: this reconciliation is allowed ONLY if the
# change set is empty, or contains EXACTLY one Modify of ChatIntegration
# with Replacement=False. Reuses (never duplicates) the certified
# Test-ChangeSetSafety for the underlying API-ID/destructive-action policy,
# then applies the extra, narrower constraint on top.
#>
function Test-ChatReconciliationChangeSet {
    param(
        [array]$Changes = @(),
        [string]$ProtectedApiId = 'id1iz7upbl',
        [hashtable]$ParameterValues = @{},
        [string]$ReviewedDigest,
        [string]$ActualDigest
    )
    if ($ReviewedDigest -or $ActualDigest) {
        $d = Test-ChangeSetDigest -ActualDigest $ActualDigest -ReviewedDigest $ReviewedDigest
        if (-not $d.Match) {
            return [pscustomobject]@{ Allowed = $false; Reason = $d.Rule; Safety = $null }
        }
    }

    $safety = Test-ChangeSetSafety -Changes $Changes -ProtectedApiId $ProtectedApiId -ParameterValues $ParameterValues
    if ($safety.Verdict -eq 'BLOCK') {
        return [pscustomobject]@{ Allowed = $false; Reason = 'SAFETY_WRAPPER_BLOCK'; Safety = $safety }
    }

    $norm = @(foreach ($c in @($Changes)) {
        $rc = if ($c.ResourceChange) { $c.ResourceChange } else { $c }
        [pscustomobject]@{
            Action            = $rc.Action
            ResourceType      = $rc.ResourceType
            LogicalResourceId = $rc.LogicalResourceId
            Replacement       = [string]$rc.Replacement
        }
    })

    if ($norm.Count -eq 0) {
        return [pscustomobject]@{ Allowed = $true; Reason = 'NO_CHANGE'; Safety = $safety }
    }

    $isChatIntegrationModifyOnly = (
        $norm.Count -eq 1 -and
        $norm[0].LogicalResourceId -eq 'ChatIntegration' -and
        $norm[0].ResourceType -eq 'AWS::ApiGatewayV2::Integration' -and
        $norm[0].Action -eq 'Modify' -and
        $norm[0].Replacement -notin @('True', 'Conditional')
    )
    if ($isChatIntegrationModifyOnly) {
        return [pscustomobject]@{ Allowed = $true; Reason = 'CHAT_INTEGRATION_MODIFY_ONLY'; Safety = $safety }
    }

    [pscustomobject]@{ Allowed = $false; Reason = 'UNEXPECTED_ACTIONS'; Safety = $safety; Changes = $norm }
}

# ---------------------------------------------------------------------------
# 16A.2R.10 - custom per-integration drift guard. CloudFormation's native
# drift detection silently excludes every AWS::ApiGatewayV2::Integration
# resource (confirmed empirically, Phase 16A.2) - this complements it, never
# replaces it. Pure comparison function; the caller supplies the real data
# (live IntegrationUri per integration + each one's expected target).
# ---------------------------------------------------------------------------
function Compare-IntegrationTargets {
    param(
        [Parameter(Mandatory)] [hashtable]$LiveTargets,    # IntegrationId -> actual IntegrationUri/function name
        [Parameter(Mandatory)] [hashtable]$ExpectedTargets # IntegrationId -> expected value (same shape)
    )
    $drifted = [System.Collections.Generic.List[object]]::new()
    $checked = 0
    foreach ($id in $ExpectedTargets.Keys) {
        $checked++
        $live = $LiveTargets[$id]
        $expected = $ExpectedTargets[$id]
        if ($null -eq $live -or $live -ne $expected) {
            $drifted.Add([pscustomobject]@{ IntegrationId = $id; Live = $live; Expected = $expected })
        }
    }
    [pscustomobject]@{
        TotalChecked = $checked
        DriftedCount = $drifted.Count
        Drifted      = @($drifted)
        AllInSync    = ($drifted.Count -eq 0)
    }
}

# ---------------------------------------------------------------------------
# 16A.2R.4 - the real AWS orchestration. NOT unit-testable without AWS (by
# nature - it calls CloudFormation/apigatewayv2 directly) - the decision
# logic it delegates to (above) is what's unit-tested. Default is a dry
# PLAN only; -Execute is required to actually run execute-change-set.
# #>
function Sync-ChatApiGatewayIntegration {
    param(
        [Parameter(Mandatory)] [string]$ApiGatewayStackName,
        [Parameter(Mandatory)] [string]$CurrentAlbDns,
        [Parameter(Mandatory)] [string]$TemplatePath,
        [string]$ProtectedApiId = 'id1iz7upbl',
        [string]$Region = 'ap-southeast-1',
        [switch]$Execute
    )
    $stack = aws cloudformation describe-stacks --stack-name $ApiGatewayStackName --region $Region --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ Status = 'FAIL'; Reason = 'STACK_READ_FAILED' } }
    $params = @{}
    foreach ($p in $stack.Stacks[0].Parameters) { $params[$p.ParameterKey] = $p.ParameterValue }
    $stackChatAlbDnsName = $params['ChatAlbDnsName']

    $syncCheck = Test-ChatAlbSyncNeeded -CurrentAlbDns $CurrentAlbDns -StackChatAlbDnsName $stackChatAlbDnsName
    if (-not $syncCheck.SyncNeeded) {
        return [pscustomobject]@{ Status = 'NO_SYNC_NEEDED'; Reason = $syncCheck.Reason }
    }
    if ($syncCheck.FailClosed) {
        return [pscustomobject]@{ Status = 'FAIL'; Reason = $syncCheck.Reason }
    }

    $newParams = @($params.Keys | ForEach-Object {
        $key = $_
        $value = if ($key -eq 'ChatAlbDnsName') { $CurrentAlbDns } else { $params[$key] }
        "ParameterKey=$key,ParameterValue=$value"
    })
    $csName = "chat-alb-sync-$(Get-Date -Format yyyyMMddHHmmss)"
    aws cloudformation create-change-set --stack-name $ApiGatewayStackName --change-set-name $csName `
        --change-set-type UPDATE --template-body "file://$TemplatePath" --capabilities CAPABILITY_AUTO_EXPAND `
        --parameters $newParams --region $Region --output json | Out-Null
    if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ Status = 'FAIL'; Reason = 'CHANGE_SET_CREATE_FAILED'; ChangeSetName = $csName } }
    aws cloudformation wait change-set-create-complete --stack-name $ApiGatewayStackName --change-set-name $csName --region $Region 2>&1 | Out-Null

    $full = aws cloudformation describe-change-set --stack-name $ApiGatewayStackName --change-set-name $csName --region $Region --output json | ConvertFrom-Json
    if ($full.Status -eq 'FAILED' -and $full.StatusReason -match "didn't contain changes|No updates") {
        return [pscustomobject]@{ Status = 'NO_OP'; Reason = 'CLOUDFORMATION_REPORTED_NO_CHANGE'; ChangeSetName = $csName }
    }
    if ($full.Status -ne 'CREATE_COMPLETE') {
        return [pscustomobject]@{ Status = 'FAIL'; Reason = "CHANGE_SET_STATUS_$($full.Status)"; ChangeSetName = $csName; Detail = $full.StatusReason }
    }

    $actualApiId = ($full.Parameters | Where-Object { $_.ParameterKey -eq 'HttpApiId' }).ParameterValue
    $plan = Test-ChatReconciliationChangeSet -Changes $full.Changes -ProtectedApiId $ProtectedApiId -ParameterValues @{ HttpApiId = $actualApiId }
    if (-not $plan.Allowed) {
        return [pscustomobject]@{ Status = 'BLOCKED'; Reason = $plan.Reason; ChangeSetName = $csName; Plan = $plan }
    }

    if (-not $Execute) {
        return [pscustomobject]@{ Status = 'PLANNED_SAFE'; Reason = $plan.Reason; ChangeSetName = $csName; Plan = $plan }
    }

    aws cloudformation execute-change-set --stack-name $ApiGatewayStackName --change-set-name $csName --region $Region --output json | Out-Null
    if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ Status = 'FAIL'; Reason = 'EXECUTE_FAILED'; ChangeSetName = $csName } }
    aws cloudformation wait stack-update-complete --stack-name $ApiGatewayStackName --region $Region 2>&1 | Out-Null
    $finalStatus = aws cloudformation describe-stacks --stack-name $ApiGatewayStackName --region $Region --query "Stacks[0].StackStatus" --output text
    [pscustomobject]@{ Status = 'EXECUTED'; Reason = $plan.Reason; ChangeSetName = $csName; Plan = $plan; StackStatus = $finalStatus }
}

Export-ModuleMember -Function @(
    'Test-ChatAlbSyncNeeded',
    'Test-ChatReconciliationChangeSet',
    'Compare-IntegrationTargets',
    'Sync-ChatApiGatewayIntegration'
)
