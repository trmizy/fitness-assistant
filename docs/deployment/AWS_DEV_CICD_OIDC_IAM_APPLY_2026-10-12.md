# AWS DEV CI/CD Activation — Apply Reviewed OIDC/IAM Plan

**Phase:** 16B.1B — CI/CD ACTIVATION — APPLY REVIEWED OIDC/IAM PLAN
**Date:** 2026-10-12
**Executed by:** `arn:aws:iam::191798898985:user/gymini-admin`
**Result:** 5 new IAM roles created exactly as reviewed in Phase 16B.1A. OIDC provider and legacy CI role untouched (byte-for-byte confirmed). No workflow activated, no application/infra state changed.

---

## Executive Summary

This phase applied, byte-for-byte, the exact CI/CD IAM role plan reviewed and hashed in Phase 16B.1A. A new CloudFormation stack `fitness-assistant-dev-cicd-iam` was created from `infra/cloudformation/ci-cd-oidc.yaml` (SHA-256 `91ba592374184025146d234d3cc12dd6d2b4bb1dc7268a5143983e5727d193dc`, unchanged since review), producing exactly the 5 roles the activation manifest specified — no more, no less. The existing GitHub OIDC provider and the legacy Terraform-managed CI role were independently re-snapshotted before and after the apply and show a 0-line diff. Live `simulate-principal-policy` calls against the newly-created roles confirm every intended positive capability is allowed and every probed dangerous capability is denied. No GitHub workflow was activated, no application code was deployed, and no runtime state changed.

## Owner Authorization

The owner authorized this phase to apply exactly the reviewed Phase 16B.1A manifest and create only the 5 listed roles, explicitly withholding authorization for: modifying the OIDC provider, broadening the legacy role, activating workflows, deploying Lambda/ECS, API Gateway changes, SOURCE_ONLY routes, and migrations. All of these withheld items were independently verified as untouched (see §§6, 7, 19, 20).

## AWS Identity

| Field | Required | Actual |
|---|---|---|
| Account | `191798898985` | `191798898985` |
| ARN | `arn:aws:iam::191798898985:user/gymini-admin` | `arn:aws:iam::191798898985:user/gymini-admin` |
| Region | `ap-southeast-1` | `ap-southeast-1` (config-file) |

Gate PASS (16B.1B.0).

## Artifact Hash Verification

`git rev-parse HEAD` at the start of this phase: `187745350ab147003d030d4826c430e84dfe3e59` — identical to the value recorded at the end of Phase 16B.1A, confirming no concurrent-agent edit touched the reviewed artifacts in between. All CI/IAM files were still `??` (untracked, never committed), never `M` (modified) in `git status` — the large set of `M`/`??` changes elsewhere in the tree belongs to a different, concurrent agent workstream (ai-service/fitness-service application code) and was left untouched, per parallel-agent safety.

Recomputed live:

| Artifact | Recorded (16B.1A) | Recomputed (16B.1B) | Match |
|---|---|---|---|
| `ci-cd-oidc.yaml` | `91ba592374...e691dc` | `91ba592374...e691dc` | YES |
| `CiReadRole` trust/permission | `c8bd0631...`/`ca5338ee...` | identical | YES |
| `AppDeployRole` trust/permission | `06db4f97...`/`afe61d58...` | identical | YES |
| `InfraPlanRole` trust/permission | `f6455d53...`/`abd355fb...` | identical | YES |
| `InfraApplyRole` trust/permission | `ced28712...`/`4c5dc873...` | identical | YES |
| `CfnExecutionRole` trust/permission | `df17b691...`/`445cf515...` | identical | YES |

`ALL_REVIEWED_HASHES_MATCH: YES`.

## Activation Manifest

Parsed `docs/deployment/generated/cicd-iam-activation-plan.json`: 5 `activationItems` (all `ACTION: CREATE`), 2 `unchangedResources` (`ACTION: LEAVE_UNCHANGED`). `PLANNED_CREATE: 5`, `PLANNED_UPDATE: 0`, `PLANNED_LEAVE_UNCHANGED: 2`, `UNRECOGNIZED_ACTIONS: 0`.

## OIDC Provider Protection

Re-read `token.actions.githubusercontent.com` live (before apply): ARN, `ClientIDList: ["sts.amazonaws.com"]`, thumbprint, `CreateDate: 2026-08-04`, `managed-by: terraform` tag — all identical to the Phase 16B.1A report. The template contains zero `AWS::IAM::OIDCProvider` resources (`grep` count = 0). `OIDC_PROVIDER_EXISTS: YES`. `OIDC_PROVIDER_ACTION: LEAVE_UNCHANGED`. `NEW_OIDC_PROVIDER: NO`.

