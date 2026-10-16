# AWS DEV Gym Route Hotfix — Applied and Verified — 2026-10-09 (Phase 15B-HF)

No credential, secret value, access key, or secret access key appears anywhere in this report.

## Identity Gate History (for the record)

This phase required two attempts before mutation could proceed, both correctly refused:

1. First resume attempt: `aws sts get-caller-identity` (no `--profile`) still returned
   `vmimport-admin` — the "parent shell" identity correction had not propagated to the shell this
   session's Bash tool actually uses (environment variable exports in one running shell do not
   reach an already-running sibling shell). **Refused, no mutation attempted.**
2. Second attempt, explicit profile: `aws sts get-caller-identity --profile gymini-admin` returned
   exactly `Account: 191798898985`, `Arn: arn:aws:iam::191798898985:user/gymini-admin`,
   `Region: ap-southeast-1` (via `aws configure list --profile gymini-admin`). **
   `AWS_EXPLICIT_PROFILE_GATE = PASS`.** Every AWS CLI call from this point used
   `--profile gymini-admin` explicitly; `[default]` (`vmimport-admin`) was never touched or
   overwritten.

## Incident

Phase 15B-A confirmed, via real live `GET` requests with a real DEV JWT, that these paths returned
HTTP 404 on AWS DEV: `/me/gym-memberships`, `/me/gym-checkins`, `/me/complaints`,
`/pt/gym-affiliations`, `/pt/gym-invitations`. Root cause: the live Gateway's `/me/{proxy+}` and
`/pt/{proxy+}` routes forwarded 100% of traffic under those prefixes to **user-service**, which has
no handler for any of these paths — gym-service owns them but was never given its own
more-specific route (the pattern already correctly applied to gym-service's 9 `/admin/<x>`
sub-paths).

## Affected Frontend Features

Confirmed by direct source grep: client's gym-membership list/pay/cancel screens, the gym
check-in-by-QR-scan feature, and the client's "my complaints" list (all `frontend/web` +
`frontend/mobile`, both confirmed callers) were affected. `GET /pt/{ptUserId}/gyms` also has a
confirmed frontend caller on both platforms. `GET/PATCH /pt/gym-invitations*` and
`GET /pt/gym-affiliations` had no confirmed frontend caller found in a direct grep — included in
the hotfix anyway since they are unambiguously gym-service's own currently-broken source, named
explicitly in this phase's own incident description.

## Root Cause

