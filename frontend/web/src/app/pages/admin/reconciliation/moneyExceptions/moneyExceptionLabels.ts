/** D7 - labels and the obligation wording of the two money-exception views. Pure. */
import { formatMoneyString, parseCents } from "../../adminFinanceOverview.utils";
import { obligationStatusLabel } from "../../adminReconciliation.utils";
import type { D65bStatus, LateObligation, LateStatus } from "./moneyExceptionTypes";

export type Tone = "success" | "neutral" | "warning" | "danger" | "info" | "pending";

// ───────────────────────────────────────────────── D65-B ──
export const D65B_STATUS_LABEL: Record<D65bStatus, string> = {
  PROPOSED: "Chờ người thứ hai duyệt",
  APPROVED_NOT_EXECUTED: "Đã duyệt — sổ cái chưa xác nhận ghi có",
  EXECUTED: "Sổ cái đã ghi có cho khách",
  REJECTED: "Đề xuất đã bị từ chối — chưa chuyển tiền",
};
export const D65B_STATUS_TONE: Record<D65bStatus, Tone> = { PROPOSED: "pending", APPROVED_NOT_EXECUTED: "warning", EXECUTED: "success", REJECTED: "neutral" };

export const D65B_HISTORY_LABEL: Record<string, string> = {
  PROPOSED: "Lập đề xuất",
  APPROVED: "Duyệt đề xuất",
  EXECUTION_STARTED: "Bắt đầu ghi có qua sổ cái",
  EXECUTION_FAILED: "Sổ cái chưa xác nhận ghi có",
  EXECUTION_BLOCKED: "Việc ghi có bị chặn",
  EXECUTION_NO_CREDIT: "Sổ cái không xác nhận khoản ghi có cho khách",
  LEDGER_CREDIT_NOT_CONFIRMED: "Sổ cái chưa xác nhận ghi có",
  EXECUTED: "Sổ cái đã ghi có cho khách",
  REJECTED: "Từ chối đề xuất",
  HANDED_OVER: "Tiếp quản việc ghi có",
};
/** Only a human-written reason is shown for these actions; system notes can carry codes. */
export const D65B_HUMAN_NOTE_ACTIONS: ReadonlySet<string> = new Set(["PROPOSED", "APPROVED", "REJECTED", "HANDED_OVER"]);

export const SESSION_STATUS_LABEL: Record<string, string> = {
  NO_SHOW: "PT vắng mặt",
  COMPLETED: "Đã hoàn thành",
  DISPUTED: "Đang bị khiếu nại",
  PT_NO_SHOW_REPORTED: "PT báo khách vắng, đang chờ phản hồi",
  CANCELLED: "Đã huỷ",
  SCHEDULED: "Sắp diễn ra",
};
export const sessionStatusLabel = (s: string | null | undefined) => (s && SESSION_STATUS_LABEL[s]) || "Chưa rõ";

export const SETTLEMENT_ROW_LABEL: Record<string, string> = {
  UNCONFIRMED: "Đang giữ, chưa xác nhận",
  NEEDS_HUMAN: "Cần người xem xét",
  SETTLED: "Đã tất toán",
  PENDING: "Chờ xử lý",
  PROCESSING: "Đang xử lý",
  FAILED: "Lỗi, chờ thử lại",
  CONFLICT: "Lệch số liệu",
};
export const settlementRowLabel = (s: string | null | undefined) => (s && SETTLEMENT_ROW_LABEL[s]) || "Chưa rõ";

// ────────────────────────────────────────────── late-open ──
export const LATE_STATUS_LABEL: Record<LateStatus, string> = {
  UNCLAIMED: "Chưa có người phụ trách",
  CLAIMED: "Đã có người phụ trách",
  BLOCKED: "Đang bị chặn",
  PROPOSED: "Chờ người thứ hai duyệt",
  APPROVED: "Đã duyệt, chờ chạy",
  EXECUTION_FAILED: "Chạy chưa thành công",
  EXECUTION_EXHAUSTED: "Hết lượt chạy",
  EXECUTED: "Sổ cái đã ghi nhận",
};
export const LATE_STATUS_TONE: Record<LateStatus, Tone> = {
  UNCLAIMED: "neutral",
  CLAIMED: "info",
  BLOCKED: "danger",
  PROPOSED: "pending",
  APPROVED: "warning",
  EXECUTION_FAILED: "warning",
  EXECUTION_EXHAUSTED: "danger",
  EXECUTED: "success",
};
/** Order of the filter chips: the ones that need a person first. */
export const LATE_STATUS_ORDER: readonly LateStatus[] = ["UNCLAIMED", "CLAIMED", "PROPOSED", "APPROVED", "EXECUTION_FAILED", "EXECUTION_EXHAUSTED", "BLOCKED", "EXECUTED"];

export const STEP_KIND_LABEL: Record<string, string> = {
  SESSION_RELEASE: "Giải ngân buổi tập đã diễn ra",
  PT_NO_SHOW_COMPENSATION: "Đền buổi PT vắng mặt",
  UNRESOLVED_SESSION_RESOLUTION: "Giải quyết buổi đang bị giữ",
};
export const stepKindLabel = (k: string | null | undefined) => (k && STEP_KIND_LABEL[k]) || "Bước tiền của buổi tập";

