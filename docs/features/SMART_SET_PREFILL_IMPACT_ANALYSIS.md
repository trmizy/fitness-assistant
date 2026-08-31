# Smart Set Prefill Impact Analysis

Date: 2026-08-24

## Problem

The P0 workout layer correctly separates historical previous performance from
deterministic progression targets, but active logging still requires users to
manually re-enter values that the system already knows. This creates avoidable
friction during a gym session, especially on mobile.

## Current FA Behavior

- `WorkoutLogPage.tsx` shows previous-performance and deterministic
  progression cards as read-only context.
- Active exercise input state is initialized blank/default per exercise.
- A set is only persisted when the user explicitly completes an exercise/set
  through existing schedule/workout APIs.
- P0 logging modes are already supported: `REPS_LOAD`, `BODYWEIGHT_REPS`,
  `TIME`, `TIME_LOAD`, and `DISTANCE_TIME`.

## Desired Behavior

Prefill editable draft inputs using the safest available source:

1. deterministic `nextTarget`, when it is actionable and data quality is
   sufficient;
2. previous actual performance, when deterministic data is insufficient or in
   review-only states;
3. program prescription defaults;
4. blank/default input.

Prefill must never mark a set completed. Persisted actuals remain whatever the
user explicitly saves, including user edits to the prefilled values.

## openGym Behavior Reference

openGym is useful as a product reference for reducing repeated data entry by
showing/prefilling prior workout values. Fitness Assistant must not copy
openGym source, component structure, constants, schemas, or tests. This
implementation will reuse Fitness Assistant's own progression and
previous-performance endpoints.

## What We Will NOT Copy

- No openGym code, schemas, UI components, CSS, constants, or tests.
- No alternate progression/recommendation engine.
- No silent completion of sets based on prefilled values.
- No bodyweight inference from InBody or unrelated measurements.
- No AI override of deterministic progression targets.

## Domain Invariants

- `Previous` is historical fact.
- `Recommended` is deterministic guidance.
- `Input` is an editable draft.
- `Completed set` is a persisted actual.
- Prefill may initialize input state, but never changes completion state.
- User edits override prefill.
- Cycle `DELOAD`/`REBUILD` envelopes remain authoritative because they are
  already baked into the progression endpoint.
- Safety/cycle review states should not create aggressive automatic input
  bumps; they may fall back to previous actual or prescription defaults.

## Affected Models

No schema migration is expected for the first implementation. Existing fields
are sufficient:

- `WorkoutSet.weight`
- `WorkoutSet.reps`
- `WorkoutSet.bodyWeightAtSetKg`
- `WorkoutSet.durationSeconds`
- `WorkoutSet.distanceMeters`
- `WorkoutSet.completed`
- `Exercise.loggingMode`

## Affected Services

Prefer existing service contracts:

- `GET /workouts/exercises/:exerciseId/previous-performance`
- `GET /workouts/exercises/:exerciseId/progression`
- existing schedule completion/update APIs

Do not add a combined active-workout context endpoint unless measured request
cost shows the current per-exercise calls are a real problem.

## Affected Frontend Pages

Primary:

- `frontend/web/src/app/pages/client/WorkoutLogPage.tsx`

Likely helper extraction:

- a small pure prefill-selection utility near workout-log utilities/tests if
  the logic becomes non-trivial enough to test independently.

## Affected AI Context

None required for initial smart prefill. AI explanation wiring remains
non-authoritative. Prefill source should be deterministic and inspectable
without AI.

## Affected Cycle / Adherence Logic

No direct changes. Prefill only changes draft input initialization. Completion,
schedule progress, adherence, cycle metrics, PRs, and progression history must
continue to derive from persisted completed sets.

## Migration Risk

Low if implemented as frontend draft initialization only. Risk rises if the
implementation attempts to create new backend recommendation state or silently
persists prefilled values before explicit completion.

## Backward Compatibility

Existing workouts, schedules, and incomplete active sessions must continue to
load. Missing progression/previous-performance data must degrade to existing
blank/default behavior.

## Security / Privacy

No new persisted client storage of health history is required. Do not store
more than current active input state in browser storage during this phase.

## Failure Modes

- Progression fetch fails: fall back to previous performance or prescription.
- Previous-performance fetch fails: fall back to prescription/default.
- Both fetches fail: keep current behavior.
- User has already edited a field: never overwrite it when async context
  arrives later.
- Exercise changes: prefill only the active exercise's empty draft state.
- Logging mode mismatch: ignore incompatible values instead of mapping them
  into unrelated fields.
- `INSUFFICIENT_DATA`, `REVIEW`, or cycle-driven `DELOAD`: do not turn the
  prefill into an unexplained aggressive increase.

## Test Plan

Unit or component-level pure logic:

- weighted `nextTarget` wins over previous value;
- bodyweight uses reps/load only, never inferred body weight;
- timed uses `durationSeconds`;
- `TIME_LOAD` uses weight + duration;
- `DISTANCE_TIME` uses distance + duration;
- `INSUFFICIENT_DATA` falls back to previous actual;
- user-edited fields are not overwritten by late async data.

Integration:

- saved actual reflects user-edited prefilled value;
- prefilled but uncompleted set is not saved as completed.

Browser E2E:

- weighted prefill;
- bodyweight prefill;
- timed prefill;
- distance/time prefill;
- deterministic target overrides previous actual where appropriate;
- `INSUFFICIENT_DATA` fallback;
- cycle `DELOAD` behavior;
- user edits prefilled value and saved actual matches the edit;
- prefilled uncompleted values never mark a set completed.

Use the stable active-workout opener from the P0 stabilization pass.

## Rollout Strategy

Implement as an additive active-workout UI enhancement. Keep all old logging
paths valid. Start with current active exercise draft prefill, then consider
multi-set table polish and undo-last-set under P1-A only after this behavior
is stable.

## Initial Verdict

Proceed with P1.1 implementation. The lowest-risk path is a pure,
mode-aware prefill selector plus frontend integration that only initializes
empty draft inputs and never marks completion.
