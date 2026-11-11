# CloudFormation LanguageExtensions permission correction

## Failure and correction

REAL HTTP/API: PLAN run 38920761765 passed OIDC and identity validation,
then its API Gateway change set failed because GyminiDevCfnExecutionRole
lacked cloudformation:CreateChangeSet on
arn:aws:cloudformation:ap-southeast-1:aws:transform/LanguageExtensions.

The deployed IAM template matched the repository before editing. Added only
that action/resource pair to the execution role in ci-cd-oidc.yaml; regenerated
the resolved policy fixture and added a scope assertion. Commit: b4ffc8d8.

TEST FIXTURE: CiHelpers.Tests.ps1, TemplateSemanticGuard.Tests.ps1 and
IamPolicyGuard.Tests.ps1: 177/177 passed with Invoke-Pester -PassThru -Quiet.

## Live result

REAL HTTP/API: applied IAM stack change set fix-languageextensions-20261016.
Only CfnExecutionRole.Policies changed directly; PLAN/APPLY role policy
references were dynamically reevaluated, with no replacements. IAM stack
fitness-assistant-dev-cicd-iam reached UPDATE_COMPLETE.

REAL HTTP/API: created API Gateway change set verify-languageextensions-20261016
using the repository baseline, previous parameter values and the same
GyminiDevCfnExecutionRole. Result: CREATE_COMPLETE, Changes: []. This local
admin-initiated check proves the service-role transform operation succeeds;
it does not replace verification of the GitHub OIDC PLAN path. The API Gateway
change set was NOT executed.

Fresh GitHub PLAN: https://github.com/trmizy/fitness-assistant/actions/runs/38921588506
(source b4ffc8d8). Full CI outcome remains pending the protected environment
review and job completion. No application deployment was performed here.
