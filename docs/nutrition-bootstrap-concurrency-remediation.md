# Nutrition Bootstrap Concurrency Remediation

Date: 2026-09-20. Scope: one defect from `docs/codex-ai-coach-release-readiness.md` (MEDIUM #1). No AI Coach core, migration or index change.

## Reproduction
Codex `test/codex-ai-coach-release-readiness/bootstrap-race.ts` (unchanged, real bootstrap + repository + isolated migrated fitness DB, 30 rounds x 10 concurrent same-user calls): 11/300 rejected (Prisma P2010 / PG 23505). Data stayed consistent (1 ACTIVE goal, 1 ACTIVE cycle); callers failed, and `internal.controller.ts` maps any throw to HTTP 500.

## Root cause
`bootstrapNutritionForUser`: `findGoalByUserId` (check) -> `ensureActiveCycle` -> second check -> `nutritionRepository.upsertGoal` (UPDATE ACTIVE -> SUPERSEDED, then INSERT ACTIVE, in a batch). Check-then-act without serialisation: several callers all see "no goal", all INSERT, the partial unique index `nutrition_goals_user_id_active_unique` rejects the losers, and the loser's error escaped. (The old header comment claimed the loser would land as a SUPERSEDED row; that is not what the SQL does.)

## Fix (Option C + A: atomic repository primitive with a per-user advisory lock)
- New `nutritionRepository.createFirstActiveGoalIfAbsent` (`nutrition.repository.ts`): one interactive transaction: `pg_advisory_xact_lock(hashtextextended('nutrition-bootstrap:'||userId, 0))` -> re-read ACTIVE goal -> if present return `{created:false}` else INSERT ... RETURNING `{created:true}`. Same lock idiom already used in `workout.service.ts` (`agent-plan:` key).
- `bootstrapNutritionForUser` calls it instead of race-check + `upsertGoal`; when `created:false` it returns the existing `already_initialized` outcome. Audit row, meal-plan queue and notification run only for the creator.
- The unique index is untouched and remains the last line of defence. No error is caught/swallowed: nothing catches P2010/23505; the race is prevented, not masked. Unexpected DB errors still propagate (tested).
- `upsertGoal` (manual/PT/adaptive goal edits) is unchanged; those paths are out of scope and were not modified.

## Serialisation scope
Per user (lock key includes `userId`). Tested: a held lock for user A does not block user B.

## Side effects audited
| Effect | In tx | Idempotent | Result |
|---|---|---|---|
| NutritionGoal INSERT | yes (locked) | yes (get-or-create) | exactly 1 |
| TrainingCycle (`ensureActiveCycle`) | no (before goal) | yes (`training_cycles_one_active_per_user` + 409 reuse) | unchanged, 1 ACTIVE |
| RecommendationAudit | no, creator only | not by itself | exactly 1 (tested) |
| Meal-plan queue job | no, creator only | not by itself | exactly 1 (tested) |
| Notification | no, creator only | not by itself | exactly 1 (tested) |
No NutritionProgram/onboarding-state write occurs in bootstrap.
Residual (unchanged design): audit/queue/notification are post-commit and non-transactional; a crash between goal commit and those calls leaves a goal without them, and a retry returns `already_initialized` (does not redo them). Pre-existing, best-effort by design; not changed.

## Results (all against isolated test DB `gymcoach_fitness_test`, localhost:55433)
- Codex `bootstrap-race.ts`, unchanged, run twice: **300/300 fulfilled, 0 rejected** (before: 11/300).
- New `nutrition-bootstrap-concurrency.integration.test.ts` (7 tests, 7/7): 30x10 = 300 calls, 0 rejected; per round 1 ACTIVE goal, 0 superseded rows, 1 ACTIVE cycle, 1 audit, 1 queue job, 1 notification, exactly 1 `created`, all callers return the same goalId, persisted target equals the engine's prescription; existing ACTIVE goal x10 concurrent -> all `already_initialized` with same id, no churn/side effects; partial state (cycle, no goal) -> 6 concurrent calls converge to 1 goal linked to that cycle; failure injection (NOT NULL violation inside the tx) -> no partial goal, lock released, retry succeeds; unexpected error propagates; 10 users x 2 calls -> all fine, per-user lock; HTTP through the real `app` (`POST /internal/onboarding/bootstrap-nutrition`, 10 concurrent) -> ten 200, one `created`, 1 ACTIVE goal, no 500.
- Timing (informational): 30 rounds x 10 same-user calls 4.6 s (~150 ms/round); 10 users x 2 concurrent 160 ms. A single-call timing was not separately measured.
- Fitness gate (target-resolution, bootstrap integration, bootstrap engine, equipment semantics, apply idempotency): **30/30**. With the new file: 27/27 in the bootstrap group.
- AI workflow/exclusion/parser/finalization: 118/118. Focused PT/Program/invariants/claims/narrator/memory glob: 172/172 (same glob as Codex). Foundation evaluator: 30/30.
- `tsc --noEmit` fitness-service and ai-service clean; frontend build ok.
- Not proven: the new test file was not run against the pre-fix code (Codex's harness is the pre-fix reproduction).

## Not done (out of scope)
Provider, browser, CI runner, deployment, observability, user-service tests (untouched by this change).
