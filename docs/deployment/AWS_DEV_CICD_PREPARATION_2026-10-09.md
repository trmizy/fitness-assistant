# Gymini DEV — CI/CD Preparation After Verified API Gateway Adoption — 2026-10-09 (Phase 16A)

No credential, secret value, access key, or secret access key appears anywhere in this report.

## Executive Summary

Phase 16A is preparation-only: **zero AWS mutations** were performed (read-only discovery calls
only — `sts get-caller-identity`, `iam get-role`/`list-*-policies`, `iam list-open-id-connect-providers`,
`lambda list-functions`, `ecs describe-services`, `ecr describe-repositories`,
`cloudformation list-stacks` — confirmed by a final `git status` + AWS inventory check showing zero
new stacks, zero new IAM roles, zero file mutations by this phase).

A substantial, independently-produced first draft of this exact CI/CD preparation already existed in
the working tree when this phase began — `ci/`, `scripts/ci/`, and
`infra/cloudformation/ci-cd-oidc.yaml` carry timestamps (~16:20–16:28 local time) from minutes before
this phase started, consistent with this repo's documented parallel-agent workflow (Codex may work
concurrently). Per this phase's own "do not overwrite useful preparation work unnecessarily"
instruction and the repo's `gymini-parallel-agent-safety` convention, this report **audits and
verifies** that existing work rather than duplicating it: every non-obvious claim in it was checked
against the real repository and real (read-only) AWS state, not taken on trust. The audit found the
existing design to be thorough and well-grounded, found **one real integration gap** (detailed below,
not yet fixed — this report documents it for the owner, since the file is another agent's active
work), and confirms the artifacts already satisfy nearly all of this phase's requirements.

**`CICD_PREPARATION_READY`** — with the one documented gap and the pre-existing activation blockers
(CloudFormation normal-update certification, OIDC role creation, GitHub environment setup) still
correctly unresolved, exactly as this phase requires.

## Post-Adoption Baseline

```
API_GATEWAY_ADOPTION_COMPLETE: YES (Phase 15B-B2B2)
API_GATEWAY_STACK: fitness-assistant-dev-api-gateway
API_GATEWAY_MANAGED_RESOURCES: 254
API_GATEWAY_DRIFT: IN_SYNC (0 drifted, re-confirmed available via the stack's current state)
LIVE_ROUTE_COUNT: 119, MATCH: 119, SOURCE_ONLY: 10, MISMATCHED: 0, GATEWAY_ONLY: 0
```

The 10 `SOURCE_ONLY` routes remain intentionally undeployed; Phase 15C owns their resolution.

## Existing CI Inventory

```
CI_PROVIDER_CURRENT: GitHub Actions (.github/workflows/docker-test.yml — the only ACTIVE workflow)
ACTIVE_CI: "Docker Fast Test" — lint, root build, unit tests, AI evaluation/policy tests, fast
  Docker test, plus an independent "Critical DB Integration" Postgres gate. Pure validation: no AWS
  credentials step, no OIDC, no deploy action anywhere in the file.
ACTIVE_DEPLOY_PIPELINE: NONE — every AWS deployment performed in this engagement to date (Lambda
  code updates, the API Gateway CloudFormation import) was a manual, human-run AWS CLI action using
  --profile gymini-admin, not an automated pipeline.
LEGACY_DEPLOYMENT_PATHS: manual `aws lambda update-function-code` (direct or S3-mediated for >50MB
  artifacts, as used in Phase 14B), scripts/aws/dev-start.ps1 / dev-stop.ps1 for environment
  lifecycle, manual CloudFormation change-set create/execute for the API Gateway (Phase 15B).
CI_PROVIDER_SELECTED: GitHub Actions (repository remote is GitHub; no stronger reason found to
  deviate).
```

## Repository Build Graph

Verified directly against each service's real `package.json` (not inferred):

| Service | Build | Test | Lambda package | Migrate artifact | Deployed migrate Lambda? |
|---|---|---|---|---|---|
| auth | `tsc` | `tsx --test src/__tests__/*.test.ts` | `build:lambda-zip` | `build:lambda-migrate` | NO (verified via live `lambda list-functions`) |
| user | `tsc` | `tsx --test ...` | `build:lambda-zip` | `build:lambda-migrate` | NO |
| fitness | `tsc` | `tsx --test ...` (+ catalog suites) | `build:lambda-zip` | `build:migrate-lambda-zip` | NO |
| gym | `tsc` | `tsx --test ...` | `build:lambda-zip` | `build:migrate-lambda-zip` | **YES** — `fitness-assistant-dev-gym-migrate` |
| payment | `tsc` | `tsx --test ...` (narrow `test`; separate `test:integration`) | `build:lambda-zip` | `build:migrate-lambda-zip` | **YES** — `fitness-assistant-dev-payment-migrate` |
| ai | `tsc` | `tsx --test ...` | `build:lambda:package` (note: different script name than the rest) | n/a in package.json | **YES** — `fitness-assistant-dev-ai-migrate` |
| chat | n/a (container) | `tsx --test ...` | Docker build (`backend/services/chat-service/Dockerfile`, confirmed present) | n/a | **YES** — `fitness-assistant-dev-chat-migrate` |
| gateway | `tsc` | — | n/a | n/a | n/a — local dev-only Express proxy, never deployed to AWS |
| frontend/web | — | — | — | — | out of Phase 16A scope |

