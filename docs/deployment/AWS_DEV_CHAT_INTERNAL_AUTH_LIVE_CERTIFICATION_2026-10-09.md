# AWS DEV — User/Fitness → Chat Internal Auth Live Deployment + Partial Runtime Certification — 2026-10-09 (Phase 14B)

No secret value — `INTERNAL_SERVICE_SECRET`, `INTERNAL_API_SECRET`, JWT, admin/test-account password,
or any authorization header — appears anywhere in this report.

## Executive Summary

The Phase 14A code fix (`docs/deployment/AWS_DEV_CHAT_INTERNAL_AUTH_CALLER_FIX_2026-10-07.md`) was
deployed live to both affected Lambdas (User, Fitness) and verified via real deployment metadata,
real HTTP smoke tests, and a real, healthy Chat ECS/ALB. Full end-to-end runtime proof that a live
request from the deployed User or Fitness Lambda reaches Chat and authenticates successfully was
**not obtained**, because the only DEV test account available has zero existing business state
(no Contract, Session, or TrainingCycle), and every supported application path that could create
that state requires either a real payment-provider transaction (User path) or an AI/Bedrock call
plus a TrainingCycle that does not yet exist (Fitness path). Per this phase's own explicit
instruction, no business fixture was created and no payment was initiated to force that proof.

**FINAL_DECISION: `CHAT_INTERNAL_AUTH_PARTIALLY_VERIFIED`** — this is not evidence of failure; it is
an honest statement that the deployment and every safely-testable layer passed, while the deepest
runtime layer remains unexercised for reasons unrelated to the fix itself.

## Phase 14A Baseline (re-confirmed, not assumed stale)

Before any deployment, the actual current source was re-read (not inferred from the Phase 14A
report alone), per this phase's own Phase 14B.0 preflight requirement:

- Discovered real, independent drift since Phase 14A: a concurrent session/commit
  (`bf6bb5d8`, authored by the repo owner, co-authored by this same fix) had already committed the
  User-side changes; a separate commit (`314cc7db`, different author) had refactored
  `room-close-resolution.service.ts::endOpenRoomCall` into a new shared file,
  `open-room-call.service.ts`, used by `booking.service.ts` too; and a live-tested fix (2026-10-08)
  had **flipped the fallback precedence** from `INTERNAL_SERVICE_SECRET || INTERNAL_API_SECRET` to
  `INTERNAL_API_SECRET || INTERNAL_SERVICE_SECRET` after reproducing a real 401 on local dev (the
  two secrets are configured to different values there; chat-service's receiver has always checked
  `INTERNAL_API_SECRET`).
- `backend/services/fitness-service/src/clients/notification.client.ts` had NOT been updated to the
  corrected precedence — fixed in this phase (small, in-scope correction, owner-confirmed) to match.
- `backend/services/chat-service/src/app.ts` had an independent, uncommitted change (dual-accept
  `INTERNAL_API_SECRET`/`INTERNAL_SERVICE_SECRET` validation) — left untouched and undeployed per
  owner decision; recorded as backlog below (see "Remaining Gaps").
