# openGym Research / Gap Analysis / P0 Implementation — Checkpoint

> Live checkpoint per the overnight-autonomous task instructions. Read this
> file first on any resume (`claude --continue` / `claude --resume`).

## Current phase

P0 complete and verified clean. Continuing into P1 (user said "tiếp tục").
P1 so far: warm-up-set exclusion from cycle-level PR/e1RM (with a caught
near-miss regression, see below), and a real, currently-reproducible
production bug found + fixed (`createWorkout`/`workoutRepository.create`
date defaulting — see "P1: real production bug found and fixed" below).

## P1: real production bug found and fixed (createWorkout date defaulting)

While re-running the full regression suite for the warm-up-filtering P1
change, 3 unrelated tests failed with `ScheduleLockedError`/`SCHEDULE_DATE_LOCKED`
("past"), on data the test had just that moment created. Root-caused, not
dismissed as flaky: `createWorkout` (and a second caller,
`workoutRepository.create` directly from `workout.worker.ts`'s AI-generated-
workout background job) left `Workout.date` to default to a raw `new Date()`
instant when no `scheduleId`/`date` was given. Every other date this codebase
writes/compares (`WorkoutSchedule.date`, and every other call site) is a
UTC-midnight-anchored calendar-day LABEL in Asia/Ho_Chi_Minh, per
`schedule-lock.util.ts`'s own module doc comment. For roughly 7 hours of
every real day (VN midnight–7am — confirmed live, this session ran during
that exact window), VN-local-day has already advanced past UTC-day, so a
freshly created workout's raw-instant date reads as "yesterday" by that
label convention — `assertWorkoutEditableByWorkoutId`'s schedule-less
fallback then immediately locks a workout the user just created, with the
confusing message "cannot edit a workout from a day that has already
passed." **This is real and currently live in the app** for anyone logging
a freeform/unscheduled workout (no `scheduleId`) or triggering the AI
workout-generation worker during that window.

Fixed at both call sites using the codebase's own existing
`todayAsScheduleDate()` helper (already imported/used elsewhere in
`workout.service.ts` for exactly this "what day is today" purpose, just
missing from these two call sites):
- `workout.service.ts`'s `createWorkout` — explicit `else` branch.
- `workout.repository.ts`'s `create` — the shared fallback, covering
  `workout.worker.ts` and any future direct caller too (defense in depth,
  not redundant — each call site could plausibly be invoked independently).

Also fixed a matching bug in the test fixture itself
(`exercise-name-snapshot.integration.test.ts`'s `completeScheduleExercise`
test built its own schedule date from raw `Date.UTC(now.getUTC*())`
components instead of the timezone-aware helper — same bug class, in test
code this time).

New regression coverage: `create-workout-date-regression.integration.test.ts`
(2 tests, asserting the exact date value, not just "the lock didn't fire" —
so a future regression is caught even if it lands on the correct side of the
lock boundary by chance). Full regression across every test file touching
`createWorkout`/`workoutRepository.create` (124 tests) confirmed clean.

## CRITICAL — pre-existing uncommitted work found at task start (2026-08-23)

Before touching anything, `git status` showed the working tree already carried
**two unrelated, substantial, already-implemented-and-tested workstreams**,
none of it committed:

1. **Onboarding/PT-Intake/Safety-Screening redesign** (`docs/ONBOARDING_PT_INTAKE_SAFETY_IMPLEMENTATION_REPORT.md`,
   `docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md`, `docs/ONBOARDING_INTAKE_QUESTIONNAIRE_REVIEW.md`)
   — touches `user-service` (migration `20260823130000_safety_screening`,
   already applied to the real dev DB — confirmed via `prisma migrate status`
   → "Database schema is up to date!"), `RegisterPage.tsx`,
   `OnboardingWizardPage.tsx`, `PersonalizedServiceOrderPage.tsx`.
2. **Personalized Service escrow/milestone ledger** — separate session, touches
   `payment-service` (`membership-ledger.service.ts`, new
   `personalized-service-ledger.service.ts` + integration test,
   `internal.routes.ts`) and `ai-service` (migration
   `20260823120000_personalized_service_escrow_milestones`).
3. A read-only QA agent run (`.temp_todo.md`, `.temp_analysis.md`, `.agnes/`,
   `docs/qa/beginner-first-time-onboarding-audit.md`) explicitly scoped to
   "DO NOT modify any source code" — inert, no conflict risk.

