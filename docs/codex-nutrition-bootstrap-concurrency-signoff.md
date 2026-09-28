# CODEX — NUTRITION BOOTSTRAP CONCURRENCY SIGN-OFF

Independent targeted verification: 2026-09-20 (Asia/Saigon). Production files modified by Codex: **NONE**. No commit, schema/index change, or production deployment. Added only this report and `test/codex-bootstrap-signoff/` verification artifacts; the unchanged foundation evaluator refreshed its generated result output.

## Decision

**GO — BOOTSTRAP CONCURRENCY CLOSED**

CRITICAL **0**, HIGH **0**, MEDIUM **0** for this targeted remediation. Current execution closes the bootstrap finding in `codex-ai-coach-release-readiness.md`; that historical report is retained unchanged. This is not a demo/staging/production readiness certification.

Verified HEAD `96c1040f8420cc121fb10b8900b7da4c509133b0` plus the current dirty worktree. Git blob identities of inspected files:

| File | Blob |
|---|---|
| fitness-service `src/repositories/nutrition.repository.ts` | `f2043a0814537125365f4dc50a8b13c573da091f` |
| fitness-service `src/services/nutrition-onboarding-bootstrap.service.ts` | `5f745136a49e040f6d355e5e19110c58a9c894fb` |
| fitness-service `src/__tests__/nutrition-bootstrap-concurrency.integration.test.ts` | `2ca79ab3834b891abd291ee2ef081cc0e7677cfc` |

Evidence directory: `test/codex-bootstrap-signoff/`. All database execution used the isolated Postgres on `localhost:55433`; fitness tests used `gymcoach_fitness_test`, AI regressions `gymcoach_ai_test`, Redis where needed `localhost:56379`.

## Original reproduction

Previous independent result: 30 rounds x 10 first-time calls, **11/300 rejected**, Prisma P2010 / PostgreSQL 23505. One ACTIVE goal/cycle survived, but expected losing callers escaped as errors. Fitness release gate was 29/30. This recheck targets that defect only.

## Code audit

Inspected remediation report, repository/service/controller, new tests, NutritionGoal/TrainingCycle schema and relevant migrations. No current diff in fitness-service schema/migrations or `internal.controller.ts`.

`nutrition.repository.ts:214` adds `createFirstActiveGoalIfAbsent`. Its interactive transaction acquires the advisory lock, rereads ACTIVE state, then either returns the existing row with `created:false` or inserts and returns the new row with `created:true`. SELECT and INSERT both use `tx`, not the outer Prisma client. No catch-all exception recovery was added.

`nutrition-onboarding-bootstrap.service.ts:252` calls this primitive after resolving the cycle; `:271` returns `already_initialized` with the winning goal ID before any creator side effects. Existing `upsertGoal` remains unchanged for manual/PT/adaptive edits. Target assembly and prescription behavior are covered by the passing target/engine regressions.

`internal.controller.ts:507` still invokes the real bootstrap service; unexpected errors still map to HTTP 500. Correctness comes from preventing the expected race, not concealing database errors.

## Advisory lock semantics

PASS. `prisma.$transaction(async tx => ...)` contains:

```sql
SELECT pg_advisory_xact_lock(hashtextextended('nutrition-bootstrap:' || userId, 0))
```

The implementation supplies the concatenated string as a bound parameter. Lock acquisition precedes the ACTIVE-goal read; insertion occurs before that same transaction commits. The transaction-scoped lock releases on commit/rollback. No remote queue/notification work is held inside it.

The key includes userId, not a global constant. An unlikely hash collision can over-serialize unrelated users, but does not merge identities or bypass the user-scoped SELECT/INSERT. No lock redesign is needed for this finding. The bootstrap-specific lock is not a universal lock for unrelated manual/PT goal writers; no broader serialization claim is made.

## Unique constraint

PASS. Queried the actual test DB, not only migration text:

```sql
CREATE UNIQUE INDEX nutrition_goals_user_id_active_unique
ON public.nutrition_goals (user_id) WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX training_cycles_one_active_per_user
ON public.training_cycles (user_id)
WHERE status = 'ACTIVE' AND archived_at IS NULL;
```

Both remain present. Their original migrations remain unchanged. The advisory lock supplements, rather than weakens, uniqueness protection.

## Original 300-call harness

