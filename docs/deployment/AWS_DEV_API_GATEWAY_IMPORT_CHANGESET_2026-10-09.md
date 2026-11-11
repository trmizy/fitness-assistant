# AWS DEV API Gateway — Import Change Set Preparation — 2026-10-09 (Phase 15B-B1)

No credential, secret value, access key, or secret access key appears anywhere in this report.

## Executive Summary

This phase prepared, but deliberately did **not execute**, CloudFormation IMPORT change sets to
adopt the already-live `fitness-assistant-dev-api` HTTP API (`id1iz7upbl`, 119 routes) under
CloudFormation ownership. Three real, previously-unknown AWS behaviors were discovered this phase
via the established "real-but-never-executed, then deleted, throwaway stack" verification method,
each requiring a genuine template fix (not a workaround):

1. `Fn::ForEach`'s `${Identifier}` substitution produces an invalid, non-alphanumeric logical ID
   when the loop collection contains hyphens/slashes (`pt-applications`, `admin/branch-documents`) —
   fixed with AWS's own documented `&{Identifier}` auto-sanitizing form.
2. `Fn::ForEach`'s `Collection` must be a flat list of strings when using a single `Identifier` — a
   `{Key, Method, Path}` object-per-entry collection (needed for auth-service's and gym-service's
   individually-registered routes) is rejected outright. Fixed by expanding those 24 routes as plain,
   explicit resources instead of a loop.
3. **A genuine, pre-existing template defect, not introduced this phase**: the template modeled
   auth-service's 12 live routes as sharing **one** `AuthIntegration` logical resource, but
   auth-service actually has **12 distinct, individually-registered live integrations** (confirmed
   via a real `aws apigatewayv2 get-integrations` read) — a single shared logical resource cannot
   correctly import 12 different physical IDs. Fixed by splitting it into 11 distinct
   `Auth*Integration` resources (one legitimately shared pair, `/auth/me` + `/auth/me/password`) plus
   a 12th, `HealthIntegration`, for `GET /health` (which also, surprisingly, reuses auth's Lambda via
   its own distinct integration — also confirmed via a real read, not assumed).
4. CloudFormation's resource-import API hard-caps `resourcesToImport` at **200 entries per change
   set** — this account's real resource count is **254** (18 Integration + 119 Route + 117
   Permission), so a single import change set is not possible. The import must be split into two
   change sets along service boundaries; this phase created and fully verified **batch 1 (188
   resources: User/Fitness/Gym/Ai/Chat/Health)** and prepared, but could not test, **batch 2 (66
   resources: Auth/Payment)**, since testing batch 2 requires batch 1 to already be executed
   (forbidden this phase).
5. CloudFormation IMPORT change sets reject a template with any `Outputs` block at all
   (`"you cannot modify or add [Outputs]"`) — the batch-1 import template omits `Outputs` for this
   reason; it is not a design choice, and `Outputs` will need to be reintroduced via a later,
   ordinary (non-import) stack update once both batches are adopted.

Batch 1's real IMPORT change set was created against stack `fitness-assistant-dev-api-gateway`,
inspected in full (188/188 actions = `Import`, 0 `Remove`, 0 `Replacement`, 0 drift, 0 new
`Api`/`Stage`), and **left un-executed**, per this phase's explicit instruction. Live runtime was
re-verified unchanged after change-set creation. `FINAL_DECISION: IMPORT_CHANGE_SET_SAFE` for batch 1.

## AWS Identity Gate

```
aws sts get-caller-identity --profile gymini-admin
  Account: 191798898985
  Arn:     arn:aws:iam::191798898985:user/gymini-admin
aws configure list --profile gymini-admin
  region: ap-southeast-1 (env: AWS_REGION/AWS_DEFAULT_REGION)
```

`AWS_EXPLICIT_PROFILE_GATE: PASS`. Every direct AWS CLI call this phase used `--profile
gymini-admin` explicitly (create/describe/delete-change-set, delete-stack, validate-template,
describe-stacks, get-apis, get-policy, describe-db-clusters). `[default]` was never read or touched.
No access key or secret value was printed, logged, or written to any file this phase.

## Verified Live Baseline

