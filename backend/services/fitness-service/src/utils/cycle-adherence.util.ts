import type { ActivityDayState } from "./activity-heatmap.util";

/**
 * Roadmap P3.4 "Training consistency and adherence" (§ 24,
 * docs/features/TRAINING_CONSISTENCY_ADHERENCE_IMPACT_ANALYSIS.md).
 *
 * §24: show `planned / completed / rescheduled / missed` — not raw count
 * only. Real audit finding: `training-cycle.service.ts`'s existing
 * `getCycleReport` already had a `workouts` breakdown, but it was exactly
 * that "raw count only" shape (`completed`/`missed`/`upcoming`, missed and
 * upcoming both just `status !== "COMPLETED"` split by date), and — more
 * importantly — a session that was RESCHEDULED silently vanishes from it
 * entirely: its `WorkoutSchedule` row's `date` moves to the new date (see
 * P1.2's reschedule mechanism, also relied on by P3.2's Activity Heatmap),
 * so the row simply reappears under `completed` or `missed`/`upcoming` at
 * its NEW date with zero indication a reschedule ever happened.
 *
 * This module is a pure aggregator, deliberately NOT a re-derivation of
 * per-day state — it reuses `classifyDayState` (P3.2, already proven
 * correct and unit-tested for exactly this 5-state day classification,
 * including the reschedule-source-vs-destination distinction) for every
 * calendar day. The one thing `classifyDayState` intentionally does NOT
 * cover — a FUTURE day that has a real planned session — is added here as
 * a 5th, additive `planned` bucket (§24's own first-listed category).
 */

export interface CycleAdherenceDayInput {
  /** classifyDayState's own return value for this day — reused unchanged. */
  state: ActivityDayState | null;
  /** Whether a real WorkoutSchedule row sits at this exact date, regardless
   * of state — only meaningful when `state` is null (a future day), to
   * distinguish "a real session is planned here" (→ planned) from "nothing
   * was ever planned this day" (→ excluded, same as a `rest` day). */
  hasRealSchedule: boolean;
}

export interface CycleAdherenceBreakdown {
  completed: number;
  partial: number;
  missed: number;
  rescheduled: number;
  planned: number;
  /**
   * completed / (completed + partial + missed + rescheduled) — i.e. "of
   * every session that has already had its moment (whether or not it was
   * ever rescheduled along the way), how many were actually completed."
   * `planned` (not yet resolved) and `rest`/unplanned days are deliberately
   * excluded from this denominator — they cannot yet be judged.
   * null when that denominator is 0 (no data to judge yet), matching this
   * codebase's own established "0/0 must never read as 0% or 100%"
   * convention (see AdherenceMetric.percent in
   * training-cycle-metrics.service.ts).
   */
  adherencePct: number | null;
}

export function aggregateCycleAdherence(
  days: CycleAdherenceDayInput[],
): CycleAdherenceBreakdown {
  let completed = 0;
  let partial = 0;
  let missed = 0;
  let rescheduled = 0;
  let planned = 0;

  for (const day of days) {
    if (day.state === "completed") completed += 1;
    else if (day.state === "partial") partial += 1;
    else if (day.state === "missed") missed += 1;
    else if (day.state === "rescheduled") rescheduled += 1;
    else if (day.state === null && day.hasRealSchedule) planned += 1;
    // day.state === "rest", or a future day with no real schedule row:
    // nothing was ever planned this day — excluded from every count.
  }

  const resolvedTotal = completed + partial + missed + rescheduled;
  const adherencePct =
    resolvedTotal > 0 ? Math.round((completed / resolvedTotal) * 100) : null;

  return { completed, partial, missed, rescheduled, planned, adherencePct };
}
