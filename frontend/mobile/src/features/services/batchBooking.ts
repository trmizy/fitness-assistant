/**
 * Pure logic behind booking several slots at once ("Đặt nhiều buổi") - nothing here knows React or the network.
 *
 * The rules mirrored here are the server's (`POST /sessions/batch`, user-service booking.service.ts); they only let the
 * sheet say "no" early. The server stays the authority and answers a refusal per slot (`slotErrors`).
 *  - at most MAX_BATCH_SESSIONS slots per request
 *  - at most MAX_SESSIONS_PER_DAY live sessions per client per day (a pending REQUESTED one counts), the batch included
 *  - never more than the contract has left
 *
 * Runs with: ./node_modules/.bin/tsx --test src/features/__tests__/batchBooking.test.ts
 */

import { dayLabel, toDateKey } from "./bookingCalendar";

export const MAX_BATCH_SESSIONS = 10;
export const MAX_SESSIONS_PER_DAY = 2;

export type PickedSlot = { date: string; time: string };

export const slotKey = (slot: PickedSlot): string => `${slot.date} ${slot.time}`;

export function slotLabel(slot: PickedSlot): string {
  return `${dayLabel(slot.date)} · ${slot.time}`;
}

/** Chronological: date then time (both fixed-width strings, so a string compare is a time compare). */
export function sortSlots(list: PickedSlot[]): PickedSlot[] {
  return [...list].sort((a, b) => slotKey(a).localeCompare(slotKey(b)));
}

export type AddResult = { list: PickedSlot[]; error: string | null };

/** Add one slot to the list; on a refusal the list is returned unchanged with the reason in Vietnamese. */
export function addSlot(list: PickedSlot[], slot: PickedSlot, opts: { sessionsLeft: number }): AddResult {
  if (list.some((s) => slotKey(s) === slotKey(slot))) {
    return { list, error: "Khung giờ này đã có trong danh sách." };
  }
  if (list.length >= MAX_BATCH_SESSIONS) {
    return { list, error: `Mỗi lần chỉ đặt được tối đa ${MAX_BATCH_SESSIONS} buổi.` };
  }
  if (list.length >= opts.sessionsLeft) {
    return { list, error: `Gói chỉ còn ${Math.max(0, opts.sessionsLeft)} buổi để đặt.` };
  }
  if (list.filter((s) => s.date === slot.date).length >= MAX_SESSIONS_PER_DAY) {
    return { list, error: `Mỗi ngày chỉ đặt tối đa ${MAX_SESSIONS_PER_DAY} buổi — hãy chọn ngày khác.` };
  }
  return { list: sortSlots([...list, slot]), error: null };
}

/** Shown on a calendar day the client can not add another session to. */
export const DAY_FULL_HINT = `Đã đủ ${MAX_SESSIONS_PER_DAY} buổi trong ngày`;

/**
 * Days (local "YYYY-MM-DD") on which the client already holds MAX_SESSIONS_PER_DAY live sessions (REQUESTED or CONFIRMED, any PT),
 * not counting `movingSessionId` — the session being rescheduled leaves its own day. Built only from sessions the app already
 * loaded, so it can only say "no" early; the server stays the authority (409 CLIENT_DAILY_SESSION_LIMIT).
 */
export function fullSessionDays(
  sessions: ReadonlyArray<{ id: string; status: string; startAt: string | null }>,
  movingSessionId?: string | null,
): Set<string> {
  const seen = new Set<string>();
  const perDay = new Map<string, number>();
  for (const s of sessions) {
    if (!s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    if (s.id === movingSessionId) continue;
    if (s.status !== "REQUESTED" && s.status !== "CONFIRMED") continue;
    const t = s.startAt ? new Date(s.startAt) : null;
    if (!t || Number.isNaN(t.getTime())) continue;
    const key = toDateKey(t);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const full = new Set<string>();
  for (const [key, n] of perDay) if (n >= MAX_SESSIONS_PER_DAY) full.add(key);
  return full;
}

export function removeSlot(list: PickedSlot[], slot: PickedSlot): PickedSlot[] {
  return list.filter((s) => slotKey(s) !== slotKey(slot));
}

/** The body for `POST /sessions/batch` (the contract id is passed separately by the service). */
export function buildBatchPayload(input: {
  slots: PickedSlot[];
  sessionMode?: string | null;
  location?: string;
  notes?: string;
}): {
  slots: Array<{ scheduledDate: string; scheduledTime: string }>;
  sessionMode?: string;
  location?: string;
  notes?: string;
} {
  const location = input.location?.trim();
  const notes = input.notes?.trim();
  return {
    slots: sortSlots(input.slots).map((s) => ({ scheduledDate: s.date, scheduledTime: s.time })),
    ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
    ...(location ? { location } : {}),
    ...(notes ? { notes } : {}),
  };
}

/**
 * A refused batch, from an axios error: the reason per slot (keyed by `slotKey`) and the headline.
 * `slotErrors` entries carry the date/time the server parsed, so the match does not depend on the order sent.
 */
export function readBatchRejection(error: unknown): { bySlot: Record<string, string>; headline: string | null } {
  const data = (error as any)?.response?.data;
  const bySlot: Record<string, string> = {};
  if (Array.isArray(data?.slotErrors)) {
    for (const row of data.slotErrors) {
      const date = String(row?.scheduledDate ?? "");
      const time = String(row?.scheduledTime ?? "");
      const message = String(row?.error ?? row?.message ?? "Khung giờ không đặt được");
      if (date && time) bySlot[`${date} ${time}`] = message;
    }
  }
  const headline = typeof data?.error === "string" && data.error ? data.error : null;
  return { bySlot, headline };
}

/** Why the "review" button is off. null = it can be pressed. */
export function batchBlockedReason(input: {
  contractStatus: string;
  sessionsLeft: number;
  count: number;
}): string | null {
  if (input.contractStatus !== "ACTIVE") return "Chỉ đặt được buổi trên hợp đồng đang hiệu lực.";
  if (input.sessionsLeft <= 0) return "Gói đã dùng hết số buổi.";
  if (input.count === 0) return "Chọn ngày và khung giờ.";
  return null;
}
