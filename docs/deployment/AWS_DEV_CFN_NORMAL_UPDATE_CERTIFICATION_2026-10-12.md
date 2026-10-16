# Gymini DEV — First Normal CloudFormation UPDATE Certification — 2026-10-12 (Phase 16A.2)

No credential, secret value, access key, or secret access key appears anywhere in this report.

## Executive Summary

This phase set out to create and inspect (never execute) the first ordinary `ChangeSetType=UPDATE`
against the now-fully-imported `fitness-assistant-dev-api-gateway` stack, to certify that the normal
update lifecycle is a true no-op against the current live baseline. The pre-flight gates (identity,
parallel-agent safety, stack baseline, template-vs-deployed comparison, SOURCE_ONLY protection,
template validation, CI regression) all passed. **The mandatory pre-changeset live-route-parity gate
(16A.2.7) failed**: a real, pre-existing runtime discrepancy — not introduced by this phase — was
found and is reported in full below. Per this phase's own explicit instruction ("If parity differs:
HARD STOP. Do not test normal CloudFormation UPDATE against an unexpected runtime state."), **no
change set was created**. Zero AWS mutations of any kind were performed this phase.
**`CFN_NORMAL_UPDATE_CERTIFIED: NO`**; `FINAL_DECISION: CFN_NORMAL_UPDATE_REQUIRES_REMEDIATION`.

**The finding, in one sentence**: the on-demand Chat ALB is recreated with a brand-new random DNS
suffix every time `dev-stop.ps1`/`dev-start.ps1` tears down and rebuilds `gymini-dev-on-demand`
(confirmed again during this very session's own full-restart earlier today); the live
`ChatIntegration`'s `IntegrationUri` is repaired directly and correctly by `dev-start.ps1`'s own
imperative reconnect step, but **outside CloudFormation** — so the API-Gateway stack's own recorded
`ChatAlbDnsName` parameter, and the static `api-source-routes.json` parity manifest, are now both
stale, and a route-parity check that was `119/119/10/0/0` in every prior phase this session now shows
one real `MISMATCHED` route. This is an architectural consequence of splitting the on-demand ALB
lifecycle from the API-Gateway CloudFormation stack, not a defect introduced by this phase, by Phase
16A, or by Phase 16A.1.

## AWS Identity

```
aws sts get-caller-identity --profile gymini-admin
  Account: 191798898985
  Arn:     arn:aws:iam::191798898985:user/gymini-admin
Region: ap-southeast-1
```

`AWS_EXPLICIT_PROFILE_GATE: PASS`. Every AWS CLI call this phase used `--profile gymini-admin`
explicitly.

## Current Imported Stack Baseline

```
STACK_NAME: fitness-assistant-dev-api-gateway
STACK_STATUS: IMPORT_COMPLETE (stable, no active operation)
STACK_RESOURCE_COUNT: 254 (confirmed via list-stack-resources)
API_ID: id1iz7upbl (confirmed via get-apis)
```

**Parallel-agent safety**: `git rev-parse HEAD` = `187745350ab147003d030d4826c430e84dfe3e59`
(unchanged since Phase 16A.1). `infra/cloudformation/api-gateway-baseline.yaml` SHA-256 =
`cadc9548f46cdcbdd3ba95057522285585c0346bbd789873b264213d2e691652` — identical to the hash recorded
in every prior phase since Phase 15B-B1; the file was not modified before, during, or after this
phase. No `git reset`/`git clean`/discard of any kind was performed.

**Stack drift**, re-run fresh this phase: `StackDriftStatus: IN_SYNC`, `DriftedStackResourceCount: 0`
— **but with an important, newly-confirmed caveat**: `describe-stack-resource-drifts` (paginated
across all 3 pages, 236 of 254 resources returned) **never includes any of the 18
`AWS::ApiGatewayV2::Integration` resources at all** — not as `IN_SYNC`, not as `NOT_CHECKED`, simply
absent from the result set entirely. Cross-checked directly: every one of the 18 missing logical IDs
is exactly the set of `AWS::ApiGatewayV2::Integration` resources (confirmed by diffing the drift
result's logical IDs against the full `list-stack-resources` output — the 18-resource gap matches the
Integration-type count exactly, zero overlap with any other type). This is a real, structural
CloudFormation limitation (`AWS::ApiGatewayV2::Integration` does not support drift detection), not a
bug in this engagement's tooling — and it is precisely why CloudFormation's own "IN_SYNC" verdict
missed the real, live `ChatIntegration` discrepancy detailed below.

## Local vs Deployed Template Comparison

Fetched the stack's currently-deployed template (`get-template --template-stage Original`) and
diffed it against the local canonical `infra/cloudformation/api-gateway-baseline.yaml`, normalizing
comments and a known cosmetic Unicode-rendering artifact in the AWS CLI's text output:

```
DEPLOYED_TEMPLATE_RESOURCE_COUNT: 254
LOCAL_TEMPLATE_RESOURCE_COUNT: 254
RESOURCE_SEMANTIC_DIFFERENCES: 0  — every Parameter and every Resource declaration is byte-identical
OUTPUT_ONLY_DIFFERENCES: 1  — HttpApiIdOut exists in the local canonical template, absent from deployed
```

Classification: the **only** two differences between local and deployed are (1) the top-level
`Description` field's text (pure metadata — CloudFormation change sets never diff `Description`, so
this produces zero planned actions regardless), and (2) the local template's single `Outputs` entry,
`HttpApiIdOut`, which is not present in the deployed template. This is the expected, already-documented
consequence of the Phase 15B-B1 finding that CloudFormation `IMPORT` change sets reject any `Outputs`
block outright — the templates actually used for Batch 1 and Batch 2's real imports both had `Outputs`
stripped, and that stripped state is what the stack still reflects today.

