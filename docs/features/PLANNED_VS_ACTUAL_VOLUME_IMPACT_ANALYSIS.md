# Planned vs Actual Training Volume — Impact Analysis

Date: 2026-08-27. Roadmap: P3.5 "Planned vs actual training volume" (§25).

## Why

§25: "Use current program/cycle plan and completed sessions." Explicit
warning: avoid oversimplified "volume = always kg × reps" across all
logging modes — weighted resistance can use volume/load metrics where
valid, timed/cardio/bodyweight need mode-appropriate metrics instead.

## Audit findings

- **`computeVolumeByWeek` (`training-cycle-metrics.service.ts`) already
  exists — and is EXACTLY the oversimplified pattern §25 warns against**:
  `if (s.weight == null || s.reps == null) continue;` skips every
  bodyweight/timed/distance set outright, only ever computing
  `weight × reps`. This function is used elsewhere (cycle report's
  training-load/monotony calcs, week-over-week volume delta) for a
  DIFFERENT, still-correct purpose (a weighted-resistance-only trend) —
  left completely unchanged; not reused for this new, properly
  mode-aware comparison.
- **The PLANNED side has a real, disclosed schema gap**:
  `WorkoutProgramExercise` has `sets`/`reps`/`weight`/`duration` — no
  `distance` column at all. A `DISTANCE_TIME` exercise (running, rowing)
  can never have a planned distance target in this schema today. Not
  worked around by guessing — `DISTANCE_TIME` exercises show actual
  distance only, with no planned counterpart, disclosed explicitly in
  both code and UI copy ("chưa có mục tiêu quãng đường").
- **`WorkoutSchedule.programDayId` + `WorkoutSchedule.workoutId`** (both
  already existing, optional columns) are exactly the link needed: for
  any completed session, the plan it was FOR (`programDayId` →
  `WorkoutProgramExercise[]`) and what was actually logged (`workoutId`
  → real `WorkoutSet` rows) are both one hop away — no new schema.
- **P3.3 Exercise Progress Charts already established the mode-gating
  convention this feature reuses**: pick the ONE metric a
  `loggingMode` supports, leave every other field `null`, never blend
  across modes. Same discipline applied here, at cycle-aggregate scope
  instead of per-session-trend scope.
- **This session's own P3.4 pass already extended `getCycleReport`
  additively once** (adherence breakdown) — same proven pattern reused
  again here: extend the one existing "what happened this cycle"
  endpoint rather than add a parallel one.

## Scope decisions

- **Comparison is plan-anchored, not actual-anchored**: only exercises
  that appear in `plannedOccurrences` are compared at all. An ad-hoc
  substitution the user logged that was never part of the plan has
  nothing to compare against and is excluded from this view entirely —
  matches §25's own "Use current program/cycle plan AND completed
  sessions" wording.
- **Scoped to COMPLETED/PARTIALLY_COMPLETED schedule rows only** (§25:
  "...and completed sessions") that have BOTH a real `programDayId` AND
  a real `workoutId` — a session with no plan link (manually created,
  outside any program) has nothing to compare and is skipped.
- **"Actual" is scoped to exactly those same sessions' own logged sets**
  — never the user's other, unrelated logged workouts for the same
  exercise elsewhere in the cycle — keeps every comparison apples-to-
  apples against what that specific planned session actually produced.
- **Per-mode metric selection, exactly one per exercise, chosen by its
  real `Exercise.loggingMode`**:
  - `REPS_LOAD` → volume (Σ weight × reps), kg.
  - `BODYWEIGHT_REPS` → reps (Σ reps).
  - `TIME` / `TIME_LOAD` → duration (Σ seconds). `TIME_LOAD`'s weight
    target is a real part of the plan but deliberately NOT folded into a
    "volume" number — weight × duration isn't an established training-
    volume metric the way weight × reps is; disclosed simplification.
  - `DISTANCE_TIME` → actual distance only (schema gap above).
- **Cycle-wide totals are summed per-mode-category independently**
  (`totalPlannedVolumeKg`/`totalPlannedReps`/
  `totalPlannedDurationSeconds` are three SEPARATE running totals, never
  combined into one number) — a program mixing a barbell squat and a
  plank never produces one meaningless blended "volume."