- `notification.service.ts`'s `pushTransient` function (used by the Phase 14A regression tests) had
  been removed by an unrelated commit; `notificationService.create()` is now the only path to
  `pushToSocket`. The 3 affected Phase 14A test files were updated to call `create()` against the
  real local dev Postgres (this service's own established test convention), with cleanup, and the
  priority-order assertions were corrected to match the now-proven-correct order.
- The fitness-service working tree also contained unrelated, uncommitted work-in-progress from a
  concurrent session (Redis resilience / exercise-substitution changes, not part of this fix) — set
  aside via `git stash` (scoped to exactly those 6 paths) before building the Fitness Lambda
  artifact, and restored immediately afterward via `git stash pop`. Verified via `git status` before
  and after that only this phase's own 3 production files + its own new test files were included in
  the Lambda build.

## Deployment Scope

| Service | Deployed | Reason |
|---|---|---|
| User | YES | Owns `notification.service.ts::pushToSocket`, `open-room-call.service.ts::endOpenRoomCall` |
| Fitness | YES | Owns `notification.client.ts::pushCycleAssessmentNotification` |
| Auth | NO | Not part of this fix |
| Gym | NO | Not part of this fix |
| Payment | NO | Not part of this fix |
| AI | NO (code) | AI Lambda/OpenSearch VPC endpoint was later **started** (owner's own later instruction, see below) but its code was never touched or redeployed |
| Chat application image | NO | Existing, already-deployed ECS image only **started**; chat-service's own uncommitted source drift was explicitly left undeployed |

`UNNECESSARY_REDEPLOYS: 0` — only the 2 functions that actually differ from their deployed artifacts
were updated.

## User Deployment

- Built via the repository's own established `npm run build:lambda-zip`
  (`scripts/build-lambda-artifact.js`) — `pnpm build` (shared + user-service), `prisma generate`,
  `pnpm deploy --prod`, flatten, zip. A real, known, pre-existing Windows gotcha (the local
  `gymcoach-user-dev` Docker container holds the generated Prisma query-engine file open, causing
  `EPERM` on `prisma generate`) was hit and resolved by stopping that one local container, rebuilding,
  then restarting it immediately after — no AWS resource was touched by this step.
- Deployed via `aws lambda update-function-code --function-name fitness-assistant-dev-user
  --zip-file fileb://...` (17.29 MB, under the 50 MB direct-upload limit).
- `LastUpdateStatus: Successful`. `CodeSha256` changed from `oIXgx9...` to `r7YWoE...`.
  **`USER_DEPLOY: PASS`.**

## Fitness Deployment

- Same build process. The resulting artifact (76.31 MB) exceeded Lambda's 50 MB direct-upload limit;
  a direct `--zip-file` attempt failed with `Connection was closed before we received a valid
  response` — the exact same class of transient/size-related failure already documented for this
  project's prior Auth/Gym/Fitness Lambda deployments (2026-09-29/09-30). Verified via
  `get-function-configuration` that `CodeSha256`/`LastModified` were unchanged before retrying (no
  partial state). Retried via this repo's own established S3-mediated path:
  `aws s3 cp` to `s3://fitness-assistant-deployments-dev-191798898985/fitness-lambda/...`, then
  `aws lambda update-function-code --s3-bucket ... --s3-key ...` — succeeded.
- `LastUpdateStatus: Successful`. `CodeSha256` changed from `/3MUP0...` to `6gW7b3...`.
  **`FITNESS_DEPLOY: PASS`.**

## Backend Smoke

Real authenticated `GET` requests (REAL HTTP/API), using a real login against the live DEV
Auth Lambda with an owner-supplied test account (password never logged/echoed):

| Route | Service | Result |
|---|---|---|
| `GET /notifications` | User | `HTTP 200`, `{"notifications":[],"unreadCount":0}` |
| `GET /workouts` | Fitness | `HTTP 200`, `[]` |
| `GET /training-cycles` | Fitness | `HTTP 200`, `{"cycles":[]}` |

Both deployed services respond correctly post-deploy. **`USER_BASE_SMOKE: PASS`.
`FITNESS_BASE_SMOKE: PASS`.**

## Chat Startup

`scripts\aws\dev-start.ps1` was run twice during this phase:

1. `-Backend -Execute` — restored Aurora (`stopped` → `available`) and the Secrets Manager VPC
   endpoint, and restored the 13 DEV-pausable EventBridge schedules to their pre-freeze state, after
   the prior turn's owner-directed full shutdown (cost optimization) had turned them off. This was
   necessary because this Phase 14B brief's own "Backend already running" assumption was stale by
   the time it was received; the owner explicitly confirmed restarting Backend before continuing.
2. `-Network -Chat -Ai -Execute` — per the owner's own later, explicit instruction to open the full
   application (not just the minimal certification window the original brief specified), including
   AI, which the owner explicitly authorized after being shown the tradeoff (cost, Bedrock scope).

Both calls preserved Backend additively (confirmed via the script's own before/after state table —
the Phase 12A/12B lifecycle fix held correctly again here).

A real, additional gap was found and fixed with the owner's standing Phase 14B authorization
("starting the minimum Chat ECS task capacity required by the existing lifecycle"): `dev-start.ps1
-Chat` reconnects the ALB/listener/target-group/API-Gateway/frontend wiring but, by its own explicit
design (`desiredCount untouched` — documented in the script itself), does **not** scale the ECS
service's desired task count. `fitness-assistant-dev-chat-service` was found at `desired=0
running=0` after the script completed. Scaled to `desired=1` via `aws ecs update-service
--desired-count 1` (explicitly owner-authorized), confirmed `running=1` and target-group health
`healthy` shortly after.

**`CHAT_START: PASS`.**

## Network Requirement

`NETWORK_REQUIRED_FOR_CHAT_CALL`: not definitively isolated as a standalone test (NAT was started as
part of the owner's "open everything" request, not as a narrowly-scoped dependency check) — not
re-litigated further since Network is intentionally active regardless for this continuous
full-service session.

## Chat Health

Chat's own bare `/health` route is mounted at the Express app root (`app.get("/health", ...)`),
while chat-service's real routes are mounted under `/chat` (`app.use("/chat", chatRoutes)`). The
API Gateway integration forwards the full matched path (confirmed via its own `IntegrationUri`),
so `GET /chat/health` through the public gateway 404s (`{"error":"Endpoint not found"}`) — not a
defect, simply no external route reaches the bare `/health` path. A real, authenticated,
**non-AI** route was used instead: `GET /chat/conversations` (`chat.routes.ts`, requires
`authMiddleware`) — `HTTP 200`, `[]`, using the same real JWT as the backend smoke tests.
**`CHAT_HEALTH: PASS`.**

## User → Chat Runtime Certification

**Not run.** Full backward source trace (the user explicitly requested this before any fixture
creation) found every real caller of `notificationService.create()` (the only remaining path to
`pushToSocket`, since `pushTransient` was removed by an unrelated commit) requires pre-existing
business state the current DEV test account does not have:

- `booking.service.ts::requestReschedule`/`respondToReschedule` — require an existing `CONFIRMED`
  Session.
- `contract.service.ts::sendFeedback` — requires an existing `ACTIVE` Contract, called by the PT side.
- `POST /internal/notifications` — service-to-service only, not reachable with a user JWT.

Tracing one level deeper (specifically requested): creating the minimum fixture (an `ACTIVE`
Contract, prerequisite for a bookable `Session`) has exactly one supported path in this codebase —
`requestContract()` → `acceptContract()` → `pay()` → `activateAfterPayment()` — and `pay()`
(`contract.service.ts:1233`) calls `paymentClient.checkout()`, a real call into payment-service with
real escrow-rate splitting; the contract only reaches `ACTIVE` after `activateAfterPayment()`
verifies a transaction with `status === "PAID"`. No admin/seed/test-fixture endpoint that creates an
`ACTIVE` Contract without a real payment was found (grepped `contract.service.ts`,
`contract.routes.ts`, `profile.routes.ts` directly — the only admin contract route found is a
read-only summary). `createMarketplaceContract()` creates a Contract already `ACTIVE`, but its own
doc comment states it is "called by ai-service right after a Marketplace ... purchase is paid
(wallet-transfer already succeeded there)" — still gated behind a real payment, just on a different
branch.

A real room-close/cancel/no-show path was also traced and explicitly rejected as a candidate per
this phase's own instruction, independent of the fixture question: several of its branches have
real financial effects (`compensateNoShowMoney`, `releaseSessionMoney`).

`USER_TO_CHAT_REQUEST_REACHED_CHAT: NO`. `USER_TO_CHAT_INTERNAL_AUTH: NOT_RUN`.
`USER_RUNTIME_BLOCKER: SAFE_FIXTURE_REQUIRES_REAL_PAYMENT`.

## Fitness → Chat Runtime Certification

**Not run / not safe to trigger.** `notification.client.ts::pushCycleAssessmentNotification` has
exactly one caller, `training-cycle.service.ts::runVersionedAssessment` (reached from both
`POST /training-cycles/:id/evaluate` and `POST /training-cycles/:id/complete`). That function
requires an existing `TrainingCycle` owned by the caller (`GET /training-cycles` confirmed the real
test account has none — `{"cycles":[]}`) and, independent of that, **always** calls
`assessCycleSafe()` → ai-service's `/ai/assess-cycle` (a real AI/Bedrock-backed call) before ever
reaching the notification push, regardless of whether that AI call succeeds (its failure is caught
and tolerated, but the attempt itself is unavoidable on this one code path). Creating a
`TrainingCycle` solely to exercise this is exactly the kind of business-fixture creation this phase
was explicitly told not to do.

`FITNESS_TO_CHAT_REQUEST_REACHED_CHAT: NOT_SAFE_TO_TRIGGER`. `FITNESS_TO_CHAT_INTERNAL_AUTH: NOT_RUN`.
`FITNESS_RUNTIME_BLOCKER: NO_TRAINING_CYCLE_AND_AI_DEPENDENCY`.

## Why Full Live Caller Certification Was Not Safe

Both repaired callers sit downstream of real business invariants this codebase enforces correctly:
a notification is never a free-standing, user-triggerable action — it is always a side effect of a
real session/contract/cycle event. Forcing one into existence for a DEV account with zero prior
state would have required either a real payment-provider transaction (User path) or a real
AI/Bedrock call plus a brand-new TrainingCycle (Fitness path) — both explicitly forbidden by this
phase's own "do not create business fixtures / do not make real payments" instruction. Manually
inserting rows, forging an internal-secret header from the test client, or otherwise bypassing these
invariants would not have certified the repaired caller at all — it would have certified a fabricated
request that never actually exercised `notification.service.ts`/`notification.client.ts`'s real
code path.

## Financial Fixture Dependency

Traced end-to-end from `requestReschedule()` backward to the only object-creation path available in
this codebase: `Contract.status: PENDING_REVIEW → PENDING_SIGNATURE/PENDING_PAYMENT → ACTIVE`, where
the final transition is gated behind `contract.service.ts::pay()` → `paymentClient.checkout()`
(real payment-service call, real escrow rate split) → `activateAfterPayment()` (verifies a real
`PAID` transaction). There is no code path in this repository that creates an `ACTIVE` Contract
without a real payment having already settled somewhere upstream of it.

## User Runtime Gap

Zero Contracts, zero Sessions on the real DEV test account (confirmed via `GET /sessions/upcoming`
→ `[]`; no `/contracts` route exists at that exact path, confirming no shortcut listing either).
Closing this gap requires either a real payment-provider transaction, or waiting for a legitimately
pre-existing `ACTIVE` Contract + `CONFIRMED` Session to exist on some DEV account (owner's own future
testing, a seeded fixture explicitly built for this purpose in a later phase, or any other real,
organic source) and observing the normal application event when it happens — not fabricating one now.

## Fitness Runtime Gap

Zero TrainingCycles on the real DEV test account (confirmed via `GET /training-cycles` →
`{"cycles":[]}`). Closing this gap requires a real Roadmap/TrainingCycle to exist first (a
substantially larger onboarding flow, out of scope here) — at which point `evaluateCycle`/
`completeCycle` would also invoke AI/Bedrock as an unavoidable step before the notification push,
not conditionally.

## Evidence Supporting Partial Verification

- Root cause confirmed by source (Phase 14A report, re-verified fresh in this phase).
- `git diff`/`git show` confirmed the live-deployed Lambda artifacts now contain the corrected
  fallback precedence (`INTERNAL_API_SECRET || INTERNAL_SERVICE_SECRET`), the fail-safe
  missing-secret skip, and the distinct 401-vs-transient-failure log classification, in all 3
  repaired call sites — this is a CODE AUDIT claim, directly backed by the exact artifacts uploaded
  and confirmed `Successful`.
- Targeted Phase 14A regression suite (8 files, fake secrets, no AWS calls) re-run after adapting to
  the unrelated `pushTransient` removal and the corrected precedence order: **9/9 pass**
  (5 fitness-service + 4 user-service), BACKEND INTEGRATION tier (real local Postgres for the
  user-service tests, per this service's own established convention).
- `npx tsc --noEmit`: clean for both `user-service` and `fitness-service`.
- `USER_BASE_SMOKE`/`FITNESS_BASE_SMOKE`/`CHAT_HEALTH`: all PASS via REAL HTTP/API against the live
  DEV deployment.
- No contradictory evidence was observed at any point: the deployed callers were never seen sending
  an empty secret, Chat never rejected a real request with 401, no deployment failure occurred, and
  no runtime configuration mismatch was found. Absence of a safe live fixture is a test-environment
  data-availability gap, not a code defect — `CHAT_INTERNAL_AUTH_FIX_FAILED` would require one of
  those four contradictions, and none exists.

## Conditions for Future Full Certification

Full runtime certification can be completed naturally, without creating anything solely for testing,
the first time either of the following already exists on a real DEV account:

- **User path**: an `ACTIVE` Contract + `CONFIRMED` Session (from any real booking/payment that
  already happened for a legitimate reason) — then observe a real `requestReschedule`/
  `respondToReschedule` call (or any of `booking.service.ts`'s other `closeRoomOf` triggers) via
  CloudWatch.
- **Fitness path**: a legitimate `TrainingCycle` (from a real Roadmap already created) — then observe
  a real `POST /training-cycles/:id/evaluate` or `/complete` call.

At that point, correlate User/Fitness/Chat CloudWatch logs around the real event's timestamp exactly
as Phase 14B.13 specifies, with no secret values ever displayed.

## Secret Safety

No log, command output, or this report at any point included `INTERNAL_SERVICE_SECRET`,
`INTERNAL_API_SECRET`, any JWT, or the test account's password. The access token obtained via a real
login was written only to a local scratchpad file (never printed) and referenced only via shell
variable substitution in subsequent commands. `SECRET_VALUE_LOGGED: NO`.

## Chat Shutdown

Not performed. Backend, Network, Chat, and AI are all intentionally active per the owner's own
explicit "open the full application" instruction, issued after this phase's original "shortest
verification window" default — overriding it for this session. Nothing was stopped solely to
finalize this report.

## Final Continuous Session State

```
Aurora:            AVAILABLE
NAT:               1 / ACTIVE
Chat ALB:          ACTIVE
Chat ECS:          desired=1, running=1
Secrets/AI VPCE:   active
Backend:           ON
```

`FINAL_COST_LEAK_CHECK: DEFERRED_CONTINUOUS_FULL_SERVICE_SESSION` — not run, by design; this is an
intentionally-active, owner-directed full-service session, not an idle leak.

## Remaining Gaps

- `backend/services/chat-service/src/app.ts`'s uncommitted dual-accept-secret change (found during
  this phase's own preflight) remains undeployed and uncommitted — backlog for a future phase to
  decide whether/when to build and push that image.
- The User runtime path and Fitness runtime path both remain only CODE-AUDIT + regression-tested,
  not live-request-verified, pending real business data as described above.

## API Gateway / IaC Backlog (unchanged from Phase 14A, recorded again, not fixed)

- `POST /auth/password-reset/request` — implemented in code, returns 404 live (missing from DEV API
  Gateway).
- `PATCH /auth/me/password` — added manually in Phase 13A due to a gap in whatever is supposed to own
  this API's route list.

Both still feed a future "API GATEWAY + IaC + CI/CD HARDENING" phase.
