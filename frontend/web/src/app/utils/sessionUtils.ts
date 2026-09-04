export interface JoinSessionState {
  visible: boolean;
  enabled: boolean;
  label: string;
  reason?: string;
}

// Both sides have to be in the room at the same time, and neither clock is exact: a client
// opening the app early or a trainer running over should not find the button dead. A wide
// grace band on each side costs nothing — the server still refuses to mint a join token for
// anything that isn't a CONFIRMED, ONLINE session the caller belongs to.
const JOIN_BEFORE_MS = 30 * 60 * 1000; // button becomes usable 30 min before start
const JOIN_AFTER_MS = 30 * 60 * 1000; // stays usable until 30 min after the end

export function getJoinSessionState(
  session:
    | {
        sessionMode: string;
        status: string;
        scheduledStartAt: string;
        scheduledEndAt: string;
        clientUserId: string;
        ptUserId: string;
      }
    | null
    | undefined,
  userId: string | null | undefined,
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

  const now = Date.now();
  const windowStart =
    new Date(session.scheduledStartAt).getTime() - JOIN_BEFORE_MS;
  const windowEnd = new Date(session.scheduledEndAt).getTime() + JOIN_AFTER_MS;

  if (now < windowStart) {
    return {
      visible: true,
      enabled: false,
      label: "Tham gia buổi học",
      reason: "Chưa đến giờ học",
    };
  }
  if (now > windowEnd) {
    return {
      visible: true,
      enabled: false,
      label: "Tham gia buổi học",
      reason: "Buổi học đã kết thúc",
    };
  }

  return { visible: true, enabled: true, label: "Tham gia buổi học" };
}