## Affected models

None — pure aggregate read of existing `WorkoutProgramExercise`/
`WorkoutSchedule`/`Workout`/`WorkoutSet`/`Exercise` data.

## Affected services

- New `backend/services/fitness-service/src/utils/planned-vs-actual.util.ts`
  — pure `computePlannedVsActual`, `aggregateCyclePlannedVsActual`.
- `training-cycle.service.ts`: new module-level async
  `buildPlannedVsActualInputs` (2 batched queries, no N+1); `getCycleReport`
  gains a top-level `plannedVsActual: { byExercise, totals }`.

## Affected frontend

`TrainingCyclePage.tsx`'s `CycleReportModal` gains a new "Kế hoạch so
với thực tế" section (only rendered when there's at least one comparable
exercise) — a cycle-wide volume-adherence line plus a per-exercise list,
each row formatted by its own mode (`formatPlannedVsActualLine`). New
`data-testid`s: `planned-vs-actual-section`,
`planned-vs-actual-volume-pct`, `planned-vs-actual-row-{exerciseId}`.

## Domain invariants

- Only plan-anchored exercises appear — an ad-hoc logged exercise never
  shows up here (it has nothing to be compared against).
- A metric is `null`, never a fabricated `0`, when that exercise's mode
  doesn't support it (e.g. `plannedReps` is always `null` for a
  `REPS_LOAD` exercise).
- Cycle totals are `null`, never `0`, when nothing of that category was
  ever planned this cycle — distinct from a real `0` (planned but never
  logged).
- Every per-mode total is summed independently — never blended across
  modes into one number.

## Migration risk

None — no schema change.

## Test plan

Unit: `computePlannedVsActual`/`aggregateCyclePlannedVsActual` — each of
the 5 logging modes' metric selection independently, an ad-hoc
unplanned exercise excluded, a planned-but-never-logged exercise still
appears with real `0` actual, multi-session summation, per-mode totals
never blended, `volumeAdherencePct`'s formula, all-null on an empty
cycle.

Backend integration: `getCycleReport` against a real seeded program day
(REPS_LOAD + BODYWEIGHT_REPS exercises) and a real completed matching
workout — proves the real DB join (`programDayId`/`workoutId`) produces
correct mode-gated per-exercise and cycle-total numbers.

Browser E2E: a real seeded program day + completed session, opened
through the real existing report-modal UI flow, shows the real
mode-aware planned-vs-actual section with the correct numbers.

## Verified results

**Unit** (`planned-vs-actual.util.test.ts`) — 11/11 passing.

**Backend integration** (`planned-vs-actual.integration.test.ts`, against
`gymcoach_fitness_test`, real seeded REPS_LOAD exercise + a real created
BODYWEIGHT_REPS exercise) — 1/1 passing: a real program day (Barbell
Curl 3×10×40kg planned, a bodyweight pull-up 3×12 planned) and a real
completed workout (Barbell Curl 2×8@42.5kg, pull-up 1×10 actual)
correctly yield `plannedVolumeKg:1200/actualVolumeKg:680` for the
REPS_LOAD exercise and `plannedReps:36/actualReps:10` for the
BODYWEIGHT_REPS one — cross-mode fields (`plannedReps` on the REPS_LOAD
row, `plannedVolumeKg` on the BODYWEIGHT_REPS row) both correctly
`null`. Cycle totals correctly kept the two categories separate.
`npx tsc --noEmit` clean (backend). Frontend `npm run build` clean.

**Browser E2E**
(`tests/51-planned-vs-actual-volume.spec.ts`) — 1/1 passing: a real
seeded program day + completed session, opened through the actual
`CycleHistoryRow` → `CycleReportModal` UI flow, shows the real
"Kế hoạch so với thực tế" section with the correct 680/1200kg (57%)
volume line and per-exercise row.

**Regression**: `tests/13-training-cycle-fixes.spec.ts` (2/2) +
`tests/50-training-cycle-adherence-breakdown.spec.ts` (1/1, P3.4's own
spec — both extend the same `getCycleReport`/`CycleReportModal`) — 3/3
still passing.