## Legacy Role Protection

Snapshotted `fitness-assistant-github-actions-ci` BEFORE apply: trust policy (`StringLike` sub matching both `ref:refs/heads/master` and `pull_request` — the known, already-accepted fork-PR exposure on this specific read-only role, unchanged from Phase 16B.1A §4), inline policies (`plan-read-only`, `state-backend-read`), zero attached managed policies, zero permissions boundary. `LEGACY_ROLE_ACTION: LEAVE_UNCHANGED` (as the manifest specifies).

## Pre-Apply Tests

Full regression immediately before execution: `scripts/ci/*.Tests.ps1` + `scripts/aws/**/*.Tests.ps1` → **299/299 pass, 0 failed**. Specifically re-ran `IamPolicyGuard.Tests.ps1` (the 14 brief-mandated negative scenarios + 7 positive proofs) → **82/82 pass**. `PREVIOUS_TESTS_REGRESSED: NO`.

## Access Analyzer

Re-ran `aws accessanalyzer validate-policy` against the exact policy JSON about to be applied (freshly re-extracted from the unchanged, hash-verified template). All 5 permission policies (`IDENTITY_POLICY`): `[]` — zero findings, confirming the Phase 16B.1A `apigateway:TagResource` fix still holds with no regression. All 5 trust policies (`RESOURCE_POLICY`): the same single `MISSING_RESOURCE` finding already documented and accepted in Phase 16B.1A §18 (a structural false positive for IAM role trust policies, which never need a `Resource` field — not a new finding, re-confirmed identical). `ACCESS_ANALYZER_ERRORS: 0` (actionable). `SECURITY_WARNINGS_UNRESOLVED: 0`.

## CloudFormation Validation

`aws cloudformation validate-template` against the unmodified, hash-verified `ci-cd-oidc.yaml`: **PASS**, `Capabilities: ["CAPABILITY_NAMED_IAM"]`, no errors. The template was not edited in this phase (doing so would have invalidated the reviewed hash binding).

## IAM Change Set

No pre-existing stack matched this template; the activation manifest/report did not pin an explicit stack name, so `fitness-assistant-dev-cicd-iam` was chosen, following this repo's established `fitness-assistant-dev-<purpose>` convention (matches `fitness-assistant-dev-api-gateway`). Confirmed non-existent via `describe-stacks` (`ValidationError: ... does not exist`) before creating.

- `IAM_STACK_NAME: fitness-assistant-dev-cicd-iam`
- `STACK_EXISTS_BEFORE: NO`
- `CHANGE_SET_TYPE: CREATE`
- Change set `phase-16b1b-cicd-iam-activation` created with the unmodified template, `CAPABILITY_NAMED_IAM`, and parameters set explicitly to the exact reviewed default values (`GitHubRepository=trmizy/fitness-assistant`, `ExistingOidcProviderArn=...token.actions.githubusercontent.com`, `DevEnvironmentName=dev`, `InfraPlanEnvironmentName=dev-infra-plan`, `InfraApplyEnvironmentName=dev-infra`, `ProtectedApiId=id1iz7upbl`, `ApiGatewayStackName=fitness-assistant-dev-api-gateway`, `ArtifactBucketName=fitness-assistant-deployments-dev-191798898985`, `ChatEcrRepositoryName=fitness-assistant-dev-chat`, `ChatClusterName=fitness-assistant-dev-cluster`, `ChatServiceName=fitness-assistant-dev-chat-service`, `ChatExecutionRoleName=fitness-assistant-dev-chat-execution-role`, `ChatTaskRoleName=fitness-assistant-dev-chat-task-role`) — not executed yet at this step.
- Reached `CREATE_COMPLETE`. Inspected all 5 changes: every one `Action: Add`, `ResourceType: AWS::IAM::Role`, `Replacement: N/A`, no pre-existing `PhysicalResourceId`. Zero changes of any other resource family (no OIDC provider, no legacy role, no API Gateway, Lambda, ECS, ECR, VPC, Secrets, RDS, CloudWatch, or Scheduler resources appeared anywhere in the change set).

## Manifest / Change-Set Match

