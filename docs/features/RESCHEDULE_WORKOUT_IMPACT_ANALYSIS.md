# Reschedule Workout — Impact Analysis

Date: 2026-08-24. Roadmap: P1.2 "Reschedule workout".

## Why

Real users miss days. A reschedule feature must represent "same logical
planned workout → moved to another date", never "missed workout + brand
new duplicate workout" — because Fitness Assistant already has adherence,
training-cycle evaluation, schedule locks, progression history, and AI
context that a naive implementation (two rows, one superseded) can corrupt.

## Audit findings (the key architectural decision)

The roadmap's own "potential conceptual model" sketches a NEW
`logicalScheduleId` field with presumably a second row per reschedule. This
was written before auditing — the actual schema already makes that
unnecessary and, on reflection, worse:

- **`WorkoutSchedule` has `@@unique([userId, date])`** — a user can only
  ever have ONE schedule row per calendar date, period. There is no
  "stack two rows for one logical session" architecture possible under
  this constraint even if I wanted one.
- **`computeAdherence` (`training-cycle-metrics.service.ts`) is a plain
  range query**: `WorkoutSchedule.findMany({ date: { gte, lte } })`,
  `total = count`, `completed = count(status==='COMPLETED')`. It holds no
  separate memory of "how many sessions were originally planned" — it
  only ever looks at whatever rows currently exist with a `date` inside
  the window being asked about.

Given both facts, the correct implementation is to **mutate the existing
row's `date` field in place** (`UPDATE`, never `INSERT`+`DELETE`/
supersede). This is not a simplification that trades correctness for
convenience — it is *more* correct than a two-row design:

- "original date no longer appears as missed duplicate" — true by
  construction, there was never a second row to appear as anything.
- "target date shows the same logical session" — true by construction,
  it's literally the same row (`id` unchanged), same `workoutId` link
  (still null until actually logged), same `trainingCycleId`,
  `sourcePlanId`, `programDayId`.
- "completion on B counts once" — true by construction, one row.
- "must not create false missed-session penalties" / "cycle metrics count
  correctly" — true FOR FREE: `computeAdherence` just sees the row at its
  new `date`. If the new date falls outside the current cycle's window,
  the session correctly stops counting toward this cycle's total (it's
  not "missed", it was legitimately moved) — no adherence code changes
  needed at all.
- Zero new "RESCHEDULED" state for cycle-evaluation code to learn about.

So `logicalScheduleId` from the roadmap's sketch is dropped (redundant —
the row's own `id` already IS the stable logical identity). What IS added,
matching the sketch's spirit: `originalPlannedDate`, `rescheduledAt`,
`rescheduleReason` — pure audit-trail columns, read by nothing except a
"rescheduled from X" UI hint later if wanted.

## Existing related code (audited)

- `assertScheduleDateEditable` (`schedule-lock.util.ts`) restricts every
  existing mutation (`skipSchedule`, `cancelSchedule`, `deleteSchedule`,
  `completeScheduleExercise`, `updateSet`, ...) to **today only** — past
  AND future are both currently locked. Reschedule cannot reuse this: case
  3 ("missed session → valid recovery date") explicitly requires touching
  a PAST schedule, and case 1 requires a FUTURE source day too. Reschedule
  gets its own authorization, deliberately looser on the source side and
  stricter on one axis skip/cancel don't care about (target must not be
  past).
- `skipSchedule`/`cancelSchedule` already establish the "reject if
  `existing.workoutId` is set" pattern for "don't let a real logged
  session be casually mutated" — reused identically here for case 7.
- `createSchedule` already has an existing-row-at-that-date path, but it
  treats it as an idempotent success (`{ alreadyExists: true, schedule }`)
  — wrong shape for reschedule's target-date conflict, which the roadmap
  wants treated as a real conflict, not silently absorbed. Reschedule
  implements its own explicit check instead.
- `SkipCancelFeedbackModal`'s existing `userAvailableMakeupDay` field
  (session-feedback, `CycleSessionFeedback`) is pure informational
  free-text/date — verified it is never read to actually move a schedule
  anywhere. Confirms no reschedule mechanism exists anywhere today; this
  is genuinely new.