```
LIVE_ROUTE_COUNT: 119
MATCH: 119
SOURCE_ONLY: 10  (unchanged — same 10 named in Phase 15B-A/15B-HF, none touched this phase)
GATEWAY_ONLY: 0
MISMATCHED: 0
BASELINE_ROUTE_COUNT_EXPECTED: 119 — CONFIRMED
SOURCE_ONLY_INCLUDED_IN_BASELINE: 0 — CONFIRMED
MISMATCHED_ROUTE_CHANGES_PENDING: 0 — CONFIRMED
```

Re-verified via a real, read-only `Test-ApiRouteParity.ps1` run both before and after all
change-set-creation activity this phase — identical result both times. `API_ID`, `Name`
(`fitness-assistant-dev-api`), and `ApiEndpoint` were independently re-confirmed via a real
`aws apigatewayv2 get-apis` read: unchanged.

## CloudFormation Resource Ownership Map

Full detail in `docs/deployment/generated/api-gateway-pre-import-resource-map.json` (now carries a
real `logicalResourceId` for every physical resource, cross-derived from the corrected template) and
`docs/deployment/generated/api-gateway-import-resources.json` (the full 254-resource specification).

| Resource type | Count | Import-supported | Current owner | Import required |
|---|---|---|---|---|
| `AWS::ApiGatewayV2::Api` | 1 | — | NONE (no IaC) | NO — never declared in this template (reference-only via `HttpApiId` parameter) |
| `AWS::ApiGatewayV2::Stage` (`$default`) | 1 | — | NONE (no IaC) | NO — left fully unmanaged this phase (see "Reference vs Ownership" below) |
| `AWS::ApiGatewayV2::Integration` | 18 | YES (confirmed via real change set: `{ApiId, IntegrationId}`) | NONE (no IaC) | YES — all 18 |
| `AWS::ApiGatewayV2::Route` | 119 | YES (confirmed via real change set: `{ApiId, RouteId}`) | NONE (no IaC) | YES — all 119 |
| `AWS::Lambda::Permission` | 117 | YES (confirmed via real change set: `{FunctionName, Id=Sid}`) | NONE (no IaC) | YES — all 117 |