Ran the exact existing `test/codex-ai-coach-release-readiness/bootstrap-race.ts` **unchanged twice**:

| Run | Rounds | Calls | Fulfilled | Rejected | Incorrect ACTIVE counts |
|---|---:|---:|---:|---:|---:|
| `original-1.txt` | 30 | 300 | 300 | 0 | 0 |
| `original-2.txt` | 30 | 300 | 300 | 0 | 0 |

Every recorded round had one ACTIVE goal and one ACTIVE cycle. No escaping P2010/23505. The original harness reports counts but not goal-cycle linkage; the independent probe below additionally asserts linkage.

Harness SHA256 before and after execution is identical: `b32935401266854c5daac59cfa09b8d18e23a062021b1204fceff516d490e0d1`. No edits made to it.

## New concurrency suite

Executed Claude's new suite: **7/7 PASS, 0 skipped** (`concurrency.txt`). Inspected assertions, not just its count.

- 30 x 10 same-user calls: no rejection, exactly one creator, all same goal ID, one total/ACTIVE goal, one ACTIVE cycle, one real audit, one queue invocation, one notification invocation, engine target parity.
- Existing goal x10: same ID, no version churn, no new side effects.
- Partial cycle-without-goal: six callers succeed and goal links to that cycle.
- Actual NOT NULL transaction failure: zero partial goal, retry succeeds.
- Injected repository exception propagates through bootstrap.
- Ten users x two calls plus held-lock isolation check.
- Real Express HTTP route: ten 200 responses and exactly one creator.

Test-evidence limitations addressed independently: the suite's partial-state test does not assert all caller IDs/side-effect counters; its HTTP test does not assert every loser status/goal ID; its held-lock setup uses a sleep rather than an acquisition barrier. `independent.ts` closes those specific assertion gaps without modifying Claude's tests.

## HTTP concurrency

PASS, separately executed independent probe. Imported the actual fitness Express app, listened on an ephemeral localhost port, and sent **10 simultaneous HTTP POST requests** to `/internal/onboarding/bootstrap-nutrition` with the valid test internal token and the same synthetic user ID.

Observed/asserted: ten HTTP **200**, ten `success:true`, exactly **1 created + 9 already_initialized**, all the same goalId, one ACTIVE goal, one ACTIVE cycle with matching goal-cycle association, one audit and one call to each external side-effect dependency. **0 HTTP 500**.

Real boundaries: socket/HTTP, app, route/internal middleware, controller, bootstrap, repository and Postgres. Controlled dependencies: profile/InBody and queue/notification functions. This is not an end-user JWT, browser, live BullMQ or notification-service delivery test.

Evidence: `independent.txt`, case `http-first`.

## Side effects

PASS for ownership under the tested successful races. Only `goalCreated:true` reaches audit (`service.ts:276`), meal-plan queue (`:309`) and notification (`:331`). Losers return before these calls.

Per round in the new 300-call suite, independent HTTP first-time race, and independent partial-state race: **1 persisted RecommendationAudit, 1 queue invocation, 1 notification invocation**. Queue/notification are instrumented dependency counters, not claims of exactly-once downstream delivery or a real BullMQ job record.

## TrainingCycle behavior

PASS within scope. `ensureActiveCycle` still runs before goal creation. It reuses an ACTIVE cycle, or creates one; a competing creation's 409 causes reread/reuse. `training-cycle.service.ts:617` maps the existing ACTIVE-cycle unique violation to 409; unrelated exceptions are rethrown.

No duplicate ACTIVE cycles or escaping cycle uniqueness errors in the two original harness runs, new suite, or independent HTTP/partial-state tests. Independent assertions verify that the new goal references the actual ACTIVE cycle. No cycle redesign or index change was needed.

## Existing active goal

PASS. New suite exercises ten concurrent calls against a manually seeded ACTIVE goal and preserves its ID/target without churn.

Independent HTTP probe repeats ten requests after successful initialization: all 200, all `already_initialized`, identical original goalId, identical stored goal/cycle/audit state, queue/notification counters unchanged. No extra ACTIVE or SUPERSEDED rows. Evidence: `http-existing`.

## Partial-state recovery

