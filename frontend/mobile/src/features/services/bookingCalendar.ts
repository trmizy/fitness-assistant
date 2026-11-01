/**
 * Pure date logic behind the month calendar in the "Đặt buổi tập" / "Đổi lịch" sheets.
 *
 * Nothing here knows about React or the network. The rules it mirrors are the server's, not new
 * ones: a new booking needs BOOKING_LEAD_HOURS' notice, a session must start inside the contract's
 * validity window, and a day only counts as bookable when the PT really has a free slot on it
 * (the slot list itself comes from `GET /availability/:ptUserId/slots?date=`, one day per call).
 *
 * Days are "YYYY-MM-DD" keys in the device's local calendar — the same shape the slot endpoint and
 * `buildBookingPayload` use. The week starts on Monday (Vietnamese convention).
 *
 * Runs with: ./node_modules/.bin/tsx --test src/features/__tests__/bookingCalendar.test.ts
 */

import { bookableSlots } from "./sessions";

/** Calendar header, Monday first. */
export const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;

/**
 * How far ahead the calendar reaches when the contract has no end date of its own. The server sets
 * no horizon; this only keeps the month navigation (and the per-day slot requests it triggers)
 * finite. Contracts with an end date are capped by that date instead, whichever comes first.
 */
export const CALENDAR_HORIZON_DAYS = 60;

export type MonthRef = { year: number; month: number }; // month is 0-based, like Date

export type CalendarCell = {
  key: string;
  day: number;
};

export type DateRange = { minKey: string; maxKey: string };

export function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function dateKeyOf(year: number, month: number, day: number): string {
  return toDateKey(new Date(year, month, day));
}

