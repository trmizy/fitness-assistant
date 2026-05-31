export interface JoinSessionState {
  visible: boolean;
  enabled: boolean;
  label: string;
  reason?: string;
}

const JOIN_BEFORE_MS = 10 * 60 * 1000;  // button appears 10 min before start
const JOIN_AFTER_MS  = 15 * 60 * 1000;  // button disappears 15 min after end

export function getJoinSessionState(
  session: {
    sessionMode: string;
    status: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    clientUserId: string;
    ptUserId: string;
  } | null | undefined,
  userId: string | null | undefined,
): JoinSessionState {
  const HIDDEN: JoinSessionState = { visible: false, enabled: false, label: '' };

  if (!session || !userId) return HIDDEN;
  if (session.sessionMode !== 'ONLINE') return HIDDEN;
  if (session.clientUserId !== userId && session.ptUserId !== userId) return HIDDEN;
  if (session.status !== 'CONFIRMED') return HIDDEN;

  const now = Date.now();
  const windowStart = new Date(session.scheduledStartAt).getTime() - JOIN_BEFORE_MS;
  const windowEnd   = new Date(session.scheduledEndAt).getTime()   + JOIN_AFTER_MS;

  if (now < windowStart) {
    return { visible: true, enabled: false, label: 'Tham gia buổi học', reason: 'Chưa đến giờ học' };
  }
  if (now > windowEnd) {
    return { visible: true, enabled: false, label: 'Tham gia buổi học', reason: 'Buổi học đã kết thúc' };
  }

  return { visible: true, enabled: true, label: 'Tham gia buổi học' };
}