PASS. Independent fixture retains an already-created ACTIVE cycle, removes only its test goal/audit, resets side-effect counters, then runs **ten concurrent bootstrap calls**. Exactly one creator; all converge on the same new goal; exactly one goal and one ACTIVE cycle; goal references the previously retained cycle; one audit/queue invocation/notification invocation. Evidence: `partial`.

## Failure rollback

PASS. Independent probe supplies NULL calories to the actual locked repository transaction. PostgreSQL **23502** / Prisma **P2010** propagates, and no NutritionGoal remains. A normal bootstrap for that same user then succeeds, proving the aborted transaction does not strand the advisory lock.

This intentional 23502 is expected failure-injection evidence, not recurrence of the old concurrent 23505. Claude's separate injected `connection reset` exception also propagates through the service; there is no catch-all recovery masking unexpected database failures.

The cycle can exist before goal creation by design; rollback here guarantees no partial goal, not rollback of the separately created cycle. The partial-state recovery test covers that boundary.

## Cross-user isolation

PASS. Independent probe waits on an explicit barrier confirming user A's advisory lock has been acquired, starts A's bootstrap, and bootstraps B while retaining A's lock. B completes successfully while A is still pending. Releasing the lock allows A to finish. This does not rely on an assumed sleep duration. Evidence: `cross-user-barrier`.

The new suite additionally passed ten users x two simultaneous calls with one ACTIVE goal/cycle per user.

## Fitness gate

**30/30 PASS, 0 skipped**. Same target-resolution, bootstrap integration, bootstrap engine, equipment semantics and apply-idempotency files used by the formerly failing gate. Evidence: `fitness.txt`.

## AI workflow regression

**118/118 PASS, 0 skipped**: workflow, exclusions, parser and finalization suites. Evidence: `workflow.txt`. No architecture reevaluation.

## Foundation evaluator

**30/30 PASS** through the existing `scripts/ci-check-foundation-evaluator.mjs`, with the evaluator unchanged. Evidence: `foundation.txt`.

## Focused regression

**172/172 PASS, 0 skipped**: the same focused PT/Program v2/invariants/claims/narrator/memory globs used in the previous independent release evaluation. Exact invocation is in `run.mjs`; evidence in `focused.txt`.

## Builds

- Fitness-service: `tsc --noEmit -p backend/services/fitness-service/tsconfig.json`, exit **0**.
- AI-service: `tsc --noEmit -p backend/services/ai-service/tsconfig.json`, exit **0**.
- Frontend: actual package `npm run build`, exit **0**, Vite completed in **27.49 s**. Nonfatal large-chunk warning remains.

Transparency: the initial verification runner referenced Vite under root `node_modules`, where it is not installed; that invocation failed before building. This was a Codex harness path error, corrected in `run.mjs`. Successful package build is retained separately in `frontend-build-retry.txt`; `summary.json` preserves the initial failure instead of erasing it. It is not a product build failure. Service checks are typechecks, not deployed artifact/startup certification.

## Remaining findings

**CRITICAL: 0.**

**HIGH: 0.**

**MEDIUM: 0** in this targeted remediation.

**LOW: 0** actionable product findings in this targeted remediation.

**INFO:** Post-commit audit/queue/notification remain non-transactional. A crash after goal commit can leave these incomplete; retry sees `already_initialized` and does not replay them. This is existing best-effort behavior, not introduced by the concurrency fix. No new materially blocking user-visible crash failure was demonstrated in this recheck. No outbox/saga redesign requested.

**INFO:** Tests establish single-owner invocation, not exactly-once external delivery. Full provider/browser/deployment verification remains separate. Dirty-worktree and nonfatal frontend chunk warnings are not reasons to restart core hardening.

## Is the release bootstrap regression closed?

**YES.** The same original repro now passes twice, real HTTP requests converge without 500s, ownership/rollback/per-user locking assertions pass, the formerly 29/30 fitness gate is 30/30, and requested regressions/typechecks/frontend build complete successfully.

The previous release report's narrowly bootstrap-based core REGRESSED status is superseded by this closure. Other release-readiness blockers are not cleared by this sign-off.

## Next phase

**DO NOT RETURN TO AI CORE HARDENING.** Resume release readiness:

1. Configured provider verification.
2. Authenticated browser E2E.
3. Immutable release candidate.
4. Real CI runner.
5. Staging/deployment verification.
6. Observability/redaction verification.
