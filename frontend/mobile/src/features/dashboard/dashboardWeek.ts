import { addDays, parseApiDateOnly, toDateInputValue } from "../../utils/date";

/**
 * Pure pieces of CL-01's dashboard (`app/client/dashboard.tsx`): the weekly activity bars, the
 * training streak, the next/later schedule selection and the body-metric change label. Kept out of
 * the screen so they can be unit-tested without rendering it.
 */

export const ACTIVITY_WEEK_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** Schedule statuses that are over — nothing left to start or resume (fitness-service schema). */
export const CLOSED_SCHEDULE_STATUSES = new Set(["COMPLETED", "SKIPPED", "CANCELLED"]);

/** One day of `GET /stats/activity-heatmap`. */
export type ActivityDay = { date: string; state: string | null };

/** Bar height fraction for a heatmap day state. */
export function activityStateValue(state: string | null): number {
  switch (state) {
    case "completed":
      return 1;
    case "partial":
      return 0.55;
    case "rescheduled":
      return 0.3;
    case "missed":
      return 0.15;
    default:
      // "rest" and "no plan that day" both read as an empty column, same as the reference.
      return 0;
  }
}

/** Height fraction per weekday, straight from the activity heatmap's own day states. */
export function buildActivityWeek(weekStart: Date, days: ActivityDay[] | undefined) {
  const byDate = new Map((days ?? []).map((d) => [d.date, d.state]));
  return ACTIVITY_WEEK_LABELS.map((label, i) => {
    const state = byDate.get(toDateInputValue(addDays(weekStart, i))) ?? null;
    return { label, state, value: activityStateValue(state) };
  });
}

/**
 * Consecutive days ending today (or yesterday, if today has not been trained yet) that count as
 * trained. A rest day does NOT break the streak — that is the whole point of programming one —
 * but it does not extend it either.
 */
export function currentStreak(days: ActivityDay[] | undefined, now: Date = new Date()): number {
  if (!days?.length) return 0;
  const byDate = new Map(days.map((d) => [d.date, d.state]));
  let streak = 0;
  let cursor = now;
  // Today not trained yet is not a broken streak — start counting from yesterday in that case.
  const todayState = byDate.get(toDateInputValue(cursor));
  if (todayState !== "completed" && todayState !== "partial") {
    cursor = addDays(cursor, -1);
  }
  for (let i = 0; i < days.length; i += 1) {
    const state = byDate.get(toDateInputValue(cursor));
    if (state === "completed" || state === "partial") streak += 1;
    else if (state !== "rest") break;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** `71.3` vs `88.7` kg → `"-17.4 kg so với lần trước"`. */
export function changeLabel(curr?: number, old?: number, unit = ""): string {
  if (curr == null || old == null) return "Chưa có số liệu trước";
  const diff = curr - old;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)} ${unit} so với lần trước`.trim();
}

/** Whether a date-only API value falls on `now`'s local calendar day. */
export function isSameLocalDay(value: string | Date, now: Date = new Date()): boolean {
  return toDateInputValue(parseApiDateOnly(value)) === toDateInputValue(now);
}

/**
 * The hero card's session and the "Sắp tới" list below it.
 *
 * - A started-but-unfinished session is still "next" — it is the one to resume. Filtering on "has
 *   no workout row" hid today's session the moment it began and jumped to next week's.
 * - "Sắp tới" starts AFTER the hero card's session; listing it again rendered the same session twice.
 */
export function selectUpcomingSchedules(schedules: unknown) {
  const list: any[] = Array.isArray(schedules) ? schedules : [];
  const upcoming = list
    .filter((s) => !CLOSED_SCHEDULE_STATUSES.has(s?.status))
    .sort((a, b) => parseApiDateOnly(a.date).getTime() - parseApiDateOnly(b.date).getTime());
  return { upcoming, next: upcoming[0] as any, later: upcoming.slice(1, 4) };
}
