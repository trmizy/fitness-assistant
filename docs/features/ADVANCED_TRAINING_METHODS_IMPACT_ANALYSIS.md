# Advanced Training Methods Impact Analysis

Date: 2026-08-28

## Status

AUDIT COMPLETE / FIRST SLICE IMPLEMENTED.

This pass starts after P0-P4 web/backend roadmap closure. It does not restart
the OpenGym roadmap and does not redesign the deterministic progression or
training-cycle engines.

## Domain Layers

| Layer | Meaning | Examples | Current code home |
|---|---|---|---|
| Exercise grouping | Exercise execution structure and group rest | `SUPERSET`, `TRISET`, `CIRCUIT` | `WorkoutProgramExerciseGroup`, `WorkoutProgramExerciseGroupMember` |
| Set technique | How an individual set or set-chain was performed | `WARMUP`, `WORKING`, `TOP`, `BACKOFF`, `FAILURE`, tempo, `DROP_SET`, `REST_PAUSE` | `WorkoutSet` main effort plus ordered `WorkoutSetSegment` mini-efforts |
| Set prescription | Target values/instructions for a set | reps, load, RPE, RIR, AMRAP, tempo, rest, duration, distance | `WorkoutProgramExerciseSetPrescription` planned rows; `WorkoutSet` actuals |
| Programming strategy | Program/session/cycle-level strategy | high volume, strength, hypertrophy, density | program/cycle analytics and coach context; not a set type |

## Current Superset State

Verified from current code:

- Schema supports group rows and group members without touching historical
  `WorkoutExercise` or `WorkoutSet` rows.
- Backend has `createExerciseGroup` and `ungroupExercises`.
- Planning UI supports multi-select grouping in `WorkoutLogPage.tsx`.
- Active UI shows a group badge.
- Rest logic now uses the existing group rest fields for both sequential and
  interleaved movement.
- Execution is true interleaved for grouped exercises in the active workout:
  A1 -> B1 -> A2 -> B2 for a 2x2 superset, and A1 -> B1 -> C1 -> A2 for a
  3-member triset. A 4-member circuit is also verified through the same
  active-session planner.

Classification:

| Capability | Status |
|---|---|
| Superset grouping data model | PASS |
| Superset planning UI | PASS |
| Superset active badge/rest semantics | PASS |
| True interleaved superset execution | PASS |
| True interleaved triset execution | PASS |
| True interleaved circuit execution | PASS |

## Set-Technique Audit

`WorkoutSet.setType` currently accepts `WARMUP`, `WORKING`, `TOP`, `BACKOFF`,
and `FAILURE` through `fitness.models.ts`. `WorkoutSet` also has actual
`rpe`, `rir`, `tempo`, `rangeOfMotion`, `side`, `painScore`, and
`techniqueNotes`.

This is real schema/API support, but it is not automatically full product
support for every method:

| Technique | Current evidence | Status |
|---|---|---|
| Straight sets | Normal workout sets and set-by-set table | COMPLETE |
| Warm-up | `setType=WARMUP`, excluded from PR/e1RM/heatmap metrics, selectable in active UI | COMPLETE for actual logging |
| Working | default/null or `WORKING` set semantics, selectable in active UI | COMPLETE for actual logging |
| Top set | schema/API/import fixture support, selectable in active UI | COMPLETE for actual logging |
| Back-off | schema/API/import fixture support, selectable in active UI | COMPLETE for actual logging |
| Failure | schema/API/import support, selectable in active UI | COMPLETE for actual logging |
| Drop set | ordered `WorkoutSetSegment` actuals under one main `WorkoutSet`; active editor + draft/offline payload | COMPLETE for actual logging; chain-specific volume semantics remain explicit follow-up |
| Rest-pause | ordered `WorkoutSetSegment` actuals under one main `WorkoutSet`; active editor + draft/offline payload | COMPLETE for actual logging; chain-specific volume semantics remain explicit follow-up |
| AMRAP | planned intent is snapshotted to actual history; active UI captures achieved reps; `AMRAP_READINESS` compares actual to minimum and respects cycle precedence | COMPLETE for capture + deterministic progression |
| RPE/RIR | per-set actual fields, active controls, and planned-set target fields exist | COMPLETE for actual logging + data foundation; advanced editor UX remains deferred |
| Tempo | actual `WorkoutSet.tempo` exists, active UI validates four-part notation and planned-set target tempo exists | COMPLETE for actual logging + data foundation; advanced editor UX remains deferred |
| High volume | analytics can count working sets/volume | PARTIAL: strategy analytics foundation, no explicit program strategy UX |

