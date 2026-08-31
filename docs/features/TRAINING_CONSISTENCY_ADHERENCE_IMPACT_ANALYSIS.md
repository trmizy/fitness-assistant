# Training Consistency and Adherence — Impact Analysis

Date: 2026-08-27. Roadmap: P3.4 "Training consistency and adherence" (§24).

## Why

§24: "Fitness Assistant can exceed openGym here due to schedule/cycle
semantics." Show `planned / completed / rescheduled / missed` — not raw
count only:

```text
Adherence: 86%
Rescheduled: 2
Missed: 1
Completed: 12
```

## Audit findings

- **`computeAdherence` (`training-cycle-metrics.service.ts`) already
  exists and is used everywhere adherence matters** (Decision Engine,
  classification, alerts, nutrition engine) — a simple `{completed, total,
  percent}` ratio, `percent: null` when `total === 0` (this codebase's own
  established "0/0 must never read as 0% or 100%" convention). Left
  **completely unchanged** — every existing caller keeps working exactly
  as before.
- **`getCycleReport` already had a `workouts` breakdown** —
  `{totalScheduled, completed, missed, upcoming, completionRate,
  missedSessions, sessionDetails, highPainSessions}` — but it is exactly
  the "raw count only" shape §24 says to move beyond: `missed` is any
  `status !== "COMPLETED"` row whose date is in the past, `upcoming` is
  the same for a future date. **Real, concrete gap found by re-reading
  this against P1.2's reschedule mechanism**: a rescheduled session's
  `WorkoutSchedule` row has its `date` column UPDATED to the new date
  (same row, not a new one — see
  `docs/features/RESCHEDULE_WORKOUT_IMPACT_ANALYSIS.md`), so the OLD date
  simply has no row anymore. The session just reappears under `completed`
  or `missed`/`upcoming` at its NEW date, with **zero indication a
  reschedule ever happened** — proactively rescheduling and simply never
  showing up are indistinguishable in the existing report.
- **`classifyDayState` (P3.2, `activity-heatmap.util.ts`) already derives
  the exact 4 real states §24 lists, per calendar day** — including the
  reschedule-source-vs-destination distinction (a day a session moved
  AWAY from shows `rescheduled`; the day it moved TO shows its own real
  current status) — proven correct by P3.2's own tests and by Activity
  Heatmap's real usage since. Reused **completely unchanged** here.
