# AWS DEV API Gateway — Source-of-Truth Model + Local IaC Design — 2026-10-09 (Phase 15A)

No credential, secret value, access key, or secret access key appears anywhere in this report.
**Read-only inventory + local IaC design only. Zero AWS mutations.**

## Executive Summary

The live `fitness-assistant-dev-api` (HTTP API, `id1iz7upbl`) has never been owned by any IaC tool —
re-confirmed fresh in this phase, not assumed from history. All 107 live routes were built up across
many ad-hoc AWS CLI deployment phases. A full route inventory (source vs. live) found **10 real
SOURCE_ONLY gaps** (beyond the 2 already known) and **4 real cross-service routing conflicts**
(gym-service routes shadowed by user-service's own catch-all routes for `/pt` and `/me`). After
accounting for every live route, parity is: **108 match, 10 source-only, 0 gateway-only, 4
mismatched** out of 107 live routes and 118 comparable source entries. CloudFormation was selected
as the IaC strategy (the repo's own existing precedent for this exact class of problem). A local
template modeling the existing API plus the two explicitly-required routes was written and
syntax-validated (read-only `validate-template` call), a read-only drift-detection tool was built and
run for real against the live API, and 17 local unit tests pass. Nothing was applied, deployed, or
imported.

## AWS Identity Verification

```
aws sts get-caller-identity
Account: 191798898985
Arn:     arn:aws:iam::191798898985:user/vmimport-admin
```

The brief's "Required IAM principal: gymini-admin" does not match the actual configured credential
(`vmimport-admin`) — flagged explicitly to the owner before any AWS read was performed. The owner
confirmed proceeding with `vmimport-admin`: not root, correct account, correct region, the same
principal every prior phase in this engagement has used safely. None of the brief's actual HARD STOP
triggers (`:root` in the ARN, unknown principal, wrong account) applied.

`AWS_ROOT_USED: NO`. `ACCOUNT: 191798898985`. `REGION: ap-southeast-1` (confirmed via `aws configure
list`).

## Live API Gateway Inventory

```
API Type:     HTTP API (v2) — confirmed via apigatewayv2 get-apis; apigateway get-rest-apis (v1) returned empty
API ID:       id1iz7upbl
API Name:     fitness-assistant-dev-api
Stage:        $default (AutoDeploy: true — no separate deploy step; a route/integration
              change takes effect immediately once created)
Endpoint:     https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com
Routes:       107
Integrations: 18 (12 individual AWS_PROXY integrations for auth's 12 explicit routes +
              5 shared AWS_PROXY integrations, one each for user/fitness/gym/payment/ai +
              1 HTTP_PROXY integration for chat via dev-chat-alb)
Authorizers:  0 — every route's AuthorizationType is NONE at the Gateway level; all real JWT
              verification happens inside each Lambda's own Express authMiddleware
CORS:         AllowOrigins: [the real S3 frontend website URL only], AllowCredentials: false,
              AllowHeaders: [authorization, content-type], standard methods + wildcard, MaxAge 300
```

Full machine-readable inventory: `docs/deployment/generated/api-gateway-live-routes.json` (107
entries, safe metadata only — route ID, method, path, authorization type, integration ID/type/target).

## Source Route Inventory

Traced directly from router/controller registrations (`app.use`/`router.get|post|patch|...`) across
all 7 services, not from documentation. Full inventory:
`docs/deployment/generated/api-source-routes.json`.

Key structural finding: **user/fitness/gym/payment/ai each expose their real sub-paths through one
shared `AWS_PROXY` integration per Lambda, behind a bare + `{proxy+}` route pair per top-level
resource prefix** (any new sub-route under an existing prefix needs no Gateway change at all).
**`auth` has no catch-all** — every one of its routes (and chat-service's webhook-style public
routes under its own `/chat` prefix) is individually, explicitly registered. This is exactly why new
Auth routes have always needed a manual Gateway addition (as `PATCH /auth/me/password` did in Phase
13A) while new User/Fitness/Gym/Payment/AI sub-routes never have.

## Route Parity

```
LIVE_ROUTE_COUNT:     107
SOURCE_ROUTE_COUNT:   118  (comparable entries, after expanding each bare+{proxy+} source
                            prefix into both forms to match how the live API models it)
MATCHING_ROUTES:      108
SOURCE_ONLY_ROUTES:   10
GATEWAY_ONLY_ROUTES:  0
MISMATCHED_ROUTES:    4
```

Produced by a REAL run of `scripts/aws/api-gateway/Test-ApiRouteParity.ps1` against the live API (not
simulated) — see "Route Drift Tool" below for how this reached a clean, zero-`GATEWAY_ONLY` result
(two real bugs in the comparison tooling itself were found and fixed in the process, not papered
over).

### A. SOURCE_AND_GATEWAY_MATCH (108)
Every one of the 5 shared-integration services' resource prefixes, chat's `/chat/{proxy+}`, `/health`,
and 11 of auth's 12 explicit routes (everything except the known-missing password-reset-request).

### B. SOURCE_ONLY (10) — implemented in code, missing from the live Gateway

| Route | Service | Note |
|---|---|---|
| `POST /auth/register/resend` | auth | Re-issues a pending sign-up's verification code |
| `PATCH /auth/users/:userId/name` | auth | Admin-corrects a user's display name |
| `POST /auth/password-reset` | auth | Consumes the reset link/token — distinct from `/request` below |
| `POST /auth/password-reset/request` | auth | **The already-known gap this phase was asked to track** |
| `POST /auth/partner-applications/start` | auth | Self-service gym-partner onboarding (see `GYM_PARTNER_SELF_ONBOARDING_SPEC.md`) |
| `POST /auth/partner-applications/verify` | auth | Same flow |
| `POST /auth/partner-applications/set-password` | auth | Same flow |
| `POST /webhooks/dropbox-sign` | user | **New finding** — mounted only when `REQUIRE_CONTRACT_ESIGN` ≠ `"false"` (default true); no `/webhooks` prefix exists anywhere in the live Gateway, so the e-signature provider's callback is currently unreachable in DEV |
| `ANY /complaint-photos/{token}` | gym | Plain top-level prefix, distinct from the already-live `/admin/complaint-photos` |
| `ANY /partner-invitations/{token}` | gym | No matching live route of any kind |

### C. GATEWAY_ONLY (0)
None — every live route has a source counterpart once the manifest is complete at the right
granularity (see "Route Drift Tool").

### D. MISMATCHED (4) — real cross-service routing conflicts, not missing routes

gym-service's own `pt.routes.ts`/`client.routes.ts` define real handlers under `/pt/*` and `/me/*`
(`gym-affiliations`, `gym-invitations`, `:ptUserId/gyms`, `gym-memberships`, `complaints`,
`gym-checkins`), but the live Gateway's only `/pt/{proxy+}` and `/me/{proxy+}` routes forward **all**
traffic under those prefixes to **user-service**, not gym-service. Unlike the 9 `/admin/<x>`
sub-paths (which gym-service correctly owns via their own more-specific live routes, with no
conflict — API Gateway resolves the more specific path first), `/pt/*` and `/me/*` have no such
more-specific carve-out for gym-service. **These gym-service routes are very likely unreachable in
the live DEV environment today.** This is a real finding from this phase's own trace, not something
this phase was asked to fix — recorded for Phase 15B/a later phase's decision (likely: either give
gym-service's conflicting paths their own more-specific live routes, the same pattern already used
for its 9 admin sub-paths, or determine they are genuinely dead code).

## Known Auth Route Gaps (explicitly re-verified, not assumed)

```
PATCH /auth/me/password:        MATCH  (live — added manually in Phase 13A; Lambda permission Sid is
                                 the hand-named "apigw-auth-me-password", not an auto-generated UUID,
                                 confirming it was a manual, non-scripted addition)
POST /auth/password-reset/request: MISSING (source exists — createEmailActionRateLimit +
                                 authController.requestPasswordReset — live Gateway returns 404)
```

Both match the brief's expected historical state exactly, confirmed fresh via live source + live
Gateway reads, not inferred from the report alone.

## Authorization Drift

No Gateway-level authorizer exists for ANY route (`AuthorizationType: NONE` universally) — this is
the project's deliberate, consistent architecture (every Lambda enforces its own JWT/role checks via
Express middleware), not drift. No route was found with Gateway-level authorization that contradicts
this (e.g., no route has an unexpected `JWT`/`AWS_IAM` authorizer type). `AUTHORIZATION_DRIFT: 0` at
the Gateway-configuration level. The 4 real app-level concerns worth separate note:

