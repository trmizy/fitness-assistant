/**
 * Rescheduling a confirmed PT session (client side): the rules the server enforces (booking.service.ts requestReschedule),
 * said in plain Vietnamese BEFORE the form is filled, so "Dời lịch" never looks dead or fails only at the last click.
 * The server stays the authority; this only explains.
 */

/** Same as the server: a move may not be requested this close to the ORIGINAL start. */
export const RESCHEDULE_WINDOW_HOURS = 12;
/** Same as the server: the NEW time must start at least this far from now (also the booking lead time). */
export const RESCHEDULE_LEAD_HOURS = 24;
/** Same as the server: at most two ACCEPTED moves per session, counting both sides. */
export const RESCHEDULE_MAX_MOVES = 2;
export const DAY_WITHIN_LEAD_HINT = `Dời lịch phải cách hiện tại ít nhất ${RESCHEDULE_LEAD_HOURS} giờ — hãy chọn ngày muộn hơn.`;

type SessionLike = {
  status: string;
  scheduledStartAt: string;
  rescheduleRequests?: Array<{ requestedBy?: string }> | null;
};

/** How many times a session was really moved: the ACCEPTED rows of its reschedule history (either side). */
export function acceptedMovesOf(history: unknown): number {
  return Array.isArray(history) ? history.filter((r) => (r as { status?: string } | null)?.status === "ACCEPTED").length : 0;
}

/**
 * null = a proposal can be sent. Otherwise why not, worded for who is asking (`viewer`, default the client).
 * `acceptedMoves` comes from the session's history (the upcoming list only carries the open proposal); leave it out while that
 * history is still loading and the 2-move cap is simply not claimed yet (the server stays the authority).
 */
export function rescheduleBlockedReason(
  session: SessionLike,
  opts: { now?: Date; acceptedMoves?: number; viewer?: "CLIENT" | "PT" } = {},
): string | null {
  const now = opts.now ?? new Date();
  const viewer = opts.viewer ?? "CLIENT";
  const other = viewer === "PT" ? "khách" : "PT";
  if (session.status !== "CONFIRMED") {
    return viewer === "PT" ? "Chỉ buổi đã xác nhận mới dời lịch được." : "Chỉ buổi đã được PT xác nhận mới dời lịch được.";
  }
  const open = session.rescheduleRequests?.[0];
  if (open) {
    const mine = (open.requestedBy ?? "CLIENT") === viewer;
    return mine
      ? `Bạn đã gửi một đề nghị dời lịch, đang chờ ${other} trả lời.`
      : `${viewer === "PT" ? "Khách" : "PT"} đang đề nghị dời lịch — hãy trả lời đề nghị đó trước.`;
  }
  if ((opts.acceptedMoves ?? 0) >= RESCHEDULE_MAX_MOVES) {
    return `Buổi tập này đã dời ${RESCHEDULE_MAX_MOVES} lần — chỉ còn cách huỷ.`;
  }
  const start = Date.parse(session.scheduledStartAt);
  if (!Number.isFinite(start)) return null;
  const hours = (start - now.getTime()) / 3_600_000;
  if (hours <= 0) return "Buổi tập đã bắt đầu, không dời lịch được nữa.";
  if (hours < RESCHEDULE_WINDOW_HOURS) {
    return `Chỉ dời lịch được khi còn hơn ${RESCHEDULE_WINDOW_HOURS} giờ trước buổi tập.`;
  }
  return null;
}

/** The success line after the client cancels: the two cases cost differently (owner decision 20/11/2026), so say which happened. */
export function cancelSuccessText(status: string): string {
  return status === "CONFIRMED"
    ? "Đã huỷ buổi — bạn mất 1 buổi trong hợp đồng"
    : status === "REQUESTED"
      ? "Đã huỷ yêu cầu đặt buổi"
      : "Đã huỷ buổi tập";
}

/** Why "Gửi yêu cầu" is still greyed out (null = ready). */
export function rescheduleSubmitHint(input: { dateStr?: string | null; slot?: string | null; reason: string }): string | null {
  if (!input.dateStr) return "Chọn ngày mới.";
  if (!input.slot) return "Chọn khung giờ mới.";
  if (!input.reason.trim()) return "Nhập lý do dời lịch.";
  return null;
}

/** True when the whole day (YYYY-MM-DD, local) ends inside the lead window, so no slot of it can ever be offered. */
export function dayEndsWithinLead(dateStr: string, now: Date = new Date(), leadHours: number = RESCHEDULE_LEAD_HOURS): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return false;
  const lastMoment = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  return lastMoment - now.getTime() < leadHours * 3_600_000;
}

/**
 * The words for a refused reschedule. user-service answers `{ error: "…" }`; a gateway refusal (expired session, rate
 * limit) is `{ error: { code, message } }` - never hand an object to a toast.
 */
export function rescheduleErrorMessage(error: unknown, fallback: string): string {
  const e = error as { response?: { data?: { error?: unknown; message?: unknown } } } | null | undefined;
  if (!e?.response) return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  const data = e.response.data;
  const nested = (data?.error as { message?: unknown } | undefined)?.message;
  for (const candidate of [data?.error, nested, data?.message]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return fallback;
}
