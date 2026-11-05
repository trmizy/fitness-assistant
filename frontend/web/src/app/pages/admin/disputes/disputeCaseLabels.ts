/**
 * Dispute V2.1 admin UI (D1) - Vietnamese wording for every enum the screens show.
 *
 * Rules: plain business language, never the raw enum, no internal codes (D77, B-1, FH-8, I6...) in any visible text, and for
 * "PT absent" never the sentence "buổi tập không bị trừ" (DQ-2(a): the client is refunded one session's value AND still loses one session right).
 * Every table is a `Record<Union, string>` so the compiler (and the exhaustive test) fails when an enum gains a value.
 */
import type {
  ApprovalResult,
  CaptureStatus,
  CaseStatus,
  CaseType,
  CloseReason,
  ClaimMove,
  ClaimResult,
  ClaimantRole,
  ExecBlockReason,
  ExecStatus,
  FindingKind,
  Outcome,
  PartyRole,
  PolicyResult,
  ProposalBlockedReason,
  ProvenanceType,
  PtLateFinding,
  Sensitivity,
  VerificationStatus,
} from "./disputeCaseTypes";

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  INTAKE: "Mới tiếp nhận",
  COLLECTING: "Đang thu thập bằng chứng",
  AWAITING_PARTIES: "Chờ các bên phản hồi",
  ASSESSING: "Đang đánh giá",
  TECH_RECONCILIATION: "Đối soát kỹ thuật",
  FINDING_RECORDED: "Đã có kết luận",
  POLICY_PENDING: "Chờ chính sách",
  PROPOSED: "Đang lập đề xuất",
  AWAITING_APPROVAL: "Chờ phê duyệt",
  DECISION_APPROVED: "Đã duyệt quyết định",
  // Not "bị từ chối": a case closed without a decision shares this status; `closeReason` (closeReasonLabel / caseStatusText) says why.
  REJECTED_INTAKE: "Đã đóng, không có quyết định",
};

/** Why a case was closed without a decision (`closeReason`). */
export const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  INTAKE_REJECTED: "Đã từ chối tiếp nhận",
  ORPHAN_SESSION_LEFT_DISPUTE: "Đã đóng: buổi tập không còn trong khiếu nại",
  NOT_A_DISPUTE: "Đã đóng: không phải khiếu nại",
};
export const CLOSE_REASON_NOTE: Record<CloseReason, string> = {
  INTAKE_REJECTED: "Hồ sơ bị từ chối ngay từ bước tiếp nhận. Không có quyết định nào về buổi tập hay tiền.",
  ORPHAN_SESSION_LEFT_DISPUTE: "Buổi tập đã rời khỏi diện khiếu nại nên hồ sơ được đóng. Không có quyết định nào về buổi tập hay tiền, và việc đóng không thay đổi buổi tập, quyền buổi hay tiền.",
  NOT_A_DISPUTE: "Kết luận là «Không phải khiếu nại» nên hồ sơ được đóng. Buổi tập không bị thay đổi (vẫn chờ xử lý trong hàng đợi) và việc đóng không đụng tới tiền.",
};
export const closeReasonLabel = (r: string | null | undefined): string | null =>
  r != null && Object.prototype.hasOwnProperty.call(CLOSE_REASON_LABEL, r) ? CLOSE_REASON_LABEL[r as CloseReason] : null;

/** One short line saying what the case is waiting for. Honest about what the system does NOT do yet. */
export const CASE_STATUS_NOTE: Record<CaseStatus, string> = {
  INTAKE: "Chưa có người phụ trách. Quản trị viên bất kỳ có thể nhận hoặc từ chối.",
  COLLECTING: "Các bên được nộp thêm lời khai và bằng chứng.",
  AWAITING_PARTIES: "Khách và PT được báo trong ứng dụng khi hồ sơ chuyển sang bước này. Chưa có hạn trả lời.",
  ASSESSING: "Chỉ ở bước này mới ghi được đánh giá và kết luận.",
  TECH_RECONCILIATION: "Đang đối chiếu dữ liệu kỹ thuật, chưa có thao tác riêng.",
  FINDING_RECORDED: "Đã có kết luận, chờ điều tra viên lập đề xuất.",
  POLICY_PENDING: "Chờ quyết định về chính sách; ở bước này chỉ có thể bổ sung bằng chứng hoặc đánh giá lại.",
  PROPOSED: "Đang chuyển sang chờ phê duyệt.",
  AWAITING_APPROVAL: "Cần một quản trị viên khác duyệt (bốn mắt).",
  DECISION_APPROVED: "Đã duyệt. Việc thực thi nằm ở bước riêng và chưa chắc đã chạy.",
  REJECTED_INTAKE: "Hồ sơ đã đóng, không có quyết định nào về buổi tập hay tiền.",
};

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  PT_DELIVERY: "Khiếu nại báo cáo hoàn thành",
  PT_CLIENT_NO_SHOW_CLAIM: "PT báo khách vắng, khách phản đối",
  PT_NO_SHOW_CLAIM: "Khách báo PT vắng, PT phản đối",
  LEGACY_UNCLASSIFIED: "Phân loại tạm (cần phân loại)",
};

