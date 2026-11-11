# Gymini DEV — Chat ALB / API Gateway CloudFormation Ownership Remediation — 2026-10-12 (Phase 16A.2R)

No credential, secret value, access key, or secret access key appears anywhere in this report.

## Executive Summary

Phase 16A.2 found that `fitness-assistant-dev-api-gateway`'s `ChatAlbDnsName` parameter had gone
stale relative to the real, recreated on-demand Chat ALB, because `dev-start.ps1` repaired the live
`ChatIntegration` directly via `apigatewayv2 update-integration` — correct for the live resource, but
invisible to CloudFormation. This phase: (1) confirmed the three-way discrepancy fresh, (2) designed
and unit-tested a CloudFormation-owned reconciliation helper (`Sync-ChatApiGatewayIntegration`,
reusing the Phase 16A.1-certified change-set safety/digest logic rather than duplicating it), (3)
replaced `dev-start.ps1`'s direct mutation with that helper, (4) fixed the route-parity tool's own
staleness by making its expected Chat target a dynamic CloudFormation-parameter reference instead of a
frozen literal, (5) added a custom per-integration drift guard to compensate for CloudFormation's
native drift detection not covering `AWS::ApiGatewayV2::Integration` at all, and (6) performed exactly
one live, narrowly-reviewed CloudFormation `UPDATE` to reconcile the current real discrepancy — a
single `Modify` of `ChatIntegration`, `Replacement=False`, verified both before and after against the
Phase 16A.1-certified safety wrapper. All three authoritative values (physical ALB DNS, stack
parameter, live `IntegrationUri`) now agree. Route parity is back to `119/119/10/0/0`, with Chat's
route passing for the right reason. 134/134 tests pass across all 4 relevant suites, zero regressions.
`FINAL_DECISION: CHAT_CFN_OWNERSHIP_REMEDIATED`.

## Root Cause

Confirmed exactly as Phase 16A.2 described, and reconfirmed fresh at the start of this phase:

```
CURRENT_CHAT_ALB_DNS (A):        dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com
STACK_CHAT_ALB_DNS_BEFORE (B):   dev-chat-alb-1795494241.ap-southeast-1.elb.amazonaws.com
LIVE_CHAT_INTEGRATION_HOST_BEFORE (C): dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com
```

`A != B` (confirmed), `C` resolves to `A` (confirmed) — i.e. the live resource was already correct
(repaired by `dev-start.ps1`'s own imperative step), but the CloudFormation stack's own bookkeeping
(`B`) was stale, and nothing in CloudFormation's own drift detection could have caught it (see
"CloudFormation Drift Detection Limitation" below).

```
ROOT_CAUSE_CONFIRMED: YES
```

## Architectural Decision

```
ARCHITECTURE_SELECTED: CLOUDFORMATION_AUTHORITATIVE_CHAT_INTEGRATION
```

CloudFormation remains the sole owner of `ChatIntegration`'s desired state. Chat's `IntegrationUri`
is never again set via a direct `apigatewayv2 update-integration` call as the normal lifecycle path;
any future change goes through a reviewed, safety-checked CloudFormation `UPDATE` change set, exactly
like every other resource in this stack since Phase 15B.

## Previous Imperative Reconnect Path

Traced in `scripts/aws/dev-start.ps1` (pre-edit) at the step labelled `"6) API Gateway reconnect"`:

```
FUNCTION: (inline in the main script body, no separate function)
COMMAND: aws apigatewayv2 update-integration --api-id $ApiId --integration-id $ChatIntegrationId
           --integration-uri "http://$newAlbDns/chat/{proxy}" --region $ExpectedRegion
INPUT_DNS_SOURCE: $newAlbDns, read from the gymini-dev-on-demand stack's own CloudFormation Output
                  "ChatLoadBalancerDnsName" immediately after that stack's deploy in this same run
INTEGRATION_ID_DISCOVERY: hardcoded constant $ChatIntegrationId = "ebe69nj" (stable - integrations
                  are never recreated by this flow, only their property is updated)
FAILURE_HANDLING: checked $LASTEXITCODE after the update call, then re-read the integration and
                  hard-stopped if the verified value didn't match what was just set
DEPENDENCIES: ran only when -Chat was requested and the on-demand stack produced a new target group
              ARN this run; came after the ECS target-group reconnect step, before the frontend
              runtime-config.json push
```