export const LATE_HISTORY_LABEL: Record<string, string> = {
  CLAIMED: "Nhận phụ trách",
  HANDED_OVER: "Chuyển giao người phụ trách",
  PROPOSED: "Lập đề xuất",
  APPROVED: "Duyệt đề xuất",
  REJECTED: "Bác đề xuất",
  BLOCKED: "Việc bị chặn",
  EXECUTION_STARTED: "Bắt đầu chạy qua sổ cái",
  EXECUTION_FAILED: "Chạy chưa thành công",
  EXECUTED: "Sổ cái đã ghi nhận",
  NOTIFIED: "Đã báo cho khách",
  RECOVERY_OPENED: "Mở đợt chạy bổ sung",
  RECOVERY_APPROVED: "Duyệt đợt chạy bổ sung",
  RECOVERY_HALTED: "Đợt chạy bổ sung dừng, không chạy gì",
  RECOVERY_APPLIED: "Đã chạy đợt bổ sung",
  RECOVERY_REJECTED: "Bác đợt chạy bổ sung",
};
export const LATE_HUMAN_NOTE_ACTIONS: ReadonlySet<string> = new Set(["HANDED_OVER", "PROPOSED", "APPROVED", "REJECTED", "RECOVERY_OPENED", "RECOVERY_APPROVED", "RECOVERY_REJECTED"]);

export const RECOVERY_CLASS_TEXT: Record<string, string> = {
  REPLAY: "Sổ cái đã ghi trước đó. Duyệt chỉ để chốt lại sổ sách, không chi thêm.",
  GRANT: "Sổ cái chưa ghi gì và khoản còn nguyên vẹn. Duyệt sẽ cấp thêm vài lượt chạy có giới hạn.",
  HALT: "Dừng: có điều chưa rõ trong sổ cái, cần một người xem xét. Duyệt chỉ để đóng lại, không chạy gì.",
};
export const recoveryClassText = (c: string | null | undefined) => (c && RECOVERY_CLASS_TEXT[c]) || "Chưa rõ cách xử lý.";

// ───────────────────────────────────────── obligation wording ──
export interface ObligationOutline {
  /** the headline, in the words the handoff allows for this state */
  label: string;
  tone: Tone;
  /** `true` = the client has NOT been paid (still owed); `false` = not owed any more; `null` = cannot tell */
  stillOwed: boolean | null;
  /** the ledger wrote the payment into the Gymini wallet */
  paidIntoWallet: boolean;
  /** the explicit sentence about payment, or null */
  warning: string | null;
}

const isPositive = (v: string | null): boolean => {
  const c = parseCents(v);
  return c !== null && c > 0n;
};

/**
 * The ledger obligation of a late-arrival compensation, as words. `OPEN` with unpaid > 0 is "still owed" and says so plainly;
 * `PAID_VIA_LEDGER` is "paid into the Gymini wallet" (not a bank transfer); no state is ever worded as paid unless it is one of those paid states.
 */
export function outlineObligation(ob: LateObligation | null): ObligationOutline {
  if (!ob) return { label: "Sổ cái chưa có khoản còn nợ nào cho buổi này", tone: "neutral", stillOwed: null, paidIntoWallet: false, warning: null };
  switch (ob.status) {
    case "OPEN":
      return isPositive(ob.unpaid)
        ? { label: "Đang mở — chưa trả cho khách", tone: "warning", stillOwed: true, paidIntoWallet: false, warning: "Khoản bồi thường đến muộn này CHƯA được trả cho khách." }
        : { label: "Đang mở, không còn phần chưa trả", tone: "neutral", stillOwed: false, paidIntoWallet: false, warning: null };
    case "UNDER_REVIEW":
      return { label: "Đang xem xét — chưa trả", tone: "warning", stillOwed: true, paidIntoWallet: false, warning: "Khoản này đang được xem xét ngoài đường này và CHƯA được trả cho khách." };
    case "APPROVED_FOR_PAYMENT":
    case "AWAITING_EVIDENCE":
      return { label: "Đang chi ngoài hệ thống, chờ xác minh — chưa phải đã trả", tone: "warning", stillOwed: true, paidIntoWallet: false, warning: "Khoản này đang chi ngoài hệ thống và CHƯA được xác minh là đã trả." };
    case "PAID_VIA_LEDGER":
      return { label: "Đã trả vào ví Gymini", tone: "success", stillOwed: false, paidIntoWallet: true, warning: null };
    case "PAID_VERIFIED":
      return { label: "Đã chi và chứng từ được xác minh", tone: "success", stillOwed: false, paidIntoWallet: false, warning: null };
    case "WAIVED":
      return { label: "Không chi trả theo quyết định", tone: "neutral", stillOwed: false, paidIntoWallet: false, warning: "Phần này không được chi trả theo quyết định; đây không phải là đã trả." };
    case "RESOLVED_OTHER":
      return { label: "Đã xử lý cách khác", tone: "neutral", stillOwed: false, paidIntoWallet: false, warning: "Phần này được xử lý cách khác; đây không phải là đã trả vào ví." };
    default:
      return {
        label: `Cần xác minh (${obligationStatusLabel(ob.status)}) — không phải nợ đang mở, cũng chưa xác minh đã trả`,
        tone: "pending",
        stillOwed: null,
        paidIntoWallet: false,
        warning: null,
      };
  }
}

/** "Phải trả A · đã trả B · còn nợ C" with every figure formatted from the server string (never added up here). */
export function obligationFigures(ob: LateObligation | null): Array<{ label: string; value: string }> {
  if (!ob) return [];
  return [
    { label: "Khoản phải trả", value: formatMoneyString(ob.owed) },
    { label: "Đã trả vào ví", value: formatMoneyString(ob.paid) },
    { label: "Còn chưa trả", value: formatMoneyString(ob.unpaid) },
  ];
}
