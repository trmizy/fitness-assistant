/**
 * Roadmap P3.2 "Activity heatmap"
 * (docs/features/ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md).
 *
 * Pure day-state classification — no Prisma, no Express, directly
 * unit-testable. §22's own 5 states, mapped onto the real existing
 * `WorkoutSchedule.status` vocabulary (see the impact analysis's audit
 * for the full reasoning behind each mapping).
 */

export type ActivityDayState = "completed" | "partial" | "missed" | "rescheduled" | "rest";

export interface ClassifyDayStateInput {
  dateLabel: string; // YYYY-MM-DD, the day being classified
  todayLabel: string; // YYYY-MM-DD
  scheduleStatusAtDate: string | null; // WorkoutSchedule.status for a row at exactly this date, or null if none
  hasOriginalPlanMovedAway: boolean; // true if some OTHER row's originalPlannedDate equals this date
}

/** Returns null for a future date — none of §22's 5 states are
 * retrospective-only concepts that apply to a day that hasn't happened
 * yet, so a future day is deliberately left unclassified rather than
 * forced into one. */
export function classifyDayState(input: ClassifyDayStateInput): ActivityDayState | null {
  if (input.dateLabel > input.todayLabel) return null;

  if (input.scheduleStatusAtDate) {
    switch (input.scheduleStatusAtDate) {
      case "COMPLETED":
        return "completed";
      case "PARTIALLY_COMPLETED":
        return "partial";
      case "SKIPPED":
      case "CANCELLED":
        return "missed";
      default:
        // NOT_STARTED / IN_PROGRESS, and the top check above already
        // confirmed this date is today-or-earlier — planned but no
        // action taken in time.
        return "missed";
    }
  }

  if (input.hasOriginalPlanMovedAway) return "rescheduled";
  return "rest";
}