This was accurate and worked correctly for the *live* resource every time — the defect was never in
its correctness, only in its invisibility to CloudFormation.

## New CloudFormation-Owned Reconnect Path

New module: `scripts/aws/api-gateway/lib/ChatIntegrationSync.psm1` (+ `ChatIntegrationSync.Tests.ps1`,
18 tests). Reuses, never duplicates, the Phase 16A.1-certified `Test-ChangeSetSafety` /
`Test-ChangeSetDigest` from `scripts/ci/CiHelpers.psm1`.

```
Sync-ChatApiGatewayIntegration (inputs: stack name, current live ALB DNS, template path, protected
  API ID, region, -Execute switch):
  1. read current stack parameters (ChatAlbDnsName) - real describe-stacks call
  2. Test-ChatAlbSyncNeeded: compare current ALB DNS to the stack's recorded value - pure, fail-closed
     (missing/unreadable data -> treated as "sync needed" + FailClosed, never silently skipped)
  3. if no sync needed -> return NO_SYNC_NEEDED, stop (no AWS mutation)
  4. else: create a real UPDATE change set using the SAME template and SAME current parameters,
     changing ONLY ChatAlbDnsName to the current ALB DNS
  5. if CloudFormation itself reports no real change -> return NO_OP
  6. inspect the real change set via Test-ChatReconciliationChangeSet: allowed ONLY if it is empty, or
     contains EXACTLY one Modify of ChatIntegration with Replacement != True/Conditional - anything
     else (extra Modify, any Route, any Delete, any Add, a Replacement on ChatIntegration itself) is
     BLOCKED, reusing the certified safety wrapper underneath for the API-ID/destructive-action layer
  7. without -Execute: returns PLANNED_SAFE (dry plan only - no mutation)
  8. with -Execute: executes the EXACT same change set (never a regenerated one), waits for
     stack-update-complete, returns the final stack status
```

`dev-start.ps1`'s step 6 now calls this helper instead of the direct API call (full diff in "Future
dev-start Behavior" below).

```
OLD_DIRECT_APIGATEWAY_RECONNECT: REMOVED
FUTURE_CHAT_RECONNECT_VIA_CFN: YES
```

## Dynamic Chat Parity Model

Root cause #2: `docs/deployment/generated/api-source-routes.json`'s `deployTargets.chat` entry was a
**frozen literal string** containing the ALB DNS at the time it was last hand-edited — guaranteed to
go stale on every future ALB recreation, independent of whether `ChatAlbDnsName` itself was ever
fixed. Replaced with a dynamic reference:

```json
"chat": {
  "dynamic": "CLOUDFORMATION_PARAMETER",
  "stackName": "fitness-assistant-dev-api-gateway",
  "parameterKey": "ChatAlbDnsName",
  "pathSuffix": "/chat/{proxy}"
}
```

`scripts/aws/api-gateway/Test-ApiRouteParity.ps1` now detects this shape and resolves it via one
extra, read-only `describe-stacks` call at check time, failing closed (hard stop, never a guess) if
the parameter can't be read. This closes the staleness problem structurally: as long as
`Sync-ChatApiGatewayIntegration` keeps the stack parameter correct, the parity tool's own expectation
can never go stale again — it reads the same live source of truth, not a second hand-maintained copy.
The three-point model from this phase's instructions is satisfied: (1) physical ALB DNS vs. stack
parameter is verified directly in "Three-Way DNS Proof" below; (2) stack parameter vs. live
`IntegrationUri` host is exactly what the parity tool's `MISMATCHED` check already does, now against
a live-resolved expectation instead of a frozen one; (3) the `/chat/{proxy}` path suffix is unchanged
and still asserted. A genuinely wrong Chat target still fails parity — nothing was silently exempted
(re-confirmed by the regression tests' case 12, "live integration points to a wrong THIRD DNS", which
still reports drift).

## CloudFormation Drift Detection Limitation

```
CFN_NATIVE_DRIFT: IN_SYNC, 0 DriftedStackResourceCount (re-run fresh this phase, after reconciliation)
CFN_INTEGRATIONS_DRIFT_SUPPORTED: NO
```

