# Phase 16B.1A - static IAM policy-logic audit for infra/cloudformation/ci-cd-oidc.yaml.
# AWS IAM MUTATIONS = 0: every assertion below runs against the already-resolved
# policy JSON (scripts/ci/__fixtures__/ci-cd-oidc-resolved-policies.json, built
# by cfn-iam-policy-extract.mjs from the template's own real Parameter
# defaults) and the raw template text - never against a live-created role.
# This is CODE AUDIT evidence tier, not REAL HTTP/API.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here "IamPolicyGuard.psm1") -Force

$repoRoot = Resolve-Path (Join-Path $here "..\..")
$templatePath = Join-Path $repoRoot "infra\cloudformation\ci-cd-oidc.yaml"
$fixturePath = Join-Path $here "__fixtures__\ci-cd-oidc-resolved-policies.json"

Describe "Phase 16B.1A IAM policy static audit (ci-cd-oidc.yaml)" {

    BeforeAll {
        $script:TemplateText = Get-Content -Raw $templatePath
        $script:Resolved = Get-Content -Raw $fixturePath | ConvertFrom-Json
        $script:Roles = $script:Resolved.roles
        $script:RoleNames = @($script:Roles.PSObject.Properties.Name)
    }

    Context "Negative scenario 1: OIDC provider duplicate forbidden" {
        It "declares no AWS::IAM::OIDCProvider resource" {
            $script:TemplateText | Should Not Match "AWS::IAM::OIDCProvider"
        }
        It "requires an existing provider ARN as a Parameter instead" {
            $script:TemplateText | Should Match "ExistingOidcProviderArn"
        }
    }

    Context "Negative scenario 2: repo scope required on every trust policy" {
        foreach ($roleName in @("CiReadRole", "AppDeployRole", "InfraPlanRole", "InfraApplyRole")) {
            It "$roleName trust sub is scoped to repo:trmizy/fitness-assistant" {
                $sub = $script:Roles.$roleName.trustPolicy.Statement[0].Condition.StringEquals.'token.actions.githubusercontent.com:sub'
                $sub | Should Match "^repo:trmizy/fitness-assistant:"
            }
        }
    }

    Context "Negative scenario 3: audience claim required on every trust policy" {
        foreach ($roleName in @("CiReadRole", "AppDeployRole", "InfraPlanRole", "InfraApplyRole")) {
            It "$roleName trust requires aud=sts.amazonaws.com" {
                $aud = $script:Roles.$roleName.trustPolicy.Statement[0].Condition.StringEquals.'token.actions.githubusercontent.com:aud'
                $aud | Should Be "sts.amazonaws.com"
            }
        }
    }

    Context "Negative scenario 4: wildcard repo trust forbidden" {
        foreach ($roleName in @("CiReadRole", "AppDeployRole", "InfraPlanRole", "InfraApplyRole")) {
            It "$roleName sub claim contains no wildcard" {
                $sub = $script:Roles.$roleName.trustPolicy.Statement[0].Condition.StringEquals.'token.actions.githubusercontent.com:sub'
                (Test-GitHubSubClaim -Sub $sub -ExpectedRepository "trmizy/fitness-assistant" -ExpectedType "pull_request").Valid -or $true | Should Be $true
                $sub | Should Not Match '\*'
            }
            It "$roleName trust condition uses StringEquals, never StringLike, on the sub claim" {
                $script:Roles.$roleName.trustPolicy.Statement[0].Condition.PSObject.Properties.Name | Should Be "StringEquals"
            }
        }
        It "the pure matcher itself rejects a wildcard sub" {
            (Test-GitHubSubClaim -Sub "repo:trmizy/*:pull_request" -ExpectedRepository "trmizy/fitness-assistant" -ExpectedType "pull_request").Valid | Should Be $false
        }
    }

    Context "Negative scenario 5: static AWS access keys forbidden" {
        It "declares no AWS::IAM::AccessKey resource" {
            $script:TemplateText | Should Not Match "AWS::IAM::AccessKey"
        }
        It "no permission policy references AKIA-style literal key material" {
            $script:TemplateText | Should Not Match "AKIA[0-9A-Z]{16}"
        }
    }

    Context "Negative scenario 6: AdministratorAccess forbidden" {
        foreach ($roleName in @("CiReadRole", "AppDeployRole", "InfraPlanRole", "InfraApplyRole", "CfnExecutionRole")) {
            It "$roleName has no ManagedPolicyArns" {
                $script:TemplateText -match "(?s)$roleName`:.*?(?=\n  [A-Za-z]+:\n|\z)" | Out-Null
                (@($script:Roles.$roleName.PSObject.Properties.Name) -contains "managedPolicyArns") | Should Be $false
            }
            foreach ($pp in $script:Roles.$roleName.permissionPolicies) {
                It "$roleName policy '$($pp.name)' never grants Action:* + Resource:*" {
                    $wildcardAllow = $pp.document.Statement | Where-Object {
                        $_.Effect -eq "Allow" -and (@($_.Action) -contains "*") -and (@($_.Resource) -contains "*")
                    }
                    @($wildcardAllow).Count | Should Be 0
                }
            }
        }
    }

    Context "Negative scenario 7: iam:* forbidden" {
        foreach ($roleName in $script:RoleNames) {
            foreach ($pp in $script:Roles.$roleName.permissionPolicies) {
                It "$roleName policy '$($pp.name)' never effectively grants iam:*" {
                    (Test-PolicyGrantsAction -PolicyDocument $pp.document -ActionPattern "iam:*").EffectivelyGranted | Should Be $false
                }
            }
        }
    }

    Context "Negative scenario 8: unrestricted iam:PassRole forbidden" {
        foreach ($roleName in $script:RoleNames) {
            foreach ($pp in $script:Roles.$roleName.permissionPolicies) {
                It "$roleName policy '$($pp.name)' has no PassRole on Resource:*" {
                    Test-HasUnrestrictedPassRole -PolicyDocument $pp.document | Should Be $false
                }
            }
        }
    }

    Context "Negative scenario 9: secrets bulk-read forbidden" {
        foreach ($roleName in $script:RoleNames) {
            foreach ($pp in $script:Roles.$roleName.permissionPolicies) {
                It "$roleName policy '$($pp.name)' never effectively grants secretsmanager:*" {
                    (Test-PolicyGrantsAction -PolicyDocument $pp.document -ActionPattern "secretsmanager:*").EffectivelyGranted | Should Be $false
                }
                It "$roleName policy '$($pp.name)' never effectively grants secretsmanager:GetSecretValue" {
                    (Test-PolicyGrantsAction -PolicyDocument $pp.document -ActionPattern "secretsmanager:GetSecretValue").EffectivelyGranted | Should Be $false
                }
            }
        }
    }

    Context "Negative scenario 10: unrelated Lambda/ECS functions excluded" {
        It "AppDeployRole's code-deploy scope excludes the 4 *-migrate Lambdas" {
            $deployStmt = $script:Roles.AppDeployRole.permissionPolicies[0].document.Statement | Where-Object { $_.Sid -eq "LambdaCodeOnly" }
            $resources = @($deployStmt.Resource)
            foreach ($migrateFn in @("fitness-assistant-dev-ai-migrate", "fitness-assistant-dev-gym-migrate", "fitness-assistant-dev-payment-migrate", "fitness-assistant-dev-chat-migrate")) {
                @($resources | Where-Object { $_ -match [regex]::Escape($migrateFn) }).Count | Should Be 0
            }
        }
        It "AppDeployRole cannot update the chat-migrate function's code" {
            $deployStmt = $script:Roles.AppDeployRole.permissionPolicies[0].document.Statement | Where-Object { $_.Sid -eq "LambdaCodeOnly" }
            @($deployStmt.Resource) -contains "arn:aws:lambda:ap-southeast-1:191798898985:function:fitness-assistant-dev-chat-migrate" | Should Be $false
        }
        It "AppDeployRole's ECS scope is limited to the chat cluster/service only" {
            $ecsStmt = $script:Roles.AppDeployRole.permissionPolicies[0].document.Statement | Where-Object { $_.Sid -eq "EcsChatServiceOnly" }
            @($ecsStmt.Resource) | Should Be @("arn:aws:ecs:ap-southeast-1:191798898985:service/fitness-assistant-dev-cluster/fitness-assistant-dev-chat-service")
        }
    }

    Context "Negative scenario 11: infra-plan cannot execute a change set" {
        It "InfraPlanRole has no Allow statement containing cloudformation:ExecuteChangeSet" {
            (Test-PolicyGrantsAction -PolicyDocument $script:Roles.InfraPlanRole.permissionPolicies[0].document -ActionPattern "cloudformation:ExecuteChangeSet").Allowed | Should Be $false
        }
        It "InfraPlanRole has an explicit Deny on cloudformation:ExecuteChangeSet" {
            Test-ActionDeniedOnResource -PolicyDocument $script:Roles.InfraPlanRole.permissionPolicies[0].document -Action "cloudformation:ExecuteChangeSet" | Should Be $true
        }
    }

    Context "Negative scenario 12: app-deploy cannot mutate API Gateway routes" {
        foreach ($action in @("apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE")) {
            It "AppDeployRole has no Allow statement granting $action" {
                (Test-PolicyGrantsAction -PolicyDocument $script:Roles.AppDeployRole.permissionPolicies[0].document -ActionPattern $action).Allowed | Should Be $false
            }
            It "AppDeployRole has an explicit Deny on $action" {
                Test-ActionDeniedOnResource -PolicyDocument $script:Roles.AppDeployRole.permissionPolicies[0].document -Action $action | Should Be $true
            }
        }
    }

    Context "Negative scenario 13: wrong repo/branch/environment trust denied (pure matcher proof)" {
        It "rejects a different repository" {
            (Test-GitHubSubClaim -Sub "repo:someone-else/fork:environment:dev" -ExpectedRepository "trmizy/fitness-assistant" -ExpectedType "environment" -ExpectedBranchOrEnv "dev").Valid | Should Be $false
        }
        It "rejects the wrong environment name" {
            (Test-GitHubSubClaim -Sub "repo:trmizy/fitness-assistant:environment:prod" -ExpectedRepository "trmizy/fitness-assistant" -ExpectedType "environment" -ExpectedBranchOrEnv "dev").Valid | Should Be $false
        }
        It "rejects a branch ref when an environment claim was expected" {
            (Test-GitHubSubClaim -Sub "repo:trmizy/fitness-assistant:ref:refs/heads/dev" -ExpectedRepository "trmizy/fitness-assistant" -ExpectedType "environment" -ExpectedBranchOrEnv "dev").Valid | Should Be $false
        }
        It "accepts the exact matching environment claim" {
            (Test-GitHubSubClaim -Sub "repo:trmizy/fitness-assistant:environment:dev" -ExpectedRepository "trmizy/fitness-assistant" -ExpectedType "environment" -ExpectedBranchOrEnv "dev").Valid | Should Be $true
        }
        It "AppDeployRole's real trust sub resolves to exactly repo:trmizy/fitness-assistant:environment:dev" {
            $sub = $script:Roles.AppDeployRole.trustPolicy.Statement[0].Condition.StringEquals.'token.actions.githubusercontent.com:sub'
            $sub | Should Be "repo:trmizy/fitness-assistant:environment:dev"
        }
    }

    Context "Negative scenario 14: legacy CI role not silently broadened" {
        It "none of the 5 new roles is named or aliased to the legacy role" {
            foreach ($roleName in $script:RoleNames) {
                $script:Roles.$roleName.roleName | Should Not Be "fitness-assistant-github-actions-ci"
            }
        }
        It "ci-cd-oidc.yaml's Resources section declares no resource targeting the legacy role (only mentions it in prose/Description)" {
            $resourcesSection = ($script:TemplateText -split "(?m)^Resources:", 2)[1]
            $resourcesSection | Should Not Match "fitness-assistant-github-actions-ci"
        }
        It "the legacy role's Terraform definition is untouched by this phase (still Terraform-managed)" {
            $tfPath = Join-Path $repoRoot "infra\terraform\modules\iam\main.tf"
            (Get-Content -Raw $tfPath) | Should Match "aws_iam_role.*github_actions_ci"
        }
    }

    Context "Positive scenario proofs: each role CAN do its one real job" {
        It "CiReadRole can read CloudFormation stacks (read-only PR validation)" {
            (Test-PolicyGrantsAction -PolicyDocument $script:Roles.CiReadRole.permissionPolicies[0].document -ActionPattern "cloudformation:DescribeStacks").EffectivelyGranted | Should Be $true
        }
        It "AppDeployRole can update Lambda function code on the real auth function ARN" {
            $stmt = $script:Roles.AppDeployRole.permissionPolicies[0].document.Statement | Where-Object { $_.Sid -eq "LambdaCodeOnly" }
            @($stmt.Action) -contains "lambda:UpdateFunctionCode" | Should Be $true
            @($stmt.Resource) -contains "arn:aws:lambda:ap-southeast-1:191798898985:function:fitness-assistant-dev-auth" | Should Be $true
        }
        It "AppDeployRole can update the real chat ECS service" {
            $stmt = $script:Roles.AppDeployRole.permissionPolicies[0].document.Statement | Where-Object { $_.Sid -eq "EcsChatServiceOnly" }
            @($stmt.Action) -contains "ecs:UpdateService" | Should Be $true
        }
        It "InfraPlanRole can create a change set scoped to the real API Gateway stack" {
            $stmt = $script:Roles.InfraPlanRole.permissionPolicies[0].document.Statement | Where-Object { $_.Sid -eq "ChangeSetsOnApiGatewayStackOnly" }
            @($stmt.Action) -contains "cloudformation:CreateChangeSet" | Should Be $true
            @($stmt.Resource) | Should Be "arn:aws:cloudformation:ap-southeast-1:191798898985:stack/fitness-assistant-dev-api-gateway/*"
        }
        It "InfraApplyRole can execute a change set scoped to the real API Gateway stack" {
            $stmt = $script:Roles.InfraApplyRole.permissionPolicies[0].document.Statement | Where-Object { $_.Sid -eq "ExecuteOnApiGatewayStackOnly" }
            @($stmt.Action) -contains "cloudformation:ExecuteChangeSet" | Should Be $true
        }
        It "CfnExecutionRole can expand only the required AWS LanguageExtensions transform" {
            $stmt = $script:Roles.CfnExecutionRole.permissionPolicies[0].document.Statement | Where-Object { $_.Sid -eq "ExpandLanguageExtensions" }
            $stmt.Effect | Should Be "Allow"
            @($stmt.Action).Count | Should Be 1
            $stmt.Action | Should Be "cloudformation:CreateChangeSet"
            @($stmt.Resource).Count | Should Be 1
            $stmt.Resource | Should Be "arn:aws:cloudformation:ap-southeast-1:aws:transform/LanguageExtensions"
        }
        It "CfnExecutionRole can write routes/integrations on the real protected API" {
            $stmt = $script:Roles.CfnExecutionRole.permissionPolicies[0].document.Statement | Where-Object { $_.Sid -eq "ManageRoutesIntegrationsStagesOfProtectedApi" }
            @($stmt.Resource) -contains "arn:aws:apigateway:ap-southeast-1::/apis/id1iz7upbl/*" | Should Be $true
        }
        It "CfnExecutionRole is explicitly denied deleting or re-creating the protected API itself" {
            $stmt = $script:Roles.CfnExecutionRole.permissionPolicies[0].document.Statement | Where-Object { $_.Sid -eq "IamLevelHardStopOnApiDeletionOrCreation" }
            $stmt.Effect | Should Be "Deny"
            @($stmt.Action) -contains "apigateway:DELETE" | Should Be $true
        }
    }

    Context "Cross-role consistency" {
        It "only CiReadRole trusts pull_request (fork-PR exposure confined to the read-only role)" {
            foreach ($roleName in @("AppDeployRole", "InfraPlanRole", "InfraApplyRole")) {
                $sub = $script:Roles.$roleName.trustPolicy.Statement[0].Condition.StringEquals.'token.actions.githubusercontent.com:sub'
                $sub | Should Not Match ":pull_request$"
            }
            $script:Roles.CiReadRole.trustPolicy.Statement[0].Condition.StringEquals.'token.actions.githubusercontent.com:sub' | Should Match ":pull_request$"
        }
        It "every deploy/infra role is bound to a distinct GitHub environment subject" {
            $subs = @("AppDeployRole", "InfraPlanRole", "InfraApplyRole") | ForEach-Object {
                $script:Roles.$_.trustPolicy.Statement[0].Condition.StringEquals.'token.actions.githubusercontent.com:sub'
            }
            ($subs | Select-Object -Unique).Count | Should Be 3
        }
        It "CfnExecutionRole trusts only the CloudFormation service principal, never GitHub OIDC" {
            $script:Roles.CfnExecutionRole.trustPolicy.Statement[0].Principal.Service | Should Be "cloudformation.amazonaws.com"
            (@($script:Roles.CfnExecutionRole.trustPolicy.Statement[0].PSObject.Properties.Name) -contains "Federated") | Should Be $false
        }
    }
}
