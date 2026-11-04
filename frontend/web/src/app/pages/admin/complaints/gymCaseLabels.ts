/**
 * D6 - Vietnamese wording of the gym complaint-case screens. No internal code reaches a user: every enum goes through a map here and an unknown
 * value falls back to a neutral sentence. Money wording follows handoff section 1: the case being "done" never means money arrived; a refund is
 * written as "đã ghi vào ví Gymini" ONLY from the server's financial state, never from an HTTP status or `execStatus`.
 */
import type { GymCaseClass, GymCaseStatus, GymClosure, GymExecStatus, GymFinancialState, GymOutcome } from "./gymCaseTypes";

export type Tone = "success" | "pending" | "danger" | "warning" | "info" | "neutral";

const lookup = <T extends string>(map: Record<T, string>, key: string | null | undefined, fallback: string): string =>
  key && Object.prototype.hasOwnProperty.call(map, key) ? map[key as T] : fallback;

// ── status ──
export const GYM_STATUS_LABEL: Record<GymCaseStatus, string> = {
  INTAKE: "Mới tiếp nhận",
  COLLECTING: "Đang thu thập bằng chứng",
  AWAITING_PARTIES: "Chờ hội viên bổ sung",
  ASSESSING: "Đang đánh giá",
  FINDING_RECORDED: "Đã có kết luận",
  AWAITING_APPROVAL: "Chờ duyệt",
  DECISION_APPROVED: "Đã duyệt quyết định",
  REJECTED_INTAKE: "Không tiếp nhận",
};
export const gymStatusLabel = (s: string | null | undefined) => lookup(GYM_STATUS_LABEL, s, "Chưa rõ trạng thái");

/** "Who must act next" - one sentence per status, shown under the header. */
export const GYM_WAITING_NOTE: Record<GymCaseStatus, string> = {
  INTAKE: "Chờ một quản trị viên nhận hồ sơ, hoặc không tiếp nhận hồ sơ này.",
  COLLECTING: "Điều tra viên đang thu thập bằng chứng và ghi lại các khẳng định.",
  AWAITING_PARTIES: "Đang chờ hội viên bổ sung thông tin. Hội viên đã được báo trong ứng dụng.",
  ASSESSING: "Điều tra viên đánh giá từng khẳng định rồi ghi kết luận.",
  FINDING_RECORDED: "Đã có kết luận. Điều tra viên lập đề xuất để chuyển sang bước duyệt.",
  AWAITING_APPROVAL: "Chờ một quản trị viên khác (không phải người lập đề xuất hay điều tra viên) duyệt hoặc bác.",
  DECISION_APPROVED: "Quyết định đã được duyệt. Duyệt chưa làm thay đổi tiền: việc thực thi là bước riêng.",
  REJECTED_INTAKE: "Hồ sơ không được tiếp nhận. Khiếu nại quay lại luồng xử lý cũ.",
};
export const gymWaitingNote = (s: string | null | undefined) => lookup(GYM_WAITING_NOTE, s, "Chưa rõ hồ sơ đang chờ ai.");

export function gymStatusTone(status: string): Tone {
  switch (status) {
    case "DECISION_APPROVED":
      return "success";
    case "REJECTED_INTAKE":
      return "neutral";
    case "AWAITING_APPROVAL":
      return "pending";
    case "AWAITING_PARTIES":
      return "warning";
    case "INTAKE":
      return "info";
    default:
      return "info";
  }
}
export const isTerminalGymStatus = (s: string) => s === "DECISION_APPROVED" || s === "REJECTED_INTAKE";

