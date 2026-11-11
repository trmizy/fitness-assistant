<#
.SYNOPSIS
  Phase 16A.3 - CloudFormation template SEMANTIC guard. Complements (never
  replaces) the existing change-set resource guard (Test-ChangeSetSafety in
  CiHelpers.psm1): that guard inspects `describe-change-set`'s `.Changes`
  array, which only ever lists RESOURCE-level actions. Phase 16A.2R showed
  this is a real blind spot - CloudFormation silently applies Outputs
  changes (and, by the same mechanism, Parameters/Conditions/Mappings/
  Transform/Rules/Metadata definition changes) without ever putting them in
  `.Changes`. This module reads the TEMPLATE itself (current deployed vs.
  proposed) and classifies every section that can change stack behavior.

  Reuses (never duplicates) CiHelpers.psm1's Find-SecretLikeOutput for the
  "does this Output expression look like it references a secret" check.
#>
Import-Module (Join-Path $PSScriptRoot "CiHelpers.psm1") -Force

function Get-Prop {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $p = $Object.PSObject.Properties[$Name]
    if ($null -ne $p) { return $p.Value }
    return $null
}

function Get-PropertyNames {
    param($Object)
    if ($null -eq $Object) { return @() }
    if ($Object -is [System.Collections.IDictionary]) { return @($Object.Keys) }
    return @($Object.PSObject.Properties.Name)
}

function ConvertTo-CanonicalJson {
    param($Value)
    if ($null -eq $Value) { return "null" }
    ($Value | ConvertTo-Json -Depth 50 -Compress)
}

# ---------------------------------------------------------------------------
# 16A.3.1/16A.3.4 - extracts the semantic model from a real template file by
# shelling out to the narrow, read-only Node adapter (cfn-template-semantics.mjs).
# Never resolves intrinsic functions or secrets; preserves them as tagged
# structural placeholders. Also computes a semantic digest (sha256 of the
# canonical JSON) so artifact identity can be proven without relying on raw
# byte equality (which whitespace/comment/YAML-vs-JSON differences would
# wrongly fail).
# ---------------------------------------------------------------------------
function Get-TemplateSemanticModel {
    param([Parameter(Mandatory)] [string]$TemplatePath)
    if (-not (Test-Path $TemplatePath)) {
        return [pscustomobject]@{ Success = $false; Error = 'TEMPLATE_NOT_FOUND'; Model = $null; Digest = $null }
    }
    $scriptPath = Join-Path $PSScriptRoot "cfn-template-semantics.mjs"
    $json = node $scriptPath $TemplatePath 2>&1
    if ($LASTEXITCODE -ne 0) {
        return [pscustomobject]@{ Success = $false; Error = "PARSE_FAILED: $json"; Model = $null; Digest = $null }
    }
    $model = $json | ConvertFrom-Json
    $digest = [System.BitConverter]::ToString(
        [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes([string]$json))
    ).Replace('-', '').ToLowerInvariant()
    [pscustomobject]@{ Success = $true; Error = $null; Model = $model; Digest = $digest }
}