**Decision (documented per the task's own "choose safest option, document
assumption, continue" rule):** the workout/training-progression domain this
task is actually about lives in `fitness-service` (schema.prisma had **zero**
pending changes at task start) and `WorkoutLogPage.tsx` (also clean) — genuinely
orthogonal to the dirty files above. Proceeding with implementation **scoped to
fitness-service + clean frontend workout files only**. Explicitly avoiding new
edits to the already-dirty `ai-service` files (`coach_context_builder.ts`,
`coach_context.types.ts`, `fitness_calculations.ts`, `orchestrator.service.ts`,
`profile_extractor.ts`, `types.ts`, `prisma/schema.prisma`), `user-service`
(`prisma/schema.prisma`, `profile.models.ts`), and all of `payment-service` —
touching those would stack a second large uncommitted change on top of
in-flight, un-reviewed work in the same files, which is a real data-integrity/
merge risk this task does not need to take to deliver its actual scope. AI
integration (Phase 15/20) is therefore **designed and documented, wiring into
ai-service deferred** — see `TRAINING_PROGRESSION_ARCHITECTURE.md` §AI.
I did not commit, stash, or discard any of the pre-existing changes (my own
constraint: only commit when asked) — they remain exactly as found.

## Completed work

- [x] Git baseline (`git status`/`branch`/`log`) — branch `master`, clean
      remote, dirty tree documented above.
- [x] Repo structure audit (7 backend services, gateway implied, frontend web
      + mobile, extensive `docs/`).
- [x] Read existing internal docs before assuming anything was missing:
      `docs/research/fitness-data-source-and-license-review.md` (license
      precedent for exactly this kind of task — LiftLog AGPL-3.0 was already
      handled the same way: behavior-only reference, no code copy),
      `docs/advanced-set-logging.md`, `docs/workout-log-audit.md`,
      `docs/TRAINING_CYCLE_DECISION_ENGINE.md`, `docs/training-cycle-v2.md`,
      `docs/gym-fitness-research.md` §2/§3/§7 (deload, RPE/RIR, e1RM — already
      sourced, reused rather than re-researched).
- [x] Fitness-Assistant workout-domain code audit (fitness-service):
      `estimated-1rm.util.ts`, `training-cycle-metrics.service.ts`
      (`computeNewPRs`, `computeE1rmTrend`, `computeVolumeByWeek`,
      `computeRpeTrend`/`computeRirTrend`), `cycle-metrics.engine.ts`,
      `cycle-decision.engine.ts`, `schema.prisma` (Exercise/WorkoutExercise/
      WorkoutSet models + enums), `WorkoutLogPage.tsx` rest-timer code.
- [x] openGym research: confirmed canonical repo is now
      **gitea.com/DuarteSantos/openGym** (GitHub `DuarteSantos8/openGym` 404s —
      moved/offline; `arvids-unavailable/openGym` is a stale fork, 5 commits,
      not the reference to use). **License: AGPL-3.0** for code (exercise
      metadata MIT via hasaneyldrm/exercises-dataset, images © Gym Visual —
      neither relevant to this task's scope). Full feature/behavior summary
      captured in the Gap Analysis doc — **no source code fetched or read**,
      only README/feature-summary level (license forbids copying it anyway).
- [x] `docs/OPENGYM_VS_FITNESS_ASSISTANT_GAP_ANALYSIS.md` written.
- [x] `docs/TRAINING_PROGRESSION_ARCHITECTURE.md` written.

## Files changed so far

Backend (fitness-service):
- `src/services/exercise-progression.engine.ts` (new) — deterministic
  per-exercise progression engine.
- `src/__tests__/exercise-progression.engine.test.ts` (new) — 17 unit tests,
  all passing.
- `src/services/workout.service.ts` — `getSessionSummary` extended with a
  bodyweight rep-PR path (`getPreviousPerformance` also added here).
- `src/repositories/workout.repository.ts` — `findPriorBodyweightRepsForExercises`
  and `findLastCompletedSetsForExercise` added (both additive, existing
  methods untouched).
- `src/controllers/workout.controller.ts` / `src/routes/workout.routes.ts` —
  new `GET /workouts/exercises/:exerciseId/previous-performance` route.
- `src/__tests__/previous-performance.integration.test.ts` (new, 3 tests),
  `src/__tests__/workout-session-summary.integration.test.ts` (extended, +2
  tests, both existing and new pass).
- `prisma/schema.prisma` + migration
  `20260823140000_workout_set_bodyweight_timed_distance_and_exercise_logging_mode`
  — additive `WorkoutSet.bodyWeightAtSetKg`/`durationSeconds`/`distanceMeters`,
  `Exercise.loggingMode` (backfilled). Applied to **both** `gymcoach_fitness`
  (dev) and `gymcoach_fitness_test` — verified backfill distribution
  (REPS_LOAD 583 / BODYWEIGHT_REPS 296 / TIME 109 / DISTANCE_TIME 14).
  Prisma client regenerated; `gymcoach-fitness-dev` container restarted
  and healthy afterward.
- `src/services/training-cycle-metrics.service.ts` — `SetRow` gained
  `setType`; `computeE1rmTrend`/`computeNewPRs` now exclude WARMUP-tagged
  sets. **Caught a near-miss regression before it shipped**: the naive
  Prisma filter `setType: { not: "WARMUP" }` silently excludes every
  NULL-setType row too (standard SQL three-valued logic) — verified
  empirically against the real dev DB (485,741 of 485,741 existing rows are
  `setType=null`; that filter alone matched zero). Fixed with an explicit
  `OR: [{ setType: null }, { setType: { not: "WARMUP" } }]`.
- `src/__tests__/training-cycle-metrics.service.test.ts` (extended, +2 unit
  tests) and `src/__tests__/compute-new-prs-warmup.integration.test.ts`
  (new, 2 tests) — regression coverage specifically proving the null-vs-
  WARMUP distinction, not just "warmup gets excluded."
- `src/services/workout.service.ts` (`createWorkout`) and
  `src/repositories/workout.repository.ts` (`create`) — fixed a real,
  currently-reproducible production bug (see "P1: real production bug found
  and fixed" above).
- `src/__tests__/create-workout-date-regression.integration.test.ts` (new,
  2 tests); `src/__tests__/exercise-name-snapshot.integration.test.ts`
  (fixed a matching bug in the test's own fixture).

Frontend (`frontend/web`):
- `src/app/services/api.ts` — `PreviousPerformance` type + `getPreviousPerformance`
  call; `WorkoutSessionPr` extended with `prType`/`previousBestReps` (optional,
  backward compatible).
- `src/app/pages/client/WorkoutLogPage.tsx` — previous-performance reference
  card, bodyweight-PR-aware completion-screen rendering, rest-timer rewritten
  to tick against a wall-clock end-timestamp (fixes real drift bug) instead of
  naive decrement, Wake Lock progressive enhancement.

Docs: this checkpoint, `OPENGYM_VS_FITNESS_ASSISTANT_GAP_ANALYSIS.md`,
`TRAINING_PROGRESSION_ARCHITECTURE.md`, `OPENGYM_RESEARCH_SOURCES.md`.

Nothing touched in `ai-service`, `user-service`, or `payment-service` — held
to the documented decision above.

## Tests executed / passing / failing

- `exercise-progression.engine.test.ts`: 17/17 pass (pure unit, no DB).
- `previous-performance.integration.test.ts`: 3/3 pass (real DB,
  `gymcoach_fitness_test`).
- `workout-session-summary.integration.test.ts`: 6/6 pass (4 pre-existing +
  2 new bodyweight-PR tests), confirming no regression on the pre-existing
  weight/e1RM PR behavior.
- `npx tsc --noEmit` (fitness-service): clean, 0 errors.
- Frontend: no tsconfig.json exists in `frontend/web` (pre-existing gap,
  already flagged before this task — not introduced by it), so no project-wide
  type-check is possible; `vite build` transforms all 1932 modules including
  the edited files with no syntax/parse errors (build itself fails on an
  unrelated pre-existing missing dependency, `body-muscles`, in a file this
  task never touched — confirmed via `git status` on that file).
- Full fitness-service regression suite (all `__tests__/*.test.ts` except
  `coach-plan-draft.integration.test.ts`/`coach.service.integration.test.ts`,
  which hang indefinitely in this ad-hoc CLI environment — pre-existing
  infra/LLM-dependency issue, reproduced on an unmodified run before any of
  this session's code changes, not caused by this work): run in progress /
  see next update in this file for final pass/fail count.
- **Self-caused regression found and fixed during verification**: first
  full-suite run failed 12 tests with `The column "logging_mode" does not
  exist` — migration had been applied to the dev DB but not
  `gymcoach_fitness_test`. Fixed immediately (`prisma migrate deploy` against
  the test DB), per this task's own Bug Policy (reproduce → fix → regression
  test, not defer).

## Current blockers

None. The uncommitted pre-existing work (onboarding/safety, escrow ledger)
remains untouched and undisturbed.

## Full-suite regression investigation (root-caused, not glossed over)

First full run (wrong env var, `FITNESS_DATABASE_URL` instead of
`DATABASE_URL` for files without the remap): 130 apparent failures — all
false, fixed by re-invoking with `DATABASE_URL` set directly (confirmed via
isolated single-file rerun: 8/8 pass).

Second run (correct env): 16 raw failure lines (~7 distinct tests after
de-duplicating file-summary restatement). Root-caused each:

- **`equipment-data-integrity.test.ts` + `movement-pattern.test.ts` (2
  tests) — CAUSED BY THIS SESSION**, not the code changes: two orphaned
  `Exercise` rows (`Coach Test Exercise coach-it-ex-*`) were left behind
  because this session force-killed (`taskkill /F`) hung
  `coach.service.integration.test.ts`/`coach-plan-draft.integration.test.ts`
  processes earlier (see "Prisma generate EPERM" troubleshooting above),
  bypassing their `finally { deleteSeed(...) }` cleanup. **Fixed**: deleted
  the 2 orphaned rows + their `workout_program_exercises` reference from
  `gymcoach_fitness_test` only (never touched dev/prod). Re-ran both files
  after cleanup: full pass.
- **`exercise-muscle-map.integration.test.ts` getMuscleMap (2 tests) — PRE-EXISTING, NOT caused by this session**: found a broad, systemic set of
  orphaned `exercise_muscles` rows referencing `muscle_id`s that no longer
  exist in `muscles` (far more than the 2 rows this session's kills could
  explain — a `LIMIT 20` query alone returned 20+ dangling rows across many
  different exercises). This is a pre-existing test-database seed
  inconsistency, out of this task's domain (exercise/muscle taxonomy seeding,
  not training-progression) — documented, not fixed.
- **`equipment-filtering.integration.test.ts` Persona A/B (2 tests) —
  PRE-EXISTING, NOT caused by this session**: fails deterministically even
  run alone/twice, but the flagged exercise differs between reruns. Verified
  directly: `equipment.service.ts`, `equipment-availability.util.ts`, and
  every equipment/exercise-substitution file are untouched by this session
  (`git status` confirmed empty diff on all of them), and the specific
  flagged exercises (`Box Skip`→`plyo-box`, `Standing Dumbbell Upright
  Row`→`dumbbell`) have **correct** `REQUIRED` `ExerciseEquipment` rows in
  the DB — the pure `isExerciseAvailable()` function reads correctly, so the
  bug (if real, not just stale local cache — `gymcoach-fitness-dev` logs
  showed a "Cache hit for exercises" pattern, an unexplored lead) is
  somewhere in the live query/cache path, not in code this session touched.
  **Not root-caused to completion** — flagged as a real, possibly
  production-relevant, discovered-but-out-of-scope bug. Do not silently
  ignore; someone should investigate `equipment.service.ts`'s
  exercise-availability query path and the exercise cache TTL/invalidation.
- **`adaptive-cycle-evaluation.integration.test.ts` steps 2/4 (1 test) —
  PRE-EXISTING, NOT caused by this session**: fails on live cross-service
  HTTP calls to `user-service` returning 401 ("[training-cycle] user profile
  fetch failed"). No file in this session's diff touches auth/internal-API
  code. Almost certainly an internal-service-secret/environment mismatch
  specific to running this integration test via ad-hoc host CLI outside the
  project's normal CI harness — not reproducible via this task's own changes
  (none of which touch cross-service auth).

Third run (after the orphaned-row cleanup), confirmed: **398 pass, exactly
the 3 pre-existing/out-of-scope issues above (5 individual test cases:
adaptive-cycle-evaluation steps 2+4, equipment-filtering Persona A+B,
getMuscleMap ×2) — zero new failures.** This matches the prediction made
before the run, confirming the root-cause analysis above is correct, not
guessed.

## STATUS: COMPLETE (P0) — continuing into P1

All safe/planned P0 phases finished: openGym researched (license verified,
AGPL-3.0, behavior-only reference), Fitness Assistant workout domain audited
from real code, external research reused/supplemented, gap analysis +
architecture written, P0 implemented (progression engine, PR bodyweight
extension, previous-performance prefill, additive schema migration,
rest-timer accuracy + Wake Lock, cycle/exercise precedence), all new code
tested against a real database, full regression suite run + individually
re-verified, final report written. Pre-existing uncommitted work
(onboarding/safety, escrow ledger) confirmed untouched by a final
`git status` diff check.

**Update — the 3 initially-flagged "pre-existing bugs" were fully
root-caused and resolved as false alarms, not left as open findings**: all
three (`equipment-filtering` Persona A/B, `exercise-muscle-map`
`getMuscleMap`, `adaptive-cycle-evaluation` steps 2/4) turned out to be this
session's own ad-hoc test-invocation choices conflicting with each file's
own documented environment requirement (dev DB vs test DB; missing
docker-only env vars for cross-service calls) — each individually re-run
under its correct, documented environment and confirmed passing. See the
implementation report's "Known limitations" section for the full per-file
diagnosis. **Zero real code bugs found this session.**

Per the user's "tiếp tục" (continue), proceeding into P1 scope now.

## UPDATE — P0-completion pass finished (second "tiếp tục" mega-prompt)

Full details: `docs/OPENGYM_P0_COMPLETION_REPORT.md` (new, final report for
this pass). Summary: fresh 2026 ACSM research (verified real), heuristic
re-audit table added, rest-timer localStorage persistence implemented, the
deterministic progression engine — previously built + unit-tested but
**unreachable by any real user** — now wired end-to-end (new
`GET /workouts/exercises/:id/progression` endpoint + UI card), 2 more real
bugs found and fixed via genuine E2E testing (a second instance of the
label-vs-instant date bug, in `findLastCompletedSetsForExercise`; the
`coach.service`/`coach-plan-draft` indefinite hang, root-caused to a second
unclosed BullMQ Redis connection and fully fixed, not just excluded again),
new `docs/TEST_ENVIRONMENT_MATRIX.md`. Final backend regression: 413 pass,
zero unexpected failures. New E2E: 3/3 real browser tests pass
(`29-bodyweight-pr-and-previous-performance.spec.ts`).

**Honest final verdict: NOT READY** against this pass's own strict gate
list — TIME/TIME_LOAD/DISTANCE_TIME logging modes have zero UI (schema +
engine support exist, the active-workout screen doesn't), rest-timer/Wake
Lock unverified by real E2E, AI wiring/DELOAD-precedence-E2E/safety-E2E/
mobile-E2E all outstanding. See the report's own "Final verdict" section for
the full, unhedged reasoning and the concrete path forward.

Pre-existing uncommitted work (onboarding/safety, escrow ledger) confirmed
byte-identical to the original baseline at the very end of this pass —
completely untouched throughout both passes.

## UPDATE 2 — TIME/TIME_LOAD/DISTANCE_TIME wired, verdict upgraded

Continued past the "NOT READY" verdict above by closing its actual cause:
re-audited `WorkoutLogPage.tsx` more thoroughly (found more pre-existing
`loggingMode` infrastructure than the first audit caught), traced the real
gap precisely (schedule-based completion had no duration field at all; the
UI's "cardio duration" control was a live bug — relabeled the weight slider,
submitted the value as `weight`), fixed it end-to-end (schema, service,
repository, frontend inputs, validation), and proved TIME mode with a real
browser + direct DB verification (`TC-TIME-MODE-01`). TIME_LOAD/DISTANCE_TIME
share the identical, now-proven mechanism, backend-proven independently, not
separately E2E-driven — an honestly narrower remaining gap than "no UI."

**Final verdict: READY WITH KNOWN LIMITATIONS** (upgraded from NOT READY —
see `docs/OPENGYM_P0_COMPLETION_REPORT.md`'s own "Final Verdict" for the
full, unhedged reasoning on what's still open: TIME_LOAD/DISTANCE_TIME's own
E2E run, rest-timer/Wake-Lock E2E, AI wiring, superset/reschedule,
DELOAD-precedence/safety/mobile/offline E2E).

Backend regression after this update: 420 pass, same 5 already-explained
Category 2/3 failures, zero new ones. Pre-existing uncommitted work
reconfirmed untouched.

## Research sources collected

See `docs/OPENGYM_RESEARCH_SOURCES.md`.

## Important architectural decisions

See `docs/TRAINING_PROGRESSION_ARCHITECTURE.md` (deterministic-vs-AI split,
cycle/exercise precedence, exercise logging-mode model, bodyweight semantics).

## Deferred work (explicit, not silently dropped)

- AI-service wiring of the new structured progression payload (designed, not
  implemented — avoids compounding the pre-existing dirty ai-service files).
- Superset support (P1 per the task's own priority scheme — real UI/data-model
  scope, not started).
- Import (Strong/Hevy/FitNotes/Apple Health) — P2, not started.
- Muscle-group maps, activity heatmap — P2, not started.
- Offline-first draft/retry beyond what already exists — audited, documented,
  not built (see gap analysis).