- `/auth/internal/*` (4 routes) are correctly **absent** from the public Gateway (service-to-service
  only) — verified, not a gap.
- The 10 SOURCE_ONLY routes above are simply unreachable publicly today — not an authorization
  problem, an availability one.
- The 4 MISMATCHED gym routes are an authorization-irrelevant **routing** conflict (right Lambda
  concept, wrong Lambda target) — also not a Gateway authorization-mode issue.
- `/webhooks/dropbox-sign` and the two `/payments/webhook/*` routes intentionally skip user JWT
  checks (external-provider signature/API-key checks instead) — correct for a webhook, and already
  reflected as `authRequirement: "OTHER"` in the source manifest rather than flagged as a gap.

## CORS Review

Single allowed origin (`http://fitness-assistant-frontend-dev-191798898985.s3-website-ap-southeast-
1.amazonaws.com`, the real deployed frontend), `AllowCredentials: false`, headers limited to
`authorization`/`content-type`. No drift found between this Gateway-level CORS policy and what the
frontend actually sends. Not broadened in this phase, per the explicit "flag drift only" instruction
— none found to flag.

## Lambda Invoke Permissions

Spot-checked `fitness-assistant-dev-auth` (13 statements), `fitness-assistant-dev-user` (22
statements), `fitness-assistant-dev-fitness` (24 statements) via `aws lambda get-policy` (safe
metadata only, no environment variables). Findings:

- Every permission is scoped to one specific `SourceArn` (`.../id1iz7upbl/*/*/<exact-path>`) — no
  overly-broad `/*` blanket grant found on any of the three.
- No duplicate or obviously-obsolete permission found on any of the three.
- Permission `Sid`s are almost entirely auto-generated UUIDs **except** `apigw-auth-me-password` (on
  auth) and `fitness-roadmaps-exact`/`fitness-roadmaps-proxy` (on fitness) — these hand-chosen names
  are themselves evidence of which routes were added by a manual AWS CLI call rather than as part of
  whatever originally bulk-provisioned the rest. Consistent with Phase 13A's own account of manually
  adding `PATCH /auth/me/password`.

No permission was modified. No Lambda environment variable was read or displayed.

## Existing IaC Discovery

```
CURRENT_API_GATEWAY_SOURCE_OF_TRUTH: NONE
```

Re-discovered fresh, not relying on the historical note:

- **Terraform** (`infra/terraform/environments/dev/main.tf`): manages IAM roles, 3 S3 buckets
  (frontend/uploads/vectors), a CloudFront SPA distribution, a monthly budget alert, and —
  confirmed directly — `module "hello_world"` using the `lambda-http-api` module
  (`source_dir = ".../src/hello"`). This is exactly the unrelated throwaway demo the brief warned not
  to adopt. It does not reference `id1iz7upbl`, any of the 7 real Lambdas, or any route.
- **CloudFormation** (`infra/cloudformation/dev-on-demand.yaml`): manages the on-demand toggle stack
  (NAT, Chat ALB/listener/target-group, OpenSearch VPC endpoint, Secrets Manager VPC endpoint) that
  `dev-start.ps1`/`dev-stop.ps1` already drive. Grepped directly for any `ApiId`/`HttpApiId`/
  `execute-api` reference — none found. It reconnects Chat's *target group* into the existing API via
  imperative AWS CLI calls inside `dev-start.ps1`, never through this stack's own resources.
- No SAM, CDK, or Serverless Framework files exist anywhere in the repository.
- No AWS CLI/PowerShell script creates or deletes API Gateway routes as part of the normal deploy
  flow — every route currently live was added by a one-off, undocumented-in-code AWS CLI call at
  some point across this engagement's history.

## Selected IaC Strategy

**CloudFormation.**

| Criterion | CloudFormation | Terraform | SAM/CDK |
|---|---|---|---|
| Already used in this repo for this exact class of problem | Yes (`dev-on-demand.yaml`, the on-demand toggle stack, actively driven by `dev-start.ps1`/`dev-stop.ps1`) | Only for IAM/S3/CloudFront/budget — never for Lambda/API Gateway | Not present at all |
| Existing-resource adoption | Native `IMPORT` change-set type — brings in existing routes/integrations/permissions without replacing them | Possible via `terraform import`, but requires a state file per resource and this repo's Terraform workflow is a separate, disconnected remote-state setup from everything else in this engagement | N/A |
| Change-set / plan-before-apply | Yes — exactly matches Phase 15A.16's own required "prove change set before apply" step | Yes (`terraform plan`) | Yes (SAM) / Yes (CDK diff) |
| Migration risk | Lowest — extends an existing, already-proven-safe pattern in this exact AWS account | Would introduce a second, disconnected deployment discipline for the same account | Would introduce a third framework with zero existing footprint |
| Team/account familiarity | High (demonstrated repeatedly this engagement, including live certifications) | Low for anything beyond IAM/S3/budget | None |

