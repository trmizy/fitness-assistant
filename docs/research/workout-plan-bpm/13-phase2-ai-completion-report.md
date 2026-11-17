# 13 — Phase 2 AI Completion Report

**Implementation owner**: Claude Code. **Independent review**: pending, by Codex (per the phase brief, section 23).
**Date**: 2026-10-05. This report follows the required structure from the Phase 2 brief (sections 21/22).

## 1. Scope

The ONLY BPM in scope, per the brief: authenticated-user chat request → structured context → authoritative
retrieval → eligible-exercise filtering → draft generation → deterministic validation → presentation → revision →
explicit confirmation → idempotent persistence (`CREATE_WORKOUT_PLAN`, Pipeline A — the chat flow owned by
`fitness-agent.service.ts`). Pipeline B (`/plans/workout/generate`, PT-initiated, `ai.worker.ts`) was confirmed
already compliant during inspection and was **not** touched.

The research package (`docs/research/workout-plan-bpm/00`–`12`) had already fixed 22 FRs/20 EXs/42 ACs and found
**exactly one real, named implementation gap**: FR09/EX03/AC25/AC09 — "equipment compatibility is checked too
late" (only at confirm time, never at draft time). This phase closes that gap in production code, adds the tests
the gap-analysis doc (`12`) listed as missing, and updates the traceability matrix (`10`) with real new evidence.

## 2. Files changed

- `backend/services/ai-service/src/services/fitness-agent-tools.ts` — fixed a real param-name bug in
  `getExerciseSubstitute` (`excludeExerciseIds` → `exclude`, matching what the fitness-service controller actually
  reads); added `validatePlanEquipment` (thin wrapper over the existing `domain()` helper and the existing
  `/internal/exercises/validate-plan-equipment` endpoint).
- `backend/services/ai-service/src/services/fitness-agent.service.ts` — added `applyEquipmentFiltering`, called
  from inside `generateWorkoutDraft` (so both initial proposal and day-count/weekday revisions get it for free);
  threaded two new counts (`equipmentSubstitutedCount`, `equipmentDroppedCount`) through `proposeWorkoutPlan` and
  the day-count-change revision branch's disclosure text.
- `backend/services/ai-service/src/__tests__/agent-workflow-create-workout-plan.test.ts` — extended the existing
  stub harness (`validatePlanEquipment` added to the capture/restore/default-stub set) and added 5 new real-DB
  test cases.
- `backend/services/fitness-service/src/__tests__/ai-workout-grounding.integration.test.ts` — added 1 new real-DB
  integration test (the equipment-rejection-at-confirm case the traceability matrix flagged as missing).
- `docs/research/workout-plan-bpm/10-traceability-matrix.md` — updated only the rows with genuinely new evidence
  (FR05, FR09, FR11, FR17, FR18 and their EX/AC cross-references), plus the summary count.
- No fitness-service production code was changed. No change to Pipeline B. No change to `recommendation_engine.ts`.

## 3. Architecture changes

None. The fix is additive and reuses existing architecture exactly:

```
generateWorkoutDraft (unchanged steps) -> resolve exercise names to canonical IDs (unchanged)
  -> NEW: applyEquipmentFiltering(identity, weeklySchedule)
       -> validatePlanEquipment (NEW wrapper, calls the SAME planEquipmentValidatorService.validate
          fitness-service already runs at confirm time, via the SAME internal endpoint Pipeline B already calls)
       -> for each violation: getExerciseSubstitute (EXISTING tool, same substitution service the
          "Đổi bài tập" UI already uses) -> replace, or drop if no substitute exists
  -> (unchanged) selectedWeekdays / weekday labels / return
-> (unchanged) confirm-time validateAiPlanExerciseEquipment remains the final backstop
```

No new agent, no new validation engine, no new substitution engine, no second source of equipment truth.

## 4. Equipment filtering implementation