`DeletionPolicy: Retain` was added to every one of the 254 importable resources (required by AWS for
any resource targeted for import — confirmed via a real "`must have DeletionPolicy attribute
specified`" error earlier this engagement) and re-verified via a fresh real test change set that the
template still expands with zero errors after the addition.

No resource in this account's live Gateway requires `RECREATION_REQUIRED: YES` — every one of the
254 resources is confirmed importable in place.

## Import-Support Findings

```
API_IMPORT_SUPPORTED: N/A — this template never owns the Api resource (reference-only)
STAGE_IMPORT_SUPPORTED: N/A — this template never owns the Stage resource (reference-only)
ROUTE_IMPORT_SUPPORTED: YES — 119/119, confirmed via a real (non-executed) IMPORT change set
INTEGRATION_IMPORT_SUPPORTED: YES — 18/18, confirmed via a real (non-executed) IMPORT change set
LAMBDA_PERMISSION_OWNERSHIP: FULL — 117/117 confirmed importable (not PARTIAL/EXTERNAL); every
  Sid + SourceArn was fetched via a real `aws lambda get-policy` on all 6 functions and cross-matched
  1:1 against the template's logical IDs with zero unmatched and zero conflicts.
```

The AWS official resource-import-supported-resources reference (confirmed earlier this engagement)
lists `AWS::ApiGatewayV2::Api`, `Route`, `Integration`, and `AWS::Lambda::Permission`/`Function` all
as import-capable — consistent with what the real change sets this phase also independently proved.

## API/Stage Protection

```
API_ID: id1iz7upbl — UNCHANGED (re-confirmed via real aws apigatewayv2 get-apis read)
API_NAME: fitness-assistant-dev-api — UNCHANGED
API_ENDPOINT: https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com — UNCHANGED
STAGE: $default, AutoDeploy — UNCHANGED (not touched; no Stage resource exists in this template)
CORS: UNCHANGED (not touched by any resource in this template)
CUSTOM_DOMAIN: none configured, UNCHANGED
FRONTEND_BASE_URL: UNCHANGED
ENDPOINT_REPLACEMENT_RISK: NONE
```

This template structurally cannot create or replace the Api (it has no `AWS::ApiGatewayV2::Api`
resource at all — `HttpApiId` is a plain `String` parameter, not a `!Ref` to a template-owned
resource), so `API_ID_REPLACEMENT_RISK: NONE` is a structural guarantee, not merely an observed
result.

## Route and Integration Ownership

119/119 routes and 18/18 integrations are modeled in `infra/cloudformation/api-gateway-baseline.yaml`
with a verified 1:1 real-physical-ID mapping (zero unmatched, zero logical-ID collisions — confirmed
via a dedicated cross-validation script comparing the template's actual declared logical IDs against
the live-data-derived mapping). One real, pre-existing modeling defect was found and fixed this phase:
auth-service's 12 routes were wrongly modeled against a single shared integration; corrected to 11
distinct `Auth*Integration` resources (`/auth/me` + `/auth/me/password` legitimately share one,
`AuthMeIntegration`) plus `HealthIntegration` for `GET /health` (which also targets the auth Lambda,
via its own distinct live integration `uvqqpy4` — confirmed via a real read, not assumed from the
Lambda target name alone).

## Lambda Permission Ownership

```
LAMBDA_PERMISSION_OWNERSHIP: FULL
PERMISSIONS_LIVE: 117 (confirmed via real `aws lambda get-policy` on all 6 functions:
  auth=13, user=22, fitness=24, gym=35, payment=15, ai=8 — sums to 117, matching the earlier
  Phase 15B-B1 pre-import-resource-map read exactly)
PERMISSIONS_MAPPED: 117/117, zero unmatched, zero logical-ID conflicts
```

Every permission's `Id` (the IAM policy statement `Sid`) and `SourceArn` was used to derive its exact
logical resource in the template (prefix/path based for the `Fn::ForEach`-generated and explicit
blocks alike). `GymMeGymCheckinsPermission` is the one legitimate many-to-one case (`GET` and `POST
/me/gym-checkins` share a single live permission, since Lambda `SourceArn` scoping is per-path, not
per-method — the same convention Phase 15B-HF's own hotfix already used live) — modeled as exactly
one logical resource shared by two Route resources, not duplicated.

No permission needed to remain `EXTERNAL`/`PREEXISTING` this phase; all 117 have a clean, verified
import path.

## Import Resource Specification

`docs/deployment/generated/api-gateway-import-resources.json` — 254 resources, each with a real
(non-placeholder) `LogicalResourceId` and a real `ResourceIdentifier`, built by cross-deriving:

- Live routes/integrations (`aws apigatewayv2 get-routes`/`get-integrations`, real reads)
- Live Lambda permissions (`aws lambda get-policy` on all 6 functions, real reads)
- The corrected template's actual `Fn::ForEach`-expanded and explicit logical IDs

Cross-validated against the template with a dedicated script: **0 missing, 0 extra, 254 = 254**,
confirming every logical ID the template declares has exactly one real physical counterpart and vice
versa.

Because of the 200-resource import limit (see Executive Summary #4), this specification is split into:

- `api-gateway-import-resources.json` — full 254-resource specification (reference/audit copy)
- Batch 1 resources-to-import (188: User/Fitness/Gym/Ai/Chat/Health) — used in the real change set below
- `api-gateway-import-resources-batch2.json` — batch 2 (66: Auth/Payment) — specification only, not
  yet tested (see "Phase 15B-B2 Execution Preconditions")

## Import Change Set

```
STACK_NAME: fitness-assistant-dev-api-gateway (confirmed not pre-existing before this phase;
  no conflicting stack owns unrelated resources — the only other stack in this account/region is
  the unrelated gymini-dev-on-demand)
CHANGE_SET_NAME: phase-15b-b1-import-batch1
CHANGE_SET_TYPE: IMPORT
CHANGE_SET_STATUS: CREATE_COMPLETE
CHANGE_SET_EXECUTED: NO
RESOURCES_IN_THIS_CHANGE_SET: 188 of 254 (batch 1 — User/Fitness/Gym/Ai/Chat/Health)
```

Template used: `infra/cloudformation/api-gateway-baseline-batch1-import.yaml` — a derived subset of
the real `api-gateway-baseline.yaml` containing only batch 1's 188 resources (Auth and Payment
sections removed; `Outputs` omitted per the IMPORT-rejects-Outputs finding above). This file is a
change-set-preparation artifact only — the real, authoritative, full adoption template remains
`api-gateway-baseline.yaml`.

Two real failed attempts preceded the successful one (both fixed before creating the final change
set, not worked around):

1. First attempt (254 resources, full template) — `ValidationError: ... 'resourcesToImport' failed
   to satisfy constraint: Member must have length less than or equal to 200`. Led directly to the
   batch split.
2. Second attempt (188-resource batch, full-featured template including `Outputs`) —
   `"As part of the import operation, you cannot modify or add [Outputs]"`. Fixed by removing
   `Outputs` from the batch-1-only template.

The stack now exists in AWS in `REVIEW_IN_PROGRESS` status — this is CloudFormation's standard,
inert, non-mutating placeholder for an unexecuted IMPORT/CREATE change set; **zero live AWS resources
were created, modified, or touched** by this state. The change set was deliberately left in place
(not deleted) as the prepared artifact for Phase 15B-B2 to execute.

## Destructive Action Scan

```
Total changes inspected: 188
Action breakdown: Import=188, Add=0, Modify=0, Remove=0
Replacement flagged: 0
Resources with non-empty Scope (drift from template): 0
New AWS::ApiGatewayV2::Api or ::Stage resources: 0
Resource type breakdown: Integration=6, Route=92, Permission=90 (sums to 188, matches batch 1's exact
  expected composition for User+Fitness+Gym+Ai+Chat+Health)
```

Verified twice, independently: once via direct `aws cloudformation describe-change-set` queries
(`Action`, `Replacement`, `Scope` fields), and once via a manual re-implementation of this repo's own
`Find-DestructiveChangeSetActions` safety-guard logic applied directly to the real change-set JSON
(the shared Pester-tested module itself expects hashtable-shaped input, which PowerShell 5.1's
`ConvertFrom-Json` does not produce without `-AsHashtable`, unavailable in this environment — the
guard's own logic was applied inline instead of modifying the shared, tested module for this one
read). Both methods agree: zero destructive or unexpected actions.

```
DESTRUCTIVE_ACTIONS_FOUND: NO
UNEXPECTED_CREATES: NO
```

## API ID Preservation

```
API_ID_PRESERVED_BY_PLAN: YES
```

The batch-1 template contains no `AWS::ApiGatewayV2::Api` resource of any kind; `HttpApiId` is used
exclusively as a plain parameter value referenced by every Route/Integration/Permission. The real
change set's 188 actions are 100% `Import` against already-existing physical resources under the
existing `id1iz7upbl` API — there is no code path by which this plan could create, replace, or
re-point the API.

## Runtime Revalidation

```
LIVE_ROUTE_COUNT (after change-set creation): 119 — UNCHANGED
MATCH: 119, SOURCE_ONLY: 10, GATEWAY_ONLY: 0, MISMATCHED: 0 — UNCHANGED
API_ID / Name / Endpoint: UNCHANGED (re-confirmed via a fresh real aws apigatewayv2 get-apis read)
RUNTIME_CHANGED: NO
```

Change-set *creation* (as opposed to *execution*) never mutates the target resources — re-verified
empirically, not just assumed, via the before/after parity re-runs above.

## Remaining Source-Only Routes

Unchanged from Phase 15B-A/15B-HF — none were added, modified, or otherwise touched this phase:

```
POST /auth/register/resend
PATCH /auth/users/:userId/name
POST /auth/password-reset
POST /auth/password-reset/request   (the one route already modeled in api-gateway-additions.yaml,
                                      intentionally still excluded from both the baseline and this
                                      phase's import)
POST /auth/partner-applications/start
POST /auth/partner-applications/verify
POST /auth/partner-applications/set-password
POST /webhooks/dropbox-sign
ANY  /complaint-photos/{token}
ANY  /partner-invitations/{token}
```

## Phase 15B-B2 Execution Preconditions

1. **Execute batch 1 first.** Run `aws cloudformation execute-change-set --profile gymini-admin
   --stack-name fitness-assistant-dev-api-gateway --change-set-name phase-15b-b1-import-batch1`, then
   confirm `StackStatus: IMPORT_COMPLETE` and re-run the live parity check (expect it unchanged:
   119/119 match, 0 mismatched, 0 gateway-only).
2. **Create and verify batch 2's real change set only after step 1 succeeds.** Batch 2 (66
   resources: Auth + Payment, specification already prepared in
   `api-gateway-import-resources-batch2.json`) requires the stack to already exist — a real,
   non-executed `create-change-set --change-set-type IMPORT` call against the now-existing stack,
   using the **full** `api-gateway-baseline.yaml` (all 254 resources — the 188 already-imported ones
   must appear unchanged in this template, plus the 66 new ones) and `--resources-to-import`
   containing only the 66 batch-2 entries. This could not be tested in this phase because it
   genuinely requires batch 1 to already be live; attempting it against a non-existent stack would
   not be a real test.
3. **Re-add `Outputs` only after both batches are imported**, via an ordinary (non-import) stack
   update — confirmed this phase that `Outputs` cannot appear in any IMPORT-type change set at all,
   not merely a new one.
4. Re-run `scripts/aws/api-gateway/lib/ApiRouteParity.Tests.ps1` (29/29 this phase) and the live
   parity tool after each batch executes, exactly as this phase did after change-set *creation*.
5. Do not add any of the 10 remaining `SOURCE_ONLY` routes, including
   `POST /auth/password-reset/request`, through this import path — `api-gateway-additions.yaml`
   remains the deliberately separate vehicle for that, per Phase 15B-A's own design.

## Final Response

```
PHASE: 15B-B1
AWS_PRINCIPAL: arn:aws:iam::191798898985:user/gymini-admin
AWS_EXPLICIT_PROFILE_GATE: PASS
ROOT_USED: NO
ACCOUNT: 191798898985
REGION: ap-southeast-1
API_ID: id1iz7upbl
LIVE_ROUTE_COUNT: 119
SOURCE_ONLY_ROUTES: 10
MISMATCHED_ROUTES: 0
GATEWAY_ONLY_ROUTES: 0
BASELINE_ROUTE_COUNT: 119
SOURCE_ONLY_INCLUDED_IN_BASELINE: 0
RESOURCE_IMPORT_MAP: CREATED (api-gateway-pre-import-resource-map.json + api-gateway-import-resources.json, 254/254 cross-validated, 0 unmatched)
API_IMPORT_SUPPORTED: N/A (reference-only, never template-owned)
STAGE_IMPORT_SUPPORTED: N/A (reference-only, never template-owned)
ROUTE_IMPORT_SUPPORTED: YES (119/119)
INTEGRATION_IMPORT_SUPPORTED: YES (18/18)
LAMBDA_PERMISSION_OWNERSHIP: FULL (117/117)
API_ID_REPLACEMENT_RISK: NONE
ENDPOINT_REPLACEMENT_RISK: NONE
TEMPLATE_VALIDATION: PASS
UNIT_TESTS: PASS (29/29 Pester, ApiRouteParity.Tests.ps1)
STACK_NAME: fitness-assistant-dev-api-gateway
IMPORT_CHANGE_SET_CREATED: YES — PARTIAL (batch 1 of 2: 188/254 resources created+verified; batch 2: 66/254 specification prepared, not yet testable — requires batch 1 executed first)
CHANGE_SET_NAME: phase-15b-b1-import-batch1
CHANGE_SET_EXECUTED: NO
DESTRUCTIVE_ACTIONS_FOUND: NO
UNEXPECTED_CREATES: NO
API_ID_PRESERVED_BY_PLAN: YES
RUNTIME_CHANGED: NO
CLOUDFORMATION_OWNERSHIP_CHANGED: NO (import not executed)
SERVICES_REDEPLOYED: NONE
SERVICES_STOPPED: NONE
FINAL_COST_LEAK_CHECK: DEFERRED_CONTINUOUS_FULL_SERVICE_SESSION
REPORT: docs/deployment/AWS_DEV_API_GATEWAY_IMPORT_CHANGESET_2026-10-09.md
READY_FOR_PHASE_15B_B2: YES, WITH PRECONDITIONS (see "Phase 15B-B2 Execution Preconditions" above — batch 1 must execute before batch 2 can even be created)
FINAL_DECISION: IMPORT_CHANGE_SET_SAFE
```

HARD STOP. DO NOT execute the import change set. DO NOT add the remaining 10 source-only routes. DO
NOT change routing. DO NOT begin CI/CD. DO NOT stop running services.
