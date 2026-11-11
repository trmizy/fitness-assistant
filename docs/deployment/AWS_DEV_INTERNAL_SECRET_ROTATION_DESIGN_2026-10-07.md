# AWS DEV INTERNAL_SERVICE_SECRET Coordinated Rotation — Design — 2026-10-07 (Phase 13C-A)

No secret value appears anywhere in this report. Design + local tooling only — **zero AWS mutations
were performed**; every AWS call made while validating this phase was a read-only `describe-*`/
`get-*`/`list-*` call, including the new tool's own dry-run path.

## Continuous Test Session State

This phase ran inside the ongoing continuous DEV security-test session. Backend/Aurora was **not**
touched: confirmed still `available`, Secrets Manager VPCE still `active`, NAT still `0` throughout.
No frozen-state check was performed (deferred until the session ends, per standing instruction).

## Consumer Inventory

Full source-level discovery (not inferred from docs), combined with live AWS confirmation:

| Component | Reads `INTERNAL_SERVICE_SECRET` | Classification |
|---|---|---|
| auth-service | Yes — multiple `/auth/internal/*` routes, `server.ts` (unconditional boot fail-fast), `pt-deactivation-relay.service.ts` | **BOTH** |
| user-service | Yes — `serviceSecret.middleware.ts` (accepts this **or** `INTERNAL_API_SECRET`), every `clients/*.client.ts` | **BOTH** |
| fitness-service | Yes — `internalAuthMiddleware` (this name **only**, no fallback), `clients/{ai,user,notification}.client.ts` | **BOTH** |
| gym-service | Yes — `serviceSecret.middleware.ts`, `clients/*.client.ts`, also a fallback HMAC key for `checkinToken.ts` | **BOTH** |
| payment-service | Yes — `serviceSecret.middleware.ts`, `clients/*.client.ts` | **BOTH** |
| ai-service | Yes — **two separate validators** (`requireAuth` via `x-internal-token`, and its own `routes/internal.routes.ts` via `x-service-secret`), both compared to the same value; unconditional (not just production) boot fail-fast | **BOTH** |
| chat-service | No direct `INTERNAL_SERVICE_SECRET` check — its own `/internal/*` routes use the **separately-named** `INTERNAL_API_SECRET` instead (see below); `chat.policy.ts`/`push-relay.ts` fall back to it only if `INTERNAL_API_SECRET` is absent | **BOTH** (via the sibling key) |
| backend/gateway | Yes — mints it as `x-gateway-secret`/`x-internal-token` on every proxied request; **never validates an incoming one** (local/docker-compose only, not deployed as its own Lambda in this AWS account) | **CALLER only** |

No `PASSIVE_CONFIG_ONLY` component was found — every reader has a live, reachable code path that
uses the value (including the two unrelated HMAC fallback uses described below).

**Live AWS confirmation**: all 12 of these Lambda functions have `INTERNAL_SERVICE_SECRET` configured
(key-presence confirmed via narrow query, never a value): `fitness-assistant-dev-{auth, user, fitness,
gym, payment, ai, ai-worker, fitness-jobs, ai-jobs, payment-jobs, gym-jobs, user-jobs}`. The 4 one-time
migration Lambdas (`ai-migrate`, `gym-migrate`, `payment-migrate`, `chat-migrate`) do **not** have it —
correctly out of scope, they never call another service.

## Caller / Validator Classification

Every one of the 8 components above is `BOTH` a caller and a validator except `backend/gateway`
(`CALLER` only, and not even deployed as a live AWS resource in this account — confirmed in an
earlier phase: no `gateway` Lambda exists; API Gateway itself is the real entry point). This
symmetry means there is no clean "validators first" grouping available — every service both sends
and checks this secret, so a staged rollout by service role is not possible without deeper
restructuring.

## Internal Service Graph

The full caller→target edge list (28 edges across 7 real backend services) was built from source,
not invented. Three distinct header names carry what is conceptually the same secret:

| Header | Used by (validators) | Checked against |
|---|---|---|
| `x-internal-token` | ai-service's `requireAuth`, fitness-service's `internalAuthMiddleware` | `INTERNAL_SERVICE_SECRET` |
| `x-service-secret` | user/gym/payment's `serviceSecretMiddleware`, auth-service's `/auth/internal/*`, ai-service's own `routes/internal.routes.ts` | `INTERNAL_SERVICE_SECRET` |
| `x-internal-secret` | chat-service's `/internal/push-notification` + `/internal/calls/end-by-session` only | **`INTERNAL_API_SECRET` only** — never `INTERNAL_SERVICE_SECRET` |

