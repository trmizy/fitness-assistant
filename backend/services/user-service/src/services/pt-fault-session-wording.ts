/**
 * Wording for the client/PT notices raised when a PT-fault session is settled (PT no-show, PT late cancel, PT blocking a
 * confirmed day, PT never entering the room, PT arriving late, admin confirming a PT no-show).
 *
 * Business rule DQ-2(a): the client is refunded the session's value (price / totalSessions) to the wallet, the session is
 * CLOSED as "not delivered - refunded", it still counts as consumed (the client's remaining sessions go down by one),
 * no replacement session is created, and the PT is not paid for it. The old texts said "buổi tập không bị trừ" and
 * promised the refund unconditionally - both wrong. The money sentence now depends on what payment-service actually
 * answered (`paid` / `owed` / `unpaid` decimal strings); when the answer does not carry them (older payment-service,
 * a retried/parked step) the sentence is neutral and names no amount.
 */

/** What payment-service reported for a PT-fault compensation: decimal strings (VND). */
export interface PtFaultMoney {
  paid: string;
  owed: string;
  unpaid: string;
}

const DECIMAL = /^\d+(\.\d+)?$/;

function asDecimal(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(v);
  if (typeof v === "string" && DECIMAL.test(v.trim())) return v.trim();
  return null;
}

/**
 * Reads the money outcome out of whatever the compensation step handed back: the raw payment-service answer, or the
 * tracked-settlement wrapper (`{ state: "SETTLED", result }`). Anything else - a void return, ALREADY_SETTLED, FAILED,
 * IN_FLIGHT, a result without the `paid` fields - yields null (neutral wording).
 */
export function readPtFaultMoney(outcome: unknown): PtFaultMoney | null {
  if (!outcome || typeof outcome !== "object") return null;
  let result: unknown = outcome;
  const wrapped = outcome as { state?: unknown; result?: unknown };
  if (typeof wrapped.state === "string") {
    if (wrapped.state !== "SETTLED") return null;
    result = wrapped.result;
  }
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const paid = asDecimal(r.paid);
  if (paid === null) return null;
  const owed = asDecimal(r.owed);
  let unpaid = asDecimal(r.unpaid);
  if (unpaid === null && owed !== null) unpaid = String(Math.max(Number(owed) - Number(paid), 0));
  if (unpaid === null) return null;
  return { paid, owed: owed ?? String(Number(paid) + Number(unpaid)), unpaid };
}

/** "250000.00" -> "250.000" (VND has no minor unit). */
export function formatVnd(amount: string): string {
  return Math.round(Number(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** The DQ-2(a) statement about the session itself. */
export const PT_FAULT_SESSION_CLOSED =
  "Buổi tập này được đóng là «không diễn ra — hoàn tiền», vẫn tính vào số buổi đã dùng của gói và không có buổi bù thêm.";

/** The wallet statement for a refund of the session value. */
export function refundMoneySentence(money: PtFaultMoney | null): string {
  if (!money) return "Giá trị buổi tập được hoàn vào ví của bạn; số tiền cụ thể xem trong lịch sử ví.";
  const paid = Number(money.paid);
  const unpaid = Number(money.unpaid);
  if (unpaid > 0) {
    return paid > 0
      ? `Đã hoàn ${formatVnd(money.paid)}đ vào ví; ${formatVnd(money.unpaid)}đ còn lại đang được đối soát.`
      : `Chưa hoàn được vào ví ngay; ${formatVnd(money.unpaid)}đ đang được đối soát.`;
  }
  return paid > 0 ? `Đã hoàn ${formatVnd(money.paid)}đ vào ví.` : refundMoneySentence(null);
}

/** The wallet statement for a part-compensation (late arrival: the session itself still happens). */
export function compensationMoneySentence(money: PtFaultMoney | null): string {
  if (!money) return "Khoản bồi thường một phần đang được xử lý vào ví của bạn; số tiền cụ thể xem trong lịch sử ví.";
  const paid = Number(money.paid);
  const unpaid = Number(money.unpaid);
  if (unpaid > 0) {
    return paid > 0
      ? `Đã bồi thường ${formatVnd(money.paid)}đ vào ví; ${formatVnd(money.unpaid)}đ còn lại đang được đối soát.`
      : `Chưa bồi thường được vào ví ngay; ${formatVnd(money.unpaid)}đ đang được đối soát.`;
  }
  return paid > 0 ? `Đã bồi thường ${formatVnd(money.paid)}đ vào ví.` : compensationMoneySentence(null);
}

/** Client notice: the PT did not deliver the session (no-show, late cancel, blocked day, never entered the room). */
export function ptFaultClientMessage(lead: string, money: PtFaultMoney | null): string {
  return `${lead} ${refundMoneySentence(money)} ${PT_FAULT_SESSION_CLOSED}`;
}

/** PT notice: the session is closed against them; they are not paid for it. */
export function ptFaultPtMessage(lead: string): string {
  return `${lead} Buổi tập được đóng là «không diễn ra — hoàn tiền», giá trị buổi được hoàn cho khách và bạn không được thanh toán buổi này.`;
}

/** Client notice: the PT arrived late. The session still took place and is counted; the client gets a part-compensation. */
export function ptLateArrivalClientMessage(money: PtFaultMoney | null, deadlineText: string): string {
  return (
    `Huấn luyện viên vào muộn. ${compensationMoneySentence(money)} Buổi tập vẫn được tính là đã diễn ra. ` +
    `Vui lòng xác nhận buổi tập trước ${deadlineText}; nếu có vấn đề, hãy khiếu nại.`
  );
}