Architectural: `/me/{proxy+}`/`/pt/{proxy+}` are single Gateway routes per prefix, both pointing at
user-service. HTTP API v2 always prefers the most-specific matching route when one exists (already
proven correct in this account for gym's 9 `/admin/<x>` sub-paths) — but no more-specific route had
ever been created for gym-service's `/me/*`/`/pt/*` handlers, so the generic catch-all silently
absorbed them instead of ever reaching gym-service.

## Exact Routes Added

All 12 routes traced directly from `backend/services/gym-service/src/routes/{client,pt,public}.
routes.ts`, created via `aws apigatewayv2 create-route`, each targeting the single pre-existing
`GymIntegration` (`045z1ul`):

| Method | Path | RouteId | Handler |
|---|---|---|---|
| GET | `/me/gym-memberships` | `q30z6lt` | `membershipController.listForClient` |
| GET | `/me/gym-memberships/{id}` | `fx5ps3u` | `membershipController.getForClient` |
| POST | `/me/gym-memberships/{id}/pay` | `ca6znwr` | `membershipController.pay` |
| POST | `/me/gym-memberships/{id}/cancel` | `h01w0lm` | `membershipController.cancel` |
| POST | `/me/gym-memberships/{id}/cancel-membership` | `x33r8d2` | `membershipController.cancelActive` |
| GET | `/me/gym-checkins` | `7hyfj5o` | `checkinController.listForClient` |
| POST | `/me/gym-checkins` | `cmq4gi6` | `checkinController.checkInByScan` |
| GET | `/me/complaints` | `3vkbwhg` | `complaintController.listMine` |
| GET | `/pt/gym-invitations` | `p1yjqic` | `affiliationController.listInvitations` |
| PATCH | `/pt/gym-invitations/{id}` | `56l7prf` | `affiliationController.respond` |
| GET | `/pt/gym-affiliations` | `iz1o0hv` | `affiliationController.listAffiliations` |
| GET | `/pt/{ptUserId}/gyms` | `atfo58e` | `collaborationController.listAcceptedGymsForPt` |

`EXACT_ROUTE_KEYS_ADDED: 12`. `EXACT_ROUTE_KEYS_UPDATED: 0` (all were net-new creations, nothing
pre-existing was modified). `WILDCARD_ROUTES_CHANGED: 0`. `USER_ROUTES_CHANGED: 0` — verified by
inspecting the full post-hotfix route list: `/me/{proxy+}`, `/pt/{proxy+}`, and every other
pre-existing route are byte-identical to their pre-hotfix `RouteId`/`Target`.

## Integration Reused

```
GYM_INTEGRATION_REUSED: YES
IntegrationId: 045z1ul
```

No second Gym integration was created. All 12 new routes point at this exact, already-existing
integration — confirmed directly in post-creation route metadata (`aws apigatewayv2 get-routes`
query filtered to the 12 new paths, every `Target` showing `integrations/045z1ul`).

## Lambda Permission

11 new, narrowly-scoped `AWS::Lambda::Permission`-equivalent grants were added via
`aws lambda add-permission` (one path, `/me/gym-checkins`, legitimately serves both its GET and
POST route under a single permission, since API Gateway Lambda-permission `SourceArn` scoping is
per-path, not per-method — the exact same convention every pre-existing hand-added permission in
this account already uses):

```
hotfix-me-gym-memberships
hotfix-me-gym-memberships-id-
hotfix-me-gym-memberships-id-pay
hotfix-me-gym-memberships-id-cancel
hotfix-me-gym-memberships-id-cancel-membership
hotfix-me-gym-checkins
hotfix-me-complaints
hotfix-pt-gym-invitations
hotfix-pt-gym-invitations-id-
hotfix-pt-gym-affiliations
hotfix-pt-ptUserId-gyms
```

Each `SourceArn` is scoped to exactly one path (`arn:aws:execute-api:ap-southeast-1:191798898985:
id1iz7upbl/*/*/<exact-path>`) — no broad account-wide or `/*`-everything grant was used.

```
PERMISSIONS_REQUIRED: 11
PERMISSIONS_CREATED: 11
PERMISSIONS_ALREADY_PRESENT: 0
```

## Pre-Hotfix HTTP Evidence

Unchanged from Phase 15B-A: all 5 named paths returned HTTP 404 from user-service's own Express
404 handler.

## Post-Hotfix HTTP Evidence

Real `GET` requests, real DEV JWT (REAL HTTP/API), performed after route+permission creation:

```
GET /me/gym-memberships  -> HTTP 200  {"success":true,"data":[]}
GET /me/gym-checkins     -> HTTP 200  {"success":true,"data":[]}
GET /me/complaints       -> HTTP 200  {"success":true,"data":[]}
GET /pt/gym-affiliations -> HTTP 403  {"success":false,"error":{"code":"FORBIDDEN","message":"Insufficient permissions"}}
GET /pt/gym-invitations  -> HTTP 403  {"success":false,"error":{"code":"FORBIDDEN","message":"Insufficient permissions"}}
```

The 3 client-scoped reads return a genuine `200` with gym-service's own JSON response shape (empty
arrays — correct, since this test account has no gym memberships/checkins/complaints). The 2
PT-scoped reads return a genuine `403 FORBIDDEN` **from gym-service's own JSON error shape**
(role-gated — this test account is `CUSTOMER`, not `PT`) — critically, **not** the old
wrong-service 404. No business data was created; no mutation endpoint (`pay`/`cancel`/
`cancel-membership`/checkin-scan/`respond`) was exercised.

