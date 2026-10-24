/**
 * Vietnamese, Vietnam-time date/time wording for user-facing texts (notifications, error messages).
 *
 * `Date#toLocaleString()` with no arguments uses the SERVER's locale and zone, which printed US-style
 * "10/29/2026, 8:00:00 AM" in a notification (B26). Everything user-facing goes through here instead:
 * always Asia/Ho_Chi_Minh (UTC+7, no daylight saving), day before month, time before date.
 */
const VN_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "10:00 ngày 12/10/2026" - the moment `d` in Vietnam time. */
export function formatViDateTime(d: Date): string {
  const p: Record<string, string> = {};
  for (const part of VN_PARTS.formatToParts(d)) p[part.type] = part.value;
  return `${p.hour}:${p.minute} ngày ${p.day}/${p.month}/${p.year}`;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** [start, end) of the Vietnam calendar day (UTC+7, no DST) that contains `now`, as UTC instants. */
export function vietnamDayRange(now: Date = new Date()): { start: Date; end: Date } {
  const startMs = Math.floor((now.getTime() + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}
