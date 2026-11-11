# AWS DEV API Gateway — Batch 2 IMPORT Change Set Preparation — 2026-10-09 (Phase 15B-B2B1)

No credential, secret value, access key, or secret access key appears anywhere in this report.

## Executive Summary

Batch 1 (188 resources: User/Fitness/Gym/Ai/Chat/Health) is confirmed stack-managed
(`IMPORT_COMPLETE`, 0 physical-ID drift). This phase prepared, inspected, and **deliberately did not
execute** the Batch 2 IMPORT change set (66 resources: Auth + Payment) that will bring the stack to
its full, 254-resource adoption. Every required safety gate passed on the first real attempt (unlike
Batch 1, which needed two iterations) — the lessons from Batch 1 (no `Outputs` in an import template,
`DeletionPolicy: Retain` on every importable resource) were applied directly. The real, non-executed
change set shows exactly 66 `Import` actions, **zero** actions touching any of the 188 already-managed
Batch-1 resources, zero destructive actions, zero replacements, and zero new `Api`/`Stage`. A
CloudFormation stack-resource-count limit of 500 (distinct from the 200-resource import-operation
limit discovered in Phase 15B-B1) was confirmed via official AWS documentation, not inferred — 254
total resources sits comfortably within it. `FINAL_DECISION: BATCH2_IMPORT_CHANGESET_SAFE`.

## AWS Identity

```
aws sts get-caller-identity --profile gymini-admin
  Account: 191798898985
  Arn:     arn:aws:iam::191798898985:user/gymini-admin
Region: ap-southeast-1
```

`AWS_EXPLICIT_PROFILE_GATE: PASS`. Every AWS CLI call this phase used `--profile gymini-admin`
explicitly. `[default]`/root were never used. No credential value appears in this report.

## Current Batch-1 Stack Ownership

```
STACK_STATUS: IMPORT_COMPLETE
STACK_MANAGED_RESOURCES: 188 (confirmed via a fresh list-stack-resources read)
RESOURCE_STATUS breakdown: { "UPDATE_COMPLETE": 188 }
```

**Git/artifact integrity (performed before touching AWS):**

- `git rev-parse HEAD`: `f21a54e37da97cc5260bc70b941daa2770ee3fee` (branch `aws-deploy`, unchanged
  since Phase 15B-B2A)
- SHA-256 of every Batch-2-relevant artifact (`api-gateway-baseline.yaml`,
  `api-gateway-import-resources-batch2.json`, `api-gateway-import-resources.json`,
  `api-gateway-pre-import-resource-map.json`, `api-gateway-baseline-batch1-import.yaml`) — all
  **identical** to the hashes recorded immediately before Phase 15B-B2A's Batch-1 execution. No
  silent regeneration occurred between phases.
- The existing Phase 15B-B1 Batch-2 spec (`api-gateway-import-resources-batch2.json`) was **validated,
  not rebuilt** — its 66 resource identifiers are independent of Batch 1's execution (Auth/Payment
  physical resources were never touched by Batch 1). What legitimately needed to be newly created this
  phase was the **template**: Batch 1's change set used a batch-1-only 188-resource template, but a
  second IMPORT change set against an *already-existing* stack must submit the stack's full desired
  end-state — so `api-gateway-baseline-batch2-import.yaml` (the complete 254-resource
  `api-gateway-baseline.yaml`, minus `Outputs`) was built for this purpose. This is a structural
  requirement of CloudFormation's own change-set model, not a redesign of Batch 2's content.
- **Representative physical-ID check** (User/Fitness/Gym/Ai/Chat/Health integrations + 4 sample
  Gym/Chat/Health routes/permissions) against `api-gateway-import-resources.json`: `BATCH1_PHYSICAL_ID_DRIFT: 0`.

## CloudFormation Capacity Check

Fetched directly from AWS's official CloudFormation quotas documentation (not inferred from the
earlier import-operation limit):

```
Resources per CloudFormation template/stack (official limit): 500 resources
Resources per resourcesToImport call (Phase 15B-B1's own empirical finding): 200 resources — a
  SEPARATE, operation-specific limit, not the same quota.
Template body size for a direct CreateStack/UpdateStack/ValidateTemplate/CreateChangeSet request:
  51,200 bytes

FINAL_STACK_RESOURCE_COUNT: 254 (188 existing + 66 Batch 2)
TOTAL_STACK_RESOURCE_LIMIT: 500
FINAL_STACK_WITHIN_LIMIT: YES (254 < 500, well clear of the limit)
api-gateway-baseline-batch2-import.yaml size: 35,182 bytes (< 51,200-byte direct-request limit —
  no S3-mediated template upload needed)
```

## Batch-2 Exact Inventory

