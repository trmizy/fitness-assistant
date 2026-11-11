# AWS DEV API Gateway — Route Adjudication + Non-Destructive Adoption Plan — 2026-10-09 (Phase 15B-A)

No credential, secret value, access key, or secret access key appears anywhere in this report.
**Read-only analysis only. Zero AWS mutations.**

## AWS Identity

```
aws sts get-caller-identity
Account: 191798898985
Arn:     arn:aws:iam::191798898985:user/vmimport-admin
```

No `gymini-admin` AWS CLI profile exists locally (only `default`, resolving to `vmimport-admin`).
Per the brief's own explicit allowance ("read-only work: vmimport-admin may be used ONLY if no
credential switch is currently available, but this must be recorded as deviation"), this entire
phase proceeded read-only under `vmimport-admin` — recorded here as the required deviation. No AWS
mutation occurred, so the "mutation principal must be gymini-admin" rule was never tested in this
phase; it applies starting Phase 15B-B.

`ROOT_USED: NO`.

## Route Count Reconciliation

A real bug was found and fixed in the parity tool itself while reconciling these numbers — not
glossed over:

**Root cause of `MATCHING_ROUTES (108) != LIVE_ROUTE_COUNT (107)`**: the tool's source-manifest
loader expands every `{proxy+}`-suffixed entry into a bare-path form AND a proxy-path form (correct
for ~51 of the 52 prefixes, since the live Gateway genuinely has both a bare and a proxy route for
each). `chat` is the ONE exception — confirmed live and in source, chat-service has NO bare `/chat`
route, only `/chat/{proxy+}`. The loader did not know this, so it synthesized a nonexistent bare
`/chat` source entry anyway; that entry still "matched" via the wildcard-covers-its-bare-prefix rule,
landing on the SAME live route the real proxy entry also matched — one live route, two source-object
matches.

**Fix**: added an explicit `"noBareRoute": true` flag to chat's manifest entry and taught the loader
to respect it. Added a dedicated regression test (`ApiRouteParity.Tests.ps1`) reproducing the exact
root cause. Re-ran the tool live.

```
LIVE_ROUTE_OBJECTS:          107  (confirmed via a fresh apigatewayv2 get-routes read)
SOURCE_ROUTE_OBJECTS:        117  (comparable manifest entries, after bare+proxy expansion,
                                   chat's bare form correctly no longer synthesized)
NORMALIZED_ROUTE_IDENTITIES: 117  (107 live + 10 source-only, zero overlap between the two)
MATCH_RELATIONSHIPS:         107  (one-to-one: every matched source object maps to exactly one
                                   live route, and every live route is matched by exactly one
                                   source object — verified directly, not inferred: a reverse
                                   mapping over Compare-ApiRoutes' own actual Match results found
                                   zero live routes referenced by more than one matched source
                                   object after the fix, versus one such case — chat — before it)
```

`117 (source) = 107 (matched) + 10 (source-only)`. Every number is now unambiguous and verified by a
real tool run, not hand-derived. `ROUTE_COUNT_RECONCILED: YES`.

## Source-Only Classification

**Overturns the Phase 15A shorthand**: a direct frontend/local-gateway trace found **real, active
frontend code (web and/or mobile) calling every single one of the 10 SOURCE_ONLY routes**, and
`backend/gateway` (the Express proxy used for local Docker dev — a completely separate thing from
the real AWS API Gateway) **explicitly registers all of them** (a generic `/auth` catch-all for the
auth-service ones; explicit registrations for `/webhooks/dropbox-sign`, `/complaint-photos`,
`/partner-invitations/:token[/accept]`). None of these are dead code, intentionally undeployed
features, or internal-only — they are real, currently-working-in-local-dev features that the real
AWS Gateway was simply never updated to expose.

Full per-route detail (handler, auth model, frontend caller, security sensitivity, reasoning):
`docs/deployment/generated/api-gateway-proposed-changes.json`. Summary:

