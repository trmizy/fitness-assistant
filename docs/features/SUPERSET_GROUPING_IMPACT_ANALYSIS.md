# Superset / Exercise Grouping — Impact Analysis

Date: 2026-08-24. Roadmap: P1.3 "Superset / exercise grouping".

## Why

Supersets are common and affect exercise navigation, rest behavior,
workout order, and active-session UX. Must not be represented with string
hacks or a boolean given the domain needs future extensibility (STRAIGHT/
SUPERSET/TRISET/CIRCUIT).

## Scope decision (confirmed with the user before implementing)

The roadmap's own schema sketch has two distinct rest fields
(`restBetweenExercisesSeconds`, `restAfterRoundSeconds`), which only makes
sense for TRUE interleaved round-robin navigation (Set 1 of A → Set 1 of B
→ short rest → Set 2 of A → Set 2 of B → real rest → ...). Building that
faithfully means restructuring the active-session set-sequencing state
machine a SECOND time this session (the first being roadmap P1.1's
set-by-set table UI, already a large change). Given the session's
accumulated blast radius, the user explicitly chose the lower-risk,
still-real-value option instead:

**This pass ships**: exercises in a group complete SEQUENTIALLY (all of
exercise A's sets, in the exact per-set flow P1.1 already built, before
moving to exercise B) — but with the CORRECT rest durations: the group's
own `restBetweenExercisesSeconds` when advancing from one group member to
the next, and `restAfterRoundSeconds` once the LAST member of the group
finishes. Visual grouping (badge, paired display) ships fully. True
interleaved per-set round-robin navigation is explicitly deferred — noted
below as a scoped-out follow-up, not a silently-dropped requirement.

## Audit findings

- **Progression stays per-exercise already** — the roadmap's own stated
  invariant. Nothing to change: `exercise-progression.engine.ts` operates
  per `exerciseId`/`programExerciseId` with no concept of "what else this
  session's exercise was paired with." Grouping is purely a
  presentation/sequencing concern layered on top.
- **Grouping only needs to exist at the PROGRAM-DAY level.** Every
  completion/undo/prefill/rest-timer mechanism P1.1 and P1.6 built is
  already keyed by `programExerciseId` (or the specific `WorkoutSet.id`),
  independent of any grouping. The active session can derive "is this
  exercise part of a group, and which members" by joining against the
  program day's group definitions (already fetched via
  `schedule.programDay`) — no new column needed on `WorkoutExercise` or
  `WorkoutSet`, no migration risk to logged history.
