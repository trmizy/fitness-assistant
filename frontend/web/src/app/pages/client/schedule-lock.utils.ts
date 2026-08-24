/**
 * Frontend mirror of backend/services/fitness-service/src/utils/schedule-lock.util.ts —
 * used ONLY for early UI feedback (calendar styling, disabling controls,
 * blocking navigation into edit mode). The server is the final authority on
 * whether a mutation is actually allowed; this module must never be the
 * only place the rule is enforced, since a user can always bypass frontend
 * JS via a direct API call.
 *
 * Computed via Intl.DateTimeFormat with an explicit IANA zone rather than
 * `new Date().getDate()` etc., so "today" is correct for the product's
 * target timezone even if the visiting browser/OS is set to a different
 * one — the same reasoning that drove the backend implementation.
 */

export const APP_SCHEDULE_TIME_ZONE = "Asia/Ho_Chi_Minh";

export function calendarDateLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Matches parseApiDateOnly's convention elsewhere in this file: a
 * WorkoutSchedule.date is a Y-M-D label carried at UTC midnight, never a
 * real localized instant — read it back via the UTC label, not the
 * viewer's local timezone.
 *
 * IMPORTANT: only pass a Date built from `Date.UTC(...)` or parsed
 * directly from an ISO string here — never the output of this file's
 * `parseApiDateOnly` (which re-materializes the label at *local* midnight
 * for calendar-grid arithmetic). Round-tripping that local Date back
 * through a UTC read shifts the label by a day for any browser timezone
 * other than UTC itself. To label a schedule coming straight from the API,
 * use `scheduledDateLabelFromApi` below instead, which reads the Y-M-D
 * digits directly out of the wire string. */
export function scheduledDateLabel(scheduledDate: Date): string {
  return calendarDateLabel(scheduledDate, "UTC");
}

/** Same label as `scheduledDateLabel`, but taken directly from the raw
 * API date string/Date (before any local-timezone reparsing) — the safe
 * entry point when you have a schedule's `.date` fresh off the wire. */
export function scheduledDateLabelFromApi(value: string | Date): string {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return scheduledDateLabel(new Date(value));
}

export type ScheduleLockComparison = "past" | "today" | "future";

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

/** Real bug found via direct user report: this used to check only
 * `scheduled < today` (past-only), while the BACKEND's matching rule
 * (assertScheduleDateEditable) locks a day that is EITHER past OR future
 * — only "today" is ever editable. That divergence let a future day's
 * "Bắt đầu tập" button render enabled, the click reach the real API, and
 * the backend correctly reject it — but by then the user had already
 * clicked a button that visually promised it would work. Fixed to match
 * the backend exactly: locked whenever it is NOT today. */
export function isScheduleDateLocked(
  scheduledDate: Date,
  now: Date = new Date(),
  userTimeZone: string = APP_SCHEDULE_TIME_ZONE,
): boolean {
  return compareScheduleDate(scheduledDate, now, userTimeZone) !== "today";
}

/** Same as `isScheduleDateLocked`, but takes the raw API date value
 * directly — see `scheduledDateLabelFromApi`'s doc comment for why this
 * matters (a value already round-tripped through `parseApiDateOnly`'s
 * local-midnight reconstruction must NOT be passed to the Date-based
 * helpers above). */
export function isScheduleDateApiValueLocked(
  apiDateValue: string | Date,
  now: Date = new Date(),
  userTimeZone: string = APP_SCHEDULE_TIME_ZONE,
): boolean {
  const scheduled = scheduledDateLabelFromApi(apiDateValue);
  const today = calendarDateLabel(now, userTimeZone);
  return scheduled !== today;
}

/** Which direction a locked day is locked in — lets callers show the
 * correct message ("đã qua" only makes sense for the past; a future day
 * needs different wording entirely) instead of a single string that's
 * wrong half the time. Undefined when the day isn't locked at all. */
export function scheduleLockDirection(
  apiDateValue: string | Date,
  now: Date = new Date(),
  userTimeZone: string = APP_SCHEDULE_TIME_ZONE,
): "past" | "future" | undefined {
  const scheduled = scheduledDateLabelFromApi(apiDateValue);
  const today = calendarDateLabel(now, userTimeZone);
  if (scheduled < today) return "past";
  if (scheduled > today) return "future";
  return undefined;
}

/** Strictly "already happened", never "not yet due" — the PAST-ONLY half
 * of `isScheduleDateApiValueLocked`. Needed as its own function (not just
 * `scheduleLockDirection(...) === "past"`) because some callers (e.g. the
 * "upcoming workouts" list, which must include today AND future days) care
 * specifically about "has this date already gone by", not "is today the
 * only editable day" — conflating the two here is exactly what caused
 * upcomingSchedules to start excluding real future sessions when
 * isScheduleDateApiValueLocked was fixed to also lock future dates. */
export function isScheduleDateApiValuePast(
  apiDateValue: string | Date,
  now: Date = new Date(),
  userTimeZone: string = APP_SCHEDULE_TIME_ZONE,
): boolean {
  const scheduled = scheduledDateLabelFromApi(apiDateValue);
  const today = calendarDateLabel(now, userTimeZone);
  return scheduled < today;
}
