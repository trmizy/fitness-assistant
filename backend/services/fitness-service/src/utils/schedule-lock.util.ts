/**
 * Pure, timezone-aware logic for the "past scheduled days are locked"
 * business rule — no Prisma, no Express, no npm dependencies beyond Node's
 * built-in Intl, so it's directly unit-testable (including against
 * negative-offset and DST-observing zones) without a database or server.
 *
 * Design note on what "the scheduled date" means in this codebase: a
 * WorkoutSchedule.date is written and read elsewhere (parseDateOnly /
 * formatDateOnly in workout.service.ts, parseApiDateOnly in
 * WorkoutLogPage.tsx) as a plain Y-M-D calendar-day LABEL stored at UTC
 * midnight — never as a real timezone-tagged instant. Re-interpreting that
 * label through a timezone conversion here would risk shifting it by a day
 * relative to every other place that already reads it as a bare label. So
 * this module keeps that same convention for the *schedule* side, and only
 * applies real timezone awareness to "what day is it right now for the
 * user" — the one side of the comparison that a business rule about "has
 * today passed" actually needs to get right per calendar day experienced by
 * a real person, not a server process's ambient TZ (this fitness-service
 * container runs in UTC, confirmed during this investigation).
 */

/** The single timezone this Vietnamese-market product's "today" is computed
 * in for scheduling/locking purposes. Not a per-user preference — no such
 * field exists anywhere in the current schema (user-service, fitness-service,
 * auth-service all checked), and adding one wasn't requested; if the product
 * later needs per-user timezones, this is the one call site to parameterize. */
export const APP_SCHEDULE_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** YYYY-MM-DD as observed in `timeZone` for the given instant. Lexically
 * comparable (string `<`/`>` on this format matches chronological order). */
export function calendarDateLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The Y-M-D label a stored WorkoutSchedule.date already represents — read
 * as UTC, matching how the rest of the codebase writes/reads it (see the
 * module doc comment above). Never re-interpret this through a different
 * timezone; it was never a real localized instant to begin with. */
export function scheduledDateLabel(scheduledDate: Date): string {
  return calendarDateLabel(scheduledDate, "UTC");
}

export type ScheduleLockComparison = "past" | "today" | "future";

/**
 * Compares a schedule's calendar date against "today" in `userTimeZone`.
 * Pure function of its three inputs — no ambient clock, no ambient TZ — so
 * callers (and tests) fully control both "now" and the timezone under test.
 */
export function compareScheduleDate(
  scheduledDate: Date,
  now: Date,
  userTimeZone: string = APP_SCHEDULE_TIME_ZONE,
): ScheduleLockComparison {
  const scheduled = scheduledDateLabel(scheduledDate);
  const today = calendarDateLabel(now, userTimeZone);
  if (scheduled < today) return "past";
  if (scheduled > today) return "future";
  return "today";
}

/** Business rule: a scheduled day strictly before OR strictly after the
 * user's current calendar day is locked for logging/completion — no plan
 * edits, no log create/update/delete, no start/complete. Only today is
 * editable. Future days were previously left unlocked ("follow whatever
 * permissions the rest of the system already grants them"), which allowed
 * a session dated tomorrow to be started/completed today — producing the
 * observed contradiction of a future day simultaneously showing "100% /
 * Hoàn thành" and an enabled start/edit button. A real workout cannot have
 * actually happened on a day that hasn't occurred yet, so completion data
 * for a future date is never trustworthy regardless of what triggered it. */
export function isScheduleDateLocked(
  scheduledDate: Date,
  now: Date = new Date(),
  userTimeZone: string = APP_SCHEDULE_TIME_ZONE,
): boolean {
  const comparison = compareScheduleDate(scheduledDate, now, userTimeZone);
  return comparison === "past" || comparison === "future";
}

/** Monday-Sunday boundaries (inclusive) of the calendar week containing
 * `now`, as observed in `userTimeZone` — returned as UTC-midnight-anchored
 * Date objects directly comparable against WorkoutSchedule.date (which
 * carries that same UTC-as-a-label convention, see the module doc comment
 * above). This is the ONE place "what week is this session in" is computed,
 * shared by every "this week" stat (weekly session count, weekly volume,
 * etc.) instead of each call site guessing its own week-start rule. Weeks
 * start Monday, matching the calendar UI's own day-column order
 * (T2..T7,CN = Mon..Sat,Sun). */
export function currentWeekRange(
  now: Date = new Date(),
  userTimeZone: string = APP_SCHEDULE_TIME_ZONE,
): { start: Date; end: Date } {
  const todayAsSchedule = todayAsScheduleDate(now, userTimeZone);
  const isoDayOfWeek = todayAsSchedule.getUTCDay() === 0 ? 7 : todayAsSchedule.getUTCDay(); // Mon=1..Sun=7

  const start = new Date(todayAsSchedule);
  start.setUTCDate(start.getUTCDate() - (isoDayOfWeek - 1));

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  return { start, end };
}

/** "Today" per `userTimeZone`, reconstructed as the same UTC-midnight-
 * anchored label convention `WorkoutSchedule.date` uses — directly
 * comparable against schedule dates and safely walkable a day at a time via
 * `setUTCDate` (streaks, week ranges) without ever re-interpreting the
 * label through a timezone a second time. */
export function todayAsScheduleDate(
  now: Date = new Date(),
  userTimeZone: string = APP_SCHEDULE_TIME_ZONE,
): Date {
  const label = calendarDateLabel(now, userTimeZone);
  const [y, m, d] = label.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Real bug found via direct user report: a FUTURE-dated schedule (e.g.
 * viewing tomorrow's plan and clicking "Bắt đầu tập") was rejected with
 * "Không thể chỉnh sửa buổi tập của ngày đã qua." — literally "cannot edit
 * a workout from a day that has already passed", which is false for a day
 * that hasn't happened yet. The lock direction was always available
 * (isScheduleDateLocked's own comparison already distinguishes past vs
 * future) but the error message was a single hardcoded string regardless
 * of which direction triggered it. `direction` lets callers (and the
 * frontend, via the JSON error body) react correctly instead of guessing
 * from message text. */
export class ScheduleLockedError extends Error {
  status = 409;
  code = "SCHEDULE_DATE_LOCKED";
  direction: "past" | "future";
  constructor(direction: "past" | "future", message?: string) {
    super(
      message ??
        (direction === "past"
          ? "Không thể chỉnh sửa buổi tập của ngày đã qua."
          : "Chưa đến ngày tập này — chỉ có thể bắt đầu/chỉnh sửa vào đúng ngày."),
    );
    this.name = "ScheduleLockedError";
    this.direction = direction;
  }
}

/** Throws ScheduleLockedError if the date is locked; otherwise a no-op.
 * The single call site every mutating endpoint should use, so the "is it
 * locked" decision and its error shape stay in exactly one place. */
export function assertScheduleDateEditable(
  scheduledDate: Date,
  now: Date = new Date(),
  userTimeZone: string = APP_SCHEDULE_TIME_ZONE,
): void {
  const comparison = compareScheduleDate(scheduledDate, now, userTimeZone);
  if (comparison === "past" || comparison === "future") {
    throw new ScheduleLockedError(comparison);
  }
}