## Scope boundary (deliberate)

**Reschedule is only offered while `status === 'NOT_STARTED'` (equivalently
`workoutId` is null)** — covers case 7 exactly, and deliberately excludes
SKIPPED/CANCELLED too: those are already deliberate terminal decisions the
product has no "undo" for today, and conflating "undo skip" with
"reschedule" would be new, unrequested scope. A skipped/cancelled session
stays skipped/cancelled; the user can still create a fresh schedule for a
new date via the existing `createSchedule` flow.

**Target date must be today or a future calendar day** (never past) — "a
valid recovery date" can't itself be missed already.

**Conflict = hard reject (409), never silently allowed/merged/stacked.**
The `@@unique([userId, date])` constraint makes "stack two sessions on one
day" structurally impossible anyway; reject is also the only choice
consistent with "must be based on current product logic, not arbitrary
frontend rules" — there is no existing product concept of a day holding
two sessions, so introducing one for reschedule alone would be a new,
unrequested capability. Repeatedly rescheduling the SAME session (case 5)
still works fine — each call is its own independent `UPDATE`.

## Cases to support — how each is handled

1. future → another future day: source not-started, target future, not
   locked either way. Works.
2. today's unstarted → tomorrow: same path.
3. missed (past) → valid recovery date: source check does NOT use
   `assertScheduleDateEditable` (which would reject a past source), only
   checks `!workoutId`; target must be today/future.
4. reschedule onto an occupied day: rejected (409), error names what's
   already scheduled there.
5. repeatedly reschedule the same session: each call independently valid,
   `originalPlannedDate` set once (first reschedule only) and preserved.
6. cancel/skip instead of reschedule: untouched, separate existing actions.
7. completed session cannot be casually moved: `workoutId` check rejects.

## Affected models

`fitness-service` `WorkoutSchedule`: 3 new nullable columns
(`original_planned_date`, `rescheduled_at`, `reschedule_reason`). Additive
migration, no backfill needed (null = never rescheduled).

## Affected services

`fitness-service`: new `workoutService.rescheduleSchedule(userId,
scheduleId, newDateStr, reason?)`. New route `POST
/workouts/schedules/:id/reschedule`. No changes to
`training-cycle-metrics.service.ts`, `cycle-metrics.engine.ts`, or any
other adherence/cycle code — see audit findings above for why.

## Affected frontend

`WorkoutLogPage.tsx`: a "Dời lịch" (reschedule) button in the day-detail
view (next to the existing skip button, but gated on `!isSelectedDayLocked`
being REMOVED — reschedule must work on locked past/future days too,
unlike skip), opening a new small date-picker modal
(`RescheduleModal`, mirroring `SkipCancelFeedbackModal`'s structural
pattern). `workoutService.rescheduleSchedule` added to `api.ts`.

## Affected AI context

None this pass — the roadmap allows "AI may explain or suggest dates" as a
future enhancement; this pass ships the deterministic mutation only.

## Migration risk

Low — 3 new nullable columns, no existing data affected.

## Backward compatibility

Fully additive. No existing schedule ever gets `rescheduledAt` set unless
explicitly rescheduled through the new endpoint.

## Security/privacy

Same ownership check as every other schedule mutation (`userId`-scoped
lookup).

## Bugs found while building this (both pre-existing, not introduced by reschedule)

1. **`calendarMonth`'s initial state ignored the URL's `date` param**,
   always defaulting to `new Date()` (today's month) even when the page
   loaded via a deep link into a different month. `aiSchedules` is only
   ever fetched for `calendarMonth`'s range, so navigating directly to a
   schedule more than ~1 week away from today's date (enough to cross a
   month boundary) silently showed "nothing scheduled" even though a real
   schedule existed — first exposed by this feature's own E2E test
   rescheduling 10 days out, but affects ANY deep link into a schedule in
   a different month, not just a rescheduled one. Fixed: `calendarMonth`
   now mirrors `selectedDate`'s own existing URL-restoration pattern.
