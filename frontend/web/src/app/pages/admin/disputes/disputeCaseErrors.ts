/**
 * Dispute V2.1 admin UI (D1) - one place that turns a failed Dispute Case request into `{code, message, fields, details, kind}`.
 *
 * Reads every error shape in the chain (contract section 0.5):
 *  - user-service Dispute Case: `{error:"<vi>", code, details?}`; Zod: `{error, code:"INVALID_INPUT", fields:[{path,message}]}`
 *  - gateway: `{success:false, error:{code:"UNAUTHORIZED"|"FORBIDDEN", message}}`
 *  - user-service auth middleware called directly: `{error:"No token provided"}` (no code)  -> decided by HTTP status
 * Kinds drive the screen: auth -> sign in again; forbidden -> hide the action; notFound -> back to the queue;
 * conflictReload -> reload the case, NEVER resend blindly; blocked -> the rule says no (state / policy), show why;
 * validation -> mark the fields; unavailable -> something could not be VERIFIED (never shown as success);
 * network -> no answer at all; unknown -> anything else.
 * No code, enum or English text reaches the user: an unknown code shows the server's Vietnamese `error` only if it really is Vietnamese.
 */
import { CASE_STATUS_LABEL, EXEC_BLOCK_REASON_LABEL, SHARE_REFUSAL_LABEL, caseStatusLabel } from "./disputeCaseLabels";

export type DisputeErrorKind = "auth" | "forbidden" | "notFound" | "conflictReload" | "blocked" | "validation" | "unavailable" | "unknown" | "network";

export interface DisputeErrorField {
  path: string;
  message: string;
}

export interface EvidenceChangeInfo {
  changedIds: string[];
  staleLive: string[];
  /** true = the sources must be re-collected first; the change can not be "acknowledged" past. */
  needsRecollect: boolean;
}

export interface DisputeErrorView {
  code: string | null;
  message: string;
  fields: DisputeErrorField[];
  details: Record<string, unknown> | null;
  kind: DisputeErrorKind;
  status: number | null;
  /** A write whose result we do not know (no answer / timeout / 5xx): reload the case before anything else. */
  outcomeUnknown: boolean;
  /** Set for EVIDENCE_CHANGED. */
  evidenceChange?: EvidenceChangeInfo;
}

export interface ParseOptions {
  /** `write` = POST: a network failure or 5xx means "we do not know whether it was saved". Default `read`. */
  action?: "read" | "write";
}

interface Entry {
  kind: DisputeErrorKind;
  message: string | ((details: Record<string, unknown> | null) => string);
}

const stateText = (d: Record<string, unknown> | null) =>
  typeof d?.status === "string" && d.status in CASE_STATUS_LABEL
    ? `Hồ sơ đang ở bước «${caseStatusLabel(d.status)}» nên chưa làm được thao tác này.`
    : "Trạng thái hiện tại của hồ sơ chưa cho phép thao tác này.";

