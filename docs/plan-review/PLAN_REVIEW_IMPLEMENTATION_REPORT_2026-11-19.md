# Workout Plan Review & Approval — R0 Audit + Local Implementation (2026-11-19)

**NO AWS DEPLOY. NO CLOUD DATA CHANGED. NO COMMIT / PUSH / MERGE.** Migration exists as a file only; it was not applied to any database.
Evidence labels: `CODE AUDIT` · `TEST FIXTURE` · `BACKEND INTEGRATION` (real Express + real controller/service, in-memory repo) · `NOT RUN`.

## 1. R0 Architecture audit

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Legacy PT review lives on ai-service `WorkoutPlan` (`ptReviewStatus` enum PENDING_PT_REVIEW/PT_APPROVED/PT_REJECTED, `ptNote`, `ptReviewedAt`) | VERIFIED | `ai-service/prisma/schema.prisma:94-133` |
| 2 | `GET /plans/pt/pending-review`, `POST /plans/:planId/pt-review` exist, PT-role gated, APPROVE/REJECT only, no contract re-check, no version/hash binding, no audit trail, no request-changes | VERIFIED | `plan.controller.ts:588-687`, `plan.routes.ts:143-157` |
| 3 | `ptReviewStatus` is only ever set to PENDING when completing a plan that already has `ptUserId` — there is **no client-initiated submit** | VERIFIED | `conversation.repository.ts:540` |
| 4 | An AI "adjust" does **not** edit a plan in place: it creates a **new `WorkoutPlan` row (new id, version+1)** and archives the previous one (`previousPlanId`) | VERIFIED (code + live log `Plan adjustment queued newPlanId/originalPlanId/version:2`) | `conversation.repository.ts:525-550`, ai Lambda log 2026-11-19 |
| 5 | `WorkoutProgram` (fitness-service) is the real prescription; `sourcePlanId`/`aiPlanVersion` are provenance; `@@unique([userId, sourcePlanId])` | VERIFIED | `fitness-service/prisma/schema.prisma:534-561` |
| 6 | `WorkoutProgram.version` is **never incremented** by program edits (no version bump in `workout.service.ts`) | VERIFIED (grep) | `workout.service.ts` — no match |
| 7 | `GET /workouts/programs/current` = newest ACTIVE, non-archived program | VERIFIED | `workout.service.ts:1840` |
| 8 | PT↔client authority = user-service ACTIVE `Contract`; fitness-service has a **strict** roster read (throws on failure) and a swallow-to-false check | VERIFIED | `user.client.ts` `fetchActiveClientIdsStrict`, `isActivePtClientRelationship`; `coach.service.ts:42-47` |
| 9 | No cross-DB transaction exists between ai-service and fitness-service | VERIFIED (separate Prisma schemas/DBs) | — |
| 10 | Persistent notifications only accept a fixed `WorkoutNotificationEventType` union (no plan-review type) | VERIFIED | `notification.client.ts:122-143` |

### Ownership (parallel-agent safety)
Uncommitted work by another stream in the same tree: `ai-service` `plan.controller.ts`, `plan.routes.ts`, `conversation.service.ts`, `conversation.repository.ts`, `workout-adjustment-constraints.ts`, `frontend/web` `AIPlansPage.tsx`, `services/api.ts`, plus infra/scripts. **None of these were edited.** Shared files touched (additive only): `fitness-service/src/app.ts` (+2 lines), `gateway/src/routes/proxy.routes.ts` (+11), `frontend/web/src/app/routes.tsx` (+3), `fitness-service/prisma/schema.prisma` (append) and the regenerated Prisma client.

## 2. Gap analysis & design decisions

| Spec requirement | Gap in existing code | Decision |
|---|---|---|
| A. logical planId stable across edits, no "Plan A.1" | AI adjust creates a new WorkoutPlan id (finding 4); program version never bumps (6) | Review subject = **WorkoutProgram.id** (stable across edits). Revision identity = **SHA-256 of the canonical prescription snapshot**, not a counter. AI-layer identity (finding 4) **not changed** — ownership conflict, see §7. |
| Decision bound to subjectId+version+hash | none | `PlanReviewRequest(subjectId, subjectVersion, contentHash, snapshot)`; decision events carry the hash |
| New revision never inherits approval | none | Approval is **never copied**; `effectiveState` computed at read time (`APPROVED_CURRENT` vs `APPROVED_OUTDATED`) |
| Immutable snapshot | none | `snapshot` JSON written once; prescription only (no InBody/profile/health/logs) |
| State machine (8 states) | 3-state enum | `plan-review.engine.ts` `TRANSITIONS`; terminal states have no outgoing edge; actor-checked |
| Where to store reviews for a fitness-service subject | n/a | **fitness-service** (owns program + contract-verification code); ai-service WorkoutPlan = provenance only, **never written** |
| Concurrency/idempotency | none | conditional `UPDATE … WHERE status IN (…) AND revision = N`; partial unique index (one open request per client+plan); unique (client, idempotencyKey); `Idempotency-Key` header |
| Cross-service consistency | no cross-DB tx | single-DB transaction per change; read-time effective approval; audit event written in the same tx; events double as notification **outbox** |
| Legacy compat | — | legacy API untouched; `toLegacyPtReviewStatus()` read-only mapping |