## Outputs Handling

Per this phase's own explicit preference ("certify RESOURCE NO-OP first... if adding Outputs would
itself make the stack materially non-no-op: defer them"): introducing `HttpApiIdOut` via this
certification's change set would be a real, planned `Add` on an `Output` — not a resource action, but
still a non-zero change that would contaminate a strict no-op proof. Deferred.

```
OUTPUTS_DEFERRED: YES
```

(Had the parity gate below passed, this phase's change set would have used a template with `Outputs`
removed — mirroring the deployed template exactly — reserving the actual reintroduction of
`HttpApiIdOut` for a separate, explicitly-labeled metadata/output update phase, exactly as instructed.
Since the parity gate failed first, this template was never actually built or submitted.)

## Parameter Reconstruction

Read directly from the live stack (`describe-stacks --query Parameters`), not guessed:

```
HttpApiId:        id1iz7upbl          (PROTECTED_HTTP_API_ID — matches)
AuthLambdaArn:    arn:...:function:fitness-assistant-dev-auth
UserLambdaArn:    arn:...:function:fitness-assistant-dev-user
FitnessLambdaArn: arn:...:function:fitness-assistant-dev-fitness
GymLambdaArn:     arn:...:function:fitness-assistant-dev-gym
PaymentLambdaArn: arn:...:function:fitness-assistant-dev-payment
AiLambdaArn:      arn:...:function:fitness-assistant-dev-ai
ChatAlbDnsName:   dev-chat-alb-1795494241.ap-southeast-1.elb.amazonaws.com
```