```
AUTH_INTEGRATIONS: 11
AUTH_ROUTES: 12
AUTH_PERMISSIONS: 12
  (subtotal: 35)
PAYMENT_INTEGRATIONS: 1
PAYMENT_ROUTES: 15
PAYMENT_PERMISSIONS: 15
  (subtotal: 31)
TOTAL: 66
```

Zero User/Fitness/Gym/Ai/Chat/Health resources appear in the Batch-2 list (verified by filtering the
full 66-entry specification for any logical ID not starting with `Auth`/`Payment` — none found).

## Auth 1:1 Integration Mapping

Re-verified against a **fresh** live read this phase (not reused from Phase 15B-B1), confirming the
template-defect fix discovered then still holds:

| Route | Live Integration ID | Template Logical Integration | Live Lambda Target |
|---|---|---|---|
| `POST /auth/login` | `1vnd68s` | `AuthLoginIntegration` | `fitness-assistant-dev-auth` |
| `POST /auth/logout` | `vq6v245` | `AuthLogoutIntegration` | `fitness-assistant-dev-auth` |
| `PATCH /auth/me` | `mg2016a` | `AuthMeIntegration` | `fitness-assistant-dev-auth` |
| `PATCH /auth/me/password` | `mg2016a` | `AuthMeIntegration` (legitimately shared) | `fitness-assistant-dev-auth` |
| `POST /auth/refresh` | `1m2k0ec` | `AuthRefreshIntegration` | `fitness-assistant-dev-auth` |
| `POST /auth/register` | `6l59zzc` | `AuthRegisterIntegration` | `fitness-assistant-dev-auth` |
| `POST /auth/register/verify` | `4y4qfnr` | `AuthRegisterVerifyIntegration` | `fitness-assistant-dev-auth` |
| `GET /auth/users` | `9ibcmaf` | `AuthUsersListIntegration` | `fitness-assistant-dev-auth` |
| `PATCH /auth/users/{userId}/disable` | `ai0sybi` | `AuthUsersDisableIntegration` | `fitness-assistant-dev-auth` |
| `PATCH /auth/users/{userId}/enable` | `9291bod` | `AuthUsersEnableIntegration` | `fitness-assistant-dev-auth` |
| `PATCH /auth/users/{userId}/role` | `5z0d625` | `AuthUsersRoleIntegration` | `fitness-assistant-dev-auth` |
| `POST /auth/verify` | `0dz9hk6` | `AuthVerifyIntegration` | `fitness-assistant-dev-auth` |

```
AUTH_INTEGRATION_MAPPING_1_TO_1: YES (12/12 live routes mapped, 0 drift, integrations never collapsed
  for convenience — 11 distinct + 1 legitimate share for /auth/me + /auth/me/password)
```

## Payment Mapping

Metadata inspection only — no payment transaction, webhook, or Lambda invocation performed.

All 15 live Payment routes share **one** live integration (`w9fjro0`, correct design — unlike Auth,
Payment never had a per-route-integration defect), confirmed via a fresh live read:

| Route | Live Integration ID | Template Logical Route | Live Target |
|---|---|---|---|
| `ANY /payments` | `w9fjro0` | `PaymentpaymentsBareRoute` | `fitness-assistant-dev-payment` |
| `ANY /payments/{proxy+}` | `w9fjro0` | `PaymentpaymentsProxyRoute` | `fitness-assistant-dev-payment` |
| `ANY /me/payments` / `/{proxy+}` | `w9fjro0` | `PaymentmepaymentsBareRoute` / `ProxyRoute` | `fitness-assistant-dev-payment` |
| `ANY /me/wallet` / `/{proxy+}` | `w9fjro0` | `PaymentmewalletBareRoute` / `ProxyRoute` | `fitness-assistant-dev-payment` |
| `ANY /me/pt-wallet` / `/{proxy+}` | `w9fjro0` | `PaymentmeptwalletBareRoute` / `ProxyRoute` | `fitness-assistant-dev-payment` |
| `ANY /me/withdrawals` / `/{proxy+}` | `w9fjro0` | `PaymentmewithdrawalsBareRoute` / `ProxyRoute` | `fitness-assistant-dev-payment` |
| `ANY /admin/payments` / `/{proxy+}` | `w9fjro0` | `PaymentadminpaymentsBareRoute` / `ProxyRoute` | `fitness-assistant-dev-payment` |
| `ANY /payments/webhook/{provider}` | `w9fjro0` | `PaymentWebhookProviderRoute` | `fitness-assistant-dev-payment` |
| `ANY /payments/webhook/vnpay` | `w9fjro0` | `PaymentWebhookVnpayRoute` | `fitness-assistant-dev-payment` |
| `ANY /payments/vnpay/return` | `w9fjro0` | `PaymentVnpayReturnRoute` | `fitness-assistant-dev-payment` |