export const FINDING_LABEL: Record<FindingKind, string> = {
  VERIFIED_DELIVERED: "Buổi tập đã diễn ra",
  VERIFIED_CLIENT_ABSENT: "Khách vắng mặt",
  VERIFIED_PT_ABSENT: "PT vắng mặt",
  VERIFIED_NOT_DELIVERED_NO_FAULT: "Buổi không diễn ra, không bên nào có lỗi",
  INSUFFICIENT_EVIDENCE: "Không đủ căn cứ",
  NOT_A_DISPUTE: "Không phải khiếu nại",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  COMPLETED: "Buổi tập tính là đã diễn ra",
  CANCELLED: "Buổi tập không diễn ra",
  PT_NO_SHOW_CONFIRMED: "Xác nhận PT vắng mặt",
};

export const CLAIM_RESULT_LABEL: Record<ClaimResult, string> = {
  ESTABLISHED: "Đã được chứng minh",
  NOT_ESTABLISHED: "Chưa đủ để chứng minh",
  REFUTED: "Bị bác bỏ",
};

export const CLAIMANT_ROLE_LABEL: Record<ClaimantRole, string> = {
  CLIENT: "Khách",
  PT: "PT",
  SYSTEM: "Hệ thống",
};

export const CLAIM_MOVE_LABEL: Record<ClaimMove, string> = {
  MONEY: "Tiền",
  QUOTA: "Quyền buổi tập",
  PT_AT_FAULT: "PT có lỗi",
};

export const PT_LATE_FINDING_LABEL: Record<PtLateFinding, string> = {
  LATE_CONFIRMED_BY_ROOM_DATA: "PT đến muộn, đã xác nhận bằng dữ liệu phòng tập",
  LATE_CONTESTED: "PT đến muộn nhưng có tranh cãi",
  NOT_LATE: "PT không đến muộn",
  UNDETERMINED: "Chưa xác định được",
};
/** Shown next to the "PT đến muộn" form. */
export const PT_LATE_ISSUE_NOTE = "Chỉ ghi nhận. Không kích hoạt bồi thường. Nếu chọn «có tranh cãi» hoặc «không đến muộn», bước tiền của buổi sẽ được giữ lại.";

export const PROVENANCE_LABEL: Record<ProvenanceType, string> = {
  SERVER_OBSERVED: "Máy chủ đọc trực tiếp từ hệ thống",
  USER_REPORTED_STORED: "Bên liên quan tự khai, máy chủ lưu lại",
  DERIVED: "Dữ liệu dẫn xuất, không phải nguồn độc lập",
  EXTERNAL_DOCUMENT: "Tài liệu ngoài hệ thống do bên liên quan nộp",
  TECH_GAP: "Không đọc được nguồn (không phải bằng chứng vắng mặt)",
  NOT_APPLICABLE: "Không áp dụng",
  ADMIN_RECEIVED_ON_BEHALF: "Quản trị viên nhận hộ",
  LEGACY_FIELD: "Trường cũ của buổi tập",
  SELF_REPORTED_SERVER_RECORDED: "Người dùng tự quét hoặc tự khai, máy chủ chỉ ghi lại",
  STAFF_ATTESTED_SERVER_RECORDED: "Nhân viên phòng tập check-in hộ và tự xác nhận danh tính",
};
/** Must sit next to any gym check-in evidence. */
export const GYM_CHECKIN_NOTE = "Check-in phòng tập không chứng minh buổi dạy PT đã diễn ra.";