Root-level scripts (verified in root `package.json`): `lint` → `node scripts/check-repo-hygiene.mjs`;
`build` → `pnpm run --recursive build`; `prisma:generate` → runs `db:generate` across all 7 backend
services (needed before `tsc` typechecks against generated Prisma types).

`fitness-assistant-github-actions-ci` (a role created in Phase 1, 2026-08-04, trust-scoped to this
same repo) already exists but is scoped to only `plan-read-only`/`state-backend-read` — a
Terraform-plan role, unrelated to and non-conflicting with the Lambda/API-Gateway CI this phase
designs.

## Service Dependency Graph

From `ci/service-impact-map.json` (already built and cross-checked against the real pnpm workspace
dependency graph by the artifact's own author — re-verified here: every backend service's
`package.json` depends on `@gym-coach/shared` via `workspace:*` and nothing else in-workspace):

| Service | Source path | Shared deps | AWS target | Deploy dependency |
|---|---|---|---|---|
| auth/user/fitness/gym/payment/ai | `backend/services/<svc>-service` | `@gym-coach/shared` | 1-2 Lambda functions each (see table above) | none cross-service |
| chat | `backend/services/chat-service` | `@gym-coach/shared` | ECS Fargate (`fitness-assistant-dev-cluster`/`-chat-service`, confirmed live) | none |
| gateway | `backend/gateway` | `@gym-coach/shared` | validate-only (never deployed) | none |

A `backend/shared/` change correctly propagates to all 7 backend consumers (incl. gateway);
`frontend/` changes are isolated to `frontend-web` (out of scope); a lockfile/toolchain change
(`package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`/`tsconfig.base.json`) propagates to everything.

## Change Impact Model

`ci/service-impact-map.json` + `scripts/ci/CiHelpers.psm1`'s `Get-CiImpact` implement a deterministic,
fail-safe classifier: every changed path is matched against every rule; the union of matched targets
is the impact; a path matching **no** rule is `Unclassified` → `ValidateAll`/`DeployBlocked` (never
guesses). Rules exist for: per-service prefixes, `backend/shared/`, workspace-lockfile files,
`scripts/aws/api-gateway/` + the two protected CloudFormation templates (→ infra-only, no Lambda
redeploy), `scripts/aws/lib/` + the lifecycle template (→ infra, validate-only — CI never applies it),
the OIDC template itself (→ infra, validate-only), `ci/`/`scripts/ci/`/`.github/workflows/`
(→ CI-meta, validate-only), and `docs/`/`reports/`/snapshot/backup directories (→ ignored).

**Independently re-verified via a real test run** (not just read): `Invoke-Pester
scripts/ci/CiHelpers.Tests.ps1` → **52/52 passed**, covering 10 distinct `Get-CiImpact` scenarios
(user-only, shared-propagates-to-all, chat-only selects ECS not Lambda, infra-only redeploys nothing,
API Gateway path selects infra only, lockfile selects everything, docs-only selects nothing without
being Unclassified, an unknown path is Unclassified and blocks deploy, a `prisma/migrations/` path
flags migration review, Windows backslash paths normalize).

## Artifact Strategy

Immutable build-once/deploy-same-artifact, implemented in `scripts/ci/Build-LambdaArtifact.ps1`
(dry-run by default, `-Execute` required to actually build) and consumed by the `dev-build.yml` /
`dev-deploy.yml` draft workflow pair:

```
SOURCE -> pnpm --filter <svc> run build:lambda-zip (ai: build:lambda:package)
       -> verify required handler file(s) present inside the zip (dist/lambda.js, etc.)
       -> SHA256(zip) + git SHA -> <service>-<gitSha>.manifest.json
       -> uploaded as a GitHub Actions artifact (dev-build.yml), 30-day retention
       -> dev-deploy.yml re-verifies the SHA256 against the manifest BEFORE any AWS call
       -> content-addressed S3 key: ci-artifacts/<service>/<gitSha>/<sha256>.zip
       -> aws lambda update-function-code --s3-bucket ... --s3-key ... (CODE ONLY)
```