## Highest-Value Safe Gap

True interleaved superset execution was the safest first implementation and is
now complete:

- It reuses existing group schema.
- It does not require a schema migration.
- It does not duplicate `WorkoutSet` rows.
- It keeps progression and PR per exercise.
- It can reuse the existing `updateSet` / completion primitives.
- It directly upgrades an already-user-facing feature from "grouped but
  sequential" to real round-based execution.

## Design

Introduce a pure active-session navigation planner that orders visible
exercise/set steps by:

1. ungrouped exercises: current sequential behavior;
2. grouped exercises: round-major order, then member order;
3. uneven set counts: skip members that have no set in that round.

Example with Bench 3 sets + Row 4 sets:

```text
Bench 1 -> Row 1 -> group rest
Bench 2 -> Row 2 -> group rest
Bench 3 -> Row 3 -> group rest
Row 4
```

The planner should return the current step, next step, group round labels, and
rest reason. UI can keep `activeExIdx` as compatibility state while deriving
the active set/exercise from the planner.

## Guardrails

- Progression remains per exercise and keeps the cycle envelope.
- PR remains per exercise.
- Warm-ups remain excluded where current metrics already exclude them.
- Offline queue/idempotency must keep using existing set IDs and event IDs.
- No API cache or PWA behavior changes are needed unless new mutation paths are
  introduced; this pass should avoid new mutation paths.
- Existing PR/progression/working-set metrics intentionally continue to read
  the main `WorkoutSet` only. Segment contribution must be introduced by a
  separately tested metric policy, never as an accidental join side effect.

## Verification

- Pure planner unit coverage: 13/13 pass.
- Active draft / smart prefill / planner utility bundle: 42/42 pass.
- Frontend build: pass.
- New real-browser E2E: `55-true-interleaved-superset.spec.ts`, 1/1 pass in
  run `e2e_202608280752400`.
- Triset real-browser E2E: `56-true-interleaved-triset.spec.ts`, 1/1 pass in
  run `e2e_202608281618205`.
- Circuit real-browser E2E: `57-true-interleaved-circuit.spec.ts`, 1/1 pass in
  run `e2e_202608281621205`.
- Basic set-type active logging: `55-true-interleaved-superset.spec.ts`
  re-run with a `WARMUP` selection and DB assertion, 1/1 pass in run
  `e2e_202608281626382`.
- Basic tempo active logging: `55-true-interleaved-superset.spec.ts`
  re-run with a `3-1-1-0` entry and DB assertion, 1/1 pass in run
  `e2e_202608281641130`.
- Per-set prescription foundation: `set-prescriptions.integration.test.ts`,
  1/1 pass against `gymcoach_fitness_test`; `fitness-service` TypeScript
  passed.
- Active AMRAP capture is covered by the same planned-set data path plus
  frontend build/type transformation; it reuses the existing `updateSet`
  completion mutation.
- Existing superset/grouping E2E regression: `38-superset-exercise-grouping.spec.ts`,
  2/2 pass in run `e2e_202608280751230`.
- Post set-type UI grouped-flow E2E bundle:
  `38-superset-exercise-grouping.spec.ts`,
  `56-true-interleaved-triset.spec.ts`, and
  `57-true-interleaved-circuit.spec.ts`, 4/4 pass in run
  `e2e_202608281630265`.

## Implementation Report

See `docs/ADVANCED_TRAINING_METHODS_IMPLEMENTATION_REPORT.md`.