```
GET_ME_GYM_MEMBERSHIPS: PASS
GET_ME_GYM_CHECKINS:    PASS
GET_ME_COMPLAINTS:      PASS
PT_GYM_AFFILIATIONS:    PASS   (proves correct routing - a clean 403 from gym-service, not a 404;
                                full success as an actual PT was not verifiable - no PT test
                                credential was available)
PT_GYM_INVITATIONS:     PASS   (same)
WRONG_SERVICE_404_FIXED: YES
```

## CloudWatch Target Verification

`aws logs filter-log-events` on `/aws/lambda/fitness-assistant-dev-gym` in the exact test window
shows real invocations correlating with every one of the 5 test calls (including the earlier,
stale-token first attempt's own `"[gym-service] token verification failed"` log lines — a
gym-service-specific log message, proving the request reached gym-service's own code, not a
generic Gateway-level rejection). The identical time-windowed query against
`/aws/lambda/fitness-assistant-dev-user` returned zero matching events.

```
GYM_LAMBDA_RECEIVED_REQUEST: YES
USER_LAMBDA_RECEIVED_BROKEN_ROUTE: NO
```

## Parity Result

```
Before hotfix: LIVE=107  SOURCE_ONLY=10  GATEWAY_ONLY=0   MISMATCHED=4
After hotfix:  LIVE=119  SOURCE_ONLY=10  GATEWAY_ONLY=0   MISMATCHED=0
```

The +12 live routes exactly match the 12 created. All 4 previously-MISMATCHED entries are gone, as
expected — none of the 10 remaining SOURCE_ONLY routes were touched, exactly as instructed.

```
LIVE_ROUTE_COUNT_AFTER:    119
SOURCE_ONLY_ROUTES_AFTER:  10
MISMATCHED_ROUTES_AFTER:   0
```

## Remaining Route Gaps

The 10 SOURCE_ONLY routes from Phase 15B-A (register/resend, users/:id/name, password-reset ×2,
the 3 partner-applications routes, the dropbox-sign webhook, complaint-photos, partner-invitations)
remain untouched and unresolved, exactly as instructed — none were added in this phase.

## IaC Baseline Update

Updated locally, **not applied**:

- `docs/deployment/generated/api-gateway-live-routes.json` — refreshed from a fresh live read
  (119 routes).
- `docs/deployment/generated/api-gateway-adoption-baseline.json` — refreshed to match (119 routes).
- `docs/deployment/generated/api-source-routes.json` — the 4 old generic `MISMATCHED` entries
  replaced with 12 individually-modeled `MATCH` entries (exact method/path/handler/RouteId), summary
  counts updated (`mismatched: 4 -> 0`, `match: 33 -> 45`).
- `docs/deployment/generated/api-gateway-proposed-changes.json` — `mismatchedRoutes` emptied, with
  a note pointing at this report as the resolution evidence.
- `infra/cloudformation/api-gateway-baseline.yaml` — the 12 routes + 11 permissions added as a new
  `Fn::ForEach::GymExactRoutes` block (reusing the existing `GymIntegration`), and the stale
  "NOT changed here" comment above `GymPrefixRoutes` updated to reflect the resolution. Re-validated
  via `aws cloudformation validate-template` (read-only, `Capabilities: [CAPABILITY_AUTO_EXPAND]`) —
  still syntactically correct after the edit.
- `scripts/aws/api-gateway/lib/ApiRouteParity.Tests.ps1` — all 29 tests still pass after every
  manifest change above (re-run, not assumed).

**CloudFormation was not applied** — these are local-file-only updates so the eventual Phase 15B-B
import reflects today's true live state, per this phase's own explicit instruction.

## Continuous Full-Service Session State

Not touched by this phase.

```
Backend: ON   Network: ON   Chat: ON   AI: ON   Aurora: available
```

`FINAL_COST_LEAK_CHECK: DEFERRED_CONTINUOUS_FULL_SERVICE_SESSION`.