## 3. Schema / API contract

Schema (additive, `20261119100000_add_plan_review/migration.sql`): enum `PlanReviewStatus` (8 values), tables `plan_review_requests`, `plan_review_events`, partial unique index `plan_review_requests_one_open_per_subject`.

API (fitness-service, gateway proxy `/plan-reviews`, auth = verified session only):

| Route | Who | Notes |
|---|---|---|
| `POST /plan-reviews` | client | body `{ptUserId, programId?, expectedContentHash?, clientNote?}` (`.strict()`); `Idempotency-Key`; 201 new / 200 replay |
| `GET /plan-reviews/mine?programId=` | client | no snapshot in lists |
| `GET /plan-reviews/inbox?status=` | PT | only clients with ACTIVE contract (strict roster) |
| `GET /plan-reviews/summary` | both | counts + current-plan effective state |
| `GET /plan-reviews/:id`, `/:id/events` | owner client / assigned PT | 404 for anyone else; PT re-verified |
| `POST /plan-reviews/:id/start` | PT | PENDING→IN_REVIEW, idempotent |
| `POST /plan-reviews/:id/decision` | PT | `{decision: APPROVE\|REQUEST_CHANGES\|REJECT, note?, expectedRevision?, expectedContentHash?}`; note required for the two negative decisions |
| `POST /plan-reviews/:id/cancel` | client | idempotent |

Error codes: `NO_ACTIVE_CONTRACT`(403) `AUTH_DEPENDENCY_UNAVAILABLE`(503) `STALE_REVISION`/`REVISION_OUTDATED`/`CONCURRENT_MODIFICATION`/`ILLEGAL_TRANSITION`/`OPEN_REQUEST_WITH_OTHER_PT`/`IDEMPOTENCY_KEY_REUSED`/`PROGRAM_NOT_CURRENT`(409) `NOT_FOUND`(404).

## 4. Implementation (files)
Backend (fitness-service): `services/plan-review/{plan-review.engine,types,service,memory-repository,prisma-repository,index}.ts`, `controllers/plan-review.controller.ts`, `routes/plan-review.routes.ts`, `app.ts` (+mount). Gateway: `/plan-reviews` proxy. Web: `services/planReviewApi.ts`, `components/plan-review/PlanReviewPanel.tsx` (consent preview, pending/feedback/outdated states, cancel, resend, idempotency key, offline message), `pages/pt/PlanReviewInboxPage.tsx` (+ route `/pt/plan-reviews`).

## 5. Test results (actually executed 2026-11-19)
| Suite | Label | Result |
|---|---|---|
| `plan-review.engine.test.ts` (8) | TEST FIXTURE | 8/8 pass |
| `plan-review.service.test.ts` S01–S24 (24 scenarios) | TEST FIXTURE (in-memory repo with DB-equivalent guarantees) | 24/24 pass |
| `plan-review.http.test.ts` H01–H09 | BACKEND INTEGRATION (real Express, stubbed auth/contracts, in-memory repo) | 9/9 pass |
| `plan-review.integration.test.ts` DB01–DB04 | **NOT RUN** — needs isolated `*_test` Postgres (Docker/PG not running; not started per rules) | 4 skipped |
| `tsc --noEmit` fitness-service | CODE | clean |
| Web new files, ad-hoc `tsc` | CODE | no errors reported for the 3 new files (no web tsconfig exists; **not a full web build**) |
| Full fitness-service suite `src/__tests__/*.test.ts` | scoped, **no DB/Redis available** | see §8 |

Scenario coverage: submit/approve/request-changes/reject (S01–S04), identity & version (S05–S07), wrong PT/client, expired/revoked/unavailable contract, role (S08–S12), stale revision / double submit / concurrent submit / concurrent decisions / replay / cancel (S13–S18), transaction failure & outbox retry (S19–S20), multi-device sync (S21), AI plan vs current program & cross-service race (S22–S23), inbox/summary scoping (S24).