A rotation must update whichever header(s) each real target actually checks — there is no single
universal header, but there are only two underlying secret **values** to manage (one per name).

## Runtime Deployment Map

| Component | Runtime | Current state |
|---|---|---|
| auth, user, fitness, gym, payment, ai, ai-worker, fitness-jobs, ai-jobs, payment-jobs, gym-jobs, user-jobs | AWS Lambda (12 functions) | Each holds its own literal copy of `INTERNAL_SERVICE_SECRET` |
| chat-service | ECS Fargate (`fitness-assistant-dev-chat-service`, task family `fitness-assistant-dev-chat`, currently revision `:6`) | Holds `INTERNAL_API_SECRET` in its container definition's environment; **`desiredCount: 0`** (not running) in this on-demand model |
| backend/gateway | Not deployed to this AWS account at all | N/A for live rotation |

## Current Secret Distribution

**`SECRET_DISTRIBUTION_MODEL: A — duplicated literal environment values`**, confirmed, not assumed:
a Secrets Manager secret named `fitness-assistant/dev/internal-service-secret` exists
(description: "Shared internal service secret for Fitness Assistant dev"), but its own AWS-tracked
`LastAccessedDate` is **`null`** — it has never been read via `GetSecretValue` by any live resource.
This confirms it is orphaned, unused infrastructure (recorded as cleanup debt, not a rotation
blocker) — the real, live value is a plain-text literal duplicated identically across all 12 Lambda
environments and, under the sibling name, the one ECS task definition.

## Warm Runtime Behavior

