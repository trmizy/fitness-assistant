/**
 * The client's OWN sessions on one calendar day, for the "Đặt lịch" tab (pure; no React, no network).
 *
 * The calendar marks a day with a dot when a session starts on it; this is the same rule, so the panel that opens when
 * the day is clicked can never disagree with the dot. Session timestamps are UTC instants and the calendar is drawn in
 * the viewer's own timezone (a Vietnamese client's device = UTC+7), hence the key is built from LOCAL date parts.
 * Keys are zero-padded "YYYY-MM-DD", the same shape the slot endpoint and `selectedDateStr` use.
 *
 * Run: npx tsx --test src/app/utils/__tests__/daySessions.test.ts
 */

export interface DaySessionLike {
  id: string;
  status: string;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
}

export type DaySessionTab = "upcoming" | "confirm" | "past";

/** Local calendar day of a Date as "YYYY-MM-DD". */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Local calendar day an ISO instant falls on; null when missing or not a date. */
export function sessionDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : localDayKey(d);
}

/**
 * Sessions that count as "on that day": every one that is not cancelled (what the calendar dot shows), once per id
 * (the upcoming list and the per-contract list overlap - the first occurrence wins, it is the one carrying the open
 * reschedule proposals), earliest first.
 */
export function sessionsOnDay<T extends DaySessionLike>(sessions: ReadonlyArray<T>, dayKey: string | null): T[] {
  if (!dayKey) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of sessions) {
    if (!s || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    if (s.status === "CANCELLED") continue;
    if (sessionDayKey(s.scheduledStartAt) !== dayKey) continue;
    out.push(s);
  }
  return out.sort((a, b) => String(a.scheduledStartAt).localeCompare(String(b.scheduledStartAt)));
}

/** Every day that holds at least one non-cancelled session (the calendar dots). */
export function bookedDayKeys(sessions: ReadonlyArray<DaySessionLike>): Set<string> {
  const days = new Set<string>();
  for (const s of sessions) {
    if (!s || s.status === "CANCELLED") continue;
    const key = sessionDayKey(s.scheduledStartAt);
    if (key) days.add(key);
  }
  return days;
}

function hhmm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "09:00–10:00" (local time); just "09:00" when the end is unknown. */
export function sessionTimeRange(s: Pick<DaySessionLike, "scheduledStartAt" | "scheduledEndAt">): string {
  const start = hhmm(s.scheduledStartAt);
  if (!start) return "";
  const end = hhmm(s.scheduledEndAt);
  return end && end !== start ? `${start}–${end}` : start;
}

/**
 * Which tab of the page lists this session, so tapping it leads somewhere it is actually shown: waiting for the
 * client's confirmation -> "confirm"; still to come (requested / confirmed, not yet started) -> "upcoming"; anything
 * finished or already started -> "past" (that tab also lists a confirmed session whose time has passed).
 */
export function sessionTabFor(s: DaySessionLike, now: Date = new Date()): DaySessionTab {
  if (s.status === "PENDING_CLIENT_CONFIRMATION") return "confirm";
  if (s.status === "REQUESTED" || s.status === "CONFIRMED") {
    const t = s.scheduledStartAt ? new Date(s.scheduledStartAt).getTime() : NaN;
    return Number.isFinite(t) && t < now.getTime() ? "past" : "upcoming";
  }
  return "past";
}