Avoided introducing a second framework without strong reason, per the brief's own explicit
preference — Terraform is present but was never used for this class of resource, and importing 107
live routes into a disconnected Terraform state would be strictly riskier than extending the
CloudFormation discipline this account already trusts for exactly this kind of "manage pre-existing
AWS resources safely" problem.

## Existing API Adoption Strategy

The new template (`infra/cloudformation/api-gateway.yaml`) takes `HttpApiId` as a **parameter**
(default `id1iz7upbl`) and never declares an `AWS::ApiGatewayV2::Api` resource — there is structurally
no way for applying it to create a second API. Phase 15B's job (not performed here) is to run a
CloudFormation `IMPORT`-type change set against the real stack, mapping each existing route/
integration/permission resource in this template to its real, already-live AWS resource ID, so the
first real apply changes nothing observable — it only brings existing resources under management.
Only after that import succeeds and is verified unchanged would the new `POST /auth/password-reset/
request` route (a genuine `CREATE`, not an import) be added, in its own, separately-approved step.

## IaC Files Added

- `infra/cloudformation/api-gateway.yaml` — local-only CloudFormation template (`AWS::
  LanguageExtensions` transform, using `Fn::ForEach` to generate the repetitive bare+`{proxy+}`
  route/permission pairs for each of the 5 shared-integration services, plus every one of auth's 12
  live routes individually, plus `/health` and `/chat/{proxy+}`, plus the one explicitly-required new
  route, `POST /auth/password-reset/request`). **Syntax-validated** via the read-only
  `aws cloudformation validate-template` call (returns parsed `Parameters`/`Description`/
  `Capabilities: [CAPABILITY_AUTO_EXPAND]` — confirms the template and its `Fn::ForEach` blocks parse
  correctly; this call cannot create, modify, or delete anything). **Not applied.**
- `docs/deployment/generated/api-gateway-live-routes.json` — the live inventory (Phase 15A.2).
- `docs/deployment/generated/api-source-routes.json` — the source inventory (Phase 15A.3), later
  corrected twice during this same phase once the drift tool's own real run exposed two granularity
  gaps in the first draft (see "Route Drift Tool").

Deliberately **not** modeled as CloudFormation resources yet (see "Route Parity" above for the full
list/reasoning): the other 9 SOURCE_ONLY gaps beyond `password-reset/request`, and the 4 MISMATCHED
gym routes — adding resources for those now would silently expand this template's blast radius past
what this phase was explicitly asked to cover, and the gym routing conflict in particular needs a
real product/ownership decision (not a template change) before any IaC should encode an answer.

## Route Drift Tool

- `scripts/aws/api-gateway/lib/ApiRouteParity.psm1` — pure functions: `ConvertTo-NormalizedRoutePath`
  (`:id` ↔ `{id}`, trailing-slash handling), `Test-PathCoveredByLiveRoute` (`{proxy+}` wildcard
  coverage), `Test-RouteMatches` (method + normalized-path), `Compare-ApiRoutes` (full A/B/C/D
  bucketing). No AWS I/O — same pure-logic/AWS-I-O separation as `DevLifecycle.psm1` and the Phase
  13B/13C/13D rotation modules.
- `scripts/aws/api-gateway/lib/ApiRouteParity.Tests.ps1` — Pester, fake route metadata only.
  **17/17 pass.**
- `scripts/aws/api-gateway/Test-ApiRouteParity.ps1` — the orchestrator. Reads the source manifest,
  makes two read-only `apigatewayv2` calls (`get-routes`, `get-integrations`), compares, prints the
  A/B/C/D report. **No `-Execute` switch exists — there is nothing this script can mutate.**

**Run live against the real API during this phase** (not simulated): first run surfaced
`GATEWAY_ONLY: 46` and several false `MISMATCHED` entries. Root-caused to two real bugs, both fixed
before trusting the result:

1. **A greedy first-match bug in `Compare-ApiRoutes`** — when a source prefix was expanded into its
   bare and `{proxy+}` forms, a loop that took the *first* live route satisfying either form (AWS
   does not guarantee `get-routes` result order) could let the wildcard entry "steal" the slot an
   exact match should have taken, leaving the real exact-match live route falsely reported as
   `GATEWAY_ONLY`. Fixed by requiring an exact normalized-path match to win over a wildcard-covered
   one whenever both are possible, regardless of array order. Caught by re-running the existing 17
   Pester tests (still 17/17 after the fix) before re-trusting the live run.
