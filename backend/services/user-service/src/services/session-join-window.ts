import { ROOM_OPEN_BEFORE_MINUTES } from "./booking.service";

/**
 * When the "meeting room" of an online session is open — the SAME rule joinSession() enforces
 * (opens ROOM_OPEN_BEFORE_MINUTES before the start, closes hard at scheduledEndAt). Clients enable
 * "Tham gia buổi học" from these two instants instead of guessing their own margins (they used to
 * allow 30 min before / 30 min after the end, so people tapped the button and were refused).
 */
export function joinWindowOf(
  scheduledStartAt: Date | string | null | undefined,
  scheduledEndAt: Date | string | null | undefined,
  openBeforeMinutes: number = ROOM_OPEN_BEFORE_MINUTES,
): { joinOpensAt: string; joinClosesAt: string } | null {
  if (!scheduledStartAt || !scheduledEndAt) return null;
  const start = new Date(scheduledStartAt).getTime();
  const end = new Date(scheduledEndAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    joinOpensAt: new Date(start - openBeforeMinutes * 60_000).toISOString(),
    joinClosesAt: new Date(end).toISOString(),
  };
}

/** Adds joinOpensAt / joinClosesAt to a session row (or to every row of a list); anything else passes through. */
export function withJoinWindow<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => withJoinWindow(v)) as unknown as T;
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, any>;
  const window = joinWindowOf(row.scheduledStartAt, row.scheduledEndAt);
  return window ? ({ ...row, ...window } as T) : value;
}