// ── class ──
export const GYM_CLASS_LABEL: Record<GymCaseClass, string> = {
  MEM_TXN: "Giao dịch gói bị lỗi",
  MEM_CLOSED: "Phòng tập đã đóng cửa",
  MEM_VIOLATION: "Phòng tập vi phạm",
  MEM_ACCESS: "Hội viên không vào được phòng tập",
  GYM_GENERAL: "Vấn đề chung của phòng tập",
};
export const GYM_CLASS_HELP: Record<GymCaseClass, string> = {
  MEM_TXN: "Gắn với một gói hội viên. Nếu khiếu nại đúng, gói có thể được hoàn qua hệ thống.",
  MEM_CLOSED: "Gắn với một gói hội viên. Nếu khiếu nại đúng, gói có thể được hoàn qua hệ thống.",
  MEM_VIOLATION: "Gắn với một gói hội viên. Nếu khiếu nại đúng, gói có thể được hoàn qua hệ thống.",
  MEM_ACCESS: "Gắn với một gói hội viên nhưng không có hoàn tiền: chỉ ghi nhận kết quả.",
  GYM_GENERAL: "Vệ sinh, thiết bị, nhân viên… Không gắn với gói hội viên và không có hoàn tiền.",
};
export const gymClassLabel = (c: string | null | undefined) => lookup(GYM_CLASS_LABEL, c, "Loại hồ sơ khác");
export const classHasMoneyExit = (c: string | null | undefined) => c === "MEM_TXN" || c === "MEM_CLOSED" || c === "MEM_VIOLATION";

/** What an admin may choose when opening a case. `needsMembership` = a membership of the reporter must be named. */
export const OPEN_CLASS_OPTIONS: Array<{ value: GymCaseClass; label: string; help: string; needsMembership: boolean; allowsMembership: boolean }> = [
  { value: "MEM_TXN", label: GYM_CLASS_LABEL.MEM_TXN, help: GYM_CLASS_HELP.MEM_TXN, needsMembership: true, allowsMembership: true },
  { value: "MEM_CLOSED", label: GYM_CLASS_LABEL.MEM_CLOSED, help: GYM_CLASS_HELP.MEM_CLOSED, needsMembership: true, allowsMembership: true },
  { value: "MEM_VIOLATION", label: GYM_CLASS_LABEL.MEM_VIOLATION, help: GYM_CLASS_HELP.MEM_VIOLATION, needsMembership: true, allowsMembership: true },
  { value: "MEM_ACCESS", label: GYM_CLASS_LABEL.MEM_ACCESS, help: GYM_CLASS_HELP.MEM_ACCESS, needsMembership: false, allowsMembership: true },
  { value: "GYM_GENERAL", label: GYM_CLASS_LABEL.GYM_GENERAL, help: GYM_CLASS_HELP.GYM_GENERAL, needsMembership: false, allowsMembership: false },
];

// ── finding / outcome ──
export const GYM_FINDING_LABEL: Record<string, string> = {
  ESTABLISHED: "Khiếu nại đúng",
  NOT_ESTABLISHED: "Chưa đủ căn cứ",
};
export const gymFindingLabel = (f: string | null | undefined) => lookup(GYM_FINDING_LABEL, f, "Kết luận khác");

export const GYM_OUTCOME_LABEL: Record<GymOutcome, string> = {
  REFUND_TRANSACTION_ERROR: "Hoàn tiền gói: giao dịch bị lỗi",
  REFUND_GYM_CLOSED: "Hoàn tiền gói: phòng tập đã đóng cửa",
  REFUND_GYM_VIOLATION: "Hoàn tiền gói: phòng tập vi phạm",
  RESOLVE_UPHELD: "Ghi nhận khiếu nại là đúng, không phát sinh tiền",
  RESOLVE_INSUFFICIENT_EVIDENCE: "Chưa đủ căn cứ, không hoàn tiền",
};
export const gymOutcomeLabel = (o: string | null | undefined) => lookup(GYM_OUTCOME_LABEL, o, "Kết quả khác");

/** What a finding leads to, by class. The server computes the real outcome; this only tells the investigator before they write it. */
export function findingConsequence(caseClass: string, finding: string): string {
  if (finding === "NOT_ESTABLISHED") return "Hồ sơ sẽ kết thúc với kết quả «Chưa đủ căn cứ». Không có hoàn tiền.";
  if (classHasMoneyExit(caseClass)) {
    return "Nếu được duyệt, hệ thống có thể hoàn gói hội viên đúng một lần. Số tiền do máy chủ tính, không nhập tay.";
  }
  return "Khiếu nại được ghi nhận là đúng nhưng loại hồ sơ này không có hoàn tiền.";
}