| Route | Recommended Action | Why |
|---|---|---|
| `POST /auth/register/resend` | ADD_LATER | Rate-limited, same risk class as `/register` itself |
| `PATCH /auth/users/:userId/name` | ADD_LATER | Admin-only, same risk class as its 3 already-live siblings |
| `POST /auth/password-reset` | ADD_LATER | Reviewed in depth — see below. SAFE. |
| `POST /auth/password-reset/request` | ADD_LATER | Reviewed in depth — see below. SAFE. |
| `POST /auth/partner-applications/start` | NEEDS_SECURITY_REVIEW | Unauthenticated account-creation-adjacent; local gateway gives it its own dedicated rate limiter (a signal it was already recognized as higher-risk), but this phase did not do the same depth of review as the password-reset pair |
| `POST /auth/partner-applications/verify` | NEEDS_SECURITY_REVIEW | Same flow family |
| `POST /auth/partner-applications/set-password` | NEEDS_SECURITY_REVIEW | Sets a brand-new account's initial password from a token — same risk class as password-reset's consume step, not reviewed to the same depth here |
| `POST /webhooks/dropbox-sign` | ADD_LATER | External-provider webhook only (Dropbox Sign); missing route likely stalls real contract e-signature completions on DEV today |
| `ANY /complaint-photos/{token}` | ADD_LATER | **Correction**: actually AUTHENTICATED (`requireAuth` + `requireRoles('CUSTOMER','PT')`), not public as Phase 15A guessed — re-verified directly against source |
| `ANY /partner-invitations/{token}` | ADD_LATER | Confirmed genuinely PUBLIC + token-gated, by design |

```
SOURCE_ONLY_CLASSIFIED:      10/10
SOURCE_ONLY_ADD_LATER:       7
SOURCE_ONLY_INTENTIONAL:     0
SOURCE_ONLY_DEAD_OR_STALE:   0
SOURCE_ONLY_NEEDS_DECISION:  0   (none needed a product decision — all 10 are already clearly
                                  real, wanted features; the only open question for 3 of them is
                                  security depth, not whether they should exist)
SOURCE_ONLY_NEEDS_SECURITY_REVIEW: 3  (the 3 partner-applications routes)
```

## Password Reset Security Review

Traced end-to-end from `auth.routes.ts` through `auth.controller.ts` into `auth.service.ts`:

- **Rate limiting**: `createEmailActionRateLimit` — 5 requests / 15 minutes, keyed by
  `scope|ip|email`, in-memory with periodic GC. Every request counts (not just failures), because
  every request can put a message in an inbox.
- **Anti-enumeration**: `requestPasswordReset` returns the exact same `{message: ...}` shape whether
  the email doesn't exist, belongs to an inactive account, is in its own per-account cooldown, or the
  email send itself throws — confirmed by reading the function's own control flow, not assumed. A
  mail-send failure is deliberately swallowed rather than surfaced as a 500, specifically because a
  500-only-for-real-accounts would itself be the enumeration signal.
- **Token**: `crypto.randomBytes(32)` (256 bits, cryptographically secure), base64url-encoded. Stored
  only as a SHA-256 hash (`findPasswordResetByHash`) — the raw token is never persisted anywhere.
  Single-use (`usedAt` checked and set), time-limited (`expiresAt` checked), and
  `invalidatePasswordResets(userId)` is called before issuing a new one so only one valid token can
  exist per user at a time.
- **Consumption is atomic**: password update + marking the token used + revoking every refresh token
  for that user all happen inside one `prisma.$transaction` — a partial failure can never leave a
  reusable token or a changed password with old sessions still alive.
- **Dev-convenience leak gate**: `devResetLink` is only ever added to the response when
  `NODE_ENV !== "production"` AND the real email failed to send. **Checked live, not assumed**:
  `aws lambda get-function-configuration` on `fitness-assistant-dev-auth` confirms
  `NODE_ENV: production` on this exact account's real DEV Lambda right now — this leak path is
  structurally closed in the environment this route would actually run in.
- **Response shape**: generic, localized Vietnamese message only; no stack traces, no account
  metadata, on either the request or reset-consumption endpoints.
- **Abuse controls beyond rate limiting**: a per-account cooldown (`SELF_RESET_COOLDOWN_SECONDS`)
  additionally caps how often any single real account can be targeted, independent of the IP/email
  rate limit.

```
PASSWORD_RESET_SAFE_TO_EXPOSE: YES
```

No gaps identified that would warrant `NEEDS_HARDENING`. This is a genuinely production-grade
implementation already sitting unused behind a missing Gateway route — the risk here was always
unavailability, not insecurity.

## Routing Mismatch Analysis