2. **Two real granularity gaps in the hand-built source manifest itself** (not the app) — gym-
   service's 9 `/admin/<x>` sub-paths and payment-service's 3 webhook/vnpay-return sub-paths had each
   been collapsed into one summary entry with a note, instead of the one-entry-per-live-route-pair
   the live Gateway actually uses. Fixed by expanding the manifest to match the live structure
   exactly (same granularity the CloudFormation template already used independently for the gym admin
   sub-paths, confirming the correction was consistent with the rest of this phase's own findings).

After both fixes, the real run reached `MATCH: 108, SOURCE_ONLY: 10, GATEWAY_ONLY: 0, MISMATCHED: 4`
— the clean, trustworthy numbers reported throughout this document. This progression is recorded
here deliberately, not smoothed over: finding and fixing a real bug in the drift tool itself, using
the tool's own unit tests as the safety net, is exactly the kind of result this phase's evidence
discipline expects to surface.

## Tests

`scripts/aws/api-gateway/lib/ApiRouteParity.Tests.ps1`, **17/17 pass**, covering (brief's own
12-item list, several with more than one case): exact match; `:id` vs `{id}`; method mismatch;
missing route; live-only route; wrong integration (wrong auth is covered by the same mismatch
mechanism — no separate authorizer dimension exists at the Gateway level, see "Authorization Drift");
wildcard route (plus wildcard-does-not-leak-into-an-unrelated-prefix); trailing slash handling;
duplicate route detection; `PATCH /auth/me/password` represented; `POST /auth/password-reset/request`
represented.

## Phase 15B Live Adoption Plan

1. Create a CloudFormation `IMPORT`-type change set against `infra/cloudformation/api-gateway.yaml`,
   mapping every modeled route/integration/permission to its real, already-live resource ID (the
   live inventory JSON from this phase gives every ID needed).
2. Review the change set in full — it must show zero `Replace`/`Delete` actions on anything existing;
   only `Import` actions for current resources and exactly one real `Add` (the new password-reset-
   request route + its permission).
3. Independently re-verify no destructive replacement via `aws cloudformation describe-change-set`
   before anyone approves it.
4. Owner approval (a real, human decision point — not something either phase should bypass).
5. Apply the import.
6. Immediately re-run `Test-ApiRouteParity.ps1` — expect `MATCH` to rise only by the handful of
   resources just imported, with `GATEWAY_ONLY`/`SOURCE_ONLY`/`MISMATCHED` otherwise unchanged from
   this phase's own baseline (108/10/0/4).
7. Deploy the one missing route this phase modeled: `POST /auth/password-reset/request`.
8. Test `PATCH /auth/me/password` still works unchanged (regression check on the manually-added
   route this whole effort exists partly to stop being fragile).
9. Test `POST /auth/password-reset/request` safely (an owner-controlled DEV account requesting its
   own reset link — same "real HTTP, owner-controlled account, no unrelated real user affected"
   discipline Phase 14B used).
10. Re-run the parity check one final time to confirm the new route moved from `SOURCE_ONLY` to
    `MATCH` and nothing else drifted.

None of this was executed in Phase 15A.

## Continuous Full-Service Session State

Re-confirmed via `dev-status.ps1` before and during this phase (read-only):

```
Aurora:            available
NAT:               1 available/pending
Chat ALB:          active
Chat ECS:          desired=1 running=1
VPC Interface Endpoints: 2 (Secrets Manager + AI/OpenSearch)
```

`CONTINUOUS_FULL_SERVICE_SESSION: ACTIVE`. Nothing was stopped in this phase. No frozen-state
cost-leak validation was run, per the brief's own explicit instruction — this is an intentionally
active, owner-directed session, not an idle leak.

## Remaining Gaps (for a future phase, not fixed here)

- The 9 SOURCE_ONLY auth-service gaps beyond `password-reset/request` (register/resend, users/:id/
  name, the 3 partner-applications routes) and user-service's `/webhooks/dropbox-sign`.
- gym-service's `/complaint-photos/*` and `/partner-invitations/*` (SOURCE_ONLY).
- gym-service's `/pt/*` and `/me/*` routing conflict with user-service (MISMATCHED) — needs a real
  product/ownership decision, not just a route addition.
- Chat's own `isValidInternalSecret` dual-accept source change (found in Phase 14B, still uncommitted,
  still undeployed) — unrelated to API Gateway, re-noted here only because it remains open.