export const GYM_EXEC_LABEL: Record<GymExecStatus, string> = {
  NOT_STARTED: "Chưa thực thi",
  EXECUTING: "Đang thực thi",
  BUSINESS_DONE: "Đã thực thi xong",
  EXEC_BLOCKED: "Bị chặn, chưa có tiền nào được chuyển",
  NEEDS_HUMAN: "Cần người xem xét",
};
export const gymExecLabel = (s: string | null | undefined) => lookup(GYM_EXEC_LABEL, s, "Chưa rõ trạng thái thực thi");
export const GYM_EXEC_NOTE: Record<GymExecStatus, string> = {
  NOT_STARTED: "Quyết định chưa được thực thi.",
  EXECUTING: "Đang thực thi hoặc lần thực thi trước chưa kết thúc. Dùng «Đối chiếu thực thi», đừng chạy lại.",
  BUSINESS_DONE: "«Đã thực thi xong» chỉ cho biết bước nghiệp vụ đã trả lời. Tiền đã về ví hay chưa đọc ở phần «Tiền» bên dưới.",
  EXEC_BLOCKED: "Không có tiền nào được chuyển. Sửa nguyên nhân rồi thực thi lại được.",
  NEEDS_HUMAN: "Có mâu thuẫn cần người xem xét. Hệ thống không tự thử lại và không có nút thực thi lại.",
};

export const GYM_CLOSURE_LABEL: Record<GymClosure, string> = {
  OPEN: "Hồ sơ đang mở",
  CLOSED: "Hồ sơ đã đóng",
  CLOSED_FINANCIAL_OPEN: "Hồ sơ đã xử lý, phần tiền còn chờ đối soát",
};
export const gymClosureLabel = (c: string | null | undefined) => lookup(GYM_CLOSURE_LABEL, c, "Chưa rõ");

// ── money ──
export const MONEY_NOT_BANK = "Ghi vào ví Gymini là bút toán ví nội bộ, không phải chuyển khoản ngân hàng.";
export const MONEY_STATE_TONE: Record<GymFinancialState, Tone> = {
  NO_MONEY_EFFECT: "neutral",
  NOT_EXECUTED: "neutral",
  LEDGER_PENDING: "pending",
  REFUND_BLOCKED: "warning",
  NO_REFUNDABLE_AMOUNT: "neutral",
  LEDGER_POSTED_FULL: "success",
  LEDGER_POSTED_PARTIAL: "warning",
  NEEDS_RECONCILIATION: "warning",
};
/** Short chip text per state. The full sentence is the server's `label`. */
export const MONEY_CHIP: Record<GymFinancialState, string> = {
  NO_MONEY_EFFECT: "Không phát sinh tiền",
  NOT_EXECUTED: "Chưa hoàn tiền",
  LEDGER_PENDING: "Đang xử lý, chưa có xác nhận",
  REFUND_BLOCKED: "Chưa hoàn tiền",
  NO_REFUNDABLE_AMOUNT: "Không có khoản nào để hoàn",
  LEDGER_POSTED_FULL: "Đã ghi vào ví Gymini",
  LEDGER_POSTED_PARTIAL: "Đã ghi một phần, còn thiếu",
  NEEDS_RECONCILIATION: "Cần đối soát",
};
export const moneyChip = (s: string | null | undefined) => lookup(MONEY_CHIP, s, "Chưa đọc được thông tin tiền");
export const moneyTone = (s: string | null | undefined): Tone => lookup(MONEY_STATE_TONE as Record<string, Tone>, s, "warning" as Tone) as Tone;

// ── actions the server may allow or refuse ──
export const ACTION_LABEL: Record<string, string> = {
  ASSIGN: "Giao người phụ trách",
  RECOLLECT_EVIDENCE: "Thu lại bằng chứng",
  ADD_CLAIM: "Ghi khẳng định",
  ADD_STATEMENT_ON_BEHALF: "Nhận lời khai hộ hội viên",
  ADD_EVIDENCE_ON_BEHALF: "Nhận tài liệu hộ hội viên",
  SHARE: "Chia sẻ cho hội viên",
  REQUEST_MORE_INFO: "Yêu cầu bổ sung",
  ADD_ASSESSMENT: "Ghi đánh giá",
  RECORD_FINDING: "Ghi kết luận",
  PROPOSE: "Lập đề xuất",
  ACK_EVIDENCE_CHANGE: "Xác nhận thay đổi bằng chứng",
  APPROVE: "Duyệt đề xuất",
  REJECT: "Bác đề xuất",
  EXECUTE: "Thực thi quyết định",
  RECONCILE_EXECUTION: "Đối chiếu thực thi",
};

