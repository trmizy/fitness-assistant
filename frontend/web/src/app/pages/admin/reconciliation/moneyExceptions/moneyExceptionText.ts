/**
 * D7 - every sentence the two money-exception views can say, in Vietnamese, keyed by the stable server code.
 * One table serves HTTP errors, `assessment.code`, `execution.code` and recovery `haltCode`: the same reason reads the same everywhere.
 *
 * Rules kept here (handoff sections 1, 4, 10):
 *  - never "đã hoàn / đã trả / hoàn tất" unless the server said the ledger credited it;
 *  - a ledger credit is "ghi vào ví Gymini", never a bank transfer;
 *  - no raw code, no internal name (D77, B-1, FH-8...) reaches the user: an unknown code falls back to a generic sentence.
 */
import { obligationStatusLabel } from "../../adminReconciliation.utils";

export type ReasonKind = "auth" | "forbidden" | "notFound" | "stale" | "blocked" | "validation" | "unavailable" | "disabled" | "unknown";

export interface ReasonEntry {
  kind: ReasonKind;
  text: string;
}

const E = (kind: ReasonKind, text: string): ReasonEntry => ({ kind, text });

export const REASON_TEXT: Record<string, ReasonEntry> = {
  // ── identity / permission
  UNAUTHENTICATED: E("auth", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."),
  UNAUTHORIZED: E("auth", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."),
  FORBIDDEN: E("forbidden", "Bạn không có quyền thực hiện thao tác này."),
  ADMIN_ONLY: E("forbidden", "Chỉ quản trị viên được thực hiện thao tác này."),
  SELF_APPROVAL_FORBIDDEN: E("forbidden", "Bạn không được duyệt đề xuất do chính mình lập. Cần một quản trị viên thứ hai."),
  SELF_REJECT_FORBIDDEN: E("forbidden", "Người lập đề xuất không được tự từ chối; cần một quản trị viên khác."),
  APPROVER_IS_ASSIGNEE: E("forbidden", "Người đang phụ trách hồ sơ không được tự duyệt. Cần một quản trị viên khác."),
  CONFLICT_OF_INTEREST: E("forbidden", "Bạn là một bên của hợp đồng này, hoặc chưa khai báo không có xung đột lợi ích, nên không thực hiện được thao tác này."),
  // ── flags (the screen hides the buttons; this is for a flag that flipped while the page was open)
  D65B_RESOLUTION_DISABLED: E("disabled", "Chức năng giải quyết khoản đang giữ của buổi PT vắng đang tắt. Chưa có gì được ghi."),
  LATE_OPEN_RECONCILIATION_DISABLED: E("disabled", "Chức năng đối soát khoản bồi thường đến muộn đang tắt. Chưa có gì được ghi."),
  // ── validation / idempotency
  INVALID_INPUT: E("validation", "Dữ liệu gửi lên chưa hợp lệ. Hãy kiểm tra các ô được đánh dấu."),
  INVALID_IDEMPOTENCY_KEY: E("validation", "Không tạo được mã chống gửi trùng. Hãy mở lại biểu mẫu."),
  IDEMPOTENCY_KEY_REUSED: E("blocked", "Thao tác này đã được gửi với nội dung khác. Hãy mở lại biểu mẫu rồi gửi lại."),
  // ── not found
  SESSION_NOT_FOUND: E("notFound", "Không tìm thấy buổi tập này."),
  CONTRACT_NOT_FOUND: E("notFound", "Không tìm thấy hợp đồng của buổi tập này."),
  RESOLUTION_NOT_FOUND: E("notFound", "Không tìm thấy đề xuất này."),
  SETTLEMENT_ROW_NOT_FOUND: E("notFound", "Không tìm thấy dòng đối soát này."),
  PROPOSAL_NOT_FOUND: E("notFound", "Không tìm thấy đề xuất này."),
  RECOVERY_NOT_FOUND: E("notFound", "Không tìm thấy đợt chạy bổ sung này."),
  // ── D65-B: proposal state (stale = somebody else moved it first: reload, never resend blindly)
  PROPOSAL_ALREADY_EXISTS: E("stale", "Buổi này đang có đề xuất chưa đóng. Hãy tải lại để xem đề xuất đó."),
  PROPOSAL_ALREADY_APPROVED: E("stale", "Đề xuất này đã được duyệt. Chỉ người đã duyệt mới chạy lại được phần ghi có; hãy tải lại để xem trạng thái."),
  PROPOSAL_ALREADY_REJECTED: E("stale", "Đề xuất này đã bị người khác từ chối. Hãy tải lại."),
  PROPOSAL_REJECTED: E("stale", "Đề xuất này đã bị bác nên không duyệt được nữa."),
  PROPOSAL_NOT_REJECTABLE: E("stale", "Đề xuất đã được duyệt hoặc đã đóng nên không bác được. Hãy tải lại."),
  APPROVER_STILL_ACTIVE: E("blocked", "Người đã duyệt vẫn là quản trị viên đang hoạt động; chính họ cần chạy tiếp việc ghi có."),
  EVIDENCE_NOT_VERIFIABLE: E("validation", "Tham chiếu bằng chứng không kiểm chứng được với đúng buổi hoặc hợp đồng này. Chưa tạo đề xuất; hãy kiểm tra mã và hash."),
  NOT_APPROVED: E("blocked", "Đề xuất này chưa được duyệt."),
  LEDGER_CREDIT_NOT_CONFIRMED: E("blocked", "Đã duyệt nhưng sổ cái chưa xác nhận ghi có cho khách. Tiền chưa chuyển vào ví; hãy chạy lại sau."),
  // ── D65-B: why the held amount cannot be resolved right now
  CONTRACT_NOT_ENDED: E("blocked", "Hợp đồng còn đang chạy nên khoản tiền của buổi này chưa bị giữ."),
  CONTRACT_ENDING: E("blocked", "Việc kết thúc hợp đồng chưa được xác nhận xong. Thử lại sau."),
  CONTRACT_HAS_NO_PAYMENT: E("blocked", "Hợp đồng không có khoản thanh toán phía sau."),
  SESSION_IN_DISPUTE: E("blocked", "Buổi tập đang bị khiếu nại: phải xử lý qua hồ sơ khiếu nại."),
  SESSION_NOT_NO_SHOW: E("blocked", "Chỉ áp dụng cho buổi mà PT vắng mặt."),
  SESSION_WENT_THROUGH_DISPUTE: E("blocked", "Buổi tập đã được phán quyết qua khiếu nại nên không xử lý bằng đường này."),
  CASE_EXISTS: E("blocked", "Buổi tập đã có hồ sơ khiếu nại: phải xử lý qua hồ sơ đó."),
  SESSION_HAS_D77: E("blocked", "Buổi tập có khoản bồi thường PT đến muộn nên không xử lý bằng đường này."),
  NO_HELD_ROW: E("blocked", "Buổi tập không có dòng tiền đền buổi PT vắng mặt."),
  ROW_NOT_HELD: E("blocked", "Khoản của buổi này không còn ở trạng thái đang giữ."),
  ALREADY_RESOLVING: E("blocked", "Buổi này đã có bước giải quyết khoản giữ đang chạy."),
  RESOLVED_OTHER_WAY: E("blocked", "Buổi này đã được giải quyết theo hướng khác."),
  ROW_ALREADY_SETTLED: E("blocked", "Bước tiền này đã hoàn tất, không còn gì để làm."),
  LEDGER_NOT_ENDED: E("blocked", "Sổ cái chưa ghi nhận việc kết thúc hợp đồng nên chưa giải quyết được."),
  INSUFFICIENT_HELD_FUNDS: E("blocked", "Tiền đang giữ của hợp đồng không đủ một buổi. Một người phải đối soát trước."),
  // ── late-open: assignee
  ALREADY_ASSIGNED: E("stale", "Dòng này đã có người khác phụ trách. Hãy tải lại để xem người phụ trách hiện tại."),
  ASSIGNEE_NOT_FOUND: E("blocked", "Không tìm thấy tài khoản của người nhận chuyển giao."),
  ASSIGNEE_NOT_ADMIN: E("blocked", "Người nhận chuyển giao phải là quản trị viên đang hoạt động."),
  ACCOUNT_LOOKUP_UNAVAILABLE: E("unavailable", "Chưa kiểm tra được tài khoản người nhận lúc này. Chưa chuyển giao gì. Hãy thử lại."),
  // ── late-open: the assessment (also used for `assessment.code`)
  ROW_KIND_NOT_SUPPORTED: E("blocked", "Dòng này không phải bước tiền của một buổi tập."),
  ROW_NOT_WAITING: E("blocked", "Dòng này không còn ở trạng thái chờ người xử lý vì khoản bồi thường đến muộn còn mở."),
  ROW_NOT_RECONCILABLE: E("blocked", "Bước giải quyết buổi bị giữ chỉ có khi hợp đồng đã kết thúc."),
  SESSION_MISMATCH: E("blocked", "Buổi tập không thuộc hợp đồng của dòng này."),
  SESSION_NOT_TERMINAL: E("blocked", "Buổi tập chưa kết thúc theo đường thường."),
  SESSION_STATE_MISMATCH: E("blocked", "Trạng thái buổi tập không khớp với bước tiền đang chờ."),
  OPEN_CASE_EXISTS: E("blocked", "Buổi tập có hồ sơ khiếu nại đang mở: phải xử lý qua hồ sơ đó, không dùng đường này."),
  LATE_CONTESTED: E("blocked", "Việc PT đến muộn của buổi này đang bị tranh cãi trong hồ sơ khiếu nại."),
  LATE_STEP_NOT_SETTLED: E("blocked", "Buổi này không có khoản bồi thường PT đến muộn đã ghi sổ, nên không thuộc hàng đợi này."),
  LATE_OPERATION_MISSING: E("blocked", "Sổ cái không có khoản bồi thường PT đến muộn của buổi này."),
  POLICY_EXCEPTION_APPLIES: E("blocked", "Hợp đồng thuộc ngoại lệ lịch sử về chính sách, cần xử lý riêng."),
  NO_OBLIGATION: E("blocked", "Sổ cái không có khoản còn nợ nào cho buổi này."),
  OBLIGATION_HAS_OUTSIDE_PAYMENT: E("blocked", "Khoản này có thanh toán ngoài hệ thống đang mở hoặc đã xác minh. Một người phải đối soát trước."),
  OBLIGATION_NOT_UNPAID: E("blocked", "Khoản này không còn phần chưa trả."),
  LEDGER_ENDING_MISMATCH: E("blocked", "Sổ cái và hệ thống không thống nhất về việc hợp đồng đã kết thúc chưa."),
  INSUFFICIENT_SOURCE: E("blocked", "Tiền đang giữ của hợp đồng không đủ để trả khoản này."),
  LEDGER_UNAVAILABLE: E("unavailable", "Chưa đọc được sổ cái nên chưa xác minh được. Chưa có gì được ghi. Hãy thử lại."),
  LEDGER_UNREADABLE: E("unavailable", "Chưa đọc được sổ cái nên chưa xác minh được."),
  ASSESSMENT_FAILED: E("unavailable", "Chưa đánh giá được dòng này."),
  LEDGER_CHECK_FAILED: E("unavailable", "Chưa kiểm tra được sổ cái cho buổi này."),
  // ── late-open: execution
  EXECUTION_ATTEMPTS_EXHAUSTED: E("blocked", "Đã chạy tối đa số lần cho phép. Cần mở đợt chạy bổ sung (hai người) hoặc một người xem lại."),
  NOT_EXHAUSTED: E("blocked", "Đề xuất vẫn còn lượt chạy: dùng «Chạy lại», chưa cần đợt bổ sung."),
  ALREADY_EXECUTED: E("stale", "Đề xuất này đã được thực thi xong."),
  REOPEN_LOST: E("blocked", "Một lần chạy khác đang xử lý dòng này."),
  EXECUTION_DID_NOT_SETTLE: E("blocked", "Lần chạy này chưa ghi nhận được vào sổ cái."),
  // ── late-open: recovery
  RECOVERY_ALREADY_OPEN: E("stale", "Đã có một đợt chạy bổ sung đang mở cho đề xuất này."),
  RECOVERY_LIMIT_REACHED: E("blocked", "Đã dùng hết số đợt chạy bổ sung cho đề xuất này. Cần một người xem lại bằng cách khác."),
  RECOVERY_CLOSED: E("stale", "Đợt chạy bổ sung này đã được duyệt hoặc đã đóng. Hãy tải lại."),
  LEDGER_WROTE_BUT_OBLIGATION_NOT_PAID: E("blocked", "Sổ cái đã có thao tác nhưng khoản chưa được trả: chưa rõ, cần một người xem."),
  OBLIGATION_PAID_WITHOUT_STEP_OPERATION: E("blocked", "Khoản đã được trả nhưng không có thao tác của bước này: chưa rõ, cần một người xem."),
  // ── server fallback
  INTERNAL_ERROR: E("unknown", "Máy chủ gặp lỗi khi xử lý yêu cầu."),
};

/** `OBLIGATION_<STATUS>`: the ledger obligation is no longer plainly OPEN. */
export function obligationBlockedText(code: string): string | null {
  const m = /^OBLIGATION_([A-Z_]+)$/.exec(code);
  if (!m || code === "OBLIGATION_HAS_OUTSIDE_PAYMENT" || code === "OBLIGATION_NOT_UNPAID" || code === "OBLIGATION_PAID_WITHOUT_STEP_OPERATION") return null;
  const status = m[1];
  if (status === "PAID_VIA_LEDGER") return "Khoản này đã được trả vào ví Gymini.";
  if (status === "PAID_VERIFIED") return "Khoản này đã được chi ngoài hệ thống và chứng từ đã được xác minh.";
  return `Khoản này đang ở trạng thái «${obligationStatusLabel(status)}», không còn là khoản đang mở đơn thuần: một người phải đối soát nó trước.`;
}

export const GENERIC_BY_KIND: Record<ReasonKind, string> = {
  auth: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  forbidden: "Bạn không có quyền thực hiện thao tác này.",
  notFound: "Không tìm thấy dữ liệu này.",
  stale: "Trạng thái đã thay đổi ở nơi khác. Hãy tải lại.",
  blocked: "Thao tác này đang bị chặn theo trạng thái hiện tại.",
  validation: "Dữ liệu gửi lên chưa hợp lệ.",
  unavailable: "Một phần hệ thống chưa phản hồi nên chưa xác minh được. Chưa có gì được ghi. Hãy thử lại.",
  disabled: "Chức năng này đang tắt.",
  unknown: "Không xử lý được yêu cầu.",
};

/** The sentence for any server code (error, assessment, execution, halt). Unknown / missing code -> `null`, the caller picks a generic one. */
export function reasonText(code: string | null | undefined): string | null {
  if (!code) return null;
  const known = REASON_TEXT[code];
  if (known) return known.text;
  if (code.startsWith("LEDGER_")) return "Sổ cái chưa xác nhận khoản ghi có cho khách.";
  return obligationBlockedText(code);
}

/** `reasonText` with a safe generic sentence when the code is not known (never the raw code). */
export const reasonOrGeneric = (code: string | null | undefined, fallback = GENERIC_BY_KIND.blocked) => reasonText(code) ?? fallback;