**This is the exact finding.** `ChatAlbDnsName`'s recorded value (`...-1795494241....`) is stale: this
very session's own earlier full-restart (`dev-start.ps1 -Network -Chat -Ai -Backend -Secrets
-Execute`, run today before this phase) tore down and recreated the on-demand ALB, which received a
**new**, different auto-generated DNS name (`dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com`
— confirmed live via a direct `apigatewayv2 get-integration` read on `ChatIntegration`,
`ebe69nj`). `dev-start.ps1`'s own "API Gateway reconnect" step already correctly repointed the live
integration's `IntegrationUri` to the new ALB DNS — but it did so with a direct `apigatewayv2
update-integration` call, **not** through CloudFormation, so the stack's own parameter record was
never updated to match. All 6 Lambda ARN parameters remain stable and correct (Lambda function names
and ARNs never change); `ChatAlbDnsName` is the one parameter that is inherently ephemeral under this
architecture's on-demand-ALB design.

Per this phase's explicit instruction, the actual/planned `HttpApiId` was never manufactured to equal
the protected value — it was read from this same live `describe-stacks` call, independently of the
`-ProtectedApiId` constant, exactly as Phase 16A.1's fixed wrapper now requires of any change-set this
phase might have produced.

## SOURCE_ONLY Protection

```
grep of infra/cloudformation/api-gateway-baseline.yaml for every named SOURCE_ONLY path pattern:
  2 matches, both benign - the already-documented "admin/complaint-photos" (a real, live, MATCHED
  route, distinct from the SOURCE_ONLY "/complaint-photos/{token}") and an explanatory code comment
  naming "password-reset/request" as the one route deliberately excluded. Zero actual SOURCE_ONLY
  resources present.
SOURCE_ONLY_INCLUDED: 0
```

## Pre-ChangeSet Parity

Ran the existing, real, read-only `Test-ApiRouteParity.ps1`:

```
LIVE: 119
MATCH: 118   <- expected 119
SOURCE_ONLY: 10   (matches expected, unchanged)
MISMATCHED: 1   <- expected 0
GATEWAY_ONLY: 0   (matches expected)

MISMATCHED ANY /chat/{proxy+}: integration target
  'http://dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com/chat/{proxy}' (live, real)
  != expected 'http://dev-chat-alb-1795494241.ap-southeast-1.elb.amazonaws.com/chat/{proxy}'
  (the static api-source-routes.json manifest's recorded expectation, now stale for the same reason
  as the stack parameter above)
```

**This does not match this phase's own stated expected baseline (119/119/10/0/0).** Per 16A.2.7's
explicit instruction, this is a **HARD STOP**: no `ChangeSetType=UPDATE` was created or even attempted
against this unexpected runtime state. Sections 16A.2.9 through 16A.2.16 (change-set creation,
inspection, the real safety-wrapper run against it, and the strict no-op requirement) were **not
performed** — there is no change set to report on.

## Template Validation

Performed anyway, as safe, independent, non-blocking supporting evidence (none of these require or
imply creating the blocked change set):

```
aws cloudformation validate-template --template-body file://infra/cloudformation/api-gateway-baseline.yaml
  -> Capabilities: [CAPABILITY_AUTO_EXPAND], no error
TEMPLATE_VALIDATION: PASS

