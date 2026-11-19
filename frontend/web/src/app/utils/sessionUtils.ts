export interface JoinSessionState {
  visible: boolean;
  enabled: boolean;
  label: string;
  reason?: string;
}

// The room is open exactly when the server says: from joinOpensAt (ROOM_OPEN_BEFORE_MINUTES before the start, 15 by
// default) until joinClosesAt (the scheduled end, no grace tail) — the sessions endpoints return both. Older responses
// without them fall back to the same default rule, so the button is never enabled for a window the server refuses.
const DEFAULT_OPEN_BEFORE_MS = 15 * 60 * 1000;

/** "Mở phòng lúc 09:45", with the day ("20/11") when it is not today. */
export function roomOpensLabel(opensAtMs: number, nowMs: number = Date.now()): string {
  const d = new Date(opensAtMs);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const n = new Date(nowMs);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? `Mở phòng lúc ${hhmm}` : `Mở phòng lúc ${hhmm} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function getJoinSessionState(
  session:
    | {
        sessionMode: string;
        status: string;
        scheduledStartAt: string;
        scheduledEndAt: string;
        clientUserId: string;
        ptUserId: string;
        joinOpensAt?: string | null;
        joinClosesAt?: string | null;
      }
    | null
    | undefined,
  userId: string | null | undefined,
  now: number = Date.now(),
): JoinSessionState {
  const HIDDEN: JoinSessionState = {
    visible: false,
    enabled: false,
    label: "",
  };

  if (!session || !userId) return HIDDEN;
  if (session.sessionMode !== "ONLINE") return HIDDEN;
  if (session.clientUserId !== userId && session.ptUserId !== userId)
    return HIDDEN;
  if (session.status !== "CONFIRMED") return HIDDEN;

  const windowStart = session.joinOpensAt
    ? new Date(session.joinOpensAt).getTime()
    : new Date(session.scheduledStartAt).getTime() - DEFAULT_OPEN_BEFORE_MS;
  const windowEnd = session.joinClosesAt
    ? new Date(session.joinClosesAt).getTime()
    : new Date(session.scheduledEndAt).getTime();

  if (now < windowStart) {
    return {
      visible: true,
      enabled: false,
      label: "Tham gia buổi học",
      reason: roomOpensLabel(windowStart, now),
    };
  }
  if (now >= windowEnd) {
    return {
      visible: true,
      enabled: false,
      label: "Tham gia buổi học",
      reason: "Buổi học đã kết thúc",
    };
  }

  return { visible: true, enabled: true, label: "Tham gia buổi học" };
}