`15/15 live Payment routes mapped, 0 drift.` 15 Lambda permissions confirmed present (one per route,
no sharing needed since every Payment path is distinct).

## Batch-1 Template Preservation

```
aws cloudformation get-template --stack-name fitness-assistant-dev-api-gateway --template-stage Original
  -> byte-identical (modulo a cosmetic Unicode-rendering artifact in YAML comments) to the local
     api-gateway-baseline-batch1-import.yaml used to execute Batch 1
```

Because `api-gateway-baseline.yaml` (full 254-resource source) has not been edited since Phase
15B-B1 (hash-confirmed identical) and `api-gateway-baseline-batch1-import.yaml` was derived from it by
pure line-deletion (never edited after extraction), the 188 Batch-1 resource declarations inside
`api-gateway-baseline-batch2-import.yaml` (this phase's Batch-2 template) are guaranteed
character-for-character identical to what's already live-managed. This was independently confirmed by
the real change-set inspection below: **zero** of the 66 planned actions reference any of the 188
Batch-1-owned logical IDs.

```
BATCH1_TEMPLATE_CHANGES: 0
```

## Batch-2 Import Resource Map

- `docs/deployment/generated/api-gateway-import-batch2-resources.json` — the 66-resource
  specification in the required `LOGICAL_ID`/`RESOURCE_TYPE`/`EXISTING_PHYSICAL_ID`/
  `IMPORT_IDENTIFIER`/`SERVICE`/`EXPECTED_CURRENT_TARGET` shape.
- `docs/deployment/generated/api-gateway-pre-import-batch2-resource-map.json` — the combined
  254-entry map (188 already `STACK_MANAGED` + 66 `PROPOSED_IMPORT`), prepared so a future Phase
  15B-B2B2 can prove all 254 physical IDs stayed unchanged through Batch 2's eventual execution.

No secrets, tokens, or Lambda environment values appear in either file.

## Import Change Set

```
STACK_NAME: fitness-assistant-dev-api-gateway
CHANGE_SET_NAME: phase-15b-b2-import-batch2
CHANGE_SET_TYPE: IMPORT
CHANGE_SET_STATUS: CREATE_COMPLETE (reached on the FIRST attempt — no Outputs/DeletionPolicy mistakes
  this time, applying Batch 1's own lessons directly)
EXECUTION_STATUS: AVAILABLE
CHANGE_SET_EXECUTED: NO
```

Template used: `infra/cloudformation/api-gateway-baseline-batch2-import.yaml` (the full
254-resource baseline, `Outputs` omitted).

## Actual Change-Set Actions

```
Total changes: 66
Action breakdown: Import=66, Add=0, Modify=0, Remove=0
Resource type breakdown: Integration=12, Route=27, Permission=27 (exactly matches: Auth 11+12+12,
  Payment 1+15+15)
Replacement flagged: 0
Changes referencing a Batch-1-owned (already stack-managed) logical ID: 0
New AWS::ApiGatewayV2::Api or ::Stage: 0
```

```
IMPORT_ACTIONS: 66
BATCH1_RESOURCE_ACTIONS: 0
DESTRUCTIVE_ACTIONS: 0
UNEXPECTED_CREATES: 0
```

## Destructive Action Scan

Applied the repo's own `Find-DestructiveChangeSetActions` safety-guard logic directly against the
real AWS change-set response (same inline-reimplementation approach as Phase 15B-B2A, since
PowerShell 5.1's `ConvertFrom-Json` output is a `PSCustomObject`, not the hashtable shape the shared,
Pester-tested module expects without `-AsHashtable`, unavailable here):

```
Non-Import actions: 0
With Replacement flag: 0
New Api/Stage resources: 0
With non-empty Scope (drift from template): 0
DESTRUCTIVE_ACTION_GUARD: PASS
```

`scripts/aws/api-gateway/lib/ApiRouteParity.Tests.ps1`: 29/29 passed (unchanged from every prior
phase this engagement).

## API / Endpoint Preservation

```
API ID: id1iz7upbl — unchanged
Name: fitness-assistant-dev-api — unchanged
Endpoint: https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com — unchanged
Stage: $default, AutoDeploy: true — unchanged
CORS (AllowOrigins/AllowMethods/AllowHeaders/AllowCredentials/MaxAge) — unchanged
```

```
API_ID_PRESERVED_BY_PLAN: YES
ENDPOINT_PRESERVED_BY_PLAN: YES
```

## Runtime Revalidation

Re-ran the read-only parity tool immediately after Batch-2 change-set creation:

```
LIVE_ROUTE_COUNT: 119 — unchanged
MATCH: 119, SOURCE_ONLY: 10 (identical list), GATEWAY_ONLY: 0, MISMATCHED: 0 — unchanged
Stack status: still IMPORT_COMPLETE, still 188 managed resources (100+88 across the CLI's own
  paginated text query) — Batch 2 has NOT been applied
Batch-2 change-set ExecutionStatus: still AVAILABLE (confirmed NOT executed)
```

```
RUNTIME_CHANGED: NO
```

Also re-confirmed `SOURCE_ONLY_INCLUDED_IN_IMPORT: 0` — a grep of the Batch-2 template for every
named SOURCE_ONLY path found only an unrelated, already-live `admin/complaint-photos` route (distinct
from the SOURCE_ONLY `/complaint-photos/{token}`) and an explanatory comment, not an actual resource.

## B2B2 Preconditions

1. Execute `phase-15b-b2-import-batch2` only — no new change set should be needed, since it already
   reached `CREATE_COMPLETE`/`AVAILABLE` on the first attempt.
2. After execution, confirm `StackStatus: IMPORT_COMPLETE` and `STACK_MANAGED_RESOURCES: 254`.
3. Cross-check all 254 physical IDs (188 Batch-1 + 66 Batch-2) against
   `api-gateway-pre-import-batch2-resource-map.json` — expect 0 drift.
4. Re-run the parity tool and the Pester suite exactly as every prior phase has.
5. Only after Batch 2 is confirmed can `Outputs` be reintroduced, via an ordinary (non-import) stack
   UPDATE — not during any import-type operation.
6. Continue to withhold all 10 `SOURCE_ONLY` routes and `api-gateway-additions.yaml`'s
   `POST /auth/password-reset/request` from any import path.

## Full-Service State

```
aws rds describe-db-clusters -> fitness-assistant-dev-aurora: available
SERVICES_REDEPLOYED: 0
SERVICES_STOPPED: 0
Backend: ON   Network: ON   Chat: ON   AI: ON   Aurora: available
```

`FINAL_COST_LEAK_CHECK: DEFERRED_CONTINUOUS_FULL_SERVICE_SESSION`.

## Final Response

```
PHASE: 15B-B2B1
AWS_PRINCIPAL: gymini-admin
AWS_EXPLICIT_PROFILE_GATE: PASS
ROOT_USED: NO
STACK_NAME: fitness-assistant-dev-api-gateway
STACK_STATUS_BEFORE: IMPORT_COMPLETE
BATCH1_ALREADY_MANAGED: 188
BATCH2_PLANNED_IMPORTS: 66
FINAL_STACK_RESOURCE_COUNT: 254
FINAL_STACK_WITHIN_LIMIT: YES
AUTH_INTEGRATION_MAPPING_1_TO_1: YES
SOURCE_ONLY_INCLUDED_IN_IMPORT: 0
BATCH1_TEMPLATE_CHANGES: 0
RESOURCE_IMPORT_MAP: PASS
PRE_IMPORT_RESOURCE_MAP_COUNT: 254
TEMPLATE_VALIDATION: PASS
UNIT_TESTS: 29/29
CHANGE_SET_TYPE: IMPORT
CHANGE_SET_NAME: phase-15b-b2-import-batch2
IMPORT_CHANGE_SET_CREATED: YES
CHANGE_SET_STATUS: CREATE_COMPLETE
IMPORT_ACTIONS: 66
BATCH1_RESOURCE_ACTIONS: 0
DESTRUCTIVE_ACTIONS: 0
UNEXPECTED_CREATES: 0
DESTRUCTIVE_ACTION_GUARD: PASS
API_ID: id1iz7upbl
API_ID_PRESERVED_BY_PLAN: YES
ENDPOINT_PRESERVED_BY_PLAN: YES
CHANGE_SET_EXECUTED: NO
CLOUDFORMATION_MANAGED_RESOURCES_AFTER: 188
LIVE_ROUTE_COUNT: 119
SOURCE_ONLY_ROUTES: 10
MISMATCHED_ROUTES: 0
GATEWAY_ONLY_ROUTES: 0
RUNTIME_CHANGED: NO
SERVICES_REDEPLOYED: 0
SERVICES_STOPPED: 0
FINAL_COST_LEAK_CHECK: DEFERRED_CONTINUOUS_FULL_SERVICE_SESSION
REPORT: docs/deployment/AWS_DEV_API_GATEWAY_IMPORT_BATCH2_CHANGESET_2026-10-09.md
FINAL_DECISION: BATCH2_IMPORT_CHANGESET_SAFE
READY_FOR_PHASE_15B_B2B2: YES
```

HARD STOP. Did NOT execute Batch 2. Did NOT add any SOURCE_ONLY route. Did NOT modify routing. Did
NOT begin CI/CD. Did NOT stop any running service.