## 6. Security / concurrency review (CODE AUDIT + tests)
* Identity only from the verified session; body `.strict()` ⇒ `clientUserId`/`role`/`status` smuggling = 400 (H02). `ptUserId` in submit is the *addressee* and is verified against that PT's ACTIVE roster.
* ACTIVE contract re-derived on submit, view, events, start, decide, inbox, summary — never cached. Roster outage ⇒ 503 and **no state change** (S11): an outage is never read as "revoked" nor as "allowed".
* Contract ended ⇒ 403, no snapshot, open request → `ACCESS_REVOKED` with audit event (S10/H09).
* IDOR: non-participants get 404 (S08/H05). Replay: decisions/cancel/submit idempotent. Stale: expected hash/revision + read-time current-hash check supersedes outdated requests (S13/S23).
* Snapshot excludes InBody/profile/health/logs (engine test); notifications carry generic text only (S20); list views omit snapshot and idempotency key.
* Residual (needs a DB to prove): the partial unique index and conditional UPDATE under real contention — DB01–DB04 written, **not run**.

## 7. Known limitations / unresolved / dependencies
1. **AI-layer logical plan id (spec A)** — ai-service adjust still creates a new `WorkoutPlan` id. Mitigated by binding reviews to `WorkoutProgram.id`+hash, but when AI adjust produces a *new program* (new id) the open request is superseded on the next PT action (S23) and the client must resubmit. True in-place AI revision needs a change in `plan.controller.ts` / `conversation.repository.ts` — **owned by another active stream; not touched.**
2. **AI Chat (spec G) — NOT IMPLEMENTED** (needs `fitness-agent.service.ts` / agent-tools; preview-then-confirm through `POST /plan-reviews`; PT feedback as non-privileged input). Backend API it must reuse is ready.
3. **Mobile (spec F) — NOT IMPLEMENTED.** Web only; the web `PlanReviewPanel` is **not mounted** in any page yet (plan-detail pages are in files with another stream's uncommitted edits) — one-line mount needed: `<PlanReviewPanel programId=… programName=… />`.
4. **Notifications** — events are queued in the outbox (`notifyUserId`, `notifiedAt`); delivery needs a new event type in user-service (`WorkoutNotificationEventType`). `dispatchPendingNotifications` is implemented/tested but unwired (`notify: null`) and has no scheduler.
5. **AWS API Gateway** — a `/plan-reviews` route must be added to `infra/…/api-gateway*` before cloud use (not done: no cloud changes allowed).
6. Offline: UI shows an explicit "not sent" message and reuses the idempotency key on retry; there is no offline queue.
7. Program-edit race: the PT sees the stored snapshot; staleness is detected at decision time, not pushed live.
8. The unrelated dirty tree (other streams) was not validated.

## 8. Regression
Scoped run of `tsx --test src/__tests__/*.test.ts` in fitness-service **without Postgres/Redis**: the run **did not complete** (no pass/fail summary was produced before the 580 s limit — it stalls on suites that wait for Redis/DB). Partial log: two tests of `agent-program-apply-idempotency.test.ts` (which does not skip without a test DB) fail with `ECONNREFUSED :6379` — environmental; that file does not import anything changed here. No other failure was observed in the partial log, but it is **not** a pass signal for the unfinished suites. **This is NOT a full-repository regression and plan-revision / PT-contract / workout-schedule / auth DB suites were not exercised** (no DB).

## 9. Local migration
`prisma/migrations/20261119100000_add_plan_review/migration.sql` — additive (expand) only. Apply **only** to an isolated local/test DB. Rollback: `DROP TABLE plan_review_events, plan_review_requests; DROP TYPE "PlanReviewStatus";` (new, empty tables — no legacy data affected). `src/generated/prisma/*` was regenerated (tracked files).

## 10. Verdict
**NOT READY FOR COMMIT as a complete feature** — backend + web inbox/panel are implemented and the logic is proven at TEST FIXTURE / BACKEND INTEGRATION level, but: DB integration NOT RUN, AI Chat + mobile + notification delivery + panel mount + AWS route NOT IMPLEMENTED. **READY FOR COMMIT as an isolated backend slice** only after DB01–DB04 pass on an isolated test DB.

**Explicit confirmation: NO AWS DEPLOY, no cloud resources, no cloud data/migration touched by this work.**
