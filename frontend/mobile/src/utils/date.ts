/**
 * Date helpers ported VERBATIM from the web client so the two apps read the same wire values the
 * same way. These look trivial and are not: `WorkoutSchedule.date` and the InBody records carry a
 * Y-M-D *label*, not an instant, and reading them with a plain `new Date(...)` shifts the label by
 * a day for anyone east/west of UTC. Web learned that the hard way (see
 * `pages/client/schedule-lock.utils.ts`'s doc comment); this file exists so mobile never relearns
 * it screen by screen.
 */

/** `Date` → the `YYYY-MM-DD` string the API expects for date-only query params. Local fields on
 * purpose: the caller means "today where the user is", not "today in UTC". */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Re-materialize a date-only API value at LOCAL midnight, for calendar arithmetic and sorting.
 * Reads the Y-M-D digits straight out of the string rather than letting `new Date` apply a
 * timezone to what was never an instant. */
export function parseApiDateOnly(value: string | Date): Date {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }

  const parsed = new Date(value);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/** "Th 4, 17/09" — the short schedule label used on the dashboard and the training screen. */
export function formatScheduleDate(value: string | Date): string {
  return parseApiDateOnly(value).toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Stable `YYYY-MM-DD` sort key for an InBody record. Priority: `dateOnly` → `date` → `createdAt`.
 * Manual entry and OCR both produce `DD/MM/YYYY` and `DD-MM-YYYY` in the wild, so both are
 * normalized here. A missing/unparseable date returns `9999-12-31` so it sorts to the END rather
 * than masquerading as the newest measurement.
 */
export function inBodyDateKey(record: any): string {
  const raw = record?.dateOnly ?? record?.date ?? record?.createdAt;
  const s = raw ? String(raw) : "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const dmy2 = /^(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (dmy2) return `${dmy2[3]}-${dmy2[2]}-${dmy2[1]}`;
  return "9999-12-31";
}

/** Newest-first, matching the web dashboard: date key descending, `createdAt` breaking ties. */
export function sortInBodyNewestFirst<T>(records: T[]): T[] {
  return [...records].sort((a: any, b: any) => {
    const cmp = inBodyDateKey(b).localeCompare(inBodyDateKey(a));
    if (cmp !== 0) return cmp;
    return Date.parse(String(b?.createdAt ?? 0)) - Date.parse(String(a?.createdAt ?? 0));
  });
}

/** Monday-based start of the week containing `date`, at local midnight. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0 = Sunday. Vietnamese weeks start Monday, so Sunday is day 7, not day 0.
  const weekdayFromMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - weekdayFromMonday);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

/** "Chào buổi sáng" / "Chào buổi chiều" / "Chào buổi tối" — the dashboard's greeting line. */
export function greetingForHour(hour: number): string {
  // Caught on device at 00:42: past midnight is still "tối" to a person, not "sáng".
  if (hour < 4) return "Chào buổi tối,";
  if (hour < 11) return "Chào buổi sáng,";
  if (hour < 18) return "Chào buổi chiều,";
  return "Chào buổi tối,";
}