`applyEquipmentFiltering` (new, `fitness-agent.service.ts`): given the already-resolved `weeklySchedule` (real
canonical `exerciseId`s), calls `validatePlanEquipment` (which resolves the user's real `UserEquipment` rows
server-side from just `userId` — no new equipment representation introduced in ai-service). If invalid, for every
violating `exerciseId` (matched by id across **every** day it appears, not just the first occurrence), it calls
`getExerciseSubstitute` with an `exclude` list built from every exerciseId already present in that specific day
(including any substitute already chosen earlier in the same day's loop, so a repair never introduces a duplicate
exercise into one day). A real substitute replaces the exercise in place; no substitute means the exercise is
dropped from its day. Empty days are re-filtered and `selectedWeekdays` is recomputed using the same existing
functions the rest of the file already uses. If the `validatePlanEquipment` call itself fails (fitness-service
unreachable), the pass is skipped and the unfiltered draft is returned unchanged — confirm-time validation is
still a hard backstop, so this can never make persistence unsafe, only means one preview didn't get the
improvement that one time (no regression versus pre-Phase-2 behavior).

## 5. Recommendation Agent contract

Unchanged. `recommendationEngine.recommend()` still produces the initial template; its own earlier, free-text,
hardcoded equipment heuristic (`filterExercisesByEquipment`/`DUMBBELL_SUBS`/`BODYWEIGHT_SUBS`) is untouched —
deliberately left in place as a harmless earlier pass, not deleted, since removing it was not required to close the
gap and would have touched more surface than necessary. The NEW pass is what actually closes FR09, because it is
the first point in the pipeline with both a real canonical `exerciseId` and real per-user equipment truth.

## 6. Deterministic validation

Confirm-time `validateAiPlanExerciseEquipment` (fitness-service, `workout.service.ts`) is **unchanged** and still
runs on every confirm — defense in depth, exactly as the brief's section 3 requires ("filter before generation +
validate after generation"). Added a real-DB test proving it actually rejects (`ai-workout-grounding.integration.
test.ts`), which did not exist before this phase.

## 7. Revision behaviour

Because the new pass lives inside `generateWorkoutDraft` itself (not duplicated into `proposeWorkoutPlan`), the
day-count-change and weekday-count-mismatch revision branches in `tryReviseWorkoutPlanDraft` get the same
equipment-aware behavior automatically, with zero duplicate wiring. Accepted tradeoff: a day-count/weekday revision
turn that also needs exclusion re-application now runs up to three sequential batches (name-resolution →
equipment-check+substitute → exclusion-reapply-substitute), each internally parallel — consistent with this file's
existing unbounded-`Promise.all` precedent, bounded by realistic plan size (≤ ~35 exercises). Latency cost, not a
correctness risk.

## 8. HITL behaviour

Unchanged. Draft vs. confirmed is still exactly the `FitnessAgentAction.status` column; nothing in this phase
touches the confirm boundary itself.

## 9. Persistence/idempotency behaviour

Unchanged in code. Added a real-DB test for EX16 (downstream persistence failure at confirm: a thrown
`importAiPlanToSchedule` call releases the action's claim back to `PENDING`, never leaves it `EXECUTING` or falsely
`COMPLETED`) — this closes a real, previously-undemonstrated gap (traceability matrix FR18/AC38 row). The
double-confirm/FR19 DB-level backstop (`WorkoutProgram.agentActionId @unique`) was **not** additionally tested this
phase — see "Known limitations."

## 10. User isolation

Unchanged. Not touched by this phase; already `IMPLEMENTED_AND_VERIFIED` per the traceability matrix (FR20).

## 11. Qwen3 4B involvement

**None, by design.** Pipeline A has zero LLM calls before or after this change — the fix is entirely deterministic,
reusing existing deterministic fitness-service services. The brief's section 15 guardrails (no 30B, no fine-tuning,
no model-swap-to-pass-tests) were respected by not introducing a model call where none existed. The frozen Qwen3 4B
evaluation dataset/execution (research doc `11`) remains out of scope for this phase, per the gap-analysis doc's own
recommendation that it be scheduled as its own phase after separate approval.

## 12. Tests added

- `agent-workflow-create-workout-plan.test.ts` (ai-service, real DB, stubbed HTTP boundary — same convention as the
  file's existing tests):
  1. Equipment violation + real substitute available → substitute reaches the persisted draft, violating exercise
     does not (FR09/AC09/AC25/EX03).
  2. Equipment violation + no substitute available → exercise dropped, honestly disclosed, draft still shown
     (EX03 recovery path).
  3. Every exercise violates, no substitutes anywhere → graceful honest empty-draft message, zero misleading
     `FitnessAgentAction` rows (AC29/EX07).
  4. `daysPerWeek` correction ("3 buổi" → "À không, 5 buổi") resolves to 5, not 3, not an average (AC05/AC26).
  5. Downstream persistence failure at confirm → action releases back to `PENDING` (AC38/EX16).
- `ai-workout-grounding.integration.test.ts` (fitness-service, real DB, real `Equipment`/`ExerciseEquipment`/
  `UserEquipment` rows): equipment-rejection at confirm time (AC17/AC28/EX06).

**Explicitly not added**: T14/T15-style Qwen3 malformed-output/timeout tests — there is no model call anywhere in
this pipeline, so such a test would assert nothing real. A CREATE_WORKOUT_PLAN-specific knowledge-question
interruption/resume test (AC31/AC32) was investigated but not added this phase — see "Known limitations."

## 13. Tests executed

All runs below were against the project's isolated test-database convention (`postgres-test` on host port 55433,
databases `gymcoach_ai_test` / `gymcoach_fitness_test`, migrated via `node scripts/prisma-test.mjs`), never the
dev/prod database. Evidence label: **REAL HTTP/API** is not applicable (no browser/gateway involved); these are
**BACKEND INTEGRATION** runs — real Postgres, real Prisma, real service-layer function calls, with only the
cross-service HTTP boundary stubbed in the ai-service suite (same convention the pre-existing tests in that file
already use) and fully real (no stubs) in the fitness-service integration test.

```
# ai-service — the two files this phase touched
cd backend/services/ai-service
NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test \
  INTERNAL_SERVICE_SECRET=test_internal_service_secret_32_chars_minimum \
  JWT_SECRET=test_jwt_secret_32_chars_minimum_value REDIS_URL=redis://localhost:56379 \
  npx tsx --test src/__tests__/agent-workflow-create-workout-plan.test.ts
