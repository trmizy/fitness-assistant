/**
 * Owner decision 20/11/2026 (no 24-hour grace): a PT cancelling a CONFIRMED session - or blocking a whole day that holds one -
 * compensates the client one session in cash, charged to the PT's earnings, at ANY notice. A REQUESTED one (never confirmed) is free.
 * Same wording as the mobile app (frontend/mobile/src/features/pt/pt.ts).
 */
export const PT_CANCEL_CONFIRMED_NOTICE =
  "Huỷ buổi đã xác nhận (kể cả chặn ngày nghỉ) sẽ bồi thường cho học viên 1 buổi bằng tiền, trừ vào thu nhập của bạn. Nên dùng Đổi lịch nếu học viên đồng ý.";

/** Body of the confirm shown before a PT cancels (or rejects) a session. */
export function ptCancelNotice(status: string, name: string): string {
  return status === "CONFIRMED"
    ? `${PT_CANCEL_CONFIRMED_NOTICE} Buổi với ${name} sẽ bị huỷ và học viên sẽ nhận được thông báo.`
    : `Buổi với ${name} sẽ bị huỷ. Học viên sẽ nhận được thông báo.`;
}

/** How many CONFIRMED sessions sit on `dateStr` (`YYYY-MM-DD`, local day - the server blocks by the local day too). */
export function confirmedSessionsOnDate(
  sessions: ReadonlyArray<{ status?: string; scheduledStartAt?: string }>,
  dateStr: string,
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr ?? "").trim());
  if (!m) return 0;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  return sessions.filter((s) => {
    if (s?.status !== "CONFIRMED" || !s.scheduledStartAt) return false;
    const t = new Date(s.scheduledStartAt);
    return !Number.isNaN(t.getTime()) && t.getFullYear() === y && t.getMonth() === mo && t.getDate() === d;
  }).length;
}

/** Body of the "block this day" confirm - asked only when the day holds CONFIRMED sessions. */
export function ptBlockDayNotice(confirmedCount: number): string {
  return `Ngày này có ${confirmedCount} buổi đã xác nhận. ${PT_CANCEL_CONFIRMED_NOTICE}`;
}
