export interface JoinSessionState {
  visible: boolean;
  enabled: boolean;
  label: string;
  reason?: string;
}

const JOIN_BEFORE_MS = 10 * 60 * 1000;
const JOIN_AFTER_MS  = 15 * 60 * 1000;

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

  const startTs = new Date(session.scheduledStartAt).getTime();
  const endTs   = new Date(session.scheduledEndAt).getTime();
  if (Number.isNaN(startTs) || Number.isNaN(endTs)) {
    return { visible: true, enabled: false, label: 'Tham gia buổi học', reason: 'Thiếu thông tin thời gian' };
  }
  if (endTs <= startTs) {
    return { visible: true, enabled: false, label: 'Tham gia buổi học', reason: 'Thời gian buổi học không hợp lệ' };
  }

  const now = Date.now();
  if (now < startTs - JOIN_BEFORE_MS) {
    return { visible: true, enabled: false, label: 'Tham gia buổi học', reason: 'Có thể tham gia trước giờ học 10 phút' };
  }
  if (now > endTs + JOIN_AFTER_MS) {
    return { visible: true, enabled: false, label: 'Buổi học đã kết thúc', reason: 'Buổi học đã kết thúc' };
  }
  return { visible: true, enabled: true, label: 'Tham gia buổi học' };
}
