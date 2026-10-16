# AWS DEV CI/CD Activation — OIDC / IAM Exact Plan

**Phase:** 16B.1A — CI/CD ACTIVATION — AWS OIDC / IAM EXACT PLAN
**Date:** 2026-10-12
**AWS IAM MUTATIONS this phase:** 0 (no `create-role`, `put-role-policy`, `create-open-id-connect-provider`, or any other IAM/OIDC write was executed)
**Status:** Plan prepared, statically audited, test-covered. Not activated. Awaiting explicit owner authorization for Phase 16B.1B.

---

## 1. Executive Summary

This phase designs, statically validates, and test-covers the exact IAM/OIDC
surface Gymini's DEV CI/CD will need to activate — without creating or
modifying a single AWS IAM resource. The result is one CloudFormation draft
(`infra/cloudformation/ci-cd-oidc.yaml`, unapplied) declaring 5 new,
least-privilege roles, each bound to one distinct GitHub OIDC subject claim,
plus a resource-scope inventory, a static policy review, 82 new automated
policy-logic tests, and a hashed activation manifest for Phase 16B.1B to
consume. Two real, concrete defects were found and fixed during this audit
(an invalid IAM action, an oversized template field) and a third real defect
was found and fixed in the audit tooling itself (a bidirectional wildcard
match that falsely flagged two roles' scoped `iam:PassRole` grants as
"grants `iam:*`"). Zero roles, policies, or OIDC resources were created.

## 2. Scope & Mutation Discipline

Every action this phase took was one of: reading live AWS state
(`get-role`, `list-functions`, `describe-services`, `describe-repositories`,
`describe-stacks`, `get-bucket-location`), statically linting policy JSON
(`accessanalyzer validate-policy`, `cloudformation validate-template` — both
real, stateless, read-only AWS APIs that create nothing), or local file
edits/tests. No `aws iam create-*`, `put-*`, `attach-*`, or
`create-open-id-connect-provider` call was made. `git status` was checked
before this phase's edits; the only files touched were the ones this phase
itself created or edited (listed in §20).

## 3. GitHub Repository & OIDC Provider Identity

| Field | Value | Verified via |
|---|---|---|
| GitHub owner/repo | `trmizy/fitness-assistant` | `git remote -v` / `git remote show origin` |
| Default branch | `master` | `git remote show origin` → `HEAD branch` |
| Current working branch | `aws-deploy` | `git branch --show-current` |
| OIDC provider ARN | `arn:aws:iam::191798898985:oidc-provider/token.actions.githubusercontent.com` | `aws iam get-open-id-connect-provider` |
| OIDC audience | `sts.amazonaws.com` | same |
| OIDC provider IaC owner | Terraform (`infra/terraform/modules/iam/main.tf` → `aws_iam_openid_connect_provider.github`) | file read |
| New OIDC provider planned | **No** — this plan only references the existing ARN by parameter | design |

## 4. Legacy CI Role Disposition & Fork-PR Risk Analysis

The pre-existing Terraform-managed role `fitness-assistant-github-actions-ci`
(`arn:aws:iam::191798898985:role/fitness-assistant-github-actions-ci`) is
**left unchanged** by this plan. Its live trust policy (`get-role`) permits
two subjects: `repo:trmizy/fitness-assistant:ref:refs/heads/master` and
`repo:trmizy/fitness-assistant:pull_request`. Its only permissions are two
inline policies: `state-backend-read` (S3 tfstate bucket) and
`plan-read-only` (broad read-only: `apigateway:GET*`, `cloudformation:Get*`,
`lambda:Get*/List*`, `logs:Describe*`, `s3:Get*/List*`, `iam:Get*/List*`,
`budgets:Describe*`, scoped `Resource: "*"` since these are read-only
describe/list/get actions with no resource-level ARN support).