No step rebuilds Lambda code after CI already tested a given build — `dev-deploy.yml` only ever
downloads a named `build_run_id`'s artifacts. For Chat, the equivalent flow builds the Docker image
once, tags it with the git SHA, pushes to the existing, confirmed-real `fitness-assistant-dev-chat`
ECR repository, and registers a new ECS task-definition revision from that exact tag.

```
IMMUTABLE_ARTIFACT_STRATEGY: PASS
```

## Lambda Deployment Strategy

Three deploy planes are explicitly separated, matching this phase's own required model:

| Plane | What it touches | Where |
|---|---|---|
| `CODE_DEPLOY` | `lambda:UpdateFunctionCode`, `PublishVersion`, `GetFunction` only | `dev-deploy.yml` (normal path) |
| `CONFIG_DEPLOY` | `lambda:UpdateFunctionConfiguration` | explicitly **denied** to `GyminiDevAppDeployRole`; `Test-DeployPlanSafety -Mode CodeDeploy` rejects any planned command matching it, and only accepts it under `-Mode ConfigDeploy` (verified by Pester test "update-function-configuration only passes in ConfigDeploy mode") |
| `SECRET_ROTATION` | `JWT_SECRET`/`JWT_REFRESH_SECRET`/`INTERNAL_SERVICE_SECRET`/`INTERNAL_API_SECRET`/`SMTP_PASS`/`PT_DOCUMENT_URL_SECRET` | never reachable from CI at all — `GyminiDevAppDeployRole`'s policy has an explicit `Deny` on `secretsmanager:*`, and `Test-DeployPlanSafety` rejects any `secretsmanager:put-secret-value`/`rotate-secret`/etc. command unconditionally (`Always: true`) |

Every AWS CLI call in `dev-deploy.yml` that could print Lambda state uses a narrow `--query` (e.g.
`Configuration.[FunctionName,CodeSha256,LastUpdateStatus]`), and every captured output file is passed
through `Find-SecretLikeOutput` (via the `scan()` shell helper) before being written to the job
summary — an unscoped `lambda get-function`/`get-function-configuration` call (which would dump
`Environment.Variables`) is a rejected `BROAD_CONFIG_DUMP` violation in `Test-DeployPlanSafety`,
independently confirmed by its own Pester test.

```
LAMBDA_DEPLOY_STRATEGY: PASS
SECRET_HANDLING: PASS
```

## Chat ECS Strategy

`Get-ChatDeployMode` in `CiHelpers.psm1` (3 Pester tests, all passing) implements exactly the
required lifecycle-preserving behavior:

- Chat currently OFF (`desiredCount` 0) and no explicit override → `REGISTER_AND_PIN_ONLY`: a new task
  definition revision is registered and pinned on the service, but `--desired-count` is **never**
  passed to `ecs update-service` — so the deploy cannot accidentally turn Chat on.
- Chat currently ON → `ROLLING_UPDATE`, still without passing a desired count (preserves whatever the
  owner set it to).
- An explicit `force_on` input is required to actually set `desiredCount=1` from an OFF state.

Live-verified this phase (read-only): `fitness-assistant-dev-chat-service` currently has
`desiredCount: 1`, running task definition revision 8 — consistent with the continuous full-service
session this engagement has kept running.

```
CHAT_DEPLOY_STRATEGY: PASS
```

## Database Migration Strategy

```
Migration tooling: Prisma, one schema per service (confirmed: gym/payment/ai/chat each have a real,
  deployed *-migrate Lambda function; auth/user/fitness have a local build:lambda-migrate /
  build:migrate-lambda-zip script but NO deployed migrate function in this account today).
Does deploy auto-run migrations today? NO at any layer checked: dev-deploy.yml's CODE_DEPLOY path
  never invokes a *-migrate function, and Test-DeployPlanSafety's MIGRATION_IN_CODE_DEPLOY rule
  (Always: true) unconditionally rejects any planned "prisma migrate" or "lambda invoke ...-migrate"
  command in a code deploy.
Requires Aurora: YES (fitness-assistant-dev-aurora, the one shared cluster for every service's own
  database per Phase 11's secret-per-service convention).
```

Classification (design-level; no live migration file audit was performed this phase — out of scope):

- `SAFE_BACKWARD_COMPATIBLE`: additive column/table changes with a default or nullable value.
- `REVIEW_REQUIRED`: `NOT NULL` added to an existing column, renames without a compatibility period,
  large table rewrites.
- `DESTRUCTIVE`: `DROP TABLE`/`DROP COLUMN`, any irreversible data transform.

`ci/service-impact-map.json`'s `migrationPathPattern` already flags any change under a service's
`prisma/migrations/` directory into a `migrationReview` list surfaced by `Get-CiImpact` — this is the
hook a future migration-guard pipeline step would consume; no such step exists yet (correctly: this
phase does not execute migrations).