- **`WorkoutProgramExercise.restSeconds` already exists but is NEVER READ**
  by the active-session rest timer — every completion path hardcodes
  `setRestSeconds(90)`. Pre-existing gap, NOT fixed by this pass (out of
  scope — this pass only wires the NEW group-specific rest fields into the
  transitions between/after group members; every other transition keeps
  today's unchanged hardcoded-90 behavior). Flagged here so a future pass
  doesn't have to rediscover it.
- **Day-detail "edit exercises" mode already has a real drag-reorder UI**
  (`editMode`/`editExercises`, `WorkoutLogPage.tsx`) — the natural existing
  place to add "select 2+ exercises → group as superset," rather than the
  separate initial-program-creation builder.
- **`createStartedWorkoutForSchedule` reads `schedule.programDay.exercises`
  fresh at session-start time** — grouping info fetched fresh alongside it
  (via a new `programDay.exerciseGroups` relation) needs no synchronization
  step; editing a group after a session already started is naturally
  reflected on the next page load, exactly like any other program edit.

## Data model

```prisma
model WorkoutProgramExerciseGroup {
  id                          String   @id @default(uuid())
  programDayId                String
  type                        String   // SUPERSET | TRISET | CIRCUIT
  order                       Int      @default(0)
  restBetweenExercisesSeconds Int?     // short/no rest between members
  restAfterRoundSeconds       Int?     // real rest after finishing every member once
  createdAt/updatedAt

  programDay WorkoutProgramDay
  members    WorkoutProgramExerciseGroupMember[]
}

model WorkoutProgramExerciseGroupMember {
  id                String @id @default(uuid())
  groupId           String
  programExerciseId String @unique // at most ONE group per program exercise
  order             Int    @default(0) // sequence within the group (A, B, C...)

  group           WorkoutProgramExerciseGroup
  programExercise WorkoutProgramExercise
}
```

`programExerciseId @unique` on the member table is the enforcement
mechanism for "an exercise can only be in one group" — a DB constraint,
not just app-layer validation.

## Contiguity invariant (why creating a group reorders exercises)

The active-session "is the NEXT exercise a fellow group member" check
(needed to pick the right rest duration) is only simple and reliable if
group members are ADJACENT in the day's exercise order — otherwise
"next" would need to search past unrelated exercises. Rather than build
that search (and rather than depend on the pre-existing drag-reorder UI
being used correctly beforehand), `createExerciseGroup` itself
re-sequences the day: the selected members are extracted and reinserted as
a contiguous block at the position of the earliest one (in the order the
caller selected them), and every other exercise's `order` shifts to close
the gap. This guarantees the invariant by construction regardless of what
order they started in.

## Affected models

`fitness-service`: 2 new tables (above). Additive migration.

## Affected services

`fitness-service`: `createExerciseGroup`, `ungroupExercises`,
`updateExerciseGroup` (rest-duration edits) in `workout.service.ts`. New
routes under `/workouts/program-days/:id/exercise-groups`.
`listSchedules`/`getCurrentProgram`'s existing `programDay` include gains
`exerciseGroups: { include: { members: true } }`.

## Affected frontend

`WorkoutLogPage.tsx`: multi-select + "Nhóm thành Superset" action in the
existing day-edit mode; a `groupId`/`groupType`/`groupOrder` +
`restBetweenExercisesSeconds`/`restAfterRoundSeconds` tag attached to each
`dayExercises[]` entry (derived from the fetched `exerciseGroups`, matching
how set-by-set metadata is already attached); a visual "Superset A1/A2"
badge in both the edit list and the active-session header/mini-nav; the
rest-duration computation (pure, testable) used at every "advance to next
exercise" call site that currently hardcodes 90.

## Domain invariants

- A group requires ≥2 members (a "group" of 1 isn't a group).
- All members of a group must belong to the SAME program day.
- An exercise can be in at most one group (DB-enforced).
- Deleting/ungrouping never deletes the underlying `WorkoutProgramExercise`
  rows, only the group/membership records.
- Grouping never touches `WorkoutExercise`/`WorkoutSet` or any already-
  logged history — purely a program-day planning concept.

## What we will NOT do in this pass (deliberate MVP boundary)

- **Not** true interleaved per-set round-robin navigation (Set 1 A → Set 1
  B → ... ) — confirmed with the user, see "Scope decision" above.
- **Not** fixing the pre-existing `WorkoutProgramExercise.restSeconds`
  being unread by the timer for NON-grouped exercises.
- **Not** touching the initial manual-program-creation builder
  (`showManualBuilder`) — grouping is only offered via the existing
  day-edit mode, which already has the exercises to select from.
- **Not** a CIRCUIT-specific "rounds" counter distinct from each member's
  own `sets` — each member's existing `sets` field is what determines how
  many times the group repeats; not enforced equal across members (a
  future refinement, not required here).

## Test plan

Backend integration: create a group re-sequences the day's exercise order
correctly (contiguous block); rejects <2 members, cross-day members, an
exercise already in another group; ungroup removes the group without
touching the exercises; `GET` program/schedule payloads include the group
data.

Unit: a pure `computeNextRestSeconds` (or similar) function — same
exercise's own sets always default duration; same-group next member uses
`restBetweenExercisesSeconds`; last member of a group uses
`restAfterRoundSeconds`; ungrouped uses the existing default.

Browser E2E: build a 2-exercise superset via the day-edit mode, start the
session, complete exercise A (all its sets) — rest timer shows the SHORT
group duration, badge shows "A1/A2" pairing — complete exercise B — rest
timer shows the LONG after-round duration; DB confirms both completed
independently with their own values (same isolation P1.1 already proved,
now also true across a group boundary).

## Verified results (2026-08-25)

Backend integration (`gymcoach_fitness_test`,
`exercise-group.integration.test.ts`) — 4/4 pass: contiguity re-sequencing
(grouping two NON-adjacent exercises correctly extracts and reinserts them
as a block, shifting everything else), validation (<2 members, cross-day
member, already-grouped member all rejected), ungroup (removes only the
group/membership rows, exercise order untouched), and the fetch shape
(`getCurrentProgram` includes `exerciseGroups` with members). Pre-existing
`schedule-lock.integration.test.ts` + `reschedule-schedule.integration.test.ts`
— 18/18 unaffected. `tsc --noEmit` clean.

Unit (`exercise-group.utils.test.ts`, the pure rest-duration function) —
7/7 pass: ungrouped always default; fellow-group-member advance uses
`restBetweenExercisesSeconds`; last-member advance (to ungrouped, to a
DIFFERENT group, or to nothing) uses `restAfterRoundSeconds`; null group
rest fields fall back to the default; null/undefined current exercise
treated as ungrouped. `npm run build` clean.

Browser E2E (`38-superset-exercise-grouping.spec.ts`) — 2/2 pass on first
real attempt (after fixing two test-fixture issues unrelated to
application code: a non-existent catalog exercise name, and an ambiguous
`getByRole('button', { name: 'Sửa' })` locator matching two buttons).
Proves, end to end: grouping two exercises via the day-edit mode persists
correctly (type, both rest fields, member count); the active-session badge
shows "Superset · Bài 1/2" then "2/2"; advancing A→B (fellow group member)
uses the configured SHORT rest; advancing B→C (group's last member, C
ungrouped) uses the configured LONG after-round rest and the badge
disappears for C; ungrouping deletes the group row and reverts rest timing
to the plain default (90s).

Targeted regression re-run (specs 35, 36, 37 — the ones sharing the most
state with this pass's `handleCompleteExercise`/`handleCompletePerSetRow`
rest-timer call sites): 4/5 pass. `36-set-by-set-table-ui.spec.ts`'s first
test failed mid-run (set 2 of 3 never completing on click) — but this
exercise was never grouped, so `computeNextExerciseRestSeconds` returns
the unchanged default-90 for it and this pass's two edited call sites
(both gated on `groupId`) are architecturally inert here. Checked
`RateLimit-Remaining` on the gateway's `/auth/*` limiter immediately after:
`1`, then `0` after the check itself — this run's own 5 tests plus
earlier probes today had nearly exhausted the 20-req/15-min budget from
the cumulative E2E volume across three milestones in one very long
session. The same test has independently passed cleanly at least 3
separate times earlier today under normal conditions (undo-last-set's own
regression, and twice during the reschedule work's regression passes).
Root-caused as rate-limit pressure, not a code defect from this pass;
never weakened the limiter. Waited out the recovery window properly (one
`Retry-After` check, then a single passive 370s wait with zero further
probing — the first attempt at this had mistakenly polled the limiter
itself every 45s in a loop, which likely kept it pinned near zero; caught
and fixed before it wasted the whole window) and re-ran the **full
11-file bundle** (specs 27, 29–38) once the limiter showed 19/20
remaining: **33/33 pass**, including `36-set-by-set-table-ui.spec.ts`
clean this time — confirming the earlier failure really was rate-limit
pressure, not a regression from this pass. Global test-suite verdict:
`READY (FAIL=0, total=540)`.