**Risk identified:** GitHub OIDC's `sub` claim for a `pull_request`-triggered
workflow is identical regardless of whether the PR originates from a fork —
so any role trusting `pull_request` is technically assumable by
fork-originated PR code. This is accepted as-is for the legacy role because
its blast radius is already minimal (read-only, no secrets, no mutation).
The same pitfall must never be repeated for a mutation-capable role — see §7.

## 5. Proposed 5-Role Architecture Overview

| Role | Trust Subject | Can Mutate? | Purpose |
|---|---|---|---|
| `GyminiDevCiReadRole` | `repo:trmizy/fitness-assistant:pull_request` | No | PR validation (template lint, route-parity read) |
| `GyminiDevAppDeployRole` | `repo:trmizy/fitness-assistant:environment:dev` | Yes (Lambda code, Chat ECS/ECR) | Normal app deploy |
| `GyminiDevInfraPlanRole` | `repo:trmizy/fitness-assistant:environment:dev-infra-plan` | No (change-set create/inspect only) | CFN plan |
| `GyminiDevInfraApplyRole` | `repo:trmizy/fitness-assistant:environment:dev-infra` | Yes, via CFN only | CFN apply (human-reviewed env) |
| `GyminiDevCfnExecutionRole` | N/A — CloudFormation service principal | Yes (API Gateway only) | The actual writer behind CFN |

None of the 5 roles has any `ManagedPolicyArns`; each carries exactly one
narrow inline policy. No static AWS access keys are used anywhere — every
role is OIDC-federated or AWS-service-assumed only.

## 6. Trust Policy Hardening Detail