export const CAPTURE_STATUS_LABEL: Record<CaptureStatus, string> = {
  OK: "Đọc được",
  UNAVAILABLE: "Không đọc được nguồn",
  NOT_APPLICABLE: "Không áp dụng",
  TECH_GAP_SUSPECTED: "Nghi lỗi kỹ thuật khi thu thập",
};

export const VERIFICATION_STATUS_LABEL: Record<VerificationStatus, string> = {
  CLIENT_CLAIMED_UNVERIFIED: "Bên liên quan tự khai, chưa xác minh",
  SERVER_VERIFIED: "Máy chủ đã xác minh (chỉ phần tệp)",
  NOT_APPLICABLE: "Không cần xác minh",
};

export const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  NORMAL: "Bình thường",
  SENSITIVE: "Nhạy cảm",
  RESTRICTED: "Hạn chế (chỉ người nộp và quản trị viên xem)",
};

export const PARTY_ROLE_LABEL: Record<PartyRole, string> = {
  CLIENT: "Khách",
  PT: "PT",
  ADMIN_ON_BEHALF: "Quản trị viên nhập hộ",
};

export const APPROVAL_RESULT_LABEL: Record<ApprovalResult, string> = {
  APPROVED: "Đã duyệt",
  REJECTED: "Đã bác",
};

export const POLICY_RESULT_LABEL: Record<PolicyResult, string> = {
  ELIGIBLE_CURRENT_POLICY: "Hợp đồng thuộc chính sách hiện hành",
  EXCEPTION_APPLIES: "Hợp đồng thuộc ngoại lệ lịch sử, cần xử lý riêng",
};

/** Why a bundle of evidence cannot be handed to the other side (A18 refusal). */
export const SHARE_REFUSAL_LABEL: Record<string, string> = {
  PARTY_SUBMITTED: "Bằng chứng do chính một bên nộp nên không chia sẻ được cho bên kia.",
  UNVERIFIED: "Bằng chứng chưa được máy chủ xác minh nên chưa chia sẻ được.",
  NOT_NORMAL_SENSITIVITY: "Bằng chứng nhạy cảm hoặc hạn chế nên chưa chia sẻ được.",
};

/** Execution axis (`case.execStatus`). `BUSINESS_DONE` never says money arrived: the money axis is the `financial` block. */
export const EXEC_STATUS_LABEL: Record<ExecStatus, string> = {
  NOT_STARTED: "Đã duyệt, chưa thực thi",
  EXECUTING: "Đang thực thi hoặc lần trước chưa kết thúc",
  BUSINESS_DONE: "Đã thực thi phần nghiệp vụ",
  EXEC_BLOCKED: "Chưa thực thi được",
  NEEDS_HUMAN: "Cần người xem xét",
};
export const EXEC_STATUS_UNREADABLE = "Chưa đọc được trạng thái thực thi.";

export const EXEC_BLOCK_REASON_LABEL: Record<ExecBlockReason, string> = {
  PT_NO_SHOW_REPORTED_NOT_SUPPORTED: "Buổi còn chờ PT phản hồi, chưa hỗ trợ thực thi.",
  CONTRACT_ENDING: "Hợp đồng đang kết thúc, thử lại sau.",
  LEDGER_UNREADABLE: "Chưa đọc được sổ cái tiền.",
  D77_COMBINATION_UNRESOLVED: "Buổi có khoản đền đến muộn, tổ hợp này chưa được cho phép thực thi.",
  CANCELLED_BLOCKED_BY_D77: "Buổi có khoản đền đến muộn nên không huỷ được.",
  POLICY_ELIGIBILITY_UNVERIFIED: "Hợp đồng chưa có kết luận áp dụng chính sách đã được duyệt.",
  POLICY_EXCEPTION_APPLIES: "Hợp đồng thuộc ngoại lệ lịch sử, cần xử lý riêng.",
  EXECUTION_DISABLED: "Bộ thực thi quyết định đang tắt.",
  SESSION_ALREADY_PROCESSED: "Buổi tập không còn ở trạng thái đang khiếu nại.",
};

export const PROPOSAL_BLOCKED_LABEL: Record<ProposalBlockedReason, string> = {
  D77_COMBINATION_UNRESOLVED: "Quyết định sẽ được duyệt nhưng chưa thực thi được vì buổi có khoản đền đến muộn.",
};