All 4 mismatches were independently, **live, directly verified** with real `GET` requests (REAL
HTTP/API) using a real DEV test account's JWT — not inferred from source alone:

| Path | Live HTTP result | Meaning |
|---|---|---|
| `GET /pt/gym-affiliations` | **404** (Express's own handler) | Request reached user-service's Lambda; it has no such route |
| `GET /pt/gym-invitations` | **404** | Same |
| `GET /me/gym-memberships` | **404** | Same — and this exact path is called by real frontend code (web + mobile) |
| `GET /me/gym-checkins` | **404** | Same — real frontend caller |
| `GET /me/complaints` | **404** | Same — real frontend caller |

Full per-route detail: `docs/deployment/generated/api-gateway-proposed-changes.json`'s
`mismatchedRoutes` array (source handler, live routing behavior, frontend caller, expected owner,
risk).

```
MISMATCHED_CLASSIFIED: 4/4
```

**This is a confirmed, currently-live, production-impacting defect on AWS DEV, independent of any
IaC work** — not a hypothetical risk this phase merely flagged. Any real gym member on DEV right now
who tries to view their gym memberships, pay for one, cancel one, check in at a gym, or view their
own complaints gets an HTTP 404. Recorded here for completeness and because fixing routing is
explicitly out of scope for this phase (`Do not modify routing`), but the owner should treat this as
its own urgent item, independent of whatever pace Phase 15B-B's IaC adoption moves at.

## /pt and /me Ownership

Per the brief's own A-E classification:

- **Not A** (gym-service's definitions are stale/dead) — real frontend code actively calls the
  shadowed `/me/*` paths; `/pt/*`'s own frontend callers were not found under this exact path in a
  targeted grep (needs a fuller audit before concluding either way, not assumed dead).
- **Is B** (the Gateway routing itself is wrong, in the sense of "incomplete") — the generic
  `/pt/{proxy+}`/`/me/{proxy+}` routes were evidently provisioned for user-service first (or only),
  and never given the same "more-specific sibling route" treatment gym-service's 9 `/admin/<x>`
  sub-paths correctly received.
- **Not C** — user-service does not proxy or delegate these specific sub-paths to gym-service
  internally (a 404 from user-service's own Express app proves it has no handler for them at all,
  not that it forwards and the forward fails).
- **Not D** — this isn't an intentional shared namespace; it's an accidental one, since gym-service's
  handlers for these exact paths are provably unreachable.
- **Not E** — folder/service ownership was not assumed; `pt.routes.ts`/`client.routes.ts` in
  `backend/services/gym-service` are unambiguously gym-service's own source, confirmed read directly.

```
ROUTE: /pt/gym-affiliations      CURRENT_LIVE_OWNER: user-service   SOURCE_DEFINED_OWNER: gym-service   CANONICAL_OWNER: gym-service   MIGRATION_REQUIRED: YES
ROUTE: /pt/gym-invitations       CURRENT_LIVE_OWNER: user-service   SOURCE_DEFINED_OWNER: gym-service   CANONICAL_OWNER: gym-service   MIGRATION_REQUIRED: YES
ROUTE: /pt/:ptUserId/gyms        CURRENT_LIVE_OWNER: user-service   SOURCE_DEFINED_OWNER: gym-service   CANONICAL_OWNER: gym-service   MIGRATION_REQUIRED: YES
ROUTE: /me/gym-memberships(*)    CURRENT_LIVE_OWNER: user-service   SOURCE_DEFINED_OWNER: gym-service   CANONICAL_OWNER: gym-service   MIGRATION_REQUIRED: YES
```

`ROUTING_CONFLICTS_REQUIRING_CHANGE: 4` — the fix pattern is already proven elsewhere in this same
API (gym's 9 `/admin/<x>` sub-paths each get their own more-specific route rather than relying on a
generic catch-all); the fix itself is deferred to a separately-approved phase, not performed here.

## Adoption Baseline

`docs/deployment/generated/api-gateway-adoption-baseline.json` — all 107 currently-live routes,
each with its real `routeId`/`integrationId`/`integrationType`/`integrationTarget`, generated
directly from the already-confirmed live inventory (no re-derivation, no guessing).
`ADOPTION_BASELINE_CREATED: YES`. Mirrored into
`infra/cloudformation/api-gateway-baseline.yaml` — reworked from Phase 15A's combined template into
a strictly baseline-only one (see "CloudFormation Import Mechanics").

```
BASELINE_BEHAVIOR_CHANGE: NO
```

## Proposed Future Changes

`docs/deployment/generated/api-gateway-proposed-changes.json` — the 10 SOURCE_ONLY routes (with full
classification) and the 4 MISMATCHED routes (with full live-verified evidence), explicitly kept out
of the baseline file. `PROPOSED_CHANGES_SEPARATED: YES` — enforced by a real Pester test
(`ApiRouteParity.Tests.ps1`: "the proposed-changes manifest's sourceOnlyRoutes never overlaps the
adoption baseline's routes") that would fail if the two ever accidentally merged.

## CloudFormation Import Mechanics

Verified against AWS's own official resource-import-support documentation (not assumed):

| Resource type | Import supported |
|---|---|
| `AWS::ApiGatewayV2::Api` | **Yes** |
| `AWS::ApiGatewayV2::Route` | **Yes** |
| `AWS::ApiGatewayV2::Integration` | **Yes** |
| `AWS::Lambda::Permission` | **Yes** |
| `AWS::Lambda::Function` | **Yes** (not imported by this design — Lambdas stay outside CloudFormation's management, referenced only by ARN parameter, consistent with how every other Lambda in this account is deployed via plain `aws lambda update-function-code`, not IaC) |

`infra/cloudformation/api-gateway-baseline.yaml` deliberately **never declares an
`AWS::ApiGatewayV2::Api` resource at all** — `HttpApiId` is a plain `String` parameter, referenced
only via `!Ref`/`!Sub` inside other resources' properties. This is a stronger guarantee than "import
is supported": there is no `Api` resource in this template's graph for CloudFormation to ever
propose replacing, modifying, or deleting, in any future plan built from it. **REFERENCE existing
API** (what this template does) is categorically different from **IMPORT resource ownership** (what
Route/Integration/Permission resources in it are designed for) — the Api itself stays outside
CloudFormation's management entirely in this design, which is the simplest way to make
`API_ID_REPLACEMENT_RISK` structurally `NONE` rather than merely "low because we'll be careful."

For each Route/Integration/Permission resource:

```
EXISTING PHYSICAL ID:        the real RouteId/IntegrationId/Permission Statement Sid (all captured in
                              docs/deployment/generated/api-gateway-adoption-baseline.json and the
                              earlier Phase 15A live-routes.json)
CLOUDFORMATION LOGICAL ID:   the Fn::ForEach-generated name (e.g. "UserprofileBareRoute") or the
                              individually-named one (e.g. "AuthLoginRoute") in api-gateway-baseline.yaml
IMPORT SUPPORTED:            YES (all three types, confirmed above)
REQUIRES RESOURCE IMPORT:    YES (none of these 107+ resources are under any CloudFormation stack
                              today — every one needs an explicit IMPORT change set entry mapping
                              logical ID to physical ID)
REQUIRES RECREATION:         NO (that is the entire point of IMPORT — it brings an existing resource
                              under management without creating or replacing it; recreation would
                              only happen if Phase 15B-B's change set is reviewed carelessly)
```

## API ID Protection

```
API_ID: id1iz7upbl
API_ID_REPLACEMENT_RISK: NONE
```

Not merely asserted — structurally guaranteed by this design's own choice to never declare an
`AWS::ApiGatewayV2::Api` resource (see above). `READY_FOR_15B_B` is not blocked on this axis.

## Client Endpoint Dependencies

**Checked directly, not assumed.** `frontend/web/.env.production` and
`.env.production.example` both hardcode `VITE_API_URL=https://id1iz7upbl.execute-api.ap-southeast-
1.amazonaws.com` — the API ID is baked into the web frontend's build output at build time (not a
runtime-config value like Chat's `chatWsUrl`/`chatEnabled`, which are hot-swappable via
`runtime-config.json`). If the API ID ever changed, every already-deployed web client would need a
full rebuild+redeploy to point at the new one. `frontend/mobile` has no such hardcoded value — it
uses a runtime-configurable server-address setting instead, so mobile's blast radius from an ID
change would be smaller. This is exactly why `API_ID_REPLACEMENT_RISK: NONE` (not just "low") matters
— this design avoids ever needing to test that blast radius for real.

## Phase 15B-B Change-Set Procedure

1. Verify `gymini-admin` (hard requirement for this step onward — `vmimport-admin`/root both cause a
   HARD STOP per the owner's own updated rule).
2. `aws cloudformation validate-template` against `api-gateway-baseline.yaml` (already done once in
   this phase; re-run fresh before the real attempt).
3. Prepare the IMPORT resource-identifier mapping from
   `docs/deployment/generated/api-gateway-adoption-baseline.json`'s real `routeId`/`integrationId`
   values (+ the Lambda Permission Sids captured in Phase 15A's Lambda-permission spot-check).
4. Create the CloudFormation change set with `ChangeSetType: IMPORT`.
5. `aws cloudformation describe-change-set` — inspect every single resource action.
6. Run the new `Find-DestructiveChangeSetActions` function (`ApiRouteParity.psm1`, 5 Pester tests
   passing) against the real `.Changes` array — **any** `Remove`, any `Modify` with
   `Replacement` of `True` or `Conditional`, or any `Add` of a new `AWS::ApiGatewayV2::Api` fails
   this check and must HARD STOP before proceeding.
7. Owner approval checkpoint — a real human decision, not bypassed by either phase.
8. Execute the import.
9. Verify `API_ID` unchanged (trivial here, since the Api was never a managed resource to begin
   with — but still re-confirm against the live account as a final sanity check).
10. Run `Test-ApiRouteParity.ps1` — expect the exact same `107/10/0/4` baseline numbers as this
    phase's own run, proving the import was truly zero-change.
11. Run the baseline smoke set (below).

Only after all of that succeeds does `api-gateway-additions.yaml` (the one new
`password-reset/request` route) become eligible for its own, separately-approved deployment step —
never bundled into the same change set as the import.

## Baseline Smoke Set (designed, not executed — nothing has been adopted yet)

| Service | Route | Why this one |
|---|---|---|
| Auth | `GET /health` | Zero-auth-needed, routes through Auth's own integration, already proven live |
| User | `GET /notifications` | Already proven live in Phase 14B; no mutation |
| Fitness | `GET /workouts` | Already proven live in Phase 14B; no mutation |
| Gym | `GET /gyms` | Public gym listing; no mutation, no payment |
| Payment | `GET /me/wallet` | Reads the caller's own wallet balance; a real financial *read*, never a transaction |
| Auth (reachability only) | `PATCH /auth/me/password` with a deliberately wrong `currentPassword` | Confirms the route is wired (expect `400`/`401`, never `404`) without ever changing the real password — the brief's own instructed non-destructive alternative to an actual password mutation |

No payment transaction is included anywhere in this set, per the brief's explicit instruction.

## Tests

`scripts/aws/api-gateway/lib/ApiRouteParity.Tests.ps1` — **29/29 pass** (20 carried over from Phase
15A plus 9 new this phase):

- The exact Phase-15B-A-discovered chat/`noBareRoute` regression (root cause of the
  108-vs-107 mismatch), plus the general "one live wildcard → multiple legitimate source matches"
  and "`:id`/`{id}` duplicate normalization" cases the brief asked for explicitly.
- `Find-DestructiveChangeSetActions`: a clean IMPORT is safe; `Remove` is always destructive; a
  `Modify` with `Replacement: True` (the literal API-ID-replacement scenario) is destructive; a
  `Conditional` replacement is treated as destructive rather than assumed safe; creating a brand-new
  `AWS::ApiGatewayV2::Api` is destructive; an ordinary new-route `Add` is not.
- The adoption baseline never carries a `recommendedAction` field (proving it is pure "what's live",
  not mixed with classification); the proposed-changes manifest never overlaps the baseline's route
  set; every proposed source-only route has one of the 6 allowed classification values.

```
UNIT_TESTS: 29/29
```

## Full-Service Session State

Not touched by this phase.

```
Backend: ON (Aurora available)
Network: ON (NAT active)
Chat:    ON (ALB active, ECS desired=1 running=1)
AI:      ON (OpenSearch/Secrets VPC endpoints active)
```

`FINAL_COST_LEAK_CHECK: DEFERRED_CONTINUOUS_FULL_SERVICE_SESSION` — intentional, owner-directed, not
run.