Re-confirmed empirically (not re-asserted from Phase 16A.2's finding): `describe-stack-resource-drifts`,
paginated across all pages, still never returns any of the 18 `AWS::ApiGatewayV2::Integration`
resources at all — not `IN_SYNC`, not `NOT_CHECKED`, simply absent. This is a structural AWS
limitation, not a gap specific to this stack. "Full stack IN_SYNC" is never reported in this document
without this caveat attached.

## Custom Integration Drift Guard

`Compare-IntegrationTargets` (same module) + a direct live check this phase: fetched all 18 live
integrations and classified each — the 17 Lambda-backed (`AWS_PROXY`) integrations only need to
target *some* `fitness-assistant-dev-*` function (their ARNs are permanently stable, never drift by
construction), while the one `HTTP_PROXY` integration (Chat) is checked against the dynamically-
resolved current stack parameter, exactly as the parity tool now does.

```
Checked: 18 / 18
Drifted: 0
AllInSync: true
```

```
CUSTOM_INTEGRATION_DRIFT_CHECK: PASS
```

## Unit / Regression Tests

`scripts/aws/api-gateway/lib/ChatIntegrationSync.Tests.ps1` — 18 new tests, covering every one of the
15 required cases from this phase's brief (cases 1–2 and 13–14 on `Test-ChatAlbSyncNeeded`; 3–9 on
`Test-ChatReconciliationChangeSet`, including reuse of the certified API-ID and digest guards; 10–12
and 15 on `Compare-IntegrationTargets`). All fake-metadata, zero AWS calls, zero live mutation —
written and run **before** any real change set was created or executed this phase, per instruction.

```
LIVE_RECONCILIATION_SIMULATED_BEFORE_REAL_RUN: YES (cases 1/2 of ChatIntegrationSync.Tests.ps1 are
  exactly the fake-A/fake-B dry-run this phase's own 16A.2R.20 asked for - no real ALB was ever
  destroyed/recreated to prove this logic)
```

Full combined regression, run twice (once before, once after the live reconciliation — identical
result both times):

```
CiHelpers.Tests.ps1:          68/68
ApiRouteParity.Tests.ps1:     29/29
DevLifecycle.Tests.ps1:       19/19
ChatIntegrationSync.Tests.ps1: 18/18
TOTAL: 134/134, 0 failed, 0 regressed
```

`DevLifecycle.Tests.ps1`'s 19 tests (another agent's own, pre-existing, uncommitted Phase 12A work —
untouched by this phase) remain green, confirming no interference with that concurrent workstream.

## Live Reconciliation Change Set

```
STACK_NAME: fitness-assistant-dev-api-gateway
CHANGE_SET_TYPE: UPDATE
CHANGE_SET_NAME: chat-alb-sync-20261012155131
TEMPLATE USED: infra/cloudformation/api-gateway-baseline.yaml (the same canonical template every
  prior phase has used - unchanged, hash-verified before this phase per the usual convention)
PARAMETERS: identical to the stack's own current values, EXCEPT ChatAlbDnsName = the current real
  ALB DNS (dev-chat-alb-1490360997...) - every other parameter (6 Lambda ARNs, HttpApiId) unchanged
RECONCILIATION_CHANGE_SET_CREATED: YES
RECONCILIATION_ACTIONS: 1
```

Full `describe-change-set` saved (sanitized - Changes + Parameters, no secrets) to
`docs/deployment/generated/api-gateway-normal-update-changeset.json`:

```
Action: Modify
LogicalResourceId: ChatIntegration
PhysicalResourceId: ebe69nj   (same physical integration - confirms an in-place property update,
                               never a replacement)
ResourceType: AWS::ApiGatewayV2::Integration
Replacement: False
Scope: [Properties]
Details: Target.Name=IntegrationUri, RequiresRecreation=Never, ChangeSource=DirectModification
```

```
EXPECTED_CHAT_INTEGRATION_MODIFY: YES
UNEXPECTED_ACTIONS: 0
```

## Deployment-Safety Wrapper Result