| Check | Result |
|---|---|
| `ACTUAL_ROLE_CREATES` == `PLANNED_ROLE_CREATES` | 5 == 5, same logical IDs — YES |
| `ACTUAL_ROLE_UPDATES` == `PLANNED_UPDATES` (0) | 0 == 0 — YES |
| `UNEXPECTED_ACTIONS` | 0 |
| `MISSING_EXPECTED_ACTIONS` | 0 |
| `OIDC_PROVIDER_ACTIONS` | 0 |
| `LEGACY_ROLE_UNEXPECTED_ACTIONS` | 0 |

## Trust Policy Review

Re-derived from the change set's own echoed `Parameters` (which matched the reviewed defaults exactly) and the resolved fixture: `CiReadRole` → `repo:trmizy/fitness-assistant:pull_request`; `AppDeployRole` → `...:environment:dev`; `InfraPlanRole` → `...:environment:dev-infra-plan`; `InfraApplyRole` → `...:environment:dev-infra`; `CfnExecutionRole` → service principal `cloudformation.amazonaws.com` only (no `Federated` key at all). No wildcard in any `sub`. `ALL_TRUST_POLICIES_REPO_SCOPED: YES`. `ALL_DEPLOY_TRUSTS_RESTRICTED: YES`.

## Permission Policy Review

Re-confirmed via the 82/82 `IamPolicyGuard.Tests.ps1` run in §8 and the Access Analyzer run in §9: `AdministratorAccess` absent, `iam:*` absent, unrestricted `iam:PassRole` absent (every grant scoped to named role ARNs with a matching `iam:PassedToService` condition), normal-deploy `secretsmanager:GetSecretValue` absent, `InfraPlanRole` cannot `ExecuteChangeSet` (explicit Deny), `AppDeployRole` cannot mutate API Gateway routes (explicit Deny), unrelated Lambda/ECS scope absent (confirmed again live in §18). `POLICY_SCOPE_REVIEW: PASS`.

## Change-Set Execution

All 12 conditions in the owner's execution-authorization checklist were independently verified true (identity, hashes, manifest, OIDC untouched, legacy protected, 299/299 tests, Access Analyzer clean, CFN validation pass, exact manifest match, trust scoping, permission scoping, zero unexpected actions) before the SAME, already-inspected change set (`phase-16b1b-cicd-iam-activation`, no regeneration) was executed:

- Executed at `2026-10-12T13:19:41Z`.
- Stack ID: `arn:aws:cloudformation:ap-southeast-1:191798898985:stack/fitness-assistant-dev-cicd-iam/62a62150-c63f-11f1-890a-0affd989b073`.
- Change-set ARN: `arn:aws:cloudformation:ap-southeast-1:191798898985:changeSet/phase-16b1b-cicd-iam-activation/9527f015-2b16-4ff6-83b9-d0bd05496c4b`.
- Final stack status: `CREATE_COMPLETE`, no failure, no rollback.

## Final IAM Inventory

| Role | ARN | Inline Policy | Attached Managed Policies | Permissions Boundary |
|---|---|---|---|---|
| `GyminiDevCiReadRole` | `arn:aws:iam::191798898985:role/GyminiDevCiReadRole` | `ci-read` | none | none |
| `GyminiDevAppDeployRole` | `arn:aws:iam::191798898985:role/GyminiDevAppDeployRole` | `app-deploy` | none | none |
| `GyminiDevInfraPlanRole` | `arn:aws:iam::191798898985:role/GyminiDevInfraPlanRole` | `infra-plan` | none | none |
| `GyminiDevInfraApplyRole` | `arn:aws:iam::191798898985:role/GyminiDevInfraApplyRole` | `infra-apply` | none | none |
| `GyminiDevCfnExecutionRole` | `arn:aws:iam::191798898985:role/GyminiDevCfnExecutionRole` | `api-gateway-stack-resources` | none | none |

## No-Static-Credential Proof

`aws iam list-users` returns exactly the 3 pre-existing users (`awsstudent`, `gymini-admin`, `vmimport-admin`) — no new user. No IAM user exists named after any of the 5 new roles. `IAM_USER_CREATED: NO`. `ACCESS_KEY_CREATED: NO`. `STATIC_AWS_CREDENTIALS_CREATED: NO`. Authentication for all 5 new roles remains GitHub OIDC → STS temporary credentials only (`CfnExecutionRole` is assumed only by the AWS CloudFormation service principal, never by a credential of any kind held outside AWS).

## Positive Capability Validation

Real `aws iam simulate-principal-policy` calls against the now-live roles (REAL HTTP/API evidence tier — not a static/offline simulation, the actual deployed policy):

