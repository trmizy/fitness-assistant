# Advanced Training Methods Implementation Report

Date: 2026-08-28

## Verdict

DONE for the first Advanced Training Methods slices: true interleaved
superset/triset/circuit execution, per-row basic set-type editing, active
tempo logging, the per-set prescription foundation, active AMRAP capture,
actual drop-set/rest-pause chain capture, and deterministic AMRAP progression.

This does not claim every advanced training method is complete. Chain-aware
volume policy, advanced
prescription editors, and programming-strategy labeling remain deliberately tracked in
`docs/ADVANCED_TRAINING_METHODS_ROADMAP.md`.

## What Changed

- Added a pure interleaved group planner in `frontend/web/src/app/pages/client/exercise-group.utils.ts`.
- Updated `WorkoutLogPage.tsx` so grouped exercises advance by set round, not
  by finishing all sets of one exercise first.
- Added round labels to the active group badge (`Round N/M`).
- Verified the already-present group type derivation (`2=SUPERSET`,
  `3=TRISET`, `4+=CIRCUIT`) for a real triset flow.
- Verified the same 4+ member path for a real circuit flow.
- Added active-workout set-type selection for the existing basic set types
  (`WARMUP`, `WORKING`, `TOP`, `BACKOFF`, `FAILURE`).
- Added active-workout tempo input with four-part notation validation
  (`3-1-1-0`) and persistence to `WorkoutSet.tempo`.
- Added `WorkoutProgramExerciseSetPrescription`, an additive planned-set
  model for per-set reps/load/RPE/RIR/set-type/tempo/duration/distance/rest
  and AMRAP/min-rep intent.
- Manual program creation now accepts `setPrescriptions`; omitted rows are
  filled from the existing exercise-level targets for backward compatibility.
- `startSchedule` materializes the workout-set skeleton from planned-set rows
  while actual set completion still writes only `WorkoutSet`.
- The active set table now displays planned-set labels before falling back to
  deterministic progression targets.
- Planned AMRAP sets now expose editable achieved reps in the active workout
  and send those actual reps through the existing per-set completion payload.
- Added ordered `WorkoutSetSegment` actuals for drop-set and rest-pause
  mini-efforts under one stable parent set.
- Added active chain-mode selection and mini-effort reps/load/pause editing;
  draft recovery and offline queued completion preserve the same payload.
- Snapshotted planned AMRAP intent onto actual `WorkoutSet` history and added
  deterministic `AMRAP_READINESS` decisions with auditable achieved/minimum/
  margin output. RIR 0 on AMRAP no longer behaves like a straight-set miss.
- Extended active draft persistence and the frontend `updateSet` type so
  `setType` and `tempo` survive reloads and reach the existing backend schema.
- Preserved existing sequential behavior for ungrouped exercises.
- Preserved existing `WorkoutSet` rows and `updateSet` mutation path.
- Added `data-testid="exercise-list-edit-button"` for stable browser coverage.
- Fixed a real rest-timer restart bug: starting a new rest while an old rest
  timer was still running now resets the wall-clock end timestamp.

## Behavior

For a 2x2 superset, active workout execution is now:

```text
Exercise A, set 1
Exercise B, set 1
Exercise A, set 2
Exercise B, set 2
```

For a 3-member triset, active workout execution follows the same planner:

```text
Exercise A, set 1
Exercise B, set 1
Exercise C, set 1
Exercise A, set 2
```

For a 4-member circuit, active workout execution follows:

```text
Exercise A, set 1
Exercise B, set 1
Exercise C, set 1
Exercise D, set 1
Exercise A, set 2
```

Rest uses the existing group fields:

- within a round: `restBetweenExercisesSeconds`;
- after the last member of a round: `restAfterRoundSeconds`;
- outside a group: unchanged default behavior.

## Data Safety

Grouping and active completion still read existing
`WorkoutProgramExerciseGroup` and `WorkoutProgramExerciseGroupMember` metadata
and complete existing `WorkoutSet` rows in place. ATM-6 adds one additive
planned-set prescription table. ATM-8 adds one additive actual-segment table
under `WorkoutSet`; chain replacement happens in the same transaction as the
parent update and does not mutate planned rows.

## Verification

| Check | Result |
|---|---|
| `npx tsx --test src/app/pages/client/__tests__/exercise-group.utils.test.ts` | 13/13 pass |
| `npx tsx --test src/app/pages/client/__tests__/active-log-draft.utils.test.ts src/app/pages/client/__tests__/smart-set-prefill.utils.test.ts src/app/pages/client/__tests__/exercise-group.utils.test.ts` | 42/42 pass |
| `npm run build` in `frontend/web` | pass |
| `npm run test:e2e -- tests/38-superset-exercise-grouping.spec.ts --workers=1` | 2/2 pass, run `e2e_202608280751230` |
| `npm run test:e2e -- tests/55-true-interleaved-superset.spec.ts --workers=1` | 1/1 pass, run `e2e_202608280752400` |
| `npm run test:e2e -- tests/55-true-interleaved-superset.spec.ts --workers=1` after set-type UI | 1/1 pass, run `e2e_202608281626382` |
| `npm run test:e2e -- tests/55-true-interleaved-superset.spec.ts --workers=1` after tempo UI | 1/1 pass, run `e2e_202608281641130` |
| `npm run test:e2e -- tests/56-true-interleaved-triset.spec.ts --workers=1` | 1/1 pass, run `e2e_202608281618205` |
| `npm run test:e2e -- tests/57-true-interleaved-circuit.spec.ts --workers=1` | 1/1 pass, run `e2e_202608281621205` |
| `npm run test:e2e -- tests/38-superset-exercise-grouping.spec.ts tests/56-true-interleaved-triset.spec.ts tests/57-true-interleaved-circuit.spec.ts --workers=1` after set-type UI | 4/4 pass, run `e2e_202608281630265` |
| `npx tsx --test src/__tests__/set-prescriptions.integration.test.ts` in `fitness-service` | 1/1 pass |
| AMRAP active capture UI/build verification | frontend utility bundle 42/42 pass; `npm run build` pass |
| Set-chain frontend utility bundle | 39/39 pass (chain + draft + offline + prefill) |
| Set-chain validation + per-set + prescription + idempotency integration bundle | 9/9 pass against `gymcoach_fitness_test` |
| `npx prisma validate --schema prisma/schema.prisma` | pass |
| `npx tsc --noEmit` in `fitness-service` | pass |
| Real-browser CLI snapshot: active `Drop set` mode and effort editor | pass; `output/playwright/atm-8-drop-set-active.png` |
| AMRAP engine + endpoint + prescription materialization bundle | 31/31 pass against `gymcoach_fitness_test` |

## Bugs Found

The prior rest timer used a stored wall-clock `endAt` timestamp, but when a new
rest was started while the previous rest timer was still running, only
`restSeconds` changed. The old `endAt` remained active, so the visible countdown
could keep following the previous rest interval. This was caught by the older
superset regression spec and fixed by introducing a shared `startRestTimer`
helper that resets `endAt` every time a rest begins.

During the per-set prescription pass, `updateProgramExercise` was also found to
accept load updates at the API/type layer but not persist `weight` in the
service patch. That would make future default set prescriptions inherit stale
exercise-level load. Fixed and covered in `set-prescriptions.integration.test.ts`.

## Remaining Advanced-Method Work

- Explicit chain-aware volume/analytics policy.
- Advanced per-set prescription editor UX.
- Explicit high-volume/density strategy labeling.
