/**
 * Home-screen shortcut helper (pure): the client's nearest upcoming PT session.
 * Only the three "still ahead" statuses count; a session counts while it has not ended yet
 * (so one that is happening today/now still shows).
 */
export const NEXT_SESSION_STATUSES = ["REQUESTED", "CONFIRMED", "PENDING_CLIENT_CONFIRMATION"] as const;

export type NextSessionInput = {
  id: string;
  status: string;
  startAt: string | null;
  endAt: string | null;
};

export function pickNextPtSession<T extends NextSessionInput>(sessions: readonly T[] | null | undefined, now: Date = new Date()): T | null {
  if (!Array.isArray(sessions)) return null;
  const nowMs = now.getTime();
  let best: T | null = null;
  let bestStart = Infinity;
  for (const s of sessions) {
    if (!s || !(NEXT_SESSION_STATUSES as readonly string[]).includes(s.status)) continue;
    const start = s.startAt ? Date.parse(s.startAt) : NaN;
    if (!Number.isFinite(start)) continue;
    const end = s.endAt ? Date.parse(s.endAt) : NaN;
    const limit = Number.isFinite(end) ? end : start;
    if (limit < nowMs) continue;
    if (start < bestStart) {
      best = s;
      bestStart = start;
    }
  }
  return best;
}
