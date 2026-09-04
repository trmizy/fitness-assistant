# Advanced Training Methods Roadmap

Date: 2026-08-28

## Scope

This roadmap starts after the OpenGym-inspired P0-P4 web/backend roadmap is
closed. It is a separate training-depth track, not a restart of P0-P4.

## Classification

| Layer | Product meaning | Current status |
|---|---|---|
| Exercise grouping | Multi-exercise execution structure (`SUPERSET`, `TRISET`, `CIRCUIT`) | Superset, triset, and circuit are now true interleaved for active workout execution |
| Set technique | How a set or set-chain is performed (`WARMUP`, `TOP`, `BACKOFF`, `DROP`, `REST_PAUSE`) | Basic set types, tempo, and actual drop-set/rest-pause chains are implemented |
| Set prescription | Per-set targets for reps/load/RPE/RIR/tempo/duration/distance | Planned-set model, manual-program API input, start-session materialization, and active table display are implemented; advanced editors remain follow-up |
| Programming strategy | Higher-level training intent (high-volume, hypertrophy, strength, density) | Analytics foundations exist; explicit strategy UX remains deferred |

## Completed

### ATM-1: True Interleaved Superset Execution

Status: DONE.

The active workout now follows round-major group order for grouped exercises:

```text
A1 -> B1 -> rest after round
A2 -> B2 -> rest after round
```

For uneven set counts, the planner skips missing member sets instead of
inventing rows:

```text
A1 -> B1
A2 -> B2
A3 -> B3
B4
```

Implemented with a pure planner in `exercise-group.utils.ts`, reusing existing
`WorkoutSet` IDs and existing `updateSet` mutation paths. No schema migration
or backend API change was required.

### ATM-2: True Interleaved Triset Execution

Status: DONE.

The existing grouping UI already derives type from selected member count
(`2=SUPERSET`, `3=TRISET`, `4+=CIRCUIT`). The active-session planner now has
unit coverage for three-member round-major order and real-browser coverage for:

```text
A1 -> B1 -> C1 -> A2
```

The browser test proves the group is persisted as `TRISET:3`, the badge shows
`Triset`, member position, and round, and rest timing remains short within the
round and long after the round.

### ATM-3: True Interleaved Circuit Execution

Status: DONE.

The same grouped-exercise planner and UI creation path now has browser proof
for 4-member circuits. Selecting four exercises persists `CIRCUIT:4`, shows a
`Circuit` active badge, and advances:

```text
A1 -> B1 -> C1 -> D1 -> A2
```

Rest remains short within the round and long after the round.

### ATM-4: Per-Row Basic Set-Type Editing

Status: DONE.

The active set form now exposes the existing basic `WorkoutSet.setType` values:

```text
WARMUP, WORKING, TOP, BACKOFF, FAILURE
```

This is an actual performed-set field, not a planned prescription system. The
field is saved through the existing `updateSet` path, preserved in session
draft recovery, and verified by browser coverage that selects `WARMUP` for a
real set and confirms `workout_sets.set_type = 'WARMUP'` in Postgres.

### ATM-5: Active Tempo Logging UX

Status: DONE.

The active set form now exposes `WorkoutSet.tempo` as a structured actual
logging input using the common four-part notation:

```text
eccentric-pause-concentric-pause
3-1-1-0
```

Empty remains valid and preserves the previous behavior. Non-empty values are
validated in the active UI before completion, saved through the existing
`updateSet` path, preserved in session draft recovery, and verified by browser
coverage that confirms `workout_sets.tempo = '3-1-1-0'` in Postgres.

### ATM-6: Per-Set Prescription Foundation

Status: DONE for data/API/materialization/display.

The fitness service now has a planned-set model beside
`WorkoutProgramExercise`:

```text
WorkoutProgramExerciseSetPrescription
```

It stores per-set planned reps, load, RPE/RIR, set type, tempo, duration,
distance, rest, notes, and AMRAP/min-rep intent. Existing programs are
backfilled from exercise-level `sets/reps/weight/restSeconds`, while newly
created manual programs can provide explicit `setPrescriptions`.

