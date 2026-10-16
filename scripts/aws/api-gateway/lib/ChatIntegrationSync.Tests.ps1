<#
.SYNOPSIS
  Phase 16A.2R regression tests for ChatIntegrationSync.psm1. FAKE metadata
  only - no AWS calls, no network, no repo mutation. Pester 3.x syntax
  (matches the repo's existing *.Tests.ps1 files).
  Run: Invoke-Pester scripts/aws/api-gateway/lib/ChatIntegrationSync.Tests.ps1
#>
Import-Module (Join-Path $PSScriptRoot "ChatIntegrationSync.psm1") -Force

Describe "Test-ChatAlbSyncNeeded (16A.2R case 1, 2, 13, 14)" {
    It "1) Chat ALB DNS == stack parameter -> no sync required" {
        $r = Test-ChatAlbSyncNeeded -CurrentAlbDns "dev-chat-alb-123.elb.amazonaws.com" -StackChatAlbDnsName "dev-chat-alb-123.elb.amazonaws.com"
        $r.SyncNeeded | Should Be $false
        $r.Reason | Should Be "ALREADY_IN_SYNC"
    }
    It "2) Chat ALB DNS != stack parameter -> sync required" {
        $r = Test-ChatAlbSyncNeeded -CurrentAlbDns "dev-chat-alb-NEW.elb.amazonaws.com" -StackChatAlbDnsName "dev-chat-alb-OLD.elb.amazonaws.com"
        $r.SyncNeeded | Should Be $true
        $r.Reason | Should Be "ALB_DNS_CHANGED"
        $r.FailClosed | Should Be $false
    }
    It "13) missing ChatAlbDnsName parameter -> fail closed (sync required, not silently skipped)" {
        $r = Test-ChatAlbSyncNeeded -CurrentAlbDns "dev-chat-alb-123.elb.amazonaws.com" -StackChatAlbDnsName ""
        $r.SyncNeeded | Should Be $true
        $r.FailClosed | Should Be $true
        $r.Reason | Should Be "STACK_PARAMETER_MISSING"
    }
    It "14) ALB lookup failure -> fail closed" {
        $r = Test-ChatAlbSyncNeeded -CurrentAlbDns "" -StackChatAlbDnsName "dev-chat-alb-123.elb.amazonaws.com"
        $r.SyncNeeded | Should Be $true
        $r.FailClosed | Should Be $true
        $r.Reason | Should Be "ALB_LOOKUP_FAILED"
    }
}

Describe "Test-ChatReconciliationChangeSet (16A.2R case 3-9)" {
    $apiOk = @{ HttpApiId = "id1iz7upbl" }
    $chatModify = @(@{ Action = "Modify"; ResourceType = "AWS::ApiGatewayV2::Integration"; LogicalResourceId = "ChatIntegration"; Replacement = "False" })

    It "3) change set contains only ChatIntegration Modify/Replacement=False -> allowed" {
        $r = Test-ChatReconciliationChangeSet -Changes $chatModify -ParameterValues $apiOk
        $r.Allowed | Should Be $true
        $r.Reason | Should Be "CHAT_INTEGRATION_MODIFY_ONLY"
    }
    It "no change at all -> allowed (NO_CHANGE)" {
        $r = Test-ChatReconciliationChangeSet -Changes @() -ParameterValues $apiOk
        $r.Allowed | Should Be $true
        $r.Reason | Should Be "NO_CHANGE"
    }
    It "4) an additional Integration Modify alongside ChatIntegration -> blocked" {
        $changes = $chatModify + @(@{ Action = "Modify"; ResourceType = "AWS::ApiGatewayV2::Integration"; LogicalResourceId = "UserIntegration"; Replacement = "False" })
        $r = Test-ChatReconciliationChangeSet -Changes $changes -ParameterValues $apiOk
        $r.Allowed | Should Be $false
        $r.Reason | Should Be "UNEXPECTED_ACTIONS"
    }
    It "5) a Route Modify alongside ChatIntegration -> blocked" {
        $changes = $chatModify + @(@{ Action = "Modify"; ResourceType = "AWS::ApiGatewayV2::Route"; LogicalResourceId = "SomeRoute"; Replacement = "False" })
        $r = Test-ChatReconciliationChangeSet -Changes $changes -ParameterValues $apiOk
        $r.Allowed | Should Be $false
        $r.Reason | Should Be "UNEXPECTED_ACTIONS"
    }
    It "6) a Delete/Remove anywhere -> blocked (via the underlying certified safety wrapper)" {
        $changes = @(@{ Action = "Remove"; ResourceType = "AWS::ApiGatewayV2::Route"; LogicalResourceId = "SomeRoute"; Replacement = "N/A" })
        $r = Test-ChatReconciliationChangeSet -Changes $changes -ParameterValues $apiOk
        $r.Allowed | Should Be $false
        $r.Reason | Should Be "SAFETY_WRAPPER_BLOCK"
    }
    It "7) Replacement=True on ChatIntegration itself -> blocked, never treated as the allowed Modify" {
        $changes = @(@{ Action = "Modify"; ResourceType = "AWS::ApiGatewayV2::Integration"; LogicalResourceId = "ChatIntegration"; Replacement = "True" })
        $r = Test-ChatReconciliationChangeSet -Changes $changes -ParameterValues $apiOk
        $r.Allowed | Should Be $false
    }
    It "8) API ID mismatch -> blocked (reuses the certified API_ID_MISMATCH gate, independently derived)" {
        $r = Test-ChatReconciliationChangeSet -Changes $chatModify -ParameterValues @{ HttpApiId = "zzzzzzzzzz" }
        $r.Allowed | Should Be $false
        $r.Reason | Should Be "SAFETY_WRAPPER_BLOCK"
    }
    It "9) change-set digest mismatch -> blocked before any content evaluation" {
        $r = Test-ChatReconciliationChangeSet -Changes $chatModify -ParameterValues $apiOk -ActualDigest "AAA" -ReviewedDigest "BBB"
        $r.Allowed | Should Be $false
        $r.Reason | Should Be "CHANGESET_DIGEST_MISMATCH"
    }
    It "matching digest proceeds to normal evaluation" {
        $r = Test-ChatReconciliationChangeSet -Changes $chatModify -ParameterValues $apiOk -ActualDigest "AAA" -ReviewedDigest "aaa"
        $r.Allowed | Should Be $true
    }
}

Describe "Compare-IntegrationTargets (16A.2R.10 - custom Integration drift guard)" {
    It "10) dynamic Chat DNS matches -> AllInSync" {
        $r = Compare-IntegrationTargets -LiveTargets @{ ChatIntegration = "http://dev-chat-alb-NEW.elb.amazonaws.com/chat/{proxy}" } `
            -ExpectedTargets @{ ChatIntegration = "http://dev-chat-alb-NEW.elb.amazonaws.com/chat/{proxy}" }
        $r.AllInSync | Should Be $true
        $r.DriftedCount | Should Be 0
    }
    It "11) stale stack parameter (expected still OLD, live is NEW) -> drift detected" {
        $r = Compare-IntegrationTargets -LiveTargets @{ ChatIntegration = "http://dev-chat-alb-NEW.elb.amazonaws.com/chat/{proxy}" } `
            -ExpectedTargets @{ ChatIntegration = "http://dev-chat-alb-OLD.elb.amazonaws.com/chat/{proxy}" }
        $r.AllInSync | Should Be $false
        $r.DriftedCount | Should Be 1
        $r.Drifted[0].IntegrationId | Should Be "ChatIntegration"
    }
    It "12) live integration points to a wrong THIRD DNS (neither expected nor the known-current one) -> drift detected" {
        $r = Compare-IntegrationTargets -LiveTargets @{ ChatIntegration = "http://dev-chat-alb-THIRD-WRONG.elb.amazonaws.com/chat/{proxy}" } `
            -ExpectedTargets @{ ChatIntegration = "http://dev-chat-alb-NEW.elb.amazonaws.com/chat/{proxy}" }
        $r.AllInSync | Should Be $false
    }
    It "15) normal static Lambda integrations remain unaffected (checked and in sync)" {
        $r = Compare-IntegrationTargets -LiveTargets @{ UserIntegration = "fitness-assistant-dev-user"; GymIntegration = "fitness-assistant-dev-gym" } `
            -ExpectedTargets @{ UserIntegration = "fitness-assistant-dev-user"; GymIntegration = "fitness-assistant-dev-gym" }
        $r.AllInSync | Should Be $true
        $r.TotalChecked | Should Be 2
    }
    It "a missing live entry for an expected integration is drift, not silently skipped" {
        $r = Compare-IntegrationTargets -LiveTargets @{} -ExpectedTargets @{ ChatIntegration = "http://x/chat/{proxy}" }
        $r.AllInSync | Should Be $false
    }
}