All 4 GitHub-OIDC-trusting roles use `StringEquals` (never `StringLike`) on
both `token.actions.githubusercontent.com:aud` (= `sts.amazonaws.com`) and
`:sub`, and each resolves (from the template's own real Parameter defaults)
to exactly one concrete subject:

| Role | Resolved `sub` |
|---|---|
| `GyminiDevCiReadRole` | `repo:trmizy/fitness-assistant:pull_request` |
| `GyminiDevAppDeployRole` | `repo:trmizy/fitness-assistant:environment:dev` |
| `GyminiDevInfraPlanRole` | `repo:trmizy/fitness-assistant:environment:dev-infra-plan` |
| `GyminiDevInfraApplyRole` | `repo:trmizy/fitness-assistant:environment:dev-infra` |
| `GyminiDevCfnExecutionRole` | N/A — `Principal: {Service: cloudformation.amazonaws.com}`, `Condition: aws:SourceAccount=191798898985` |

No role uses `repo:*/*` or a wildcarded `sub`. `Test-GitHubSubClaim` (new,
pure function, `scripts/ci/IamPolicyGuard.psm1`) independently re-derives and
confirms each of these matches — see §19.

## 7. PR Security Model (Fork Exposure)

Only `GyminiDevCiReadRole` trusts `pull_request` — confirmed by the new
cross-role-consistency test (`scripts/ci/IamPolicyGuard.Tests.ps1`). This
role cannot mutate anything (its only actions are `cloudformation:Validate/
Describe/List/GetTemplate*` and `apigateway:GET`), so the known GitHub OIDC
fork-PR `sub`-claim ambiguity (§4) has **zero mutation blast radius** here —
a fork-originated PR can, at worst, read the already-public shape of the
protected API and validate a template, never write anything. The 3
mutation-capable roles (`AppDeployRole`, `InfraPlanRole`, `InfraApplyRole`)
trust `environment:*` subjects instead, which GitHub Environments gate by
branch-protection rules (and, for `dev-infra`, a required human reviewer) —
not by PR origin at all.

## 8. AppDeployRole Permission Detail

Scoped to exactly 12 real, live Lambda ARNs for
`UpdateFunctionCode`/`PublishVersion`/`GetFunction` (deliberately excluding
all 4 `*-migrate` functions — normal CI deploy can never touch a migration
Lambda), 5 of those 12 for a synthetic-health `InvokeFunction` smoke action,
the real Chat ECR repo for image push, the real Chat ECS cluster/service for
`UpdateService` (never a different service), `iam:PassRole` restricted to
exactly the Chat execution/task role ARNs with
`iam:PassedToService=ecs-tasks.amazonaws.com`, and the artifact bucket's
`ci-artifacts/*` prefix only. An explicit `Deny` statement
(`ExplicitDenyOfDangerousPlanes`) blocks `lambda:UpdateFunctionConfiguration`,
`secretsmanager:*`, `kms:Decrypt`/`GenerateDataKey`, `rds:*`, scheduler
mutation, `cloudformation:*ChangeSet/*Stack`, direct `apigateway:POST/PUT/
PATCH/DELETE`, and all `iam:Create*/Put*/Attach*/Delete*/Update*` — belt and
suspenders against this role ever becoming a backdoor into any other
protected surface.

## 9. InfraPlanRole Permission Detail

Scoped to `cloudformation:CreateChangeSet/DescribeChangeSet/DeleteChangeSet/
ListChangeSets/Describe*/List*/GetTemplate/DetectStackDrift/
DescribeStack*Drift*`, restricted to the exact
`fitness-assistant-dev-api-gateway` stack ARN pattern only; template
validation (unscoped, read-only); the artifact bucket's `ci-templates/*`
prefix; read-only `apigateway:GET` on the protected API; and `iam:PassRole`
restricted to exactly `CfnExecutionRole`'s own ARN with
`iam:PassedToService=cloudformation.amazonaws.com`. An explicit `Deny`
blocks `ExecuteChangeSet`/`CreateStack`/`UpdateStack`/`DeleteStack`,
`secretsmanager:*`, and Lambda code/config mutation — this role can prepare
a change but never apply one.

## 10. InfraApplyRole Permission Detail

Scoped to `cloudformation:ExecuteChangeSet/DescribeChangeSet/Describe*/
List*/DetectStackDrift/DescribeStack*Drift*`, restricted to the same single
stack ARN pattern; read-only `apigateway:GET` for post-apply parity checks;
the same `iam:PassRole`-to-`CfnExecutionRole`-only grant. An explicit `Deny`
blocks direct `apigateway:POST/PUT/PATCH/DELETE`, `secretsmanager:*`, and
Lambda code/config mutation — this role can only ever write the protected
API through CloudFormation, never directly.

## 11. CfnExecutionRole Permission Detail

The actual writer. Trusted only by the `cloudformation.amazonaws.com`
service principal (`aws:SourceAccount` condition-pinned to this account) —
never by GitHub OIDC directly, so no workflow can assume it without going
through a CloudFormation `ExecuteChangeSet`/`CreateChangeSet` call that
itself requires `InfraPlanRole`/`InfraApplyRole`'s own `iam:PassRole` grant.
Scoped to `apigateway:GET/POST/PUT/PATCH/DELETE` on the protected API's
routes/integrations/stages and the shared `/tags/*` ARN (tagging uses the
same HTTP-method-style actions — see the real bug fix in §18), plus
`lambda:AddPermission/RemovePermission/GetPolicy/GetFunction` on exactly the
6 Lambdas actually wired into the protected API's integrations. An explicit
`Deny` hard-stops `apigateway:DELETE` on the API itself and
`apigateway:POST` on the account-level `/apis` collection — this role can
manage the protected API's contents but can never delete or duplicate the
API resource itself.

## 12. Resource Scope Inventory

Machine-readable inventory: `ci/aws/dev-resource-scope.json`. Every ARN in
it was read from a real, live AWS API call on 2026-10-12
(`--profile gymini-admin`) — none are guessed from naming convention. It
records: the OIDC provider ARN, the protected API's ARN forms, the API
Gateway stack ARN, all 16 live Lambda function ARNs (split into the 12
AppDeployRole can code-deploy, the 5 it can smoke-invoke, the 6
CfnExecutionRole can manage permissions on, and the 4 `*-migrate` functions
explicitly excluded from CI code-deploy), the Chat ECS cluster/service ARN,
the Chat ECR repository ARN, the Chat execution/task role ARNs, the
artifact S3 bucket ARN and its two CI-owned prefixes, and the CloudWatch
Logs log-group wildcard AppDeployRole can read for smoke correlation.

## 13. Static Policy Review Table

| Concern | Finding |
|---|---|
| Any new role's statement with `Resource: "*"` | Present only where AWS has no resource-level ARN support for that action: `ecr:GetAuthorizationToken` (account-level by design), `ecs:RegisterTaskDefinition`/`DescribeTaskDefinition`/`ListTaskDefinitions` (no resource-level ARN in IAM), `ecs:ListTasks`/`DescribeTasks` (scoped instead via an `ecs:cluster` ArnEquals condition), `elasticloadbalancing:DescribeTargetHealth`/`DescribeTargetGroups` (read-only), `scheduler:ListSchedules` (read-only), `cloudformation:ValidateTemplate`/`GetTemplateSummary` (unscoped by AWS design), `CiReadRole`'s `cloudformation:DescribeStacks`/etc. (read-only, PR-triggered role). None of these is a mutation on an unrelated resource. |
| `iam:PassRole` scope | Every grant is restricted to specific, named role ARNs with a matching `iam:PassedToService` condition (Chat roles → `ecs-tasks.amazonaws.com`; `CfnExecutionRole` → `cloudformation.amazonaws.com`). No `Resource: "*"` PassRole anywhere — confirmed by `Test-HasUnrestrictedPassRole` across all 5 roles (§19). |
| `secretsmanager:GetSecretValue` / bulk secret read | Absent from every Allow statement in all 5 roles; `AppDeployRole`/`InfraPlanRole`/`InfraApplyRole` each carry an explicit `secretsmanager:*` Deny. Confirmed by `Test-PolicyGrantsAction` (§19). |
| `AdministratorAccess` / `Action:"*" + Resource:"*"` | Absent from all 5 roles; no `ManagedPolicyArns` on any role. Confirmed by test (§19). |
| `iam:*` | Absent from all 5 roles (a false positive on this exact check, caused by a bidirectional-match bug in the first draft of the test helper, was found and fixed — see §19). |
| `InfraPlanRole` cannot `ExecuteChangeSet` | Confirmed: no Allow statement grants it; an explicit Deny does. |
| `AppDeployRole` cannot mutate API Gateway routes | Confirmed: no Allow statement grants `apigateway:POST/PUT/PATCH/DELETE`; an explicit Deny does. |

## 14. High-Risk Areas Explicitly Excluded

None of the 5 roles' policies grant: IAM administration (`iam:Create*/
Put*/Attach*/Delete*/Update*` — explicitly denied on `AppDeployRole`, absent
everywhere else), AWS Organizations or account management actions, disabling
CloudTrail/GuardDuty, KMS key deletion (`kms:ScheduleKeyDeletion` etc. —
absent; `AppDeployRole` explicitly denies even `kms:Decrypt`/
`GenerateDataKey`), Secrets Manager mutation or bulk read (`secretsmanager:*`
explicitly denied on 3 of 5 roles, absent on the other 2), RDS/Aurora
deletion (`rds:*`/`rds-data:*` explicitly denied on `AppDeployRole`, absent
elsewhere), or VPC/networking deletion. None of these action families
appears in any Allow statement across all 10 policy documents (5 trust + 5
permission) — confirmed by direct inspection of the resolved policy fixture.

## 15. IaC Ownership & Duplicate-Resource Avoidance

`OIDC_PROVIDER_IAC_OWNER: Terraform`. `NEW_OIDC_PROVIDER_PLANNED: NO`. The 5
new roles are declared only in `infra/cloudformation/ci-cd-oidc.yaml`
(CloudFormation), which references the Terraform-owned provider ARN by
parameter and never re-declares an `AWS::IAM::OIDCProvider` resource
(confirmed by a direct text-absence test, §19). `infra/terraform/modules/
iam/main.tf` was read but not modified by this phase.

## 16. Workflow → Role Matrix

| Workflow (draft, `ci/drafts/github-actions/`, not active) | Role Assumed |
|---|---|
| PR validation (not yet written as a workflow file) | `GyminiDevCiReadRole` |
| `infra-plan.yml` | `GyminiDevInfraPlanRole` |
| `infra-deploy.yml` | `GyminiDevInfraApplyRole` → passes `GyminiDevCfnExecutionRole` to CloudFormation |
| App deploy (not yet written as a workflow file) | `GyminiDevAppDeployRole` |

## 17. Environment / Subject Matrix

| GitHub Environment | Subject Claim | Role | Requires Human Reviewer |
|---|---|---|---|
| (PR, no environment) | `repo:trmizy/fitness-assistant:pull_request` | `GyminiDevCiReadRole` | No |
| `dev` | `repo:trmizy/fitness-assistant:environment:dev` | `GyminiDevAppDeployRole` | Per GitHub Environment config (not this phase's scope) |
| `dev-infra-plan` | `repo:trmizy/fitness-assistant:environment:dev-infra-plan` | `GyminiDevInfraPlanRole` | No (plan-only, non-mutating) |
| `dev-infra` | `repo:trmizy/fitness-assistant:environment:dev-infra` | `GyminiDevInfraApplyRole` | **Yes — required**, since this role's `ExecuteChangeSet` is the only path to a live API Gateway mutation |

## 18. Access Analyzer Validation Results

`aws accessanalyzer validate-policy` (real, stateless, read-only) was run
against all 5 trust policies (`--policy-type RESOURCE_POLICY`) and all 5
permission policies (`--policy-type IDENTITY_POLICY`), using policy JSON
resolved from the template's own real Parameter defaults
(`scripts/ci/cfn-iam-policy-extract.mjs`).

**Two real defects found and fixed in the template itself:**
1. `apigateway:TagResource does not exist` (`INVALID_ACTION`) on
   `CfnExecutionRole`'s permission policy — removed; the already-present
   `apigateway:POST`/`PUT` actions, already scoped to the `/tags/*` resource
   ARN, already cover tagging (API Gateway v2 uses HTTP-method-style IAM
   actions throughout, including for tags).
2. Top-level template `Description` exceeded CloudFormation's 1024-character
   limit (`cloudformation validate-template` failure) — shortened to ~705
   characters.

**Post-fix re-validation:** `CfnExecutionRole`'s permission policy now
returns `[]` (zero findings). All other 4 roles' permission policies already
returned `[]`. `cloudformation validate-template` now succeeds, returning
`Capabilities: ["CAPABILITY_NAMED_IAM"]` with no error.

**Non-blocking findings accepted, not chased:** `MISSING_RESOURCE` on all 5
trust policies — a validator-level false positive specific to IAM role trust
policies (which structurally never need a `Resource` field; confirmed
against both AWS's own documented Federated-principal trust-policy example
and the live legacy role's own working trust policy, neither of which has a
`Resource` field either). `CONFIRM_AUDIENCE_CLAIM_TYPE` (SUGGESTION) on 4 of
5 trust policies — already correctly handled (the `aud` claim is already a
scalar `StringEquals` match, exactly as the suggestion recommends).

`ACCESS_ANALYZER_ERRORS: 0`. `SECURITY_WARNINGS_UNRESOLVED: 0` (the two
non-blocking items above are SUGGESTION/structural-false-positive, not
unresolved warnings).

## 19. Automated Test Coverage

**New:** `scripts/ci/IamPolicyGuard.psm1` (pure, offline static-audit
functions — `Test-GitHubSubClaim`, `Test-PolicyGrantsAction`,
`Test-HasUnrestrictedPassRole`, `Test-ActionDeniedOnResource`, etc.) +
`scripts/ci/IamPolicyGuard.Tests.ps1` (82 tests) covering all 14 of the
brief's mandated negative scenarios (OIDC-provider-duplicate forbidden, repo
scope required, audience required, wildcard repo trust forbidden, static
AWS keys forbidden, AdministratorAccess forbidden, `iam:*` forbidden,
unrestricted PassRole forbidden, secrets bulk-read forbidden, unrelated
Lambda/ECS denied, infra-plan cannot ExecuteChangeSet, app-deploy cannot
mutate API Gateway routes, wrong repo/branch/environment trust denied,
legacy role not silently broadened) plus positive per-role capability proofs
and cross-role consistency checks — all run against the real, resolved
policy content of `ci-cd-oidc.yaml`
(`scripts/ci/__fixtures__/ci-cd-oidc-resolved-policies.json`, produced by the
new `scripts/ci/cfn-iam-policy-extract.mjs`). `POLICY_NEGATIVE_TESTS: 14/14
scenarios covered`. `POLICY_POSITIVE_TESTS: 7 per-role capability proofs, all
passing`.

**Two real bugs found and fixed while building this suite** (both CODE
AUDIT tier, not live AWS):
1. `Test-PolicyGrantsAction`'s original implementation matched in both
   directions, so a narrow, correctly-scoped `iam:PassRole` grant on
   `InfraPlanRole`/`InfraApplyRole` was falsely reported as "effectively
   grants `iam:*`". Fixed by making the match strictly one-directional
   (does the policy's own action entry's wildcard pattern cover the probed
   pattern — never the reverse).
2. The "legacy role not silently broadened" test originally scanned the
   entire template text, which falsely flagged the template's own
   `Description` field (which legitimately mentions the legacy role's name
   in prose, documenting that it's left untouched). Fixed by scanning only
   the `Resources:` section.

**Full regression:** `SCOPED REQUIRED REGRESSION: scripts/ci/*.Tests.ps1,
scripts/aws/**/*.Tests.ps1` (every existing Pester suite in this repo's CI
tooling, plus the 2 new files) — **299/299 pass, 0 failed, 0 skipped**
(217 pre-existing baseline + 82 new, exact arithmetic match).
`PREVIOUS_TESTS_REGRESSED: NO`. `FULL_SAFETY_TESTS: 299/299`.

This is CODE AUDIT / BACKEND INTEGRATION (Pester-level) evidence, never REAL
BROWSER or REAL HTTP/API against a live IAM role, since AWS_MUTATIONS=0 for
this entire phase means no role exists yet to test against live.

## 20. Activation Manifest, Cryptographic Hashes & Readiness for Phase 16B.1B

`docs/deployment/generated/cicd-iam-activation-plan.json` — lists all 5
roles to be created (RESOURCE_TYPE/NAME/PURPOSE/IAC_OWNER/
TRUST_POLICY_SHA256/PERMISSION_POLICY_SHA256/EXPECTED_ARN/ACTION=CREATE) plus
the 2 resources explicitly left unchanged (OIDC provider, legacy role).

| Artifact | SHA-256 |
|---|---|
| `infra/cloudformation/ci-cd-oidc.yaml` | `91ba592374184025146d234d3cc12dd6d2b4bb1dc7268a5143983e5727d193dc` |
| `cicd-iam-activation-plan.json` (this manifest) | `d4492ba82f4c6a2b36920880520e64a332c21982b5b3a59385201f11f5979428` |
| Per-role trust/permission policy digests | see the manifest file (5 roles × 2 digests each) |

`PLAN_ARTIFACTS_HASHED: YES`. Files created/edited this phase:
`infra/cloudformation/ci-cd-oidc.yaml` (2 real bug fixes),
`ci/aws/dev-resource-scope.json` (new),
`scripts/ci/cfn-iam-policy-extract.mjs` (new),
`scripts/ci/__fixtures__/ci-cd-oidc-resolved-policies.json` (new, generated),
`scripts/ci/__fixtures__/ci-cd-oidc-digests.json` (new, generated),
`scripts/ci/IamPolicyGuard.psm1` (new),
`scripts/ci/IamPolicyGuard.Tests.ps1` (new),
`docs/deployment/generated/cicd-iam-activation-plan.json` (new),
`docs/deployment/AWS_DEV_CICD_OIDC_IAM_PLAN_2026-10-12.md` (this report).
No workflow file was moved out of `ci/drafts/`. No IAM role, policy, or OIDC
provider was created, modified, or deleted. `READY_FOR_PHASE_16B_1B: YES`,
pending explicit owner authorization to actually apply
`ci-cd-oidc.yaml` (Phase 16B.1B is out of scope for this phase and was not
started).

---

## Final Response

```
PHASE: 16B.1A
AWS_MUTATIONS: 0
GITHUB_OWNER: trmizy
GITHUB_REPOSITORY: trmizy/fitness-assistant
GITHUB_DEFAULT_BRANCH: master
OIDC_PROVIDER_EXISTS: YES
OIDC_PROVIDER_REUSE: YES
OIDC_PROVIDER_IAC_OWNER: Terraform
NEW_OIDC_PROVIDER_PLANNED: NO
LEGACY_CI_ROLE: fitness-assistant-github-actions-ci
LEGACY_CI_ROLE_ACTION: LEAVE_UNCHANGED
PROPOSED_NEW_ROLES: 5
ROLE_NAMES: GyminiDevCiReadRole, GyminiDevAppDeployRole, GyminiDevInfraPlanRole, GyminiDevInfraApplyRole, GyminiDevCfnExecutionRole
STATIC_AWS_ACCESS_KEYS: NO
ADMINISTRATOR_ACCESS: NO
IAM_STAR: NO
UNRESTRICTED_PASSROLE: NO
NORMAL_DEPLOY_SECRET_READ: NO
INFRA_PLAN_CAN_EXECUTE_CHANGESET: NO
APP_DEPLOY_CAN_DIRECTLY_MUTATE_API_ROUTES: NO
TRUST_REPOSITORY_SCOPED: YES (all 4 OIDC-trusting roles, StringEquals, repo:trmizy/fitness-assistant prefix)
DEPLOY_TRUST_BRANCH_OR_ENV_SCOPED: YES (environment:dev / dev-infra-plan / dev-infra)
FORK_PR_AWS_CREDENTIAL_EXPOSURE: LIMITED_TO_READ_ONLY_ROLE (only GyminiDevCiReadRole trusts pull_request; it has no mutation capability)
ACCESS_ANALYZER_ERRORS: 0
SECURITY_WARNINGS_UNRESOLVED: 0
POLICY_NEGATIVE_TESTS: 14/14 scenarios covered (82 total assertions)
POLICY_POSITIVE_TESTS: 7/7 per-role capability proofs passing
FULL_SAFETY_TESTS: 299/299
PREVIOUS_TESTS_REGRESSED: NO
ACTIVATION_MANIFEST: docs/deployment/generated/cicd-iam-activation-plan.json
PLAN_ARTIFACTS_HASHED: YES
OIDC_ROLE_CREATED: NO
WORKFLOW_ACTIVATED: NO
API_GATEWAY_CHANGED: NO
SOURCE_ONLY_DEPLOYED: 0
SERVICES_REDEPLOYED: 0
SERVICES_STOPPED: 0
CI_ACTIVATION_AUTHORIZED: NO
READY_FOR_PHASE_16B_1B: YES
REPORT: docs/deployment/AWS_DEV_CICD_OIDC_IAM_PLAN_2026-10-12.md
FINAL_DECISION: PLAN COMPLETE, STATICALLY VALIDATED, TEST-COVERED (299/299) - NOT ACTIVATED
```

**HARD STOP — this phase created no IAM role, modified no OIDC provider,
activated no workflow, deployed no service, executed no CloudFormation
change set, added no SOURCE_ONLY route, ran no migration, and changed no
lifecycle state. Phase 16B.1B (actually applying `ci-cd-oidc.yaml` and
moving a workflow out of `ci/drafts/`) requires separate, explicit owner
authorization and has not begun.**