/** Why the server says no. Written for the person who sees the disabled form. */
export const REFUSAL_TEXT: Record<string, string> = {
  GYM_CASE_DISABLED: "Chức năng xử lý hồ sơ này chưa được bật trên hệ thống nên chỉ xem được.",
  NOT_INVESTIGATOR: "Chỉ điều tra viên được giao hồ sơ này mới làm được thao tác này.",
  SELF_APPROVAL_FORBIDDEN: "Người lập đề xuất và điều tra viên của hồ sơ không được tự duyệt. Cần một quản trị viên khác.",
  CONFLICT_OF_INTEREST: "Bạn là một bên của vụ việc nên không làm được thao tác này.",
  STATE_NOT_ALLOWED: "Bước hiện tại của hồ sơ chưa cho phép thao tác này.",
  CASE_CLOSED: "Hồ sơ đã kết thúc nên không còn thao tác này.",
  CLAIM_REQUIRED: "Cần ghi ít nhất một khẳng định trước.",
  ASSESSMENT_REQUIRED: "Mỗi khẳng định phải được đánh giá trước khi ghi kết luận.",
  DECISION_NOT_APPROVED: "Quyết định chưa được duyệt.",
  ALREADY_EXECUTED: "Quyết định đã được thực thi, không thực thi lần hai.",
  NOTHING_TO_RECONCILE: "Không có lần thực thi nào đang dở để đối chiếu.",
  EXECUTION_STARTED: "Việc thực thi đã bắt đầu nên không đổi người phụ trách được.",
  EXECUTION_EXECUTING: "Đang thực thi. Dùng «Đối chiếu thực thi», đừng chạy lại.",
  EXECUTION_NEEDS_HUMAN: "Đang chờ người xem xét. Hệ thống không tự thử lại.",
  EXECUTION_BUSINESS_DONE: "Quyết định đã được thực thi.",
  NOT_ALLOWED: "Bạn chưa làm được thao tác này lúc này.",
};
export function refusalText(reason: string | null | undefined): string {
  if (!reason) return REFUSAL_TEXT.NOT_ALLOWED;
  return REFUSAL_TEXT[reason] ?? REFUSAL_TEXT.NOT_ALLOWED;
}

// ── history ──
export const GYM_EVENT_LABEL: Record<string, string> = {
  CASE_OPENED: "Mở hồ sơ",
  INVESTIGATOR_ASSIGNED: "Giao người phụ trách",
  STATUS_CHANGED: "Đổi bước xử lý",
  TRANSITION: "Đổi bước xử lý",
  MORE_INFO_REQUESTED: "Yêu cầu bổ sung",
  EVIDENCE_RECOLLECTED: "Thu lại bằng chứng",
  CLAIM_RECORDED: "Ghi khẳng định",
  ASSESSMENT_RECORDED: "Ghi đánh giá",
  FINDING_RECORDED: "Ghi kết luận",
  PROPOSAL_CREATED: "Lập đề xuất",
  EVIDENCE_CHANGE_ACK: "Xác nhận thay đổi bằng chứng",
  SHARED: "Chia sẻ cho hội viên",
  DECISION_APPROVED: "Duyệt đề xuất",
  DECISION_REJECTED: "Bác đề xuất",
  STATEMENT_SUBMITTED: "Hội viên gửi lời khai",
  EVIDENCE_SUBMITTED: "Hội viên gửi tài liệu",
  STATEMENT_ON_BEHALF: "Admin nhận hộ lời khai",
  EVIDENCE_ON_BEHALF: "Admin nhận hộ tài liệu",
  EXECUTION_STARTED: "Bắt đầu thực thi",
  EXECUTION_BLOCKED: "Thực thi bị chặn",
  EXECUTION_NEEDS_HUMAN: "Cần người xem xét",
  EXECUTION_BUSINESS_DONE: "Thực thi xong (bước nghiệp vụ)",
};
export const gymEventLabel = (a: string | null | undefined) => lookup(GYM_EVENT_LABEL, a, "Thao tác khác");