Ran the real, Phase-16A.1-certified `scripts/ci/Test-DeploymentSafety.ps1` against this exact saved
artifact, with digest binding against the artifact's own real sha256 (proving the identity-binding
mechanism, not merely asserting it):

```
Verdict: APPROVAL_REQUIRED (not BLOCK - exit code 0)
Findings: [{ Severity: APPROVAL, Rule: INTEGRATION_CHANGE, LogicalResourceId: ChatIntegration,
             Action: Modify, Replacement: False }]
```

```
API_ID_GUARD: PASS  (the actual HttpApiId was independently read from the change set's own
  .Parameters - confirmed id1iz7upbl - never manufactured to equal the protected constant)
DIGEST_BINDING: PASS
```

The same result was independently reproduced by the module's own `Test-ChatReconciliationChangeSet`
(used internally by `Sync-ChatApiGatewayIntegration`) before this separate, standalone wrapper run —
two independent code paths agreeing is itself part of the proof this reconciliation was safe.

## One-Time Reconciliation Execution

```
08:53:29Z  aws cloudformation execute-change-set --change-set-name chat-alb-sync-20261012155131
           (the exact, already-created, already-inspected change set - never regenerated)
08:53:3X  (first poll) StackStatus: UPDATE_COMPLETE
```

```
RECONCILIATION_EXECUTED: YES
STACK_STATUS_AFTER: UPDATE_COMPLETE
```

## Three-Way DNS Proof

Re-verified fresh, immediately after `UPDATE_COMPLETE`:

```
CURRENT_CHAT_ALB_DNS:          dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com
STACK_CHAT_ALB_DNS_AFTER:      dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com
LIVE_CHAT_INTEGRATION_HOST_AFTER: dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com
```

All three agree exactly.

```
CHAT_ALB_STACK_SYNC: PASS
CHAT_INTEGRATION_STACK_SYNC: PASS
```

Physical resource identity preserved: `ChatIntegration`'s `PhysicalResourceId` is still `ebe69nj`,
both in the change-set's own `ResourceChange` and in a fresh `list-stack-resources` read after the
update — confirmed, not assumed.

```
PHYSICAL_ID_CHANGES: 0
```

## Route Parity

Re-ran the corrected, dynamic-resolution `Test-ApiRouteParity.ps1`:

```
LIVE: 119
MATCH: 119
SOURCE_ONLY: 10
MISMATCHED: 0
GATEWAY_ONLY: 0
```

Chat's `ANY /chat/{proxy+}` route is now inside `MATCH(119)` because all three authoritative values
genuinely agree — not because its `IntegrationUri` was ever special-cased or ignored.

## Chat Runtime

Real, safe, non-mutating checks:

```
Chat ECS: desiredCount=1, runningCount=1 (unchanged throughout this phase - never restarted)
Target group health: healthy
GET http://dev-chat-alb-1490360997.../health -> HTTP 200 {"status":"healthy","service":"chat-service",...}
```

No Bedrock/AI invocation, no business mutation, no payment of any kind.

```
CHAT_DESIRED_COUNT: 1
CHAT_RUNNING_COUNT: 1
CHAT_HEALTH: PASS
```

## Future dev-start Behavior

`scripts/aws/dev-start.ps1`'s one changed block (step "6) API Gateway reconnect") now calls
`Sync-ChatApiGatewayIntegration -Execute` instead of a direct `apigatewayv2 update-integration`, and
still hard-stops (exits 1) on any unsafe or failed result, then independently re-verifies the live
`IntegrationUri` afterward exactly as before. Every other lifecycle behavior is untouched:

```
Backend lifecycle (Aurora/schedules): untouched
NAT lifecycle: untouched
Secrets VPCE: untouched
AI/OpenSearch VPCE: untouched
Scheduler protection (gym-partner-upload-sweep never touched): untouched
Chat ECS desiredCount semantics (dev-start never arbitrarily restores it): untouched - confirmed by
  diff review; the only lines changed in dev-start.ps1 are the module import and the step-6 block
```

The other agent's own in-progress Phase 12A lifecycle-state-resolution refactor (uncommitted,
`Resolve-DesiredStartState`/`Resolve-DesiredStopState`/`Get-CurrentStackState` etc. in
`scripts/aws/lib/DevLifecycle.psm1`) was left completely untouched — confirmed via `git diff --stat`
before and after this phase showing the identical line-count delta for `dev-stop.ps1`, which this
phase never edited at all.