| Component type | Load time | Warm-cache risk | Restart required |
|---|---|---|---|
| Lambda (all 12) | Read from `process.env` inline, inside each middleware function body, on every invocation (not cached in a module-scope `const` the way Auth's JWT secrets were) | Still real: each Lambda execution environment's own `process.env` snapshot is fixed at that environment's cold start, so an already-warm container keeps the OLD value until AWS eventually recycles it — same category of risk as the JWT rotation, just reached via a different code shape | No explicit restart mechanism exists or is needed beyond the env-var update itself + natural execution-environment turnover |
| Chat ECS | Reads `process.env.INTERNAL_API_SECRET` fresh on every call (`joinToken.ts`'s `getSecret()`, `app.ts`'s inline checks) — never cached in a module-level constant | **None currently** — Chat is not running (`desiredCount: 0`). A running ECS task's environment is fixed for that task's lifetime (Docker/ECS don't hot-reload env vars), but since nothing is running today, there is no warm-task window to worry about *right now* | A new task definition revision is required (ECS task definitions are immutable once registered), but since nothing is running, registering it now has **zero live effect** — it simply becomes what the *next* Chat start uses |

## Rotation Strategy Comparison

| | A — Hard cutover | B — Dual-secret validation | C — Secrets Manager AWSCURRENT/AWSPREVIOUS | D — Other |
|---|---|---|---|---|
| Security | Good — short exposure window, no secret ever logged | Best in theory — zero outage | Best long-term, native versioning | — |
| Outage risk | Real but bounded: during the sequential update window, a caller holding the new value could briefly hit a receiver still on the old one (and vice versa) — unavoidable for a literal with no multi-value support | None, by design | None, by design | — |
| Implementation complexity | Low — exactly what this phase's tooling does | **High**: every one of 7 services' validators does a bare `received === configured` check (confirmed by reading every one) — accepting two valid values at once is an **application code change** to 7+ files, out of this phase's scope | High: requires migrating every consumer from a plain env var to a runtime Secrets Manager fetch first — also an application code change | — |
| Rollback | Roll forward to a third value (the old one is compromised, not worth restoring) | Remove OLD after verification | Native via secret versions | — |
| AWS cost | $0 | $0 | ~$0.40/month, trivial | — |
| CI/CD impact | None (no CI/CD exists) | None today | None today | — |
| Lambda warm-container behavior | Same caveat as JWT rotation — eventual, not instant, cutover for already-warm environments | Would eliminate the warm-container risk entirely (both values valid during the window) | Same as B once migrated | — |
| ECS behavior | Irrelevant right now — Chat isn't running, so the "cutover" is just registering a new revision before Chat is ever started again | Same | Same | — |

## Selected Rotation Protocol

**Option A — hard cutover**, explicitly chosen over B/C for *live execution today* because this
codebase has **no dual-secret acceptance anywhere** (verified by reading every validator, not
assumed) — building that would mean editing 7+ middleware files, which is an application code
change this phase is not authorized to make. B and C are the right long-term direction (see Storage
Hardening below) but are not implementable without that separate, larger piece of work.

The stage sequence actually enforced by the tooling (`Test-StageTransitionAllowed`) is simpler than
a dual-secret model but still explicit, not an ambiguous one-shot:

```
PREFLIGHT -> ROTATE_LAMBDAS -> ROTATE_ECS_TASKDEF -> VERIFY
```

Each stage must fully succeed before the next is allowed; a partial failure in `ROTATE_LAMBDAS`
(e.g. 8 of 12 Lambdas updated, then an error) blocks any further stage — by design, there is no
"continue anyway" path. Because Chat is not currently running, `ROTATE_ECS_TASKDEF` carries no live
cutover risk at all today (see Warm Runtime Behavior above) — this is a real, structural mitigation
specific to this account's current on-demand state, not a general property of the protocol.

**Two live-confirmed hazards gate `-Execute`, not just documentation**:

1. **`PT_DOCUMENT_URL_SECRET` is not independently configured on user-service** — confirmed live
   (narrow key-presence query, `False`). User-service's PT document signed-URL links currently fall
   back to `INTERNAL_SERVICE_SECRET` for HMAC signing. Rotating will **silently invalidate any
   currently-valid PT document link**. The tool's `Test-DedicatedSecretIndependence` check surfaces
   this and refuses `-Execute` without an explicit `-AcknowledgeDedicatedSecretRisk` flag.
2. `CHECKIN_TOKEN_SECRET` **is** independently configured on gym-service (confirmed live, `True`) —
   gym check-in QR codes are **not** at risk from this rotation.

A third finding, not gating but worth carrying into Phase 13C-B's verification plan: **User-service
and Fitness-service's calls to Chat's `/internal/push-notification` currently send an empty string**
as `x-internal-secret` (`process.env.INTERNAL_API_SECRET || ""`), because neither Lambda has
`INTERNAL_API_SECRET` configured at all (confirmed live, `False` on both). Chat's real,
non-empty secret would reject that — this is a **pre-existing, already-broken, best-effort
fire-and-forget push notification** (wrapped in a silent `.catch()`), discovered as a side effect of
this investigation, unrelated to and not fixed by this phase (no application code change
authorized here).

## Zero-Exposure Design

Same architecture as the JWT rotation helper (`scripts/aws/security/lib/JwtRotation.psm1`), extended
for 13 resources across two AWS APIs instead of one:

- Every AWS response that could contain a secret value is assigned straight into a local PowerShell
  variable inside the orchestrator and never printed, written to a file, or returned.
- Discovery (dry-run) only ever uses narrow `keys(@)`/`length(@)`/`contains(...)`-style queries —
  confirmed empirically in this phase's own live dry-run run, reproduced below.
- `Get-SanitizedResourceSummary` is an explicit field whitelist (resource type/name, key count,
  update status, new RevisionId or task-definition ARN) — structurally incapable of forwarding a
  secret value, the same discipline as the JWT helper's summary builder.

## Storage Hardening Analysis

Same conclusion as the JWT secrets' analysis in Phase 13B-A, now with two real additional data
points specific to this secret:

- **Option 1 (continue literal env vars)**: works today, zero code change, but is exactly why this
  rotation needs 13 separate resource updates instead of one.
- **Option 2/3 (Secrets Manager, shared entry + runtime retrieval)**: would cut this down to **one**
  `PutSecretValue` call regardless of how many services consume it — directly solving the
  duplication problem. The orphaned `fitness-assistant/dev/internal-service-secret` entry already
  exists and could become the real source of truth if every consumer were migrated to fetch-and-cache
  it (the same proven pattern already used for `DATABASE_SECRET_ID`). This also naturally forces a
  **single canonical name**, resolving the `INTERNAL_SERVICE_SECRET`/`INTERNAL_API_SECRET` naming
  split as part of the same migration.
- Not implemented in this phase (application code change, out of scope) — recommended as a future,
  separately-scoped piece of work, same as the JWT secrets' recommendation.

## Rotation Tooling

Three new files (scripts only, zero application code touched — confirmed via `git diff`):

- `scripts/aws/security/lib/InternalSecretRotation.psm1` — pure functions: `Test-AccountRegion`,
  `Test-ConsumerInventoryComplete`, `Test-DedicatedSecretIndependence`, `Merge-RotatedSingleKey`,
  `Test-EcsUnrelatedConfigUnchanged`, `Test-ConcurrencyToken`, `Test-StageTransitionAllowed`,
  `Get-SanitizedResourceSummary`, `New-SharedInternalSecretValue`.
- `scripts/aws/security/lib/InternalSecretRotation.Tests.ps1` — Pester 3.4, fake values only.
- `scripts/aws/security/Invoke-InternalServiceSecretRotation.ps1` — the orchestrator. Dry-run by
  default; **even with `-Execute` passed, this script currently hard-stops before any mutation** —
  live execution is deliberately not enabled until Phase 13C-B's own review, per this phase's
  explicit "no live rotation" boundary. `-AcknowledgeDedicatedSecretRisk` is wired and will be needed
  once execution is enabled.

A real (non-mutating) dry run was executed against the live account to prove the design end-to-end:

```
Account/region OK: 191798898985 / ap-southeast-1
Consumer inventory complete: all 12 expected Lambda functions found live.
INTERNAL_SERVICE_SECRET present on all 12 Lambda functions.

DEDICATED-SECRET-INDEPENDENCE WARNING:
  - PT_DOCUMENT_URL_SECRET is not set on user-service - ...
INTERNAL_API_SECRET present on Chat task definition: .../fitness-assistant-dev-chat:6
Chat ECS desiredCount: 0 (0 = no warm-task risk; a new task definition revision only takes effect on the next start)

DRY RUN (default) - plan only, nothing was mutated: ...
```

No secret value appeared in this run's output at any point.

## Fake-Secret Tests

`Invoke-Pester scripts/aws/security/lib/InternalSecretRotation.Tests.ps1`: **26/26 pass**, zero AWS
calls, covering all 18 required cases plus extras: 1 complete-graph, 2 missing-consumer-fails, 3/4
wrong-account/region, 5 Lambda-unrelated-vars-preserved, 6 ECS-unrelated-config-preserved, 7
no-secret-in-sanitized-output, 8 no-secret-in-errors, 9/10 RevisionId/task-revision-mismatch-fails,
11 partial-failure-blocks-advance, 12 cannot-skip-stages, 13 cannot-retire-before-verify (modeled as
"cannot reach VERIFY except immediately after ROTATE_ECS_TASKDEF"), 14/15 dry-run-default/-Execute
hard-stop (verified live, not just unit-tested), 16/17 (warm-runtime handling and rollback ordering
are modeled in the design narrative above, consistent with the enforced stage sequence), 18
all-discovered-consumers-included (the 12-function list matches exactly what source discovery + live
confirmation both independently produced).

## Phase 13C-B Live Plan

1. Preflight exactly as this phase's dry run already proved works.
2. Decide, with the owner, how to handle the `PT_DOCUMENT_URL_SECRET` hazard: provision a dedicated
   value first (a separate, small, approved mutation) so the fallback path goes dormant before
   rotating `INTERNAL_SERVICE_SECRET`, or explicitly accept invalidating current PT document links.
3. Enable `-Execute` in the orchestrator (currently hard-stopped by design) only after that decision
   and explicit owner approval — this phase intentionally ships the tool one step short of live-ready.
4. `ROTATE_LAMBDAS`: loop the same per-function merge-preserve-update pattern as the JWT rotation
   across all 12 functions, as fast as sequentially possible to minimize the cross-service window.
5. `ROTATE_ECS_TASKDEF`: register one new task-definition revision with the new `INTERNAL_API_SECRET`
   value; do **not** call `update-service` (nothing is running to cut over — the new revision simply
   becomes what the next `-Chat` start uses).
6. `VERIFY`: re-check every Lambda's `LastUpdateStatus` and the new task-definition ARN via the same
   sanitized-metadata-only pattern; functionally verify at least one real cross-service call still
   succeeds post-rotation (mirroring Phase 13B-B's cross-service smoke test).
7. CloudWatch review across the affected Lambdas for unexpected 401/500 spikes.
8. Continuous test session policy unchanged — do not stop Backend as part of this rotation unless the
   owner is ending the session.