When a schedule starts, the `WorkoutSet` skeleton is created from these
planned rows. Actual updates still write only `WorkoutSet`, and do not mutate
the plan. The active set table now prefers planned-set labels over the
coarser exercise-level/progression fallback.

Verified with a real Postgres integration test: create manual program with
warm-up/top/backoff planned sets, start the schedule, confirm the skeleton
matches those planned values, then update the actual set and confirm the
planned row remains unchanged.

### ATM-7: Active AMRAP Capture

Status: DONE for active UX and completion payload.

Planned AMRAP rows (`isAmrap=true`) now expose the reps control during active
workout completion even for load-based exercises. The draft defaults to the
planned minimum/target reps, but the user records the achieved reps into the
actual `WorkoutSet.reps` field. This keeps the planned row immutable and lets
the active log distinguish "minimum prescription" from "actual achieved".

### ATM-8: Drop Set / Rest-Pause Chains

Status: DONE for actual data, API, active UX, draft/offline persistence.

`WorkoutSet` remains the main effort and stable completion/idempotency unit.
Each subsequent mini-effort is stored as an ordered `WorkoutSetSegment` with
technique (`DROP_SET` or `REST_PAUSE`), actual reps, load, RPE/RIR, pause,
and notes. This prevents a drop chain from inflating planned set counts or
silently entering existing PR/progression calculations as sibling sets.

The active workout exposes a three-mode segmented control (`Straight`,
`Drop set`, `Rest-pause`) and an ordered mini-effort editor. Chain payloads
travel through the existing `updateSet` transaction, offline event queue, and
active draft recovery. Omitting `segments` preserves an existing chain;
sending an explicit array atomically replaces it, and `[]` returns the set to
straight-set semantics.

Verified against real Postgres: create a two-effort drop chain, update only a
parent-set field and confirm the chain remains, replace it with rest-pause,
then explicitly clear it. Existing per-set completion and idempotency tests
remain green.

### ATM-9: AMRAP Progression Semantics

Status: DONE for deterministic progression and active explanation.

AMRAP intent is copied from the planned prescription into immutable actual
history (`WorkoutSet.isAmrap`, `WorkoutSet.amrapMinReps`) when a session is
materialized. Later program edits therefore cannot rewrite why a historical
set was performed.

The pure exercise engine now applies `AMRAP_READINESS` only to reps-based
logging modes:

```text
achieved < minimum, once       -> KEEP and repeat
achieved < minimum, 2 sessions -> DELOAD
minimum to minimum + 1         -> KEEP
minimum + 2 or more            -> INCREASE_LOAD
bodyweight minimum + 2 or more -> INCREASE_REPS (minimum + 1)
```

RIR 0 on a real AMRAP is expected and is not counted as a failed straight
set. With multiple AMRAP probes in one session, every probe must clear the
two-rep readiness margin before an automatic increase is allowed. The cycle
envelope remains authoritative: `DELOAD` overrides locally and `REBUILD`
blocks automatic increases. The API/UI expose achieved reps, minimum reps,
and margin so the decision remains auditable without AI.

## Next Candidates

| Priority | Item | Why next | Required design decision |
|---|---|---|---|
| ATM-10 | Strategy labeling | High-volume/density blocks are programming strategy, not set type | Program/cycle-level strategy field and coach context contract |
| ATM-11 | Advanced prescription editor | Data/API exist, but planners need ergonomic per-set editing | Where PT/client edit rights and validation should live |
| ATM-12 | Chain-aware analytics | Drop/rest-pause actuals exist but current volume metrics intentionally read parent sets only | Which segment metrics affect volume, fatigue, and coach context without changing PR semantics |

## Guardrails

- Progression and PRs remain per exercise.
- Warm-ups remain excluded from PR/e1RM/heatmap scoring.
- LLMs may explain deterministic outputs, never overwrite them.
- Offline queue and idempotency keep using existing set IDs.
- Do not mark native Apple Health/Health Connect as done without native
  platform verification.