// ───────────────────────────────────────────────────────── state machine hint ──
/** Copy of `TRANSITIONS` in user-service rules.ts. Only a FALLBACK now: the buttons come from `allowedActions` / `actions.transition.options`; the server decides. */
const TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  INTAKE: ["COLLECTING", "REJECTED_INTAKE"],
  COLLECTING: ["AWAITING_PARTIES", "ASSESSING", "TECH_RECONCILIATION"],
  AWAITING_PARTIES: ["COLLECTING", "ASSESSING"],
  ASSESSING: ["COLLECTING", "AWAITING_PARTIES", "TECH_RECONCILIATION", "FINDING_RECORDED"],
  TECH_RECONCILIATION: ["COLLECTING", "ASSESSING"],
  FINDING_RECORDED: ["PROPOSED", "POLICY_PENDING", "TECH_RECONCILIATION"],
  POLICY_PENDING: ["COLLECTING", "ASSESSING"],
  PROPOSED: ["AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["DECISION_APPROVED", "ASSESSING"],
  DECISION_APPROVED: [],
  REJECTED_INTAKE: [],
};
/** Targets of the generic transition endpoint (the other states are reached only by the action that earns them). */
const MANUAL_TARGETS: readonly CaseStatus[] = ["COLLECTING", "AWAITING_PARTIES", "ASSESSING", "TECH_RECONCILIATION", "REJECTED_INTAKE"];
const MANUAL_FROM_BLOCKED: readonly CaseStatus[] = ["PROPOSED", "AWAITING_APPROVAL"];

export function allowedTransitions(status: CaseStatus): CaseStatus[] {
  return [...(TRANSITIONS[status] ?? [])];
}
/** Subset reachable through the "chuyển trạng thái" form (A6). */
export function manualTransitions(status: CaseStatus): CaseStatus[] {
  if (MANUAL_FROM_BLOCKED.includes(status)) return [];
  return allowedTransitions(status).filter((s) => MANUAL_TARGETS.includes(s));
}
export const isTerminalStatus = (s: CaseStatus) => s === "DECISION_APPROVED" || s === "REJECTED_INTAKE";

// ───────────────────────────────────────────────────── finding -> consequence ──
/**
 * "Kết luận -> kết quả" (what a finding leads to). Illustration shown BEFORE proposing; the server recomputes everything.
 * DQ-2(a): PT absent = refund one session's value AND the session right is still consumed, no make-up session, PT is not paid for it.
 */
export const FINDING_CONSEQUENCE: Record<FindingKind, string> = {
  VERIFIED_DELIVERED: "Trừ 1 quyền buổi của khách. PT được ghi nhận buổi này. Khách không được hoàn tiền.",
  VERIFIED_CLIENT_ABSENT: "Hồ sơ ghi nhận khách vắng. Trừ 1 quyền buổi của khách, PT được ghi nhận buổi này, khách không được hoàn tiền.",
  VERIFIED_PT_ABSENT:
    "Hoàn cho khách giá trị một buổi (giá hợp đồng chia tổng số buổi) từ tiền của chính hợp đồng. Buổi này vẫn tính là đã dùng: khách vẫn mất 1 quyền buổi và không có buổi bù. PT không nhận tiền buổi đó và bị ghi nhận có lỗi. Nếu tiền không đủ, phần thiếu thành khoản còn phải thanh toán.",
  VERIFIED_NOT_DELIVERED_NO_FAULT:
    "Không trừ quyền buổi và không hoàn tiền khi hợp đồng đang chạy. Không chọn được nếu buổi có khoản đền đến muộn.",
  INSUFFICIENT_EVIDENCE: "Hồ sơ chuyển sang chờ chính sách. Chưa đề xuất kết quả nào.",
  NOT_A_DISPUTE: "Chưa có thiết kế xử lý cho trường hợp này nên chưa lập được đề xuất.",
};

/** Consequence by RULING outcome (what a proposal says once it exists). Same wording rules as above. */
export const OUTCOME_CONSEQUENCE: Record<Outcome, string> = {
  COMPLETED: "Trừ 1 quyền buổi của khách, PT được ghi nhận buổi, khách không được hoàn tiền.",
  PT_NO_SHOW_CONFIRMED: FINDING_CONSEQUENCE.VERIFIED_PT_ABSENT,
  CANCELLED: FINDING_CONSEQUENCE.VERIFIED_NOT_DELIVERED_NO_FAULT,
};