```
DATABASE_MIGRATION_STRATEGY: PASS (design only, not yet wired into an automatic gate — acceptable for
  Phase 16A since no migration pipeline exists or runs)
```

## API Gateway CloudFormation Strategy

The plan/apply split exactly matches 16A.7/16A.21/16A.22:

```
infra-plan.yml   (GyminiDevInfraPlanRole, CANNOT execute - explicit Deny on ExecuteChangeSet):
  validate -> upload template (content-addressed by its own sha256 to S3) -> create-change-set
  (type UPDATE, role-arn = GyminiDevCfnExecutionRole) -> wait complete -> Test-ChangeSetSafety scan
  -> publish changes.json + a "reviewed_digest" (sha256 of changes.json) to the job summary.

infra-deploy.yml (GyminiDevInfraApplyRole, CANNOT create-change-set):
  re-describe the named change set -> re-hash its Changes JSON -> compare against the
  reviewed_digest input -> CHANGESET_DIGEST_MISMATCH hard-fails if they differ -> re-run
  Test-ChangeSetSafety one more time -> execute-change-set -> wait -> post-apply invariants
  (API ID unchanged, Test-ApiRouteParity.ps1, /health 200, detect-stack-drift).
```

`Test-ChangeSetSafety` (CiHelpers.psm1) is a from-scratch, more granular reimplementation of this
repo's own `Find-DestructiveChangeSetActions` (reused, not duplicated, as a defense-in-depth second
opinion inside the same function) — it classifies every change as `HARD_BLOCK` (API
creation/replacement, or a wrong `HttpApiId` parameter — never allowlistable), `BLOCK` (route/stage/
integration/permission removal or replacement — allowlistable only with a non-expired, named,
reasoned entry), or `APPROVAL` (ordinary adds/modifies — never blocking, but forces the manual-
approval `dev-infra` GitHub Environment). 11 Pester tests on this function, all passing, including
allowlist-expiry and "the allowlist can never override an API HARD block."