| Role | Action probed | Resource | Decision |
|---|---|---|---|
| `AppDeployRole` | `lambda:UpdateFunctionCode` | `fitness-assistant-dev-auth` | **allowed** |
| `AppDeployRole` | `ecs:UpdateService` | chat cluster/service | **allowed** |
| `AppDeployRole` | `iam:PassRole` (→ ecs-tasks.amazonaws.com) | chat execution role | **allowed** |
| `InfraPlanRole` | `cloudformation:CreateChangeSet` | protected API Gateway stack | **allowed** |
| `InfraApplyRole` | `cloudformation:ExecuteChangeSet` | protected API Gateway stack | **allowed** |
| `CfnExecutionRole` | `apigateway:POST` | protected API's `/routes` | **allowed** |

## Negative Capability Validation

| Role | Action probed | Resource | Decision |
|---|---|---|---|
| `AppDeployRole` | `iam:CreateRole`, `iam:AttachRolePolicy` | any role | **explicitDeny** |
| `AppDeployRole` | `lambda:UpdateFunctionCode` | `fitness-assistant-dev-chat-migrate` (unrelated/excluded Lambda) | **implicitDeny** |
| `AppDeployRole` | `ecs:UpdateService` | a different (non-chat) ECS service | **implicitDeny** |
| `AppDeployRole` | `ecr:PutImage` | an unrelated ECR repo | **implicitDeny** |
| `AppDeployRole` | `cloudformation:ExecuteChangeSet` | protected API Gateway stack | **explicitDeny** |
| `AppDeployRole` | `secretsmanager:GetSecretValue` | any secret | **explicitDeny** |
| `AppDeployRole` | `apigateway:POST` / `apigateway:DELETE` | protected API routes | **explicitDeny** / **explicitDeny** |
| `InfraPlanRole` | `cloudformation:ExecuteChangeSet` | protected API Gateway stack | **explicitDeny** |
| `InfraApplyRole` | `apigateway:POST` | protected API routes | **explicitDeny** |
| `CfnExecutionRole` | `apigateway:DELETE` | the protected API itself | **explicitDeny** |
| `CfnExecutionRole` | `rds:DeleteDBInstance` | `*` | **implicitDeny** (action entirely absent from the policy) |

All 11 probes behaved exactly as designed. Wrong-repository/branch/environment trust rejection was already proven at the pure-function level in `IamPolicyGuard.Tests.ps1` (§8, scenario 13) and structurally confirmed again here (§13) — a live cross-repo OIDC assumption attempt cannot be safely simulated without a real foreign GitHub Actions run, which is out of this phase's scope (see §20 below).

## Provider / Legacy Role Preservation

Byte-for-byte `Compare-Object` between the BEFORE (pre-apply) and AFTER (post-apply) snapshots:

| Artifact | Diff lines |
|---|---|
| OIDC provider (`get-open-id-connect-provider`) | **0** |
| Legacy role (`get-role`) | **0** |
| Legacy role inline policy names | **0** |
| Legacy role `plan-read-only` policy document | **0** |
| Legacy role `state-backend-read` policy document | **0** |

`OIDC_PROVIDER_CHANGED: NO`. `LEGACY_ROLE_CHANGED: NO`.

## Runtime Preservation

| Surface | Status |
|---|---|
| API Gateway CFN stack | `UPDATE_COMPLETE`, last updated `2026-10-12T08:53:34Z` — before this phase began, untouched by it |
| Chat ECS service | `desiredCount: 1`, `runningCount: 1`, `status: ACTIVE` |
| Lambda (`fitness-assistant-dev-auth`) | `LastModified: 2026-10-07T13:59:02Z` — unchanged, no code deploy occurred |
| Aurora cluster | `available`, unchanged |
| NAT gateway | 1, `available`, unchanged |
| EventBridge Scheduler | unchanged set of enabled/disabled schedules |

No API Gateway, Lambda code, ECS, ECR, Aurora, NAT, ALB, scheduler, OpenSearch, or Secrets Manager resource was created, modified, or deleted by this phase.

## GitHub OIDC Live-Test Handoff

No GitHub Actions token was faked and no trust policy was temporarily weakened to test `AssumeRoleWithWebIdentity`. Validation at this phase was limited to: trust-policy structure (§13), permission-policy structure (§14), live AWS-side existence (§15), Access Analyzer (§9), and live `simulate-principal-policy` (§17/§18). `LIVE_GITHUB_OIDC_ASSUME_ROLE_TEST: DEFERRED_TO_WORKFLOW_ACTIVATION` — proving real OIDC federation requires an actual GitHub Actions workflow run, which remains out of scope until a later, explicitly-authorized activation phase.

