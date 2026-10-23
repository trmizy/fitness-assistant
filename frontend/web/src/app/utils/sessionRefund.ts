/**
 * DQ-2(a) - what a NO_SHOW (PT-fault) session says about the client's refund. A NO_SHOW session is "không diễn ra": it is closed, it
 * still counts as used, the PT is not paid for it and it is NEVER shown as delivered / completed. Whether the money came back is a
 * separate fact the server derives from the ledger (`refundState`, `refundedAmount`, `refundPendingAmount` on the session):
 *
 *   FULL     the whole value was refunded          -> "đã hoàn tiền"
 *   PARTIAL  part refunded, the rest is OPEN        -> "đã hoàn một phần, còn Xđ đang chờ xử lý"
 *   PENDING  nothing refunded yet / not confirmed   -> "chưa hoàn, đang chờ xử lý"
 *   (none)   the server could not tell              -> no claim at all
 * An open remainder is never written as paid. A remainder the owner closed without paying (`refundPendingAmount` = 0 and not FULL)
 * says so instead of "đang chờ xử lý".
 */

export type RefundState = "FULL" | "PARTIAL" | "PENDING";

export interface SessionRefundFields {
  status?: string;
  refundState?: RefundState | null;
  refundedAmount?: string | null;
  refundPendingAmount?: string | null;
}

const vnd = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Math.round(n)) : null;
};

const isClosedWithoutMore = (s: SessionRefundFields) => s.refundPendingAmount !== null && s.refundPendingAmount !== undefined && Number(s.refundPendingAmount) === 0;

/** The client's label of a NO_SHOW session. */
export function noShowLabelForClient(s: SessionRefundFields): string {
  const base = "Không diễn ra";
  switch (s.refundState) {
    case "FULL":
      return `${base} — đã hoàn tiền`;
    case "PARTIAL": {
      if (isClosedWithoutMore(s)) return `${base} — đã hoàn một phần, phần còn lại đã được đóng`;
      const rest = vnd(s.refundPendingAmount);
      return rest ? `${base} — đã hoàn một phần, còn ${rest}đ đang chờ xử lý` : `${base} — đã hoàn một phần, phần còn lại đang chờ xử lý`;
    }
    case "PENDING":
      return isClosedWithoutMore(s) ? `${base} — không hoàn thêm (đã đóng)` : `${base} — chưa hoàn, đang chờ xử lý`;
    default:
      return base;
  }
}

/** The trainer's label of the same session: it is the trainer's fault, not the student's, and it says what happened to the client's refund. */
export function noShowLabelForPt(s: SessionRefundFields): string {
  const base = "Không diễn ra";
  switch (s.refundState) {
    case "FULL":
      return `${base} — đã hoàn tiền cho khách`;
    case "PARTIAL": {
      if (isClosedWithoutMore(s)) return `${base} — hoàn một phần cho khách, phần còn lại đã đóng`;
      const rest = vnd(s.refundPendingAmount);
      return rest ? `${base} — hoàn một phần cho khách, còn ${rest}đ đang chờ xử lý` : `${base} — hoàn một phần cho khách, phần còn lại đang chờ xử lý`;
    }
    case "PENDING":
      return isClosedWithoutMore(s) ? `${base} — không hoàn thêm cho khách (đã đóng)` : `${base} — hoàn tiền cho khách đang chờ xử lý`;
    default:
      return base;
  }
}

/** Replaces the label of a NO_SHOW session with the refund-aware one; every other session keeps its own label. */
export function withRefundLabel<T extends { label: string }>(cfg: T, s: SessionRefundFields, audience: "CLIENT" | "PT"): T {
  if (s.status !== "NO_SHOW") return cfg;
  return { ...cfg, label: audience === "PT" ? noShowLabelForPt(s) : noShowLabelForClient(s) };
}
