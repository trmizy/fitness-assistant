/**
 * The client's OWN sessions on one calendar day, shown beside the free slots in the "Đặt buổi tập" sheet (pure).
 *
 * Days are "YYYY-MM-DD" keys in the device's local calendar (UTC+7 for a Vietnamese client) - the same keys the calendar
 * and the slot endpoint use. Cancelled sessions are left out; a session appears once; earliest first.
 *
 * Runs with: ./node_modules/.bin/tsx --test src/features/__tests__/daySessions.test.ts
 */

import { toDateKey } from "./bookingCalendar";

export type DaySession = {
  id: string;
  status: string;
  startAt: string | null;
  endAt: string | null;
  ptUserId?: string;
};

export function sessionsOnDay<T extends DaySession>(sessions: ReadonlyArray<T>, dayKey: string | null): T[] {
  if (!dayKey) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of sessions) {
    if (!s || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    if (s.status === "CANCELLED" || !s.startAt) continue;
    const d = new Date(s.startAt);
    if (Number.isNaN(d.getTime()) || toDateKey(d) !== dayKey) continue;
    out.push(s);
  }
  return out.sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
}

function hhmm(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "09:00–10:00" (local time); the start alone when the end is unknown. */
export function sessionTimeRange(s: Pick<DaySession, "startAt" | "endAt">): string {
  const start = hhmm(s.startAt);
  if (!start) return "";
  const end = hhmm(s.endAt);
  return end && end !== start ? `${start}–${end}` : start;
}
