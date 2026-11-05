/**
 * D6 - turns a failed gym complaint / complaint-case request into the same `DisputeErrorView` the D1 forms use.
 *
 * Why not `parseDisputeError` as is: gym-service wraps errors as `{ success:false, error:{ code, message, details?, fields? } }` (the
 * user-service case routes put `details` at the top level), and several codes mean something else in the gym flow
 * (`CASE_STATE_NOT_ALLOWED` names gym steps, `EXEC_BLOCKED` carries a membership reason). So the envelope is read here, the gym
 * codes are answered here, and only the shape (`DisputeErrorView`, `mustReloadFirst`, `canOfferRetry`) is shared with D1.
 *
 * No code, enum or English text reaches the user: an unknown code shows the server's message only when it really is Vietnamese.
 */
import { NETWORK_READ_MESSAGE, NETWORK_WRITE_MESSAGE, UNKNOWN_OUTCOME_SUFFIX, type DisputeErrorKind, type DisputeErrorView } from "../disputes/disputeCaseErrors";
import { gymStatusLabel } from "./gymCaseLabels";

export type GymErrorView = DisputeErrorView;

interface Entry {
  kind: DisputeErrorKind;
  message: string | ((details: Record<string, unknown> | null) => string);
}

const stateText = (d: Record<string, unknown> | null) =>
  typeof d?.status === "string" ? `Hồ sơ đang ở bước «${gymStatusLabel(d.status)}» nên chưa làm được thao tác này.` : "Bước hiện tại của hồ sơ chưa cho phép thao tác này.";

/** Why `execute` was blocked: gym-service stores `MEMBERSHIP_NOT_REFUNDABLE` or `REFUND_REFUSED:<detail>`; nothing moved. */
export function execBlockedText(reason: unknown): string {
  const r = typeof reason === "string" ? reason : "";
  if (r.startsWith("REFUND_REFUSED")) return "Hệ thống từ chối hoàn tiền cho gói hội viên này nên chưa có khoản tiền nào được chuyển. Sửa nguyên nhân rồi thực thi lại.";
  if (r === "MEMBERSHIP_NOT_REFUNDABLE") return "Gói hội viên không còn ở trạng thái hoàn được nên chưa có khoản tiền nào được chuyển.";
  return "Chưa thực thi được quyết định. Chưa có khoản tiền nào được chuyển.";
}

