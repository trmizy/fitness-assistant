/**
 * The booking calendar's "day the PT works" marker, shared by the booking page and the reschedule picker
 * (DateSlotPicker) so both highlight the same days.
 *
 * Source: the PT's public weekly hours (`availabilityService.getAvailability`). Only used to HIGHLIGHT days - nothing is
 * disabled by it; the slot list and the server-side rules (>= 24 h lead, availability, contract validity) decide.
 *
 * Run: npx tsx --test src/app/utils/__tests__/ptWeeklyHours.test.ts
 */

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/** weekday (0 = Sunday) -> the latest minute-of-day a PT's working window ends */
export function latestEndByWeekday(rows: unknown): Map<number, number> {
  const out = new Map<number, number>();
  const list = (Array.isArray(rows) ? rows : []) as Array<{ dayOfWeek?: string; endTime?: string; isActive?: boolean }>;
  for (const s of list) {
    if (s.isActive === false) continue;
    const wd = DAY_NAMES.indexOf(String(s.dayOfWeek).toUpperCase());
    const [hh, mm] = String(s.endTime ?? "").split(":").map(Number);
    if (wd < 0 || !Number.isFinite(hh)) continue;
    out.set(wd, Math.max(out.get(wd) ?? 0, hh * 60 + (Number.isFinite(mm) ? mm : 0)));
  }
  return out;
}

/**
 * True when the PT works that weekday AND the last one-hour start of their window is at least `leadMs` from `now`
 * (the 24 h booking lead), so a highlighted day always has hours to pick.
 */
export function isWorkingDay(
  dateObj: Date,
  latestEnd: Map<number, number>,
  now: number = Date.now(),
  leadMs: number = 24 * 60 * 60 * 1000,
): boolean {
  const end = latestEnd.get(dateObj.getDay());
  return end !== undefined && dateObj.getTime() + (end - 60) * 60_000 >= now + leadMs;
}