# -> tests 10, pass 10, fail 0 (5 pre-existing + 5 new, all passing)

# fitness-service — the integration test this phase touched
cd backend/services/fitness-service
NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test \
  FITNESS_DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test \
  INTERNAL_SERVICE_SECRET=test_internal_service_secret_32_chars_minimum REDIS_URL=redis://localhost:56379 \
  npx tsx --test src/__tests__/ai-workout-grounding.integration.test.ts
# -> tests 3, pass 3, fail 0 (2 pre-existing + 1 new, all passing)
```

**Regression check** — the `getExerciseSubstitute` param fix touches a tool called from other existing revision
code paths, so the full ai-service suite (`npx tsx --test src/__tests__/*.test.ts`, same env as above) was also run
once:

```
tests 788, pass 778, fail 6, skipped 4
```

This is **ai-service's own test suite**, not a full repository regression (fitness-service/user-service/auth-
service/chat-service/gym-service/payment-service suites were not run in this pass). All 6 failures were verified
**pre-existing and environmental, not caused by this phase's change**:

- 3 failures in `plan-generation-equipment.integration.test.ts` (Pipeline B's own test, untouched by this phase) —
  require `DEBUG_AI_PLAN` telemetry and a live/spawned fitness-service HTTP server that this ad hoc run did not
  provide.
- 2 failures in `llm-provider-ollama-regression.test.ts` — asserts a specific default Ollama model name
  (`llama3.2:3b`) that no longer matches this environment's configured default (`qwen3:4b-instruct-2507-q4_K_M`);
  unrelated to workout generation.
- 1 failure in `fitness-agent-chat-verification-fixes.test.ts` ("selection wording is unchanged...") — requires a
  real, reachable fitness-service for `searchExerciseByName`, which this ad hoc run did not start. **Verified by
  direct A/B**: stashed this phase's two changed service files and re-ran this exact test in isolation — it failed
  **identically**, confirming the failure is pre-existing and unrelated to this change, not a regression.

No full build (`pnpm run build`) or the repo's Docker `docker:test:full` orchestration (which would also run
RAG/retrieval evals, policy tests, and other services' suites) was executed in this pass — `npx tsc --noEmit` was
run for both ai-service and fitness-service after every edit and is clean.

## 14. Exact pass/fail counts

| Suite | Pass | Fail | Skipped | Notes |
|---|---|---|---|---|
| `agent-workflow-create-workout-plan.test.ts` | 10 | 0 | 0 | includes all 5 new Phase 2 cases |
| `ai-workout-grounding.integration.test.ts` | 3 | 0 | 0 | includes the 1 new Phase 2 case |
| ai-service full suite (`*.test.ts`) | 778 | 6 | 4 | all 6 failures pre-existing/environmental, see §13 |

## 15. Remaining BPM gaps

- **FR19 (double-confirm, DB-level)**: the ai-service-layer `EXECUTING`/`COMPLETED` claim-state idempotency is
  proven (pre-existing test). The `WorkoutProgram.agentActionId @unique` DB-level backstop specifically was **not**
  additionally exercised this phase — doing so would need a real-HTTP integration test against fitness-service
  (the `plan-generation-equipment.integration.test.ts` convention, not the stub-based one), which was judged lower
  priority than the equipment gap given the ai-service-layer evidence already on file. Still PARTIAL, not MISSING.
- **FR15 (CREATE_WORKOUT_PLAN-specific interruption/resume)**: investigated, not added. The real interruption-
  preserving mechanism (EX09) lives in CI-V2's `global-turn.ts`, which this test file's existing tests run with
  CI-V2 off (legacy mode). Correctly exercising CI-V2's `KNOWLEDGE_QA` path would require either enabling
  `CONVERSATIONAL_INTELLIGENCE_V2=on` with its own additional narration/RAG stub requirements, or first verifying
  legacy-mode's actual (possibly different) interruption behavior — neither was done confidently enough in this
  pass to ship a test whose correctness I could actually stand behind. Remains PARTIAL (generically proven by
  X1–X4, not yet CREATE_WORKOUT_PLAN-specific).
- **FR10/EX08 (catalog-unmatched-count path)**: still PARTIAL — this phase added equipment-drop-count disclosure
  as a *new*, separate counter (not folded into the existing catalog-`unmatchedCount`), but did not add a dedicated
  unit test for the original catalog-unmatched behavior itself.
- **trainingLocation**, **Qwen3 4B dataset/evaluation execution**, **`createManualProgram`'s equipment-validation
  asymmetry** — all explicitly out of scope per the brief and the gap-analysis doc; not touched.

## 16. Known limitations

- A pre-existing gap, **not introduced by this phase**: `tryReviseWorkoutPlanDraft`'s weekday-mismatch regeneration
  branch (the `if (weekdays.length === payload.weeklySchedule.length) {...} else { regenerate(...) }` path for "Tôi
  tập được thứ 3, 5, 7"-style messages) has no explicit "came back empty" guard the way the day-count-change branch
  and `proposeWorkoutPlan` both do — if `regenerate()` there returns an empty schedule, the function falls through
  toward `return null` instead of a truthful "couldn't do that" message. Flagged during investigation (Plan-agent
  review), not fixed — it is outside this phase's named gap and changing it was not required by any FR/AC.
- The new equipment-filtering pass adds at least one extra synchronous HTTP round trip (plus up to N substitute
  calls) to every draft-generation and day-count/weekday-revision turn. No concurrency limiter exists for this fan-
  out, consistent with this file's pre-existing pattern (its own exercise-name resolution has none either), but it
  is a real, accepted latency cost versus the pre-Phase-2 behavior.
- The ai-service full-suite run (§13) surfaced 3 pre-existing, unrelated test gaps in this environment (Ollama
  model-name drift, Pipeline B's telemetry test needing a live fitness-service/worker setup this ad hoc run didn't
  provide) — not part of this phase's scope to fix, noted for completeness.

## 17. Regression evidence

- `npx tsc --noEmit` clean for both ai-service and fitness-service after every edit.
- All pre-existing tests in both touched test files still pass (10/10, 3/3 — see §13/§14).
- The one suspicious full-suite failure that shares a file with this phase's change
  (`fitness-agent-chat-verification-fixes.test.ts`) was verified by direct stash/re-run A/B to fail identically
  with this phase's changes removed — confirmed pre-existing, not a regression (§13).
- The `getExerciseSubstitute` param-name fix (`excludeExerciseIds` → `exclude`) makes an existing, previously
  silently-broken exclusion mechanism start actually working; this is a bug fix with no test in this suite asserting
  the old (broken) behavior, so no regression risk from that specific change was found.

## 18. Whether the frozen benchmark can now begin

The brief's own section 11 evaluation plan (`docs/research/workout-plan-bpm/11-qwen3-4b-evaluation-plan.md`) is a
**design**, not yet executed, and remains its own future phase per the gap-analysis doc's explicit recommendation —
this phase did not start it, and nothing here changes that timeline. For the narrower question of whether THIS
BPM's implementation is now complete enough to stop blocking that future benchmark: the one real, named,
MISSING-status implementation gap (FR09) is now closed with real evidence, and 4 other previously-PARTIAL rows
(FR05, FR11, FR17, FR18) now have real new evidence. Two rows remain honestly PARTIAL (FR15, FR19) for reasons
documented above, not because they were skipped carelessly.

---

## Final response (brief section 22)

**A. Repository inspection findings**: see this report's §1–§7 and the pre-existing `02`–`12` research docs;
confirmed two separate "AI workout plan" pipelines exist, only Pipeline A had the equipment-timing gap.

**B. Implementation plan actually executed**: exactly the plan approved before implementation — add
`validatePlanEquipment` + fix the `getExerciseSubstitute` param bug in `fitness-agent-tools.ts`; add
`applyEquipmentFiltering` inside `generateWorkoutDraft`; thread two new disclosure counters; add the listed tests;
update traceability; write this report. No deviation.

**C. Files changed**: §2.

**D. FR/EX/AC closed**: FR05/AC05/AC26, FR09/EX03/AC09/AC25, FR11/EX07/AC29 (empty-result trigger), FR17/EX06/AC17/
AC28, FR18/EX16/AC18/AC38 — see §15 for what remains open and why.

**E. Tests added**: §12 (6 new tests across 2 files).

**F. Exact test commands**: §13.

**G. Exact results**: §13/§14 — 10/10, 3/3, and an honestly-scoped 778/788 full-suite run with all 6 failures
verified pre-existing/environmental (one by direct A/B stash comparison).

**H. Equipment constraint evidence**: §4, §12 test 1–3, §13.

**I. HITL/persistence evidence**: §8/§9, §12 test 5.

**J. Cross-user evidence**: unchanged this phase; already `IMPLEMENTED_AND_VERIFIED` (FR20) before this phase began.

**K. Qwen3 4B behaviour**: §11 — none, by design.

**L. Remaining gaps**: §15.

**M. Regression findings**: §17 — none found; one suspicious failure verified pre-existing by direct A/B.

**N. Final verdict**: **NOT_READY_FOR_FROZEN_BPM_BENCHMARK**

Exact blockers:
1. FR15 (CREATE_WORKOUT_PLAN-specific interruption/resume) and FR19 (DB-level double-confirm backstop) remain
   PARTIAL, not IMPLEMENTED_AND_VERIFIED — both are pre-existing gaps this phase investigated but did not close,
   for the specific, documented reasons in §15.
2. The Qwen3 4B evaluation dataset (research doc `11`) has not been constructed or run — this was always scoped as
   its own future phase requiring separate approval, not a blocker this phase was asked to clear, but it is still
   a precondition for the benchmark itself, not merely for this BPM's implementation completeness.
3. This phase's full-suite regression run was scoped to ai-service only, run ad hoc against a locally-started
   `postgres-test`/`redis-test` pair rather than the repo's own `docker:test:full` orchestration — a benchmark
   gate would reasonably want that fuller, officially-orchestrated run (including fitness-service's own full
   suite) before being called clean.