# ---------------------------------------------------------------------------
# 16A.3.6 - per-Output classification (Add/Modify/Remove), export-name-change
# detection, and a secret-reference sanity check. Pure, no AWS/file access.
# ---------------------------------------------------------------------------
function Compare-TemplateOutputs {
    param($Current, $Proposed)
    # @() at the CALL SITE, not only inside Get-PropertyNames itself - a
    # single-element return value does not survive PowerShell's own
    # pipeline/return unwrapping otherwise (confirmed empirically: a
    # single-property object's names came back as a bare [string], not a
    # 1-element array, making `+` concatenate text instead of unioning
    # arrays - the same class of bug as Phase 16A.1's Where-Object/.Count
    # unwrap, here hitting `+` instead).
    $currentNames = @(Get-PropertyNames $Current)
    $proposedNames = @(Get-PropertyNames $Proposed)
    $allNames = @($currentNames + $proposedNames | Sort-Object -Unique)
    $changes = [System.Collections.Generic.List[object]]::new()

    foreach ($name in $allNames) {
        $inCurrent = $currentNames -contains $name
        $inProposed = $proposedNames -contains $name

        if ($inCurrent -and -not $inProposed) {
            $changes.Add([pscustomobject]@{ Name = $name; ChangeType = 'REMOVE'; Blocked = $true; Reason = 'OUTPUT_REMOVAL_BLOCKED' })
            continue
        }
        if (-not $inCurrent -and $inProposed) {
            $val = Get-Prop $Proposed $name
            $secretHit = @(Find-SecretLikeOutput -Text (ConvertTo-CanonicalJson (Get-Prop $val 'Value')))
            if ($secretHit.Count -gt 0) {
                $changes.Add([pscustomobject]@{ Name = $name; ChangeType = 'ADD'; Blocked = $true; Reason = 'SUSPICIOUS_SECRET_REFERENCE' })
            } else {
                $changes.Add([pscustomobject]@{ Name = $name; ChangeType = 'ADD'; Blocked = $false; Reason = 'OUTPUT_ADDED_NEEDS_VISIBLE_APPROVAL' })
            }
            continue
        }

        $curVal = Get-Prop $Current $name
        $propVal = Get-Prop $Proposed $name
        $curJson = ConvertTo-CanonicalJson $curVal
        $propJson = ConvertTo-CanonicalJson $propVal
        if ($curJson -eq $propJson) { continue }

        $curExport = ConvertTo-CanonicalJson (Get-Prop $curVal 'Export')
        $propExport = ConvertTo-CanonicalJson (Get-Prop $propVal 'Export')
        if ($curExport -ne $propExport) {
            $changes.Add([pscustomobject]@{ Name = $name; ChangeType = 'MODIFY'; Blocked = $true; Reason = 'EXPORT_NAME_CHANGE_BLOCKED' })
            continue
        }
        $secretHit = @(Find-SecretLikeOutput -Text (ConvertTo-CanonicalJson (Get-Prop $propVal 'Value')))
        if ($secretHit.Count -gt 0) {
            $changes.Add([pscustomobject]@{ Name = $name; ChangeType = 'MODIFY'; Blocked = $true; Reason = 'SUSPICIOUS_SECRET_REFERENCE' })
            continue
        }
        $changes.Add([pscustomobject]@{ Name = $name; ChangeType = 'MODIFY'; Blocked = $false; Reason = 'OUTPUT_MODIFIED_NEEDS_VISIBLE_APPROVAL' })
    }

    [pscustomobject]@{
        Changes   = @($changes)
        AnyBlocked = (@($changes | Where-Object { $_.Blocked }).Count -gt 0)
    }
}