// ── evidence sources ──
export const GYM_SOURCE_LABEL: Record<string, string> = {
  COMPLAINT_RECORD: "Nội dung khiếu nại",
  COMPLAINT_PHOTO: "Ảnh đính kèm khiếu nại",
  GYM_RECORD: "Hồ sơ phòng tập",
  MEMBERSHIP_RECORD: "Gói hội viên",
  CHECKIN_SUMMARY: "Tóm tắt lượt check-in của gói",
  PARTY_DOCUMENT: "Tài liệu do người dùng nộp",
};
export const gymSourceLabel = (s: string | null | undefined) => lookup(GYM_SOURCE_LABEL, s, "Nguồn khác");
export const PHOTO_HASH_NOTE = "Mã băm chỉ phủ bản ghi ảnh, không phủ nội dung tệp ảnh.";
export const DECLARED_HASH_NOTE = "Mã sha256 do người nộp tự khai, hệ thống chưa kiểm chứng tệp.";
export const SENSITIVITY_LABEL: Record<string, string> = { NORMAL: "Bình thường", SENSITIVE: "Nhạy cảm" };

// ── complaint (old model) ──
export const ISSUE_LABEL: Record<string, string> = {
  CLEANLINESS: "Vệ sinh",
  STAFF_BEHAVIOR: "Thái độ nhân viên",
  EQUIPMENT_CONDITION: "Thiết bị hư hỏng",
  FALSE_ADVERTISING: "Quảng cáo sai sự thật",
  BILLING: "Tính phí sai",
  SAFETY: "An toàn",
  OTHER: "Khác",
};
export const issueLabel = (t: string | null | undefined) => lookup(ISSUE_LABEL, t, "Khác");
export const COMPLAINT_STATUS_LABEL: Record<string, string> = { OPEN: "Mới", IN_PROGRESS: "Đang xử lý", RESOLVED: "Đã xử lý" };
export const complaintStatusLabel = (s: string | null | undefined) => lookup(COMPLAINT_STATUS_LABEL, s, "Chưa rõ");

// ── member-facing ──
export const MEMBER_PROGRESS_TONE: Record<string, Tone> = {
  "Đã tiếp nhận": "info",
  "Đang xem xét": "info",
  "Cần bạn bổ sung thông tin": "warning",
  "Đã xử lý": "success",
  "Không tiếp nhận": "neutral",
};
export const memberProgressTone = (p: string | null | undefined): Tone => (p && MEMBER_PROGRESS_TONE[p]) || "neutral";

// ── fixed sentences ──
export const GYM_CASE_DISABLED_NOTE = "Chức năng xử lý hồ sơ khiếu nại phòng gym chưa được bật trên hệ thống này. Bạn xem được hồ sơ nhưng chưa ghi hay thực thi được gì.";
export const COMPLAINT_RESOLVE_NOT_REFUND = "Xử lý khiếu nại không tự hoàn tiền.";
export const CASE_REQUIRED_TEXT = "Khiếu nại này đã có hồ sơ xử lý nên chỉ kết thúc được qua hồ sơ.";
export const EXECUTE_CONFIRM_NOTICE = "Hệ thống sẽ hoàn gói hội viên đúng một lần. Số tiền do máy chủ tính, bạn không nhập. Thao tác không thể hoàn tác.";
export const EXECUTE_WALLET_NOTE = "Khoản hoàn (nếu có) được ghi vào ví Gymini của hội viên, không chuyển về ngân hàng.";
export const MEMBER_NO_FILE_NOTE = "Bạn chưa gửi được tệp trực tiếp. Hãy nhập mô tả và mã sha256 của tệp bạn có; hệ thống ghi nhận mã đó là lời khai của bạn, chưa kiểm chứng.";
export const GYM_CASE_STATUS_FILTER_NOTE = "Mỗi lần mở danh sách, hệ thống ghi nhật ký truy cập cho từng hồ sơ nên danh sách không tự làm mới. Bấm «Tải lại» khi cần.";