export const GYM_ERROR_CODES: Record<string, Entry> = {
  // identity / permission
  UNAUTHENTICATED: { kind: "auth", message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." },
  UNAUTHORIZED: { kind: "auth", message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." },
  FORBIDDEN: { kind: "forbidden", message: "Bạn không có quyền thực hiện thao tác này." },
  ADMIN_ONLY: { kind: "forbidden", message: "Chỉ quản trị viên được thực hiện thao tác này." },
  NOT_ASSIGNED_INVESTIGATOR: { kind: "forbidden", message: "Chỉ điều tra viên được giao hồ sơ này mới làm được thao tác này." },
  SELF_APPROVAL_FORBIDDEN: { kind: "forbidden", message: "Người lập đề xuất và điều tra viên của hồ sơ không được tự duyệt. Cần một quản trị viên khác." },
  CONFLICT_OF_INTEREST: { kind: "forbidden", message: "Bạn là một bên của vụ việc, hoặc chưa khai báo không có xung đột lợi ích, nên không thực hiện được thao tác này." },
  // not found
  CASE_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy hồ sơ khiếu nại. Quay lại danh sách để chọn lại." },
  COMPLAINT_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy khiếu nại này." },
  MEMBERSHIP_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy gói hội viên đã chọn." },
  DECISION_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy quyết định đã duyệt." },
  CLAIM_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy khẳng định này trong hồ sơ." },
  EVIDENCE_NOT_FOUND: { kind: "notFound", message: "Có bằng chứng hoặc lời khai không thuộc hồ sơ này." },
  STATEMENT_NOT_FOUND: { kind: "notFound", message: "Không tìm thấy lời khai này trong hồ sơ." },
  // concurrency: reload, never resend blindly
  CASE_VERSION_CONFLICT: { kind: "conflictReload", message: "Hồ sơ vừa được người khác cập nhật. Hãy tải lại hồ sơ rồi làm lại thao tác nếu vẫn cần." },
  // flag
  GYM_CASE_DISABLED: { kind: "blocked", message: "Chức năng xử lý hồ sơ khiếu nại phòng gym chưa được bật trên hệ thống này nên chưa ghi được gì." },
  GYM_CASE_OPEN: { kind: "blocked", message: "Gói hội viên này đang có hồ sơ khiếu nại chưa kết thúc. Việc hoàn tiền phải đi qua hồ sơ đó." },
  GYM_CASE_DECISION_EXISTS: { kind: "blocked", message: "Gói hội viên này đã có quyết định được duyệt trong hồ sơ khiếu nại. Không hoàn tiền ngoài hồ sơ để tránh mâu thuẫn với quyết định đó." },
  GYM_CASE_DECISION_MISMATCH: { kind: "blocked", message: "Quyết định của hồ sơ không khớp với gói hội viên cần hoàn tiền nên không thực hiện hoàn tiền." },
  // state / rule refusals
  CASE_STATE_NOT_ALLOWED: { kind: "blocked", message: stateText },
  CASE_NOT_ACCEPTING: { kind: "blocked", message: "Hồ sơ hiện không nhận thêm thông tin. Hãy tải lại để xem bước hiện tại." },
  IDEMPOTENCY_KEY_REUSED: { kind: "blocked", message: "Thao tác này đã được gửi với nội dung khác. Hãy mở lại biểu mẫu rồi gửi lại." },
  CASE_ALREADY_OPEN: { kind: "blocked", message: "Khiếu nại này đã có hồ sơ, hoặc gói hội viên này đang có hồ sơ khác chưa kết thúc." },
  REPORTER_REQUIRED: { kind: "blocked", message: "Khiếu nại chưa có người phản ánh nên chưa mở được hồ sơ. Hãy gắn người phản ánh trước." },
  COMPLAINT_ALREADY_RESOLVED: { kind: "blocked", message: "Khiếu nại này đã được xử lý xong nên không mở hồ sơ được." },
  MEMBERSHIP_MISMATCH: { kind: "blocked", message: "Gói hội viên không thuộc người phản ánh hoặc không thuộc chi nhánh của khiếu nại." },
  MEMBERSHIP_REQUIRED: { kind: "validation", message: "Loại hồ sơ này cần chọn gói hội viên liên quan." },
  MEMBERSHIP_NOT_ALLOWED: { kind: "validation", message: "Loại hồ sơ này không gắn với gói hội viên." },
  MEMBERSHIP_NOT_REFUNDABLE: { kind: "blocked", message: "Gói hội viên không còn hoàn được nên chưa lập đề xuất hoàn tiền được. Chưa có khoản tiền nào được chuyển." },
  ASSESSMENT_REQUIRED: { kind: "blocked", message: "Cần ít nhất một khẳng định và mỗi khẳng định phải được đánh giá trước khi ghi kết luận." },
  FINDING_REQUIRED: { kind: "blocked", message: "Hồ sơ chưa có kết luận để lập đề xuất." },
  PROPOSAL_REQUIRED: { kind: "blocked", message: "Hồ sơ chưa có đề xuất." },
  EVIDENCE_CHANGED: { kind: "blocked", message: "Bằng chứng đã thay đổi sau khi lập đề xuất. Điều tra viên cần thu lại và xác nhận thay đổi trước khi duyệt." },
  EVIDENCE_DUPLICATE: { kind: "blocked", message: "Tài liệu có cùng mã sha256 đã được nộp trong hồ sơ này." },
  DECISION_NOT_APPROVED: { kind: "blocked", message: "Quyết định này chưa được duyệt." },
  DECISION_MISMATCH: { kind: "blocked", message: "Hồ sơ đã gắn với một quyết định khác." },
  DECISION_WRONG_CASE: { kind: "blocked", message: "Quyết định này không thuộc hồ sơ." },
  OUTCOME_MISMATCH: { kind: "blocked", message: "Kết quả của quyết định không còn khớp với kết luận của hồ sơ nên chưa thực thi được." },
  EXECUTION_IN_PROGRESS: { kind: "blocked", message: "Quyết định đang được thực thi hoặc lần trước chưa kết thúc. Dùng «Đối chiếu thực thi», đừng chạy lại." },
  EXECUTION_STATE_CHANGED: { kind: "conflictReload", message: "Trạng thái thực thi vừa thay đổi. Hãy tải lại hồ sơ." },
  NEEDS_HUMAN: { kind: "blocked", message: "Việc thực thi đang chờ người xem xét. Hệ thống không tự thử lại." },
  EXEC_BLOCKED: { kind: "blocked", message: (d) => execBlockedText(d?.reason) },
  CASE_REQUIRED: { kind: "blocked", message: "Khiếu nại này đã có hồ sơ xử lý nên chỉ kết thúc được qua hồ sơ." },
  // validation
  INVALID_INPUT: { kind: "validation", message: "Dữ liệu gửi lên chưa hợp lệ. Hãy kiểm tra các ô được đánh dấu." },
  INVALID_IDEMPOTENCY_KEY: { kind: "validation", message: "Không tạo được mã chống gửi trùng. Hãy mở lại biểu mẫu." },
  REASON_REQUIRED: { kind: "validation", message: "Cần nhập lý do." },
  SUPPLEMENT_REASON_REQUIRED: { kind: "validation", message: "Từ lời khai thứ hai trở đi cần nhập lý do bổ sung." },
  EVIDENCE_LISTED_TWICE: { kind: "validation", message: "Một bằng chứng chỉ được xếp vào một nhóm." },
  ADMIN_NOT_FOUND: { kind: "validation", message: "Không tìm thấy quản trị viên đã chọn." },
  NOT_AN_ADMIN: { kind: "validation", message: "Người được chọn không phải là quản trị viên đang hoạt động." },
  // unavailable
  AUTH_UNAVAILABLE: { kind: "unavailable", message: "Chưa kiểm tra được tài khoản quản trị viên nên chưa gán được. Chưa có gì được ghi. Hãy thử lại." },
  INTERNAL_ERROR: { kind: "unknown", message: "Máy chủ gặp lỗi khi xử lý yêu cầu." },
};

const VIETNAMESE = /[àáâãăạảấầẩẫậắằẳẵặèéêẹẻẽếềểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳỵỷỹđ]/i;

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function kindOfStatus(status: number | null): DisputeErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 400 || status === 422) return "validation";
  if (status === 503) return "unavailable";
  if (status === 409) return "blocked";
  return "unknown";
}