# ---------------------------------------------------------------------------
# 16A.3.3/16A.3.5 - the main comparator. Classifies every top-level section;
# an unrecognized section on either side fails closed (never silently
# ignored). Resources are flagged here too (RESOURCE_CHANGE) but this is
# explicitly a COMPLEMENT to, never a replacement for, Test-ChangeSetSafety's
# own authoritative resource-action judgment - see the module synopsis.
# ---------------------------------------------------------------------------
function Compare-TemplateSemantics {
    param(
        [Parameter(Mandatory)] $Current,
        [Parameter(Mandatory)] $Proposed
    )
    $findings = [System.Collections.Generic.List[object]]::new()

    $unknown = @(@(Get-Prop $Current 'UnknownTopLevelSections') + @(Get-Prop $Proposed 'UnknownTopLevelSections') | Sort-Object -Unique)
    if ($unknown.Count -gt 0) {
        $findings.Add([pscustomobject]@{ Category = 'UNKNOWN_SECTION'; Severity = 'FAIL_CLOSED'; Detail = $unknown })
    }

    $sectionMap = @{
        Resources  = 'RESOURCE_CHANGE'
        Parameters = 'PARAMETER_CHANGE'
        Conditions = 'CONDITION_CHANGE'
        Mappings   = 'MAPPING_CHANGE'
        Transform  = 'TRANSFORM_CHANGE'
        Rules      = 'RULE_CHANGE'
    }
    foreach ($section in $sectionMap.Keys) {
        $curVal = Get-Prop $Current $section
        $propVal = Get-Prop $Proposed $section
        if ((ConvertTo-CanonicalJson $curVal) -ne (ConvertTo-CanonicalJson $propVal)) {
            $findings.Add([pscustomobject]@{ Category = $sectionMap[$section]; Severity = 'EXPLICIT_REVIEW' })
        }
    }

    $metadataChanged = (ConvertTo-CanonicalJson (Get-Prop $Current 'Metadata')) -ne (ConvertTo-CanonicalJson (Get-Prop $Proposed 'Metadata'))
    if ($metadataChanged) {
        $findings.Add([pscustomobject]@{ Category = 'METADATA_ONLY_CHANGE'; Severity = 'INFORMATIONAL' })
    }

    $outputDiff = Compare-TemplateOutputs -Current (Get-Prop $Current 'Outputs') -Proposed (Get-Prop $Proposed 'Outputs')
    if ($outputDiff.Changes.Count -gt 0) {
        $findings.Add([pscustomobject]@{ Category = 'OUTPUT_CHANGE'; Severity = 'EXPLICIT_REVIEW'; Detail = $outputDiff })
    }

    $nonMetadata = @($findings | Where-Object { $_.Category -ne 'METADATA_ONLY_CHANGE' })
    $hasFailClosed = @($findings | Where-Object { $_.Severity -eq 'FAIL_CLOSED' }).Count -gt 0
    $hasBlockedOutput = $outputDiff.AnyBlocked

    $overall =
        if ($hasFailClosed) { 'FAIL_CLOSED' }
        elseif ($hasBlockedOutput) { 'BLOCK' }
        elseif ($findings.Count -eq 0) { 'NO_SEMANTIC_CHANGE' }
        elseif ($nonMetadata.Count -eq 0) { 'METADATA_ONLY_CHANGE' }
        else { 'SEMANTIC_CHANGE' }

    [pscustomobject]@{
        Overall    = $overall
        Findings   = @($findings)
        OutputDiff = $outputDiff
    }
}

# ---------------------------------------------------------------------------
# 16A.3.8 - plan/apply TEMPLATE binding, parallel to CiHelpers.psm1's
# Test-ChangeSetDigest (change-set binding). Commit binding is optional
# (NOT_USED) since no draft workflow currently threads a source commit SHA
# into the apply step - documented as a future hardening, not invented here.
# ---------------------------------------------------------------------------
function Test-TemplateBindingMatch {
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$ReviewedTemplateDigest,
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$ActualTemplateDigest,
        [AllowEmptyString()] [string]$ReviewedCommit,
        [AllowEmptyString()] [string]$ActualCommit
    )
    if ([string]::IsNullOrWhiteSpace($ReviewedTemplateDigest) -or [string]::IsNullOrWhiteSpace($ActualTemplateDigest)) {
        return [pscustomobject]@{ Match = $false; Rule = 'TEMPLATE_DIGEST_MISSING' }
    }
    if ($ReviewedTemplateDigest.Trim().ToLowerInvariant() -ne $ActualTemplateDigest.Trim().ToLowerInvariant()) {
        return [pscustomobject]@{ Match = $false; Rule = 'TEMPLATE_DIGEST_MISMATCH' }
    }
    if ($ReviewedCommit -or $ActualCommit) {
        if ([string]::IsNullOrWhiteSpace($ReviewedCommit) -or [string]::IsNullOrWhiteSpace($ActualCommit)) {
            return [pscustomobject]@{ Match = $false; Rule = 'COMMIT_BINDING_MISSING' }
        }
        if ($ReviewedCommit -ne $ActualCommit) {
            return [pscustomobject]@{ Match = $false; Rule = 'COMMIT_MISMATCH' }
        }
    }
    [pscustomobject]@{ Match = $true; Rule = 'OK' }
}

Export-ModuleMember -Function @(
    'Get-TemplateSemanticModel',
    'Compare-TemplateOutputs',
    'Compare-TemplateSemantics',
    'Test-TemplateBindingMatch'
)