- §24's "planned" category is the one thing `classifyDayState` doesn't
  cover on purpose (P3.2 deliberately leaves a future day unclassified —
  correct for a day-grid heatmap, since a future day "hasn't happened
  yet"). For a cycle summary, a future day that has a REAL scheduled
  session is meaningfully different from a future rest day — added as an
  additive 5th bucket on top of `classifyDayState`'s output, not a change
  to that function.

## Scope decisions

- **Extend the existing `getCycleReport` endpoint, not a new one.** It is
  already the real "what happened this cycle" report, already wired into
  `TrainingCyclePage.tsx`'s report modal, already fetches the exact
  `WorkoutSchedule` rows (with `originalPlannedDate`) needed — zero extra
  queries. New `workouts.breakdown` (`{completed, partial, missed,
  rescheduled, planned, adherencePct}`) and `workouts.rescheduledSessions`
  fields are purely additive; every pre-existing field
  (`completed`/`missed`/`upcoming`/`completionRate`/`missedSessions`) is
  untouched.
- **The breakdown covers the cycle's FULL planned window
  (`cycle.startDate` to `cycle.endDate`)**, not the report's existing
  `windowEnd` (which caps at "now" for an ongoing cycle, correct for
  nutrition tracking but wrong for "planned" — a future session is
  future by definition).
- **New `adherencePct` is deliberately a second, DIFFERENT percentage
  from the pre-existing `completionRate`** — not a violation of "audit
  before building a second parallel computation," but the direct result
  of that audit: `completionRate` is row-based and reschedule-blind (see
  findings above); `adherencePct` is day-based
  (`completed/(completed+partial+missed+rescheduled)`), reusing
  `classifyDayState`'s already-proven semantics, and correctly attributes
  a rescheduled-away day to its own bucket instead of silently vanishing.
  Showing both side by side without reconciling them would look like a
  bug, so this doc records why they can legitimately differ, and the
  service's own code comment says so at the point both are computed.
- **`computeAdherence` itself was NOT touched or reused for the new
  percentage** — its row-based counting doesn't align with a day-based,
  reschedule-aware breakdown (a rescheduled row is only ever counted once,
  at wherever it currently sits), so reusing it as-is for this specific
  display would have produced numbers that don't reconcile with the new
  Rescheduled/Planned counts on the same screen.

## Affected models

None — pure aggregate read of existing `TrainingCycle`/`WorkoutSchedule`
data.

## Affected services

- New `backend/services/fitness-service/src/utils/cycle-adherence.util.ts`
  — pure `aggregateCycleAdherence`.
- `training-cycle.service.ts`: new module-level `buildCycleAdherenceDays`
  helper (day-cursor loop + `classifyDayState`, mirrors
  `stats.service.ts`'s `getActivityHeatmap` pattern, scoped to one
  cycle's window); `getCycleReport` gains `workouts.breakdown` and
  `workouts.rescheduledSessions`.

## Affected frontend

`TrainingCyclePage.tsx`'s `CycleReportModal` — the existing 3-column
Completed/Missed/Rate grid becomes a 5-column
Adherence/Completed/Rescheduled/Missed/Planned grid, plus a new
"Đã dời lịch: ..." line (mirrors the existing "Ngày bỏ lỡ: ..." line's
convention). New `data-testid`s: `cycle-adherence-breakdown`,
`adherence-pct`, `cycle-rescheduled-sessions`,
`cycle-history-row-{cycleId}` (added to make the pre-existing history row
E2E-targetable), `cycle-report-modal`.

## Domain invariants

- Every field is real or explicitly excluded — no guessed defaults. A
  `rest`/never-planned day never enters any count.
- A rescheduled session's ORIGINAL date is `rescheduled`; the date it
  moved TO shows its own real current status — never both, never neither
  (same invariant P3.2 already proved for the day-grid case).
- `adherencePct` is `null`, never `0`/`100`, when nothing has resolved
  yet (a cycle with only `planned`/`rest` days).

## Migration risk

None — no schema change.

## Test plan

Unit: `aggregateCycleAdherence` — each of the 5 buckets independently, a
future day with vs without a real schedule row, `rest` days excluded from
every count, `adherencePct`'s exact denominator (excluding
planned/rest), null-when-nothing-resolved, 100%/0% edge cases (never
conflated with null), an empty window.

Backend integration: `getCycleReport` against a real seeded cycle with
all 5 real states including a genuine reschedule — proves the new
breakdown correctly separates rescheduled/planned from completed/missed
in a case the pre-existing fields could not, AND proves the pre-existing
fields are still internally consistent under their own (older,
reschedule-blind) definition, demonstrating the two percentages'
legitimate divergence with real numbers.

Browser E2E: a real seeded closed cycle with a real reschedule, opened
through the real existing report-modal UI flow, shows the real breakdown
grid and the real rescheduled-sessions line.

## Verified results

**Unit** (`cycle-adherence.util.test.ts`) — 8/8 passing.

**Backend integration**
(`cycle-adherence-breakdown.integration.test.ts`, against
`gymcoach_fitness_test`) — 1/1 passing: a real cycle with 1 completed, 1
partial, 1 skipped, 1 genuinely-rescheduled-and-still-pending, and 1
never-touched-upcoming session correctly yields
`{completed:1, partial:1, missed:1, rescheduled:1, planned:2,
adherencePct:25}`, while the pre-existing `completed`/`missed`/`upcoming`/
`completionRate` fields simultaneously read `{1, 2, 2, 33}` under their
own older definition — both internally consistent, visibly different,
exactly as documented. `npx tsc --noEmit` clean (backend). Frontend
`npm run build` clean.

**Browser E2E**
(`tests/50-training-cycle-adherence-breakdown.spec.ts`) — 1/1 passing: a
real seeded closed cycle with a real reschedule, opened through the
actual `CycleHistoryRow` → `CycleReportModal` UI flow, shows the real
5-bucket breakdown grid (`adherence-pct` = 33%) and the real
"Đã dời lịch: ..." line.

**Regression**: `tests/13-training-cycle-fixes.spec.ts` (2/2, exercises
the same Training Cycle tab this pass modified) +
`tests/37-reschedule-workout.spec.ts` (2/2, shares the exact
`originalPlannedDate` reschedule mechanism this pass's breakdown reads) —
4/4 still passing.