## Phase 16B.2 Readiness

5 roles live, zero drift from the reviewed plan, zero workflow activated, zero runtime change. The next step toward CI/CD activation (moving a draft workflow out of `ci/drafts/github-actions/` into `.github/workflows/` and running a real GitHub Actions job against `GyminiDevCiReadRole`) requires its own separate, explicit owner authorization and has not begun.

---

## Final Response

```
PHASE: 16B.1B
AWS_PRINCIPAL: gymini-admin
AWS_ACCOUNT: 191798898985
ARTIFACT_HASH_GATE: PASS
ALL_REVIEWED_HASHES_MATCH: YES
ACTIVATION_MANIFEST_VALID: YES
IAM_STACK_NAME: fitness-assistant-dev-cicd-iam
STACK_EXISTS_BEFORE: NO
CHANGE_SET_TYPE: CREATE
OIDC_PROVIDER_EXISTS: YES
OIDC_PROVIDER_ACTION: LEAVE_UNCHANGED
OIDC_PROVIDER_CHANGED: NO
LEGACY_CI_ROLE: fitness-assistant-github-actions-ci
LEGACY_ROLE_ACTION: LEAVE_UNCHANGED
LEGACY_ROLE_CHANGED: NO
PREVIOUS_TEST_BASELINE: 299/299
FULL_SAFETY_TESTS: 299/299
PREVIOUS_TESTS_REGRESSED: 0
ACCESS_ANALYZER_ERRORS: 0
SECURITY_WARNINGS_UNRESOLVED: 0
CFN_TEMPLATE_VALIDATION: PASS
PLANNED_ROLE_CREATES: 5
PLANNED_ROLE_UPDATES: 0
CHANGE_SET_CREATED: YES
ACTUAL_ROLE_CREATES: 5
ACTUAL_ROLE_UPDATES: 0
UNEXPECTED_ACTIONS: 0
MISSING_EXPECTED_ACTIONS: 0
OIDC_PROVIDER_ACTIONS: 0
LEGACY_ROLE_UNEXPECTED_ACTIONS: 0
TRUST_POLICY_REVIEW: PASS
POLICY_SCOPE_REVIEW: PASS
CHANGE_SET_EXECUTED: YES
IAM_STACK_FINAL_STATUS: CREATE_COMPLETE
ROLES_CREATED: GyminiDevCiReadRole, GyminiDevAppDeployRole, GyminiDevInfraPlanRole, GyminiDevInfraApplyRole, GyminiDevCfnExecutionRole
ROLES_UPDATED: none
IAM_USERS_CREATED: 0
ACCESS_KEYS_CREATED: 0
STATIC_AWS_CREDENTIALS_CREATED: NO
ADMINISTRATOR_ACCESS: NO
UNRESTRICTED_PASSROLE: NO
NORMAL_DEPLOY_SECRET_READ: NO
INFRA_PLAN_CAN_EXECUTE_CHANGESET: NO
APP_DEPLOY_CAN_DIRECTLY_MUTATE_API_ROUTES: NO
LIVE_GITHUB_OIDC_ASSUME_ROLE_TEST: DEFERRED_TO_WORKFLOW_ACTIVATION
OIDC_POST_APPLY: UNCHANGED
LEGACY_ROLE_POST_APPLY: UNCHANGED
API_GATEWAY_CHANGED: NO
SERVICES_REDEPLOYED: 0
SERVICES_STOPPED: 0
CHAT_DESIRED_COUNT: 1
CHAT_RUNNING_COUNT: 1
SOURCE_ONLY_DEPLOYED: 0
ACTIVE_GITHUB_WORKFLOWS_CREATED: 0
POST_APPLY_SNAPSHOT: docs/deployment/generated/cicd-iam-post-apply.json
REPORT: docs/deployment/AWS_DEV_CICD_OIDC_IAM_APPLY_2026-10-12.md
FINAL_DECISION: CICD_OIDC_IAM_ACTIVATED
READY_FOR_PHASE_16B_2: YES
```

**HARD STOP.**

Do NOT activate GitHub workflows.
Do NOT deploy Lambda/ECS.
Do NOT modify API Gateway.
Do NOT add SOURCE_ONLY routes.
Do NOT run migrations.
Do NOT change lifecycle state.