Invoke-Pester scripts/ci/CiHelpers.Tests.ps1        -> 68/68 PASS (unchanged from Phase 16A.1's baseline)
Invoke-Pester scripts/aws/api-gateway/lib/ApiRouteParity.Tests.ps1 -> 29/29 PASS
CI_HELPER_TESTS: 97/97 combined
CI_DEPLOYMENT_SAFETY_WRAPPER: CERTIFIED (Phase 16A.1's certification stands; nothing in this phase
  touched scripts/ci/ at all)
```

## Normal UPDATE Change Set

```
CHANGE_SET_TYPE: UPDATE
CHANGE_SET_NAME: (not created)
CHANGE_SET_CREATED: NO
```

Not attempted, per the 16A.2.7 HARD STOP above. No `create-change-set` call of any kind was made this
phase — the only CloudFormation API calls made were read-only (`describe-stacks`,
`list-stack-resources`, `get-template`, `detect-stack-drift`,
`describe-stack-drift-detection-status`, `describe-stack-resource-drifts`, `validate-template`).

## CloudFormation No-Change Semantics

Not applicable — no change set was created to classify.

```
NO_CHANGE_RESPONSE: N/A (not attempted)
```

## Real Deployment-Safety Wrapper Result

Not applicable — there is no real `describe-change-set` artifact for
`scripts/ci/Test-DeploymentSafety.ps1` to evaluate this phase. The wrapper's own Phase 16A.1
certification (68/68, including the real end-to-end API-ID-mismatch proof) remains valid and
unaffected; it was not re-exercised against a live change set here because none exists.

```
API_ID_CHECK: N/A (no change set)
DIGEST_BINDING: NOT_APPLICABLE
```

## Resource Action Analysis

Not applicable — no change set exists to contain actions. The one concrete, already-identified
discrepancy (`ChatIntegration`'s live `IntegrationUri` vs. the stack's recorded `ChatAlbDnsName`
parameter) is documented in full under "Parameter Reconstruction" above, with its `LIKELY_CAUSE`
already established with certainty (not a guess): the on-demand ALB is destroyed and recreated with a
new random DNS suffix on every `dev-stop`/`dev-start` cycle, and only `dev-start.ps1`'s own imperative
`apigatewayv2 update-integration` step (outside CloudFormation) keeps the *live* resource correct in
between. No repair was attempted this phase, per instruction.

```
CHANGE_SET_RESOURCE_ACTIONS: N/A (no change set)
ADD_ACTIONS / MODIFY_ACTIONS / REMOVE_ACTIONS / REPLACE_ACTIONS: N/A
```

## Runtime Revalidation

Confirmed this phase caused zero additional change beyond the read-only calls listed above:

```
API ID: id1iz7upbl — unchanged
Stack resource count: 254 — unchanged
Stack status: IMPORT_COMPLETE — unchanged
```

```
POST_PLAN_LIVE_ROUTES: 119 (route count itself unchanged - the issue is one route's integration
  target, not a missing/extra route)
POST_PLAN_SOURCE_ONLY: 10
POST_PLAN_MISMATCHED: 1 (the same ChatIntegration finding - this phase neither caused nor fixed it)
POST_PLAN_GATEWAY_ONLY: 0
STACK_RESOURCE_COUNT_AFTER: 254
```

## Full-Service State

```
Chat ECS: desiredCount=1, runningCount=1 (confirmed unchanged and healthy - re-verified this phase,
  not merely assumed from the earlier Chat-restore task)
Aurora / NAT / Secrets / AI: not independently re-touched this phase; no stop/start action of any
  kind was performed
SERVICES_REDEPLOYED: 0
SERVICES_STOPPED: 0
CHAT_DESIRED_COUNT: 1
```

## CI Activation Implications

`CFN_NORMAL_UPDATE_CERTIFIED` remains `NO` — exactly as it was before this phase, for a different
(and now better-understood) reason: not because the template itself is unsafe, but because the
**pre-flight parity gate this certification is required to pass** currently fails, due to a
real, independently-confirmed, architecture-level staleness issue with `ChatAlbDnsName` /
`api-source-routes.json`'s Chat integration expectation. `CI_ACTIVATION_AUTHORIZED` remains `NO`
regardless, per 16A.2.20's own rule (no resource action — or in this case, no completed
certification at all — unconditionally blocks CI activation).

**Recommended remediation** (not performed this phase, scoped narrowly for a future explicit phase):
1. Decide the authoritative fix direction: either (a) update the stack's `ChatAlbDnsName` parameter to
   the current live ALB DNS via a real, reviewed, executed CloudFormation UPDATE (the architecturally
   "correct" fix, but it does perform one real resource Modify on `ChatIntegration` — not a no-op by
   definition, so it cannot itself be the certification), or (b) accept that `ChatAlbDnsName` will
   always lag behind the on-demand ALB's true current value between `dev-start.ps1` runs, and treat
   `dev-start.ps1`'s own imperative reconnect as the sole source of truth for this one property,
   explicitly excluding `ChatIntegration`'s `IntegrationUri` from any future parity/no-op requirement.
2. Refresh `docs/deployment/generated/api-source-routes.json`'s own expected Chat integration target
   to match current reality (or, if (b) above is chosen, mark it as a permanently-dynamic field the
   parity tool should not hard-fail on).
3. Re-run this exact certification (16A.2) after either fix — it is designed to be safely re-runnable
   with zero side effects, as this run itself demonstrates.
4. Separately, and independently of the Chat finding: once a resource-level no-op is actually proven,
   decide whether to carry the deferred `HttpApiIdOut` Output through a dedicated, explicitly-labeled
   metadata-only follow-up update, per "Outputs Handling" above.

## Final Response

```
PHASE: 16A.2
AWS_PRINCIPAL: gymini-admin
AWS_MUTATIONS: 0
RUNTIME_RESOURCE_MUTATIONS: 0
STACK_NAME: fitness-assistant-dev-api-gateway
STACK_RESOURCE_COUNT: 254
API_ID: id1iz7upbl
STACK_DRIFT_BEFORE: IN_SYNC (236/254 checkable resources; 18 AWS::ApiGatewayV2::Integration resources
  are structurally excluded from CloudFormation drift detection - a real AWS limitation, not a gap in
  this engagement's tooling)
DEPLOYED_TEMPLATE_RESOURCE_COUNT: 254
LOCAL_TEMPLATE_RESOURCE_COUNT: 254
RESOURCE_SEMANTIC_DIFFERENCES: 0
OUTPUT_ONLY_DIFFERENCES: 1
OUTPUTS_DEFERRED: YES
SOURCE_ONLY_INCLUDED: 0
PRE_UPDATE_LIVE_ROUTES: 119
PRE_UPDATE_SOURCE_ONLY: 10
PRE_UPDATE_MATCH: 118
PRE_UPDATE_MISMATCHED: 1
TEMPLATE_VALIDATION: PASS
CI_HELPER_TESTS: 97/97 (68 CiHelpers + 29 ApiRouteParity)
CI_DEPLOYMENT_SAFETY_WRAPPER: CERTIFIED
CHANGE_SET_TYPE: UPDATE
CHANGE_SET_NAME: NOT_CREATED
CHANGE_SET_CREATED: NO
NO_CHANGE_RESPONSE: N/A
NO_CHANGE_RESPONSE_VALIDATED: N/A
CHANGE_SET_RESOURCE_ACTIONS: N/A
ADD_ACTIONS: N/A
MODIFY_ACTIONS: N/A
REMOVE_ACTIONS: N/A
REPLACE_ACTIONS: N/A
ACTUAL_HTTP_API_ID: id1iz7upbl (read live from describe-stacks, independently of the protected
  constant)
PROTECTED_HTTP_API_ID: id1iz7upbl
API_ID_GUARD: N/A (no change set to guard)
DIGEST_BINDING: NOT_APPLICABLE
CHANGE_SET_EXECUTED: NO
POST_PLAN_LIVE_ROUTES: 119
POST_PLAN_SOURCE_ONLY: 10
POST_PLAN_MISMATCHED: 1
POST_PLAN_GATEWAY_ONLY: 0
STACK_RESOURCE_COUNT_AFTER: 254
CHAT_DESIRED_COUNT: 1
SERVICES_REDEPLOYED: 0
SERVICES_STOPPED: 0
CFN_NORMAL_UPDATE_CERTIFIED: NO
CI_ACTIVATION_AUTHORIZED: NO
READY_FOR_PHASE_16B: NO
REPORT: docs/deployment/AWS_DEV_CFN_NORMAL_UPDATE_CERTIFICATION_2026-10-12.md
FINAL_DECISION: CFN_NORMAL_UPDATE_REQUIRES_REMEDIATION
```

HARD STOP. No resource-changing change set was created or executed. Did NOT activate any GitHub
workflow. Did NOT create any deploy role. Did NOT deploy application code. Did NOT add any
SOURCE_ONLY route. Did NOT run any migration. Did NOT change any service lifecycle state.