/** Shown instead of the raw server sentence when A13 answers "no proposal": cancelling a session that has a late-arrival compensation is refused. */
export const POLICY_PENDING_NO_PROPOSAL =
  "Buổi này có khoản đền đến muộn nên không kết luận «không diễn ra» được. Hồ sơ chuyển sang chờ chính sách; chưa có đề xuất nào được tạo.";

// ───────────────────────────────────────────────────────── fixed page sentences ──
/** AdminDisputes header (true for every ruling, including PT absence). */
export const DISPUTE_PAGE_PENDING_SENTENCE =
  "Khách đã khiếu nại báo cáo của PT. Buổi đang chờ kết luận và tiền chưa được quyết toán; quyền buổi tập tuỳ theo kết luận.";
/** AdminComplaintsPage, next to "Đánh dấu đã xử lý". */
export const COMPLAINT_NO_AUTO_REFUND_SENTENCE = "Xử lý khiếu nại không tự hoàn tiền.";

const lookup = <K extends string>(table: Record<K, string>, key: string | null | undefined, fallback: string): string =>
  key != null && Object.prototype.hasOwnProperty.call(table, key) ? table[key as K] : fallback;

export const caseStatusLabel = (s: string | null | undefined) => lookup(CASE_STATUS_LABEL, s, "Chưa rõ trạng thái");
/** The status text of a case: a case closed without a decision is named by its `closeReason`, never just "từ chối". */
export const caseStatusText = (c: { status?: string | null; closeReason?: string | null }): string =>
  c.status === "REJECTED_INTAKE" ? (closeReasonLabel(c.closeReason) ?? CASE_STATUS_LABEL.REJECTED_INTAKE) : caseStatusLabel(c.status);
export const caseTypeLabel = (s: string | null | undefined) => lookup(CASE_TYPE_LABEL, s, "Loại khiếu nại khác");
export const findingLabel = (s: string | null | undefined) => lookup(FINDING_LABEL, s, "Kết luận khác");
export const outcomeLabel = (s: string | null | undefined) => lookup(OUTCOME_LABEL, s, "Kết quả khác");
export const claimResultLabel = (s: string | null | undefined) => lookup(CLAIM_RESULT_LABEL, s, "Chưa rõ");
export const claimantRoleLabel = (s: string | null | undefined) => lookup(CLAIMANT_ROLE_LABEL, s, "Bên khác");
export const claimMoveLabel = (s: string | null | undefined) => lookup(CLAIM_MOVE_LABEL, s, "Nội dung khác");
export const ptLateFindingLabel = (s: string | null | undefined) => lookup(PT_LATE_FINDING_LABEL, s, "Chưa rõ");
export const provenanceLabel = (s: string | null | undefined) => lookup(PROVENANCE_LABEL, s, "Nguồn chưa rõ");
export const captureStatusLabel = (s: string | null | undefined) => lookup(CAPTURE_STATUS_LABEL, s, "Chưa rõ");
export const verificationStatusLabel = (s: string | null | undefined) => lookup(VERIFICATION_STATUS_LABEL, s, "Chưa rõ");
export const sensitivityLabel = (s: string | null | undefined) => lookup(SENSITIVITY_LABEL, s, "Chưa rõ");
export const partyRoleLabel = (s: string | null | undefined) => lookup(PARTY_ROLE_LABEL, s, "Bên khác");

/** Reference kind labels (FIX-1): Vietnamese wording for evidence references, audit logs and D65-B types. */
export const CONTRACT_POLICY_REF_KIND_LABEL: Record<string, string> = {
  PT_TERMS_ACCEPTANCE: "Bản ghi PT chấp nhận điều khoản",
  CONTRACT_AUDIT_LOG: "Nhật ký gắn điều khoản với hợp đồng",
};

export const D65B_REF_TYPE_LABEL: Record<string, string> = {
  EVIDENCE: "Bằng chứng",
  LEDGER_OP: "Bút toán sổ cái",
};

export const REFERENCE_KIND_LABEL: Record<string, string> = {
  ...CONTRACT_POLICY_REF_KIND_LABEL,
  ...D65B_REF_TYPE_LABEL,
};