## Remaining CI Activation Blockers

`CFN_NORMAL_UPDATE_CERTIFIED` is reset to `NO` and must be re-earned from scratch — this phase
performed a real resource-changing UPDATE (by design, to fix a real discrepancy), so Phase 16A.2's
strict no-op certification no longer applies to the post-remediation baseline and must be re-run
against it, per this phase's own explicit instruction not to immediately re-run 16A.2 within this
same phase. OIDC roles, GitHub protected environments, and the PR validation workflow remain exactly
as uncreated/inactive as before. The 10 `SOURCE_ONLY` routes remain untouched and still pending Phase
15C.

## Final Response

```
PHASE: 16A.2R
AWS_PRINCIPAL: gymini-admin
PROTECTED_API_ID: id1iz7upbl
ROOT_CAUSE_CONFIRMED: YES
ARCHITECTURE_SELECTED: CLOUDFORMATION_AUTHORITATIVE_CHAT_INTEGRATION
OLD_DIRECT_APIGATEWAY_RECONNECT: REMOVED
FUTURE_CHAT_RECONNECT_VIA_CFN: YES
CURRENT_CHAT_ALB_DNS: dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com
STACK_CHAT_ALB_DNS_BEFORE: dev-chat-alb-1795494241.ap-southeast-1.elb.amazonaws.com
LIVE_CHAT_INTEGRATION_HOST_BEFORE: dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com
RECONCILIATION_REQUIRED: YES
RECONCILIATION_CHANGE_SET_CREATED: YES
RECONCILIATION_ACTIONS: 1
EXPECTED_CHAT_INTEGRATION_MODIFY: YES
UNEXPECTED_ACTIONS: 0
API_ID_GUARD: PASS
DIGEST_BINDING: PASS
RECONCILIATION_EXECUTED: YES
STACK_STATUS_AFTER: UPDATE_COMPLETE
STACK_CHAT_ALB_DNS_AFTER: dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com
LIVE_CHAT_INTEGRATION_HOST_AFTER: dev-chat-alb-1490360997.ap-southeast-1.elb.amazonaws.com
CHAT_ALB_STACK_SYNC: PASS
CHAT_INTEGRATION_STACK_SYNC: PASS
LIVE_ROUTE_COUNT: 119
MATCHING_ROUTES: 119
SOURCE_ONLY_ROUTES: 10
MISMATCHED_ROUTES: 0
GATEWAY_ONLY_ROUTES: 0
CFN_NATIVE_DRIFT_STATUS: IN_SYNC (0 drifted of the 236 checkable resources)
CFN_INTEGRATIONS_DRIFT_SUPPORTED: NO
CUSTOM_INTEGRATION_DRIFT_CHECK: PASS (18/18 in sync)
CI_HELPER_TESTS: 68/68
API_PARITY_TESTS: 29/29
LIFECYCLE_TESTS: 19/19
CHAT_DESIRED_COUNT: 1
CHAT_RUNNING_COUNT: 1
CHAT_HEALTH: PASS
API_ID_CHANGED: NO
PHYSICAL_ID_CHANGES: 0
SERVICES_REDEPLOYED: 0
SERVICES_STOPPED: 0
SOURCE_ONLY_DEPLOYED: 0
CFN_NORMAL_UPDATE_CERTIFIED: NO
CI_ACTIVATION_AUTHORIZED: NO
READY_TO_RERUN_PHASE_16A_2: YES
REPORT: docs/deployment/AWS_DEV_CHAT_CFN_OWNERSHIP_REMEDIATION_2026-10-12.md
FINAL_DECISION: CHAT_CFN_OWNERSHIP_REMEDIATED
```

HARD STOP. Did NOT activate CI/CD. Did NOT re-run Phase 16A.2 in this same phase. Did NOT add any
SOURCE_ONLY route. Did NOT restart Chat or the ALB (only CloudFormation-owned property reconciliation
was performed; Chat ECS desiredCount/runningCount were never touched). Did NOT run any migration. Did
NOT modify any unrelated service.