/** "2026-10-27" -> local Date at midnight; null when it is not a real calendar day. */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [y, mo, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

export function monthOf(date: Date): MonthRef {
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function monthOfKey(key: string): MonthRef | null {
  const date = parseDateKey(key);
  return date ? monthOf(date) : null;
}

/** Month arithmetic that rolls the year over (Dec + 1 = Jan next year). */
export function addMonths(ref: MonthRef, delta: number): MonthRef {
  const index = ref.year * 12 + ref.month + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

export function compareMonths(a: MonthRef, b: MonthRef): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

export function monthTitle(ref: MonthRef): string {
  return `Tháng ${ref.month + 1}, ${ref.year}`;
}

/** Monday = 0 .. Sunday = 6 (JS getDay() is Sunday = 0). */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * The month as rows of 7, Monday first. Cells outside the month are `null` so the grid keeps its
 * shape without inventing days from the neighbouring months. Always 4..6 rows.
 */
export function monthGrid(ref: MonthRef): (CalendarCell | null)[][] {
  const first = new Date(ref.year, ref.month, 1);
  const daysInMonth = new Date(ref.year, ref.month + 1, 0).getDate();
  const lead = mondayIndex(first);
  const cells: (CalendarCell | null)[] = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ key: dateKeyOf(ref.year, ref.month, day), day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (CalendarCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

type RangeInput = {
  now?: Date;
  /** 24 for a new booking (BR-30), 0 for a reschedule proposal. */
  leadHours: number;
  /** Contract end — a session may not start after it. null/undefined = open ended. */
  contractEnd?: string | null;
  /** Contract start — only a reschedule is checked against it by the server. */
  contractStart?: string | null;
  horizonDays?: number;
};

function dayKeyOfInstant(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : toDateKey(d);
}

/**
 * The first and last day the calendar lets a person pick; null when nothing is left (the contract
 * ends before the lead time allows). The first day is the one that contains `now + leadHours`: an
 * earlier day cannot hold a slot the server would accept.
 */
export function bookingRange(input: RangeInput): DateRange | null {
  const now = input.now ?? new Date();
  const earliest = new Date(now.getTime() + input.leadHours * 3_600_000);
  let minKey = toDateKey(earliest);
  const startKey = dayKeyOfInstant(input.contractStart);
  if (startKey && startKey > minKey) minKey = startKey;

  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (input.horizonDays ?? CALENDAR_HORIZON_DAYS));
  let maxKey = toDateKey(horizon);
  const endKey = dayKeyOfInstant(input.contractEnd);
  if (endKey && endKey < maxKey) maxKey = endKey;

  return minKey > maxKey ? null : { minKey, maxKey };
}

export function inRange(key: string, range: DateRange | null): boolean {
  return !!range && key >= range.minKey && key <= range.maxKey;
}

/** The months the arrows may reach: the range's first month through its last. */
export function canGoPrev(current: MonthRef, range: DateRange | null): boolean {
  const first = range ? monthOfKey(range.minKey) : null;
  return !!first && compareMonths(current, first) > 0;
}

export function canGoNext(current: MonthRef, range: DateRange | null): boolean {
  const last = range ? monthOfKey(range.maxKey) : null;
  return !!last && compareMonths(current, last) < 0;
}

/** Keep a month inside what the range allows (a stale month after switching contracts, say). */
export function clampMonth(current: MonthRef, range: DateRange | null): MonthRef {
  const first = range ? monthOfKey(range.minKey) : null;
  const last = range ? monthOfKey(range.maxKey) : null;
  if (!first || !last) return current;
  if (compareMonths(current, first) < 0) return first;
  if (compareMonths(current, last) > 0) return last;
  return current;
}

const DAY_ENUM_TO_JS: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

/**
 * Which weekdays (JS getDay values) the PT publishes active hours for, from `GET /availability/:pt`.
 * null means "unknown / nothing published": the caller must then ask the slot endpoint for every
 * day, because that endpoint seeds an empty schedule on first read — not assume the PT is closed.
 */
export function activeWeekdays(raw: unknown): Set<number> | null {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : null;
  if (!list || list.length === 0) return null;
  const days = new Set<number>();
  for (const row of list) {
    if (row?.isActive === false) continue;
    const day = DAY_ENUM_TO_JS[String(row?.dayOfWeek ?? "").toUpperCase()];
    if (day !== undefined) days.add(day);
  }
  return days;
}

/**
 * The days of `month` worth asking the slot endpoint about: inside the range and, when the PT's
 * weekly pattern is known, on a weekday they work. Saves ~3 requests in 7 without ever hiding a
 * day that could have a slot.
 */
export function candidateDays(month: MonthRef, range: DateRange | null, weekdays: Set<number> | null): string[] {
  if (!range) return [];
  const out: string[] = [];
  for (const row of monthGrid(month)) {
    for (const cell of row) {
      if (!cell || !inRange(cell.key, range)) continue;
      const date = parseDateKey(cell.key)!;
      if (weekdays && !weekdays.has(date.getDay())) continue;
      out.push(cell.key);
    }
  }
  return out;
}

/**
 * The slots of one day that a person could really take: not past the lead time, and not starting
 * after the contract's end (the server refuses those with "vượt quá ngày kết thúc hợp đồng").
 */
export function freeSlotsOfDay(
  slots: string[],
  date: string,
  opts: { now?: Date; leadHours: number; contractEnd?: string | null; contractStart?: string | null },
): string[] {
  const now = opts.now ?? new Date();
  const byLead = bookableSlots(slots, date, now, opts.leadHours);
  const end = opts.contractEnd ? new Date(opts.contractEnd).getTime() : NaN;
  const start = opts.contractStart ? new Date(opts.contractStart).getTime() : NaN;
  const day = parseDateKey(date);
  if (!day || (Number.isNaN(end) && Number.isNaN(start))) return byLead;
  return byLead.filter((slot) => {
    const [h, m] = slot.split(":").map(Number);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
    return (Number.isNaN(end) || at <= end) && (Number.isNaN(start) || at >= start);
  });
}

/** Days (keys) that have at least one takeable slot, from whatever slot lists have loaded so far. */
export function daysWithFreeSlots(
  slotsByDate: Record<string, string[] | undefined>,
  opts: { now?: Date; leadHours: number; contractEnd?: string | null; contractStart?: string | null },
): Set<string> {
  const free = new Set<string>();
  for (const [date, slots] of Object.entries(slotsByDate)) {
    if (slots && freeSlotsOfDay(slots, date, opts).length > 0) free.add(date);
  }
  return free;
}

export type DayState = "selected" | "free" | "none" | "pending" | "out";

/**
 * How one cell is drawn and whether it can be tapped.
 *  - out: outside the allowed range (dimmed, disabled)
 *  - selected / free: has at least one takeable slot (accent)
 *  - pending: allowed, but its slots have not loaded yet (neutral, disabled until known)
 *  - none: allowed but nothing to book (dimmed, disabled)
 */
export function dayState(
  key: string,
  ctx: { range: DateRange | null; free: Set<string>; pending: Set<string>; selected: string | null },
): DayState {
  if (!inRange(key, ctx.range)) return "out";
  if (key === ctx.selected) return "selected";
  if (ctx.free.has(key)) return "free";
  return ctx.pending.has(key) ? "pending" : "none";
}

/** Only a day known to have a slot can be tapped. */
export function isTappable(state: DayState): boolean {
  return state === "free" || state === "selected";
}

const WEEKDAY_SHORT = ["CN", "Th 2", "Th 3", "Th 4", "Th 5", "Th 6", "Th 7"];

/** "2026-10-27" -> "Th 3, 27/10". */
export function dayLabel(key: string): string {
  const date = parseDateKey(key);
  if (!date) return "";
  return `${WEEKDAY_SHORT[date.getDay()]}, ${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}