/** Every code of handoff section 6 + contract section A/B/C that a screen can meet. */
export const DISPUTE_ERROR_CODES: Record<string, Entry> = {
  // identity / permission
  UNAUTHENTICATED: { kind: "auth", message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." },
  UNAUTHORIZED: { kind: "auth", message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." },
  FORBIDDEN: { kind: "forbidden", message: "Bạn không có quyền thực hiện thao tác này." },
  ADMIN_ONLY: { kind: "forbidden", message: "Chỉ quản trị viên được thực hiện thao tác này." },
  NOT_ASSIGNED_INVESTIGATOR: { kind: "forbidden", message: "Chỉ điều tra viên được giao hồ sơ này mới làm được thao tác này." },
  SELF_APPROVAL_FORBIDDEN: { kind: "forbidden", message: "Bạn không được duyệt đề xuất do mình lập hoặc hồ sơ do mình phụ trách." },
  CONFLICT_OF_INTEREST: { kind: "forbidden", message: "Bạn là một bên của vụ việc, hoặc chưa khai báo không có xung đột lợi ích, nên không thực hiện được thao tác này." },
  // not found
  CASE_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy hồ sơ khiếu nại. Quay lại danh sách để chọn lại." },
  SESSION_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy buổi tập này." },
  CLAIM_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy khẳng định này trong hồ sơ." },
  EVIDENCE_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy bằng chứng hoặc lời khai này trong hồ sơ." },
  STATEMENT_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy lời khai này trong hồ sơ." },
  POLICY_REVIEW_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy kết luận áp dụng chính sách này trong hồ sơ." },
  DECISION_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy quyết định đã duyệt." },
  // concurrency: reload, never resend blindly
  CASE_VERSION_CONFLICT: { kind: "conflictReload", message: "Hồ sơ vừa được người khác cập nhật. Hãy tải lại hồ sơ rồi làm lại thao tác nếu vẫn cần." },
  STATEMENT_VERSION_CONFLICT: { kind: "conflictReload", message: "Lời khai vừa được cập nhật ở nơi khác. Hãy tải lại rồi gửi lại nếu vẫn cần." },
  SESSION_ALREADY_PROCESSED: { kind: "conflictReload", message: "Buổi này vừa được xử lý ở nơi khác. Hãy tải lại để xem kết quả." },
  // state / rule refusals
  CASE_STATE_NOT_ALLOWED: { kind: "blocked", message: stateText },
  IDEMPOTENCY_KEY_REUSED: { kind: "blocked", message: "Thao tác này đã được gửi với nội dung khác. Hãy mở lại biểu mẫu rồi gửi lại." },
  CLASSIFICATION_REQUIRED: { kind: "blocked", message: "Hồ sơ còn ở phân loại tạm. Điều tra viên cần phân loại trước khi ghi kết luận hoặc lập đề xuất." },
  ALREADY_CLASSIFIED: { kind: "blocked", message: "Hồ sơ này đã được phân loại." },
  ASSESSMENT_REQUIRED: { kind: "blocked", message: "Mỗi khẳng định trong hồ sơ phải được đánh giá trước khi ghi kết luận." },
  FINDING_REQUIRED: { kind: "blocked", message: "Hồ sơ chưa có kết luận để lập đề xuất." },
  PROPOSAL_REQUIRED: { kind: "blocked", message: "Hồ sơ chưa có đề xuất." },
  DESIGN_REQUIRED: { kind: "blocked", message: "Chưa hỗ trợ xử lý cho kết luận này." },
  NO_PROPOSAL_FOR_FINDING: { kind: "blocked", message: "Kết luận này không tạo đề xuất." },
  PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED: {
    kind: "blocked",
    message: (d) => (typeof d?.reason === "string" && SHARE_REFUSAL_LABEL[d.reason]) || "Chưa hỗ trợ chia sẻ bằng chứng này cho bên kia.",
  },
  SESSION_NOT_DISPUTED: { kind: "blocked", message: "Buổi này không còn trong diện khiếu nại. Danh sách cần được làm mới." },
  CASE_DECISION_PENDING_EXECUTION: { kind: "blocked", message: "Buổi này đã có quyết định được duyệt nhưng chưa thực thi nên chưa mở hồ sơ mới được." },
  DISPUTE_TYPE_UNKNOWN: { kind: "blocked", message: "Chưa xác định được loại khiếu nại của buổi này." },
  POLICY_ELIGIBILITY_UNVERIFIED: { kind: "blocked", message: "Hợp đồng chưa có kết luận áp dụng chính sách. Chưa phán quyết được." },
  POLICY_EXCEPTION_APPLIES: { kind: "blocked", message: "Hợp đồng thuộc ngoại lệ lịch sử, cần xử lý riêng." },
  POLICY_REVIEW_ALREADY_APPROVED: { kind: "blocked", message: "Kết luận áp dụng chính sách này đã được duyệt." },
  CANCELLED_BLOCKED_BY_D77: { kind: "blocked", message: "Buổi có khoản đền đến muộn nên không huỷ được." },
  D77_COMBINATION_UNRESOLVED: { kind: "blocked", message: "Buổi có khoản đền đến muộn, tổ hợp này chưa được cho phép thực thi." },
  CONTRACT_ENDING: { kind: "blocked", message: "Hợp đồng đang kết thúc. Thử lại sau." },
  CASE_REQUIRED: { kind: "blocked", message: "Buổi khiếu nại phải được phán quyết qua hồ sơ khiếu nại." },
  EVIDENCE_CHANGED: {
    kind: "blocked",
    message: "Bằng chứng đã thay đổi sau khi lập đề xuất. Cần điều tra viên xem lại và xác nhận trước khi duyệt.",
  },
  EVIDENCE_NOT_IN_CASE: { kind: "blocked", message: "Có bằng chứng không thuộc hồ sơ này." },
  CONTRACT_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy hợp đồng này." },
  EVIDENCE_REF_NOT_FOUND: { kind: "validation", message: "Không tìm thấy bản ghi được chọn làm căn cứ. Hãy tải lại danh sách." },
  EVIDENCE_REF_NOT_IN_CONTRACT: { kind: "validation", message: "Căn cứ đã chọn không thuộc PT hoặc hợp đồng này." },
  EVIDENCE_REF_NOT_PROOF: { kind: "blocked", message: "Bản ghi này là điều khoản nháp hoặc chưa đủ làm căn cứ. Hãy chọn bản ghi chính thức." },
  EVIDENCE_REF_CHANGED: { kind: "conflictReload", message: "Căn cứ đã thay đổi sau khi đề xuất. Hãy tải lại và rà soát trước khi duyệt." },
  SUPERSEDES_INVALID: { kind: "blocked", message: "Kết luận cũ được thay thế phải cùng hợp đồng." },
  EXECUTION_DISABLED: { kind: "blocked", message: "Bộ thực thi quyết định đang tắt. Chưa có gì được thay đổi." },
  EXECUTION_IN_PROGRESS: { kind: "blocked", message: "Quyết định đang được thực thi. Hãy tải lại sau ít phút." },
  EXECUTION_STATE_CHANGED: { kind: "conflictReload", message: "Trạng thái thực thi của hồ sơ vừa thay đổi. Hãy tải lại hồ sơ để xem kết quả." },
  NEEDS_HUMAN: { kind: "blocked", message: "Cần người xem xét. Hệ thống không tự thử lại." },
  NOT_NEEDS_HUMAN: { kind: "blocked", message: "Việc thực thi không còn ở trạng thái chờ người xem xét. Hãy tải lại hồ sơ." },
  DECISION_MISMATCH: { kind: "blocked", message: "Hồ sơ đã gắn với một quyết định khác. Hãy tải lại hồ sơ." },
  DECISION_UNREADABLE: { kind: "blocked", message: "Không đọc được quyết định đã duyệt. Cần người xem xét." },
  DECISION_WRONG_CASE: { kind: "blocked", message: "Quyết định này không thuộc hồ sơ." },
  OUTCOME_MISMATCH: { kind: "blocked", message: "Kết quả của quyết định không khớp với đề xuất đã duyệt. Cần người xem xét." },
  CASE_SESSION_MISMATCH: { kind: "blocked", message: "Hồ sơ và buổi tập không khớp nhau. Cần người xem xét." },
  CASE_EXISTS: { kind: "blocked", message: "Buổi này đã có hồ sơ khiếu nại nên chỉ xử lý được trong hồ sơ, qua bước duyệt của người thứ hai. Chưa có gì được ghi vào buổi, quyền buổi hay tiền." },
  CASE_NOT_ORPHAN: { kind: "blocked", message: "Buổi tập vẫn đang trong khiếu nại nên hồ sơ không phải hồ sơ mồ côi." },
  FINDING_NOT_A_DISPUTE: { kind: "blocked", message: "Chỉ đóng được khi kết luận hiện tại là «Không phải khiếu nại»." },
  ASSIGNEE_NOT_FOUND: { kind: "blocked", message: "Không tìm thấy người nhận hồ sơ này. Hãy chọn lại trong danh sách quản trị viên." },
  ASSIGNEE_NOT_ADMIN: { kind: "blocked", message: "Người nhận phải là quản trị viên đang hoạt động. Hãy chọn lại trong danh sách." },
  EVIDENCE_REQUIRED: { kind: "validation", message: "Cần chọn ít nhất một bằng chứng của hồ sơ này." },
  EXEC_BLOCKED: {
    kind: "blocked",
    message: (d) => (typeof d?.reason === "string" && EXEC_BLOCK_REASON_LABEL[d.reason as keyof typeof EXEC_BLOCK_REASON_LABEL]) || "Chưa thực thi được quyết định này.",
  },
  DECISION_NOT_APPROVED: { kind: "blocked", message: "Quyết định này chưa được duyệt." },
  FEATURE_DISABLED: { kind: "blocked", message: "Chức năng này hiện chưa được bật." },
  LATE_OPEN_RECONCILIATION_DISABLED: { kind: "blocked", message: "Chức năng đối soát khoản bồi thường còn mở đang tắt." },
  EVIDENCE_FILE_INTEGRITY: { kind: "blocked", message: "Tệp lưu không còn khớp với mã băm lúc nộp." },
  // validation
  INVALID_INPUT: { kind: "validation", message: "Dữ liệu gửi lên chưa hợp lệ. Hãy kiểm tra các ô được đánh dấu." },
  INVALID_IDEMPOTENCY_KEY: { kind: "validation", message: "Không tạo được mã chống gửi trùng. Hãy mở lại biểu mẫu." },
  IDEMPOTENCY_KEY_REQUIRED: { kind: "validation", message: "Thao tác này thiếu mã chống gửi trùng nên chưa ghi gì. Hãy mở lại biểu mẫu rồi gửi lại." },
  REASON_REQUIRED: { kind: "validation", message: "Cần nhập lý do." },
  SUPPLEMENT_REASON_REQUIRED: { kind: "validation", message: "Từ lời khai thứ hai trở đi cần nhập lý do bổ sung." },
  EVIDENCE_LISTED_TWICE: { kind: "validation", message: "Một bằng chứng chỉ được xếp vào một nhóm." },
  TYPE_NOT_ALLOWED: { kind: "validation", message: "Loại khiếu nại này không được chọn." },
  // unavailable: could NOT be verified, never success
  PAYMENT_UNAVAILABLE: { kind: "unavailable", message: "Chưa đọc được sổ cái tiền nên chưa xác minh được. Chưa có gì được ghi. Hãy thử lại." },
  LEDGER_UNAVAILABLE: { kind: "unavailable", message: "Chưa đọc được sổ cái tiền nên chưa xác minh được. Chưa có gì được ghi. Hãy thử lại." },
  // 503: the chat / gym evidence source could not be read right now. Nothing was written and there is nothing to "acknowledge": just try again later.
  EVIDENCE_SOURCE_UNAVAILABLE: { kind: "unavailable", message: "Chưa đọc được nguồn bằng chứng (chat hoặc phòng tập) lúc này nên chưa kiểm tra được. Chưa có gì được ghi. Hãy thử lại sau ít phút." },
  ACCOUNT_LOOKUP_UNAVAILABLE: { kind: "unavailable", message: "Chưa kiểm tra được tài khoản người nhận lúc này. Chưa có gì được ghi. Hãy thử lại." },
  // unknown outcome
  INTERNAL_ERROR: { kind: "unknown", message: "Máy chủ gặp lỗi khi xử lý yêu cầu." },
};

const VIETNAMESE = /[àáâãăạảấầẩẫậắằẳẵặèéêẹẻẽếềểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳỵỷỹđ]/i;

function kindOfStatus(status: number | null): DisputeErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 400 || status === 422) return "validation";
  if (status === 503) return "unavailable";
  if (status === 409) return "blocked";
  return "unknown";
}