2. **`createManualProgram` archives ANY existing ACTIVE program on every
   call, regardless of `replaceExisting`** — only the schedule-deletion
   step is conditional on that flag; the `workoutProgram.updateMany({
   status: "ACTIVE" -> "ARCHIVED" })` always runs. `GET
   /workouts/schedules` only returns schedules whose program is still
   ACTIVE (or has a `workoutId`/no `programDayId`), so seeding two
   "occupied dates" via two separate `createManualProgram` calls silently
   makes the FIRST call's schedule invisible the moment the second call
   runs — not a reschedule bug, a pre-existing test-seeding trap (spec 27
   already worked around it by using one program with multiple days; this
   pass's own conflict-rejection test hit it fresh and was fixed the same
   way). Not changed in application code — `replaceExisting`'s current
   behavior may well be intentional (at most one program truly "active"
   at a time); noted here only so a future agent doesn't waste time
   restaging the same discovery.

## Test plan

Backend integration: all 7 cases above, plus the target-conflict rejection,
plus a direct proof that `computeAdherence` reflects a reschedule correctly
without any changes to it (reschedule out of a cycle's window drops the
session from that cycle's total; reschedule within stays counted at its
new date) — the central architectural claim of this doc, verified rather
than assumed.

Browser E2E: reschedule a future session to another future date from the
day-detail view; the original date's day-card shows nothing scheduled
(never a stale/duplicate entry); the target date shows the same session
(same exercises); DB confirms one row, same `id`, moved `date`.

## Verified results (2026-08-24)

Backend integration (`gymcoach_fitness_test`,
`reschedule-schedule.integration.test.ts`) — 8/8 pass: cases 1–2 (future→
future, same row), case 3 (missed/past source, proven distinct from
`assertScheduleDateEditable` by first showing `skipSchedule` rejects the
same row), past-target rejection, case 4 (occupied-date conflict, names
what's there, source row provably untouched), case 5 (repeated reschedule
keeps `originalPlannedDate` pinned to the true first plan), case 7
(started/completed session rejected), the scope-boundary addition
(SKIPPED session also rejected), and the central architectural claim
(`computeAdherence`, completely unmodified, correctly drops a session from
its cycle total when rescheduled out of the window and correctly recovers
it when rescheduled back in — zero adherence-code changes needed).
Pre-existing `schedule-lock.integration.test.ts` +
`undo-complete-schedule-exercise.integration.test.ts` — 14/14 unaffected.
`tsc --noEmit` clean. `npm run build` clean (frontend/web).

Browser E2E (`37-reschedule-workout.spec.ts`) — 2/2 pass, after fixing bug
#1 above (test 1 first failed exactly the way it predicted) and working
around bug #2 (test 2 first failed the same way spec 27 had already
learned to avoid).

Full regression (specs 27, 29–37, 10 files) run **twice** back to back:
first run surfaced a third, unrelated issue — `27-future-schedule-lock.spec.ts`
Scenario C (pre-existing, not touched by reschedule) seeded a 3-set
exercise and expected one click to finish it, which stopped being true
once roadmap P1.1's set-by-set table shipped earlier this session (see
`SET_BY_SET_TABLE_UI_IMPACT_ANALYSIS.md`'s own "Follow-up" section) — fixed
in the test itself (loops up to 3 completions), verified in isolation
(4/4), folded into the second full run: **30/31 pass**. The one remaining
failure in that second run was Scenario C again, this time failing at an
EARLIER step (the "start workout" click never reaching the active-exercise
view) — re-ran spec 27 alone immediately after and it passed cleanly
(4/4), and a direct probe confirmed the gateway's `/auth/*` rate limiter
(20 req/15min, unrelated pre-existing infra — see
`[[auth-rate-limiter-15min]]` memory) was at `RateLimit-Remaining: 0` at
that point, from the sheer cumulative volume of logins across this one
very long session's many E2E runs today. Root-caused, not a code defect —
never weakened the limiter, did not force another full run through an
already-exhausted budget. `37-reschedule-workout.spec.ts` itself passed
cleanly in every run it was part of, including this one.