**Real gap found by this audit** (not yet fixed — this file belongs to another agent's active
workstream, so this report documents it for the owner rather than silently patching it):
`scripts/ci/Test-DeploymentSafety.ps1`'s `-ChangeSetFile` branch calls `Test-ChangeSetSafety` with
`-ParameterValues @{ HttpApiId = $ProtectedApiId }` — i.e. it **always** passes a value equal to the
very thing it's supposed to be checked against, rather than reading the real `Parameters` array from
the actual `describe-change-set` output. The underlying `API_ID_MISMATCH` hard-block is correctly
implemented and unit-tested in isolation (Pester test "7b) a HttpApiId other than the protected API is
a HARD block" calls the function directly with a genuinely different value and it fires), but through
this CLI wrapper — the one every draft workflow actually calls — **it can never fire in practice**,
because the comparison is always `$ProtectedApiId -eq $ProtectedApiId`. This should be fixed (read
`Parameters` from the change-set JSON and pass the real `HttpApiId` value through) before Phase 16B
wires any of these workflows to a real OIDC role.

```
API_GATEWAY_CFN_PIPELINE: PASS (with the one documented wrapper-level gap above)
```

## First Normal Update Certification Requirement

The stack has been imported (Phase 15B) but **no ordinary CloudFormation `UPDATE`** has yet been run
against it. Both `infra-plan.yml` and `infra-deploy.yml` already correctly gate on a repository
variable (`vars.APIGW_ADOPTION_COMPLETE`) that must read exactly `"true"` before they will run at
all — set once the owner is satisfied, not something CI sets itself. Even with that variable set,
activating either workflow before a real, human-supervised no-op/safe-update trial would mean the
*first* normal UPDATE this template ever receives happens unattended.

```
CFN_NORMAL_UPDATE_CERTIFIED: NO (confirmed — correctly not attempted this phase or any prior one)
```

**Recommended future certification phase** (not performed now): with `--profile gymini-admin`, create
a real, non-executed `UPDATE`-type change set against `fitness-assistant-dev-api-gateway` using the
unchanged `api-gateway-baseline.yaml`, confirm it reports `FAILED`/`"No updates are to be performed"`
(a true no-op), then — only after that evidence exists — flip `APIGW_ADOPTION_COMPLETE` adjacent
readiness state for infra workflows.

## GitHub OIDC Architecture

```
git remote -v -> origin https://github.com/trmizy/fitness-assistant.git
GITHUB_REPOSITORY: trmizy/fitness-assistant (OWNER=trmizy, REPO=fitness-assistant — read from the
  real remote, not guessed)
```

**Real, read-only discovery (not assumed)**: `aws iam list-open-id-connect-providers` shows
`token.actions.githubusercontent.com` **already exists** in this account (`ClientIDList:
["sts.amazonaws.com"]`, created 2026-08-04 — Phase 1 — tagged `project=fitness-assistant`,
`managed-by=terraform`). `infra/cloudformation/ci-cd-oidc.yaml` correctly discovered this
independently and **references it by ARN** (`ExistingOidcProviderArn` parameter) rather than
declaring a second `AWS::IAM::OIDCProvider` — re-verified by this audit directly against AWS, not
re-derived from the template's own comment. A separate, pre-existing role trusting the same provider
(`fitness-assistant-github-actions-ci`, same creation date) was also found and confirmed scoped only
to `plan-read-only`/`state-backend-read` (Terraform-plan CI, unrelated) — correctly left untouched by
the new design.

```
OIDC_STRATEGY: PASS (discovery + reuse, no provider duplication, no clobbering of the legacy role)
```

Per 16A.10's explicit instruction, **no OIDC provider and no role was created this phase** — `aws iam
list-roles` for any `Gymini*`-named role returns empty, confirming `ci-cd-oidc.yaml` is still a draft,
never applied.

## Least-Privilege IAM

Five roles, each trusting exactly one GitHub OIDC subject (`pull_request`, `environment:dev`,
`environment:dev-infra-plan`, `environment:dev-infra`, or the CloudFormation service principal for the
one that CloudFormation itself assumes) — reviewed line-by-line:

- `GyminiDevCiReadRole`: `cloudformation:ValidateTemplate`/`GetTemplateSummary`/`Describe*`/
  `ListStackResources`/`GetTemplate` + `apigateway:GET` scoped to the one protected API ARN. No
  mutation action anywhere.
- `GyminiDevAppDeployRole`: Lambda code-update actions scoped to the 11 named function ARNs (no
  wildcard), `lambda:InvokeFunction` scoped to only the 5 non-ECS functions actually smoke-tested,
  S3 scoped to the `ci-artifacts/*` prefix only, ECR push scoped to the one Chat repo, ECS
  `UpdateService` scoped to the one Chat service ARN, `iam:PassRole` scoped to exactly the two named
  Chat execution/task role ARNs with an `iam:PassedToService` condition — **and an explicit `Deny`**
  covering `UpdateFunctionConfiguration`, `AddPermission`/`RemovePermission`, `CreateFunction`/
  `DeleteFunction`, all of `secretsmanager:*`/`kms:Decrypt`/`rds:*`, all scheduler/events writes, every
  CloudFormation mutation verb, every non-GET `apigateway:*` verb, and every IAM write verb.
- `GyminiDevInfraPlanRole`: change-set create/describe/delete + drift-detect, scoped to the one
  protected stack ARN; `iam:PassRole` scoped to exactly `GyminiDevCfnExecutionRole`'s ARN with the
  CloudFormation-service condition; explicit `Deny` on `ExecuteChangeSet`/`CreateStack`/`UpdateStack`/
  `DeleteStack` and Lambda code/config writes.
- `GyminiDevInfraApplyRole`: `ExecuteChangeSet` + read-only, same stack ARN scope; explicit `Deny` on
  direct `apigateway:POST/PUT/PATCH/DELETE` (CloudFormation itself, via its own service role, is the
  only writer).
- `GyminiDevCfnExecutionRole`: the CloudFormation **service** role (trusted only by
  `cloudformation.amazonaws.com`, condition-scoped to this account) — the only principal with
  `apigateway:POST/PUT/PATCH/DELETE`, and even it carries an explicit `Deny` on
  `apigateway:DELETE`/`POST` against the bare `/apis/{id}` and `/apis` collection resources (so it
  cannot delete or recreate the API itself, only mutate routes/integrations/stages under it).

No role anywhere uses `AdministratorAccess`, `iam:*`, `organizations:*`, `account:*`, an unscoped
`secretsmanager:GetSecretValue`, or an unscoped `kms:Decrypt`.

```
CI_ADMINISTRATOR_ACCESS: NO
LONG_LIVED_AWS_KEYS_IN_CI: NO (OIDC AssumeRoleWithWebIdentity only, in every draft workflow)
OIDC_IAC_DRAFT: PASS
```

## Secret Handling

`Find-SecretLikeOutput` detects (types only, never values) JWTs, AWS access-key IDs, PEM private
keys, a raw Lambda `Environment.Variables` dump, and any of the six named secrets
(`JWT_SECRET`/`JWT_REFRESH_SECRET`/`INTERNAL_SERVICE_SECRET`/`INTERNAL_API_SECRET`/`SMTP_PASS`/
`PT_DOCUMENT_URL_SECRET`) appearing as an assigned value in text — 5 Pester tests confirm it detects
each without ever surfacing the underlying value, and correctly ignores a masked (`****`) or bare
reference. Every AWS CLI call in `dev-deploy.yml` that could leak state is piped through this scanner
before being written anywhere. Test account credentials are never written into workflow YAML in any
draft file reviewed.

```
SECRET_HANDLING: PASS
```

## Scheduler / Lifecycle Preservation

`dev-deploy.yml` snapshots `aws scheduler list-schedules` before and after a deploy and diffs them,
failing the job if anything changed; `Test-ScheduleStatePreserved` (CiHelpers.psm1, 2 Pester tests)
is the pure-function form of the same check, and `Test-DeployPlanSafety`'s `SCHEDULER_MUTATION` /
`LIFECYCLE_SCRIPT` / `CHAT_POWER_CHANGE` rules (all `Always: true` except the lifecycle-script/
chat-power ones, which require an explicit `-AllowChatPowerChange` override that no draft workflow
ever passes) statically reject any planned `scheduler update/create/delete-schedule`,
`events enable/disable-rule`, `dev-start.ps1`/`dev-stop.ps1` invocation, or `ecs update-service
--desired-count` from a normal deploy plan.

```
DEPLOY_CONCURRENCY_GUARD: PASS — every mutating draft workflow (dev-deploy, infra-plan, infra-deploy,
  chat-deploy) shares one concurrency group, "gymini-dev-deploy", with cancel-in-progress: false
  (explicitly, since cancelling mid-CloudFormation-execution or mid-update-function-code would leave
  uncertain state); only the non-mutating pr-validation.yml uses per-PR cancellation.
```

## PR Validation

`ci/drafts/github-actions/pr-validation.yml`: impact-detection job → `quality` (install, repo-hygiene
lint, `prisma:generate`, typecheck/build) → `unit` (matrix over the 6 Lambda services, skipped when
not impacted, failures routed through `Get-CiFailureClass` so a missing-local-Postgres failure is
`INTEGRATION_ENV_UNAVAILABLE`/non-blocking rather than a false code-failure) → `iac` (cfn-lint — a new
tool, explicitly flagged as a 16B adoption decision — plus a JSON-validity check on the route source
manifest) → `chat-image` (Docker build only, never pushed) → a dedicated `ci-helper-tests` job running
the real Pester suites on `windows-latest` (correctly reasoned: this repo's `*.Tests.ps1` files target
Windows PowerShell 5.1's Pester 3.x `Should Be` syntax, which Pester 5 on Linux runners would reject).
Zero AWS credentials anywhere in the file. One honestly self-documented gap: a *static*
manifest-vs-template route-parity check does not exist yet — the only existing parity tool
(`Test-ApiRouteParity.ps1`) reads the live API, making it a post-deploy check, not a PR-time one.

```
PR_VALIDATION_DRAFT: PASS (with the documented static-parity gap, same severity class as the
  CHANGESET_DIGEST wrapper gap above — real, worth closing in 16B, not blocking preparation)
```

## Application Deployment

Covered under "Lambda Deployment Strategy" and "Chat ECS Strategy" above.

```
APP_DEPLOY_DRAFT: PASS
```

## Infrastructure Plan / Apply

Covered under "API Gateway CloudFormation Strategy" above.

```
INFRA_PLAN_DRAFT: PASS
INFRA_APPLY_DRAFT: PASS
```

## Concurrency

Covered under "Scheduler / Lifecycle Preservation" above (`gymini-dev-deploy` group).

## Smoke Matrix

`ci/smoke-matrix.json`: verified this phase via a fresh, real, read-only `apigatewayv2 get-routes` in
earlier Phase 15B work that the **only** public `/health`-shaped route in the live Gateway targets
auth-service; the matrix correctly smokes the other 5 Lambda services via a synthetic `lambda:Invoke`
of a `GET /health` API-Gateway-v2-shaped event instead of HTTP, with an honestly flagged open
assumption ("each `lambda.ts` wraps `app.ts` so `/health` is reachable") to confirm in the actual
Phase 16B trial run. Chat is smoked via `elbv2:DescribeTargetHealth`, gated `onlyIfRunning` so a
deploy never fails merely because the owner left Chat off. Every mutating entry (`payment` checkout,
`auth` password-reset-request, `auth` register, `ai` chat/Bedrock) is explicitly `mutation: true,
safeForCi: false` and is excluded by `Get-SmokePlan`'s own filter (`-not $e.mutation` AND `-not
$e.safeForCi` are both checked) — independently confirmed by 3 passing Pester tests, including "no
selected entry anywhere is a mutation, SMTP, register or AI chat call."

```
SAFE_SMOKE_MATRIX: PASS
```

## Rollback

Documented, not yet exercised live (correctly — this is a design phase):

- **Lambda**: `dev-deploy.yml` records each target function's pre-deploy `CodeSha256` (narrow
  `--query`, scanned for secrets before being written) into the job summary as the rollback
  reference; rolling back means re-running `update-function-code` against that previous
  `S3Bucket`/`S3Key` (the artifact is content-addressed and already in S3 from the original deploy —
  nothing is rebuilt).
- **Chat**: the previous ECS task-definition revision/image digest remains registered and
  describable; rollback is `update-service --task-definition <previous-revision>` (not yet scripted,
  correctly deferred).
- **CloudFormation**: native rollback is noted as unsafe to rely on blindly for *imported* resources —
  the report's own stance (and this phase's instruction) is forward-fix via a new, reviewed change
  set, never an automatic rollback that might attempt to "recreate" something CloudFormation thinks
  it owns but didn't actually create.
- **Database**: explicitly, down migrations are never assumed safe or automatic.

```
ROLLBACK_DESIGN: PASS (documented; no rollback has been executed, none was required to be)
```

## Failure Classification

`Get-CiFailureClass` (CiHelpers.psm1) implements the required taxonomy and is pattern-matched against
real error text, not just a stage name: `BEDROCK_ACCOUNT_AUTHORIZATION_BLOCKED` (non-blocking,
correctly distinguished from a real `DEPLOY_FAIL`/`IAM` problem, even when the message happens to
surface during the `deploy` stage), `MANUAL_APPROVAL_REQUIRED`, `INTEGRATION_ENV_UNAVAILABLE` (missing
local Postgres), `EXTERNAL_PROVIDER_UNAVAILABLE` (SMTP/VNPay/MoMo/ZaloPay/Stripe/PayPal
timeouts/5xx), then falls through to `BUILD_FAIL`/`UNIT_TEST_FAIL`/`INTEGRATION_TEST_FAIL`/
`DEPLOY_FAIL`/`SMOKE_FAIL` by stage. 4 Pester tests confirm the Bedrock and Postgres classifications
specifically (including "even from the deploy stage" — proving it's message-driven, not just
stage-driven).

```
BEDROCK_FAILURE_CLASSIFICATION: PASS
```

## CI Safety Tests

```
CI_SAFETY_TESTS: 52/52 (re-run live this phase, not assumed from a prior pass)
```

Mapped against the 20 required fake-metadata scenarios: 1–12, 15–19 are each covered by a named,
passing test in `scripts/ci/CiHelpers.Tests.ps1` (service-only impact, shared-propagation,
chat-only/ECS-not-Lambda, infra-only/no-redeploy, API-IaC-selects-infra, docs-only/none,
unclassified/blocked, migration-flag, Windows-path-normalize, CFN Remove/Replace/API-replacement
blocks, wrong-account/root/vmimport-admin blocks, static-IAM-user-in-CI rejection, Payment-mutation
rejection, Bedrock classification, schedule-state-preservation). Items 13 ("CI admin policy rejected")
and 14 ("static AWS access-key approach rejected") are covered at the **design** level (no role grants
`AdministratorAccess`; every draft workflow authenticates via OIDC `role-to-assume`, never a static
`aws-access-key-id` input) rather than as a dedicated unit test, since there is no IAM policy document
to unit-test yet (the roles are drafted, not created). Item 20 ("plan/apply identity mismatch blocks
execution") is implemented procedurally in `infra-deploy.yml`'s `CHANGESET_DIGEST_MISMATCH` check
rather than as a pure-function unit test — this is an honest, accurate characterization, not a gap:
the behavior genuinely exists, just in workflow YAML rather than in `CiHelpers.psm1`.

## Remaining Activation Blockers

```
API Gateway adoption:                    COMPLETE
CloudFormation normal-update certification: NOT YET satisfied (no normal UPDATE ever run)
CI OIDC IAM:                              NOT YET created (draft only, confirmed via a live
                                           `iam list-roles` returning zero Gymini* roles)
GitHub protected environment:             NOT YET created (dev / dev-infra / dev-infra-plan
                                           environments referenced by the draft workflows do not
                                           exist in the repository yet)
PR validation workflow:                   NOT YET active (sits in ci/drafts/, not .github/workflows/)
DEV deployment role:                      NOT YET created
15C route/security decisions:             still pending (10 SOURCE_ONLY routes)
Newly found this phase:                   Test-DeploymentSafety.ps1's ChangeSetFile ParameterValues
                                           wrapper gap (see "API Gateway CloudFormation Strategy")
```

**Recommendation on the 15C dependency**: application CI (PR validation, Lambda code deploy, Chat
deploy) does **not** need to wait for Phase 15C — none of the 10 `SOURCE_ONLY` routes are Lambda code
paths; they are purely Gateway-routing gaps. Infrastructure CI (`infra-plan`/`infra-deploy`), however,
**should** wait, because every one of those 10 routes is an Auth/Payment/Gym *routing* decision that a
future infra-apply run could accidentally touch if a shared template edit lands before 15C's decisions
are final — the existing `Test-ChangeSetSafety` guard would catch an actual destructive action, but
"was this route addition intentional" is a product decision 15C owns, not something the safety guard
can judge. Recommendation: **app CI may activate independently of 15C; infra CI should wait for 15C's
route decisions to be final**, even though the technical adoption blockers (OIDC roles, environments)
are the same for both.

## Phase 16B Activation Plan

Suggested order (none performed this phase):

1. Fix the `Test-DeploymentSafety.ps1` `ParameterValues` wrapper gap and add a regression test that
   calls it (not just `Test-ChangeSetSafety` directly) with a real describe-change-set-shaped JSON
   carrying a mismatched `HttpApiId` parameter.
2. Run the CloudFormation normal-update/no-op certification trial (see "First Normal Update
   Certification Requirement").
3. Create the 3 GitHub Environments (`dev`, `dev-infra-plan`, `dev-infra`) with branch/reviewer rules.
4. Apply `infra/cloudformation/ci-cd-oidc.yaml` (human, `--profile gymini-admin`, one-time).
5. Copy `pr-validation.yml` into `.github/workflows/` first (zero AWS access — lowest risk).
6. Trial `dev-build.yml` + `dev-deploy.yml` in `dry_run: true` mode before any real `update-function-code`.
7. Trial `infra-plan.yml` against the now-adopted stack; confirm a genuine no-op before ever running
   `infra-deploy.yml`.
8. Only after 15C's route decisions land, consider activating `infra-deploy.yml` for real route
   changes.
9. `chat-deploy.yml` last, starting with `dry_run: true` and `force_on: false`.

## Final Response

```
PHASE: 16A
AWS_MUTATIONS: 0
API_GATEWAY_ADOPTION_COMPLETE: YES
API_GATEWAY_STACK: fitness-assistant-dev-api-gateway
API_GATEWAY_MANAGED_RESOURCES: 254
API_GATEWAY_DRIFT: IN_SYNC
CI_PROVIDER_CURRENT: GitHub Actions (docker-test.yml only; no deploy pipeline)
CI_PROVIDER_SELECTED: GitHub Actions
GITHUB_REPOSITORY: trmizy/fitness-assistant
OIDC_STRATEGY: PASS
LONG_LIVED_AWS_KEYS_IN_CI: NO
CI_ADMINISTRATOR_ACCESS: NO
OIDC_IAC_DRAFT: PASS
BUILD_GRAPH: PASS
CHANGE_IMPACT_GRAPH: PASS
IMMUTABLE_ARTIFACT_STRATEGY: PASS
LAMBDA_DEPLOY_STRATEGY: PASS
CHAT_DEPLOY_STRATEGY: PASS
DATABASE_MIGRATION_STRATEGY: PASS
API_GATEWAY_CFN_PIPELINE: PASS (one documented wrapper-level gap, not yet fixed)
CFN_NORMAL_UPDATE_CERTIFIED: NO
SOURCE_ONLY_ROUTE_EXCEPTIONS: 10
PR_VALIDATION_DRAFT: PASS
APP_DEPLOY_DRAFT: PASS
INFRA_PLAN_DRAFT: PASS
INFRA_APPLY_DRAFT: PASS
SAFE_SMOKE_MATRIX: PASS
DEPLOY_CONCURRENCY_GUARD: PASS
ROLLBACK_DESIGN: PASS
SECRET_HANDLING: PASS
BEDROCK_FAILURE_CLASSIFICATION: PASS
CI_SAFETY_TESTS: 52/52
ACTIVE_GITHUB_WORKFLOWS_CREATED: 0
AWS_OIDC_ROLE_CREATED: NO
AWS_SERVICES_CHANGED: NO
SERVICES_REDEPLOYED: 0
SERVICES_STOPPED: 0
CI_ACTIVATION_AUTHORIZED: NO
READY_FOR_PHASE_16B: YES
REPORT: docs/deployment/AWS_DEV_CICD_PREPARATION_2026-10-09.md
FINAL_DECISION: CICD_PREPARATION_READY
```

HARD STOP. Did NOT activate any workflow. Did NOT create any OIDC role/provider. Did NOT deploy any
application code. Did NOT run any DB migration. Did NOT add any SOURCE_ONLY route. Did NOT perform a
CloudFormation normal UPDATE. Did NOT stop any running service.