function genericMessage(kind: DisputeErrorKind, status: number | null): string {
  switch (kind) {
    case "auth":
      return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    case "forbidden":
      return "Bạn không có quyền thực hiện thao tác này.";
    case "notFound":
      return "Không tìm thấy dữ liệu này.";
    case "validation":
      return "Dữ liệu gửi lên chưa hợp lệ.";
    case "unavailable":
      return "Một phần hệ thống chưa phản hồi nên chưa xác minh được. Hãy thử lại.";
    case "blocked":
      return "Thao tác này đang bị chặn theo trạng thái hiện tại.";
    default:
      return status && status >= 500 ? "Máy chủ gặp lỗi khi xử lý yêu cầu." : "Không xử lý được yêu cầu.";
  }
}

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export const NETWORK_READ_MESSAGE = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
export const NETWORK_WRITE_MESSAGE = "Chưa biết thao tác đã được ghi hay chưa vì không nhận được phản hồi. Hãy tải lại hồ sơ để kiểm tra trước khi thử lại.";
export const UNKNOWN_OUTCOME_SUFFIX = " Chưa rõ thao tác đã được ghi hay chưa: hãy tải lại hồ sơ để kiểm tra trước khi thử lại.";

/** Core: HTTP status + parsed body -> view. */
export function parseDisputeErrorBody(status: number | null, body: unknown, options: ParseOptions = {}): DisputeErrorView {
  const write = options.action === "write";
  const root = asRecord(body);

  let code: string | null = null;
  let serverText: string | null = null;
  let details: Record<string, unknown> | null = null;
  let fields: DisputeErrorField[] = [];

  if (root) {
    const err = root.error;
    if (typeof err === "string") serverText = err;
    else if (asRecord(err)) {
      // gateway / payment-service shape
      const e = asRecord(err)!;
      if (typeof e.code === "string") code = e.code;
      if (typeof e.message === "string") serverText = e.message;
    }
    if (typeof root.code === "string") code = root.code;
    details = asRecord(root.details);
    if (Array.isArray(root.fields)) {
      fields = (root.fields as unknown[])
        .map((f) => asRecord(f))
        .filter((f): f is Record<string, unknown> => !!f)
        .map((f) => ({ path: String(f.path ?? ""), message: String(f.message ?? "") }));
    }
  }

  const entry = code ? DISPUTE_ERROR_CODES[code] : undefined;
  let kind: DisputeErrorKind;
  let message: string;
  if (entry) {
    kind = entry.kind;
    message = typeof entry.message === "function" ? entry.message(details) : entry.message;
  } else {
    kind = kindOfStatus(status);
    // Unknown code: the server's own text, but only when it is Vietnamese (never English / a raw code).
    message = serverText && VIETNAMESE.test(serverText) ? serverText : genericMessage(kind, status);
  }

  const outcomeUnknown = write && (status === null || (status >= 500 && status !== 503));
  if (outcomeUnknown) {
    kind = status === null ? "network" : kind;
    message = status === null ? NETWORK_WRITE_MESSAGE : `${message}${UNKNOWN_OUTCOME_SUFFIX}`;
  }

  const view: DisputeErrorView = { code, message, fields, details, kind, status, outcomeUnknown };

  if (code === "EVIDENCE_CHANGED") {
    const staleLive = strings(details?.staleLive);
    view.evidenceChange = {
      changedIds: strings(details?.changedIds),
      staleLive,
      needsRecollect: details?.needsRecollect === true || staleLive.length > 0,
    };
    view.message = view.evidenceChange.needsRecollect
      ? "Nguồn bằng chứng đã đổi nhưng chưa được thu lại. Điều tra viên cần thu lại bằng chứng trước, rồi mới xác nhận và duyệt."
      : "Bằng chứng đã thay đổi sau khi lập đề xuất. Điều tra viên cần xác nhận thay đổi, sau đó người duyệt tích xác nhận và gửi lại.";
  }
  return view;
}