function generic(kind: DisputeErrorKind, status: number | null): string {
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

/** Core: HTTP status + parsed body -> view. `action: "write"` = a POST/PATCH (a network failure or 5xx means the outcome is unknown). */
export function parseGymErrorBody(status: number | null, body: unknown, options: { action?: "read" | "write" } = {}): GymErrorView {
  const write = options.action === "write";
  const root = asRecord(body);
  let code: string | null = null;
  let serverText: string | null = null;
  let details: Record<string, unknown> | null = null;
  let fields: Array<{ path: string; message: string }> = [];
  if (root) {
    const err = root.error;
    const env = asRecord(err);
    if (env) {
      if (typeof env.code === "string") code = env.code;
      if (typeof env.message === "string") serverText = env.message;
      details = asRecord(env.details);
      if (Array.isArray(env.fields)) fields = fieldsOf(env.fields);
    } else if (typeof err === "string") serverText = err;
    if (!code && typeof root.code === "string") code = root.code;
    if (!details) details = asRecord(root.details);
    if (fields.length === 0 && Array.isArray(root.fields)) fields = fieldsOf(root.fields);
  }
  const entry = code ? GYM_ERROR_CODES[code] : undefined;
  let kind: DisputeErrorKind;
  let message: string;
  if (entry) {
    kind = entry.kind;
    message = typeof entry.message === "function" ? entry.message(details) : entry.message;
  } else {
    kind = kindOfStatus(status);
    message = serverText && VIETNAMESE.test(serverText) ? serverText : generic(kind, status);
  }
  const outcomeUnknown = write && (status === null || (status >= 500 && status !== 503));
  if (outcomeUnknown) {
    kind = status === null ? "network" : kind;
    message = status === null ? NETWORK_WRITE_MESSAGE : `${message}${UNKNOWN_OUTCOME_SUFFIX}`;
  }
  const view: GymErrorView = { code, message, fields, details, kind, status, outcomeUnknown };
  if (code === "EVIDENCE_CHANGED") {
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const staleLive = list(details?.staleLive);
    view.evidenceChange = { changedIds: list(details?.changedIds), staleLive, needsRecollect: details?.needsRecollect === true || staleLive.length > 0 };
    view.message = view.evidenceChange.needsRecollect
      ? "Nguồn bằng chứng đã đổi nhưng chưa được thu lại. Điều tra viên cần thu lại bằng chứng trước, rồi mới xác nhận và duyệt."
      : "Bằng chứng đã thay đổi sau khi lập đề xuất. Điều tra viên cần xác nhận thay đổi, sau đó người duyệt tích xác nhận và gửi lại.";
  }
  return view;
}

function fieldsOf(raw: unknown[]): Array<{ path: string; message: string }> {
  return raw
    .map((f) => asRecord(f))
    .filter((f): f is Record<string, unknown> => !!f)
    .map((f) => ({ path: String(f.path ?? ""), message: String(f.message ?? "") }));
}

/** Anything thrown by the `api` client (axios error, SessionChangedError, plain Error) -> view. */
export function parseGymError(error: unknown, options: { action?: "read" | "write" } = {}): GymErrorView {
  const e = error as { response?: { status?: number; data?: unknown }; name?: string; message?: string } | null | undefined;
  if (e?.response && typeof e.response.status === "number") return parseGymErrorBody(e.response.status, e.response.data, options);
  if (e?.name === "SessionChangedError") {
    return { code: null, message: "Phiên đăng nhập đã thay đổi. Hãy tải lại trang.", fields: [], details: null, kind: "auth", status: null, outcomeUnknown: options.action === "write" };
  }
  if (e?.name === "Error" && e.message === "INVALID_IDEMPOTENCY_KEY") return parseGymErrorBody(400, { success: false, error: { code: "INVALID_IDEMPOTENCY_KEY", message: "" } }, options);
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

/** Is the whole write layer off? (409 GYM_CASE_DISABLED) */
export const isGymDisabled = (v: GymErrorView | null | undefined) => v?.code === "GYM_CASE_DISABLED";
