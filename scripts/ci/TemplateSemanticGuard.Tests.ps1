<#
.SYNOPSIS
  Phase 16A.3 regression tests for TemplateSemanticGuard.psm1. Pester 3.x
  syntax (matches the repo's existing *.Tests.ps1 files).
  Run: Invoke-Pester scripts/ci/TemplateSemanticGuard.Tests.ps1
#>
Import-Module (Join-Path $PSScriptRoot "TemplateSemanticGuard.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "CiHelpers.psm1") -Force

function New-BaseModel {
    [pscustomobject]@{
        Transform = "AWS::LanguageExtensions"
        Parameters = [pscustomobject]@{ HttpApiId = [pscustomobject]@{ Type = "String"; Default = "id1iz7upbl" } }
        Mappings = [pscustomobject]@{}
        Conditions = [pscustomobject]@{}
        Resources = [pscustomobject]@{ R1 = [pscustomobject]@{ Type = "AWS::ApiGatewayV2::Route"; Properties = [pscustomobject]@{ RouteKey = "GET /x" } } }
        Outputs = [pscustomobject]@{ HttpApiIdOut = [pscustomobject]@{ Value = [pscustomobject]@{ __fn = "Ref"; value = "HttpApiId" } } }
        Rules = [pscustomobject]@{}
        Metadata = [pscustomobject]@{}
        UnknownTopLevelSections = @()
    }
}
function Copy-Model($m) { $m | ConvertTo-Json -Depth 50 | ConvertFrom-Json }

Describe "Get-TemplateSemanticModel (real end-to-end YAML/JSON parsing, cases 1-3)" {
    $yamlA = Join-Path $TestDrive "a.yaml"
    $yamlB = Join-Path $TestDrive "b.yaml"
    $jsonC = Join-Path $TestDrive "c.json"
    Set-Content -Path $yamlA -Encoding utf8 -Value @'
AWSTemplateFormatVersion: "2010-09-09"
Parameters:
  HttpApiId:
    Type: String
    Default: id1iz7upbl
Resources:
  R1:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      RouteKey: "GET /x"
      Target: !Sub "integrations/${X}"
Outputs:
  HttpApiIdOut:
    Value: !Ref HttpApiId
'@
    Set-Content -Path $yamlB -Encoding utf8 -Value @'
AWSTemplateFormatVersion: "2010-09-09"
# a totally unrelated comment, added for no reason
Parameters:
  HttpApiId:
    Type: String
    Default: id1iz7upbl


Resources:
  R1:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      RouteKey: "GET /x"      # trailing comment
      Target: !Sub "integrations/${X}"
Outputs:
  HttpApiIdOut:
    Value: !Ref HttpApiId
'@
    Set-Content -Path $jsonC -Encoding utf8 -Value (@'
{
  "AWSTemplateFormatVersion": "2010-09-09",
  "Parameters": { "HttpApiId": { "Type": "String", "Default": "id1iz7upbl" } },
  "Resources": { "R1": { "Type": "AWS::ApiGatewayV2::Route", "Properties": { "RouteKey": "GET /x", "Target": { "Fn::Sub": "integrations/${X}" } } } },
  "Outputs": { "HttpApiIdOut": { "Value": { "Ref": "HttpApiId" } } }
}
'@)

    It "1) identical templates -> NO_SEMANTIC_CHANGE" {
        $a = Get-TemplateSemanticModel -TemplatePath $yamlA
        $a.Success | Should Be $true
        $again = Get-TemplateSemanticModel -TemplatePath $yamlA
        $r = Compare-TemplateSemantics -Current $a.Model -Proposed $again.Model
        $r.Overall | Should Be "NO_SEMANTIC_CHANGE"
        $a.Digest | Should Be $again.Digest
    }
    It "2) whitespace/comment-only difference -> NO_SEMANTIC_CHANGE" {
        $a = Get-TemplateSemanticModel -TemplatePath $yamlA
        $b = Get-TemplateSemanticModel -TemplatePath $yamlB
        $a.Success | Should Be $true
        $b.Success | Should Be $true
        $r = Compare-TemplateSemantics -Current $a.Model -Proposed $b.Model
        $r.Overall | Should Be "NO_SEMANTIC_CHANGE"
    }
    It "3) YAML vs semantically-equivalent JSON -> NO_SEMANTIC_CHANGE" {
        $a = Get-TemplateSemanticModel -TemplatePath $yamlA
        $c = Get-TemplateSemanticModel -TemplatePath $jsonC
        $a.Success | Should Be $true
        $c.Success | Should Be $true
        $r = Compare-TemplateSemantics -Current $a.Model -Proposed $c.Model
        $r.Overall | Should Be "NO_SEMANTIC_CHANGE"
    }
    It "19) the real canonical template's HttpApiIdOut Output is present and self-consistent" {
        $real = Join-Path $PSScriptRoot "..\..\infra\cloudformation\api-gateway-baseline.yaml"
        $m = Get-TemplateSemanticModel -TemplatePath $real
        $m.Success | Should Be $true
        ($m.Model.Outputs.PSObject.Properties.Name) -contains "HttpApiIdOut" | Should Be $true
        $r = Compare-TemplateSemantics -Current $m.Model -Proposed $m.Model
        $r.Overall | Should Be "NO_SEMANTIC_CHANGE"
    }
}

Describe "Compare-TemplateSemantics (synthetic, cases 4-14, 20)" {
    It "4) Output added -> OUTPUT_CHANGE detected" {
        $cur = New-BaseModel
        $prop = Copy-Model $cur
        $prop.Outputs | Add-Member -NotePropertyName "NewOut" -NotePropertyValue ([pscustomobject]@{ Value = "x" })
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        @($r.Findings | Where-Object Category -eq "OUTPUT_CHANGE").Count | Should Be 1
        $r.OutputDiff.Changes[0].ChangeType | Should Be "ADD"
    }
    It "5) Output modified -> OUTPUT_CHANGE detected" {
        $cur = New-BaseModel
        $prop = Copy-Model $cur
        $prop.Outputs.HttpApiIdOut.Value.value = "SomethingElse"
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        @($r.Findings | Where-Object Category -eq "OUTPUT_CHANGE").Count | Should Be 1
        $r.OutputDiff.Changes[0].ChangeType | Should Be "MODIFY"
    }
    It "6) Output removed -> OUTPUT_CHANGE detected and BLOCKED" {
        $cur = New-BaseModel
        $prop = Copy-Model $cur
        $prop.Outputs.PSObject.Properties.Remove("HttpApiIdOut")
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        $r.Overall | Should Be "BLOCK"
        $r.OutputDiff.Changes[0].ChangeType | Should Be "REMOVE"
        $r.OutputDiff.Changes[0].Blocked | Should Be $true
    }
    It "7) Output Export name changed -> BLOCK / manual-review-required" {
        $cur = New-BaseModel
        $cur.Outputs.HttpApiIdOut | Add-Member -NotePropertyName "Export" -NotePropertyValue ([pscustomobject]@{ Name = "OldExport" })
        $prop = Copy-Model $cur
        $prop.Outputs.HttpApiIdOut.Export.Name = "NewExport"
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        $r.Overall | Should Be "BLOCK"
        $r.OutputDiff.Changes[0].Reason | Should Be "EXPORT_NAME_CHANGE_BLOCKED"
    }
    It "8) Resource property changed -> RESOURCE_CHANGE detected" {
        $cur = New-BaseModel
        $prop = Copy-Model $cur
        $prop.Resources.R1.Properties.RouteKey = "GET /y"
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        @($r.Findings | Where-Object Category -eq "RESOURCE_CHANGE").Count | Should Be 1
        $r.Overall | Should Be "SEMANTIC_CHANGE"
    }
    It "9) Parameter default changed -> PARAMETER_CHANGE detected" {
        $cur = New-BaseModel
        $prop = Copy-Model $cur
        $prop.Parameters.HttpApiId.Default = "differentid"
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        @($r.Findings | Where-Object Category -eq "PARAMETER_CHANGE").Count | Should Be 1
    }
    It "10) Condition changed -> CONDITION_CHANGE detected" {
        $cur = New-BaseModel
        $prop = Copy-Model $cur
        $prop.Conditions | Add-Member -NotePropertyName "IsProd" -NotePropertyValue ([pscustomobject]@{ __fn = "Equals"; value = @("a","b") })
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        @($r.Findings | Where-Object Category -eq "CONDITION_CHANGE").Count | Should Be 1
    }
    It "11) Mapping changed -> MAPPING_CHANGE detected" {
        $cur = New-BaseModel
        $prop = Copy-Model $cur
        $prop.Mappings | Add-Member -NotePropertyName "RegionMap" -NotePropertyValue ([pscustomobject]@{ a = [pscustomobject]@{ b = "c" } })
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        @($r.Findings | Where-Object Category -eq "MAPPING_CHANGE").Count | Should Be 1
    }
    It "12) Transform changed -> TRANSFORM_CHANGE detected" {
        $cur = New-BaseModel
        $prop = Copy-Model $cur
        $prop.Transform = "AWS::Serverless-2016-10-31"
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        @($r.Findings | Where-Object Category -eq "TRANSFORM_CHANGE").Count | Should Be 1
    }
    It "13) Metadata-only change -> correctly classified, not BLOCK/SEMANTIC_CHANGE" {
        $cur = New-BaseModel
        $prop = Copy-Model $cur
        $prop.Metadata | Add-Member -NotePropertyName "Note" -NotePropertyValue "just a comment field"
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        $r.Overall | Should Be "METADATA_ONLY_CHANGE"
    }
    It "14) unknown template section -> fail closed" {
        $cur = New-BaseModel
        $prop = Copy-Model $cur
        $prop.UnknownTopLevelSections = @("SomeFutureCfnFeatureThisToolDoesNotKnowAboutYet")
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        $r.Overall | Should Be "FAIL_CLOSED"
    }
    It "20) MANDATORY - Phase 16A.2R reproduction: Changes=[] but Outputs gains HttpApiIdOut must NOT be a full no-op" {
        $cur = New-BaseModel
        $cur.Outputs = [pscustomobject]@{}   # before: no Outputs at all (pre-16A.2R baseline)
        $prop = New-BaseModel                 # after: HttpApiIdOut present (what actually got deployed)
        # Resources identical on both sides - simulating a change-set with Changes=[]
        $prop.Resources = Copy-Model $cur.Resources
        $r = Compare-TemplateSemantics -Current $cur -Proposed $prop
        $r.Overall | Should Not Be "NO_SEMANTIC_CHANGE"
        @($r.Findings | Where-Object Category -eq "OUTPUT_CHANGE").Count | Should Be 1
        $r.OutputDiff.Changes[0].ChangeType | Should Be "ADD"
    }
}

Describe "Test-TemplateBindingMatch (plan/apply template binding, cases 15-16)" {
    It "15) plan template digest != apply template digest -> BLOCK" {
        $r = Test-TemplateBindingMatch -ReviewedTemplateDigest "AAA111" -ActualTemplateDigest "BBB222"
        $r.Match | Should Be $false
        $r.Rule | Should Be "TEMPLATE_DIGEST_MISMATCH"
    }
    It "matching template digest alone (no commit binding used) -> PASS" {
        $r = Test-TemplateBindingMatch -ReviewedTemplateDigest "AAA111" -ActualTemplateDigest "aaa111"
        $r.Match | Should Be $true
    }
    It "16) reviewed commit != apply commit -> BLOCK when commit binding is supplied" {
        $r = Test-TemplateBindingMatch -ReviewedTemplateDigest "AAA111" -ActualTemplateDigest "AAA111" -ReviewedCommit "sha-old" -ActualCommit "sha-new"
        $r.Match | Should Be $false
        $r.Rule | Should Be "COMMIT_MISMATCH"
    }
    It "matching commit binding -> PASS" {
        $r = Test-TemplateBindingMatch -ReviewedTemplateDigest "AAA111" -ActualTemplateDigest "AAA111" -ReviewedCommit "sha-x" -ActualCommit "sha-x"
        $r.Match | Should Be $true
    }
    It "a missing template digest on either side never passes" {
        (Test-TemplateBindingMatch -ReviewedTemplateDigest "" -ActualTemplateDigest "AAA111").Match | Should Be $false
        (Test-TemplateBindingMatch -ReviewedTemplateDigest "AAA111" -ActualTemplateDigest "").Match | Should Be $false
    }
}

Describe "Existing guards remain intact (regression, cases 17-18)" {
    It "17) change-set digest mismatch -> existing Test-ChangeSetDigest guard still BLOCKS" {
        $r = Test-ChangeSetDigest -ActualDigest "AAA" -ReviewedDigest "BBB"
        $r.Match | Should Be $false
        $r.Rule | Should Be "CHANGESET_DIGEST_MISMATCH"
    }
    It "18) API ID mismatch -> existing Test-ChangeSetSafety guard still BLOCKS" {
        $r = Test-ChangeSetSafety -ParameterValues @{ HttpApiId = "wrong-id" } -ProtectedApiId "id1iz7upbl" -Changes @()
        $r.Verdict | Should Be "BLOCK"
        $r.HardBlock | Should Be $true
    }
}