/** Anything thrown by the `api` client (axios error, SessionChangedError, plain Error) -> view. */
export function parseDisputeError(error: unknown, options: ParseOptions = {}): DisputeErrorView {
  const e = error as { response?: { status?: number; data?: unknown }; name?: string; code?: string } | null | undefined;
  if (e?.response && typeof e.response.status === "number") return parseDisputeErrorBody(e.response.status, e.response.data, options);
  if (e?.name === "SessionChangedError") {
    return { code: null, message: "Phiên đăng nhập đã thay đổi. Hãy tải lại trang.", fields: [], details: null, kind: "auth", status: null, outcomeUnknown: options.action === "write" };
  }
  if (e?.name === "Error" && (error as Error).message === "INVALID_IDEMPOTENCY_KEY") {
    return parseDisputeErrorBody(400, { error: "", code: "INVALID_IDEMPOTENCY_KEY" }, options);
  }
  // No response at all: network down, timeout, CORS, aborted.
  const write = options.action === "write";
  return {
    code: null,
    message: write ? NETWORK_WRITE_MESSAGE : NETWORK_READ_MESSAGE,
    fields: [],
    details: null,
    kind: "network",
    status: null,
    outcomeUnknown: write,
  };
}

/** Should the screen offer "Tải lại hồ sơ" before anything else? (conflict, unknown outcome, state refusal). */
export const mustReloadFirst = (v: DisputeErrorView) => v.kind === "conflictReload" || v.outcomeUnknown || v.code === "CASE_STATE_NOT_ALLOWED";
/** A blind "thử lại" button is allowed only for an unavailable read-through (nothing was written) and for validation after the user edits. */
export const canOfferRetry = (v: DisputeErrorView) => v.kind === "unavailable" && !v.outcomeUnknown;
