/**
 * Gymini V2 (EXPERIMENTAL) — the user's calendar day (TZ-UTC fix, 2026-11-13).
 *
 * "Today" / "yesterday" / "N days ago" are CALENDAR days in the user's time zone, the same convention V1 uses for today's
 * schedule (services/fitness-agent-tools.ts getTodaySchedule: Intl "en-CA" + Asia/Ho_Chi_Minh). Before this module the
 * Recovery / Progress path used UTC days, so between 00:00 and 07:00 Vietnam time a workout logged "yesterday evening"
 * looked like "today" and the Training schedule and the Recovery history disagreed about what "today" is.
 * Gymini has no per-user time-zone field; every user is served in Vietnam time (one constant, one place).
 */
export const USER_TIME_ZONE = "Asia/Ho_Chi_Minh";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); formatters.set(timeZone, f); }
  return f;
}

/** YYYY-MM-DD of an instant (Date / ISO string / epoch ms) in the user's time zone; null when absent or invalid. */
export function calendarDateIn(value: unknown, timeZone: string = USER_TIME_ZONE): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(d.getTime())) return null;
  return formatter(timeZone).format(d);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD); null when either is not a date. Pure date arithmetic. */
export function calendarDaysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
