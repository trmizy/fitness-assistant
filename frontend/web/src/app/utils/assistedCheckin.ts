/**
 * D15c — phần thuần (không React) của "check-in hộ" ở quầy lễ tân: chuẩn hoá phản hồi, nhãn tiếng Việt, mã lỗi.
 *
 * Server (gym-service, assisted-checkin.views.ts) đã chỉ trả tập trường tối thiểu. Các hàm `normalize*` ở đây cố ý chỉ
 * GIỮ các trường đó: dù server lỡ gửi thêm (SĐT, e-mail, giá, id...) thì giao diện cũng không có chỗ để hiện chúng.
 */

export type MemberStatus = "ACTIVE" | "EXPIRED" | "SUSPENDED";
export type AssistedMethod = "PHOTO_MATCH" | "MEMBER_OTP" | "MANAGER_EXCEPTION";

export interface AssistedConfig {
  methods: AssistedMethod[];
  exceptionEnabled: boolean;
  otpTtlSeconds: number;
  otpResendSeconds: number;
}

export interface MemberResult {
  membershipId: string;
  displayName: string;
  memberCode: string;
  planName: string;
  planType: "VISIT_BASED" | "TIME_BASED";
  status: MemberStatus;
  expiresAt: string | null;
  remainingVisits: number | null;
  photoUrl: string | null;
  hasPhoto: boolean;
  canCheckIn: boolean;
  blockedReason: string | null;
}

export interface ExceptionRow {
  id: string;
  membershipId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "USED";
  displayName: string;
  memberCode: string;
  planName: string;
  requestReason: string;
  requestedByName: string;
  createdAt: string | null;
  expiresAt: string | null;
  decisionReason: string | null;
  decidedByName: string | null;
  mine: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function normalizeConfig(raw: unknown): AssistedConfig {
  const d = (raw ?? {}) as Record<string, unknown>;
  const methods = (Array.isArray(d.methods) ? d.methods : []).filter((m): m is AssistedMethod => m === "PHOTO_MATCH" || m === "MEMBER_OTP");
  return {
    methods,
    exceptionEnabled: d.exceptionEnabled !== false,
    otpTtlSeconds: typeof d.otpTtlSeconds === "number" ? d.otpTtlSeconds : 300,
    otpResendSeconds: typeof d.otpResendSeconds === "number" ? d.otpResendSeconds : 60,
  };
}

export function normalizeMembers(raw: unknown): MemberResult[] {
  const d = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(d.results) ? d.results : [];
  return list.flatMap((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const membershipId = str(x.membershipId);
    if (!membershipId) return [];
    const status = x.status === "ACTIVE" || x.status === "SUSPENDED" ? x.status : "EXPIRED";
    return [{
      membershipId,
      displayName: str(x.displayName) ?? "Hội viên",
      memberCode: str(x.memberCode) ?? "",
      planName: str(x.planName) ?? "",
      planType: x.planType === "VISIT_BASED" ? "VISIT_BASED" : "TIME_BASED",
      status,
      expiresAt: str(x.expiresAt),
      remainingVisits: typeof x.remainingVisits === "number" ? x.remainingVisits : null,
      photoUrl: str(x.photoUrl),
      hasPhoto: x.hasPhoto === true,
      canCheckIn: x.canCheckIn === true,
      blockedReason: str(x.blockedReason),
    } satisfies MemberResult];
  });
}

export function normalizeExceptions(raw: unknown): { canApprove: boolean; exceptions: ExceptionRow[] } {
  const d = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(d.exceptions) ? d.exceptions : [];
  const STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "USED"];
  return {
    canApprove: d.canApprove === true,
    exceptions: list.flatMap((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      const id = str(x.id);
      if (!id) return [];
      return [{
        id,
        membershipId: str(x.membershipId) ?? "",
        status: (STATUSES.includes(String(x.status)) ? x.status : "PENDING") as ExceptionRow["status"],
        displayName: str(x.displayName) ?? "Hội viên",
        memberCode: str(x.memberCode) ?? "",
        planName: str(x.planName) ?? "",
        requestReason: str(x.requestReason) ?? "",
        requestedByName: str(x.requestedByName) ?? "Nhân viên",
        createdAt: str(x.createdAt),
        expiresAt: str(x.expiresAt),
        decisionReason: str(x.decisionReason),
        decidedByName: str(x.decidedByName),
        mine: x.mine === true,
      } satisfies ExceptionRow];
    }),
  };
}

/** Chuẩn hoá mã hội viên người dùng gõ: bỏ ký tự lạ, IN HOA, chèn gạch giữa nếu đủ 8 ký tự. */
export function formatCodeInput(v: string): string {
  const c = v.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export const isFullCode = (v: string) => v.replace(/[^0-9A-Za-z]/g, "").length === 8;

/** Khoá idempotency phía máy khách (server nhận 8-100 ký tự [A-Za-z0-9_.:-]). */
export function newRequestId(): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `web-${rnd}`;
}

export const REASON_PRESETS = [
  "Quên điện thoại",
  "Hết pin điện thoại",
  "Ứng dụng bị lỗi",
] as const;

export const STATUS_LABEL: Record<MemberStatus, { text: string; cls: string }> = {
  ACTIVE: { text: "Còn hạn", cls: "bg-green-500/10 text-green-400" },
  EXPIRED: { text: "Hết hạn", cls: "bg-red-500/10 text-red-400" },
  SUSPENDED: { text: "Tạm khoá", cls: "bg-amber-500/10 text-amber-400" },
};

export const EXCEPTION_STATUS_LABEL: Record<ExceptionRow["status"], { text: string; cls: string }> = {
  PENDING: { text: "Chờ duyệt", cls: "bg-amber-500/10 text-amber-400" },
  APPROVED: { text: "Đã duyệt", cls: "bg-green-500/10 text-green-400" },
  REJECTED: { text: "Bị từ chối", cls: "bg-red-500/10 text-red-400" },
  EXPIRED: { text: "Hết hạn", cls: "bg-zinc-700/40 text-zinc-400" },
  USED: { text: "Đã dùng", cls: "bg-zinc-700/40 text-zinc-400" },
};

/** Mã lỗi server → câu tiếng Việt cho lễ tân (không lộ mã kỹ thuật). */
const ERROR_TEXT: Record<string, string> = {
  SEARCH_QUERY_INVALID: "Nhập mã hội viên đầy đủ (8 ký tự), hoặc tên kèm 4 ký tự cuối của mã. Tên hay số điện thoại một mình là không đủ.",
  SEARCH_RATE_LIMITED: "Bạn tra cứu quá nhanh. Vui lòng đợi một chút rồi thử lại.",
  MEMBER_NOT_FOUND: "Không tìm thấy hội viên này ở thương hiệu của chi nhánh.",
  GYM_HAS_NO_BRAND: "Chi nhánh chưa thuộc thương hiệu nào nên chưa có hội viên.",
  METHOD_DISABLED: "Cách xác minh này đang được tắt.",
  PHOTO_UNAVAILABLE: "Hội viên chưa có ảnh hồ sơ nên không thể đối chiếu ảnh.",
  PHOTO_ATTESTATION_REQUIRED: "Hãy xác nhận người trước mặt trùng với ảnh hồ sơ.",
  MEMBER_CODE_MISMATCH: "Mã hội viên nhập vào không khớp.",
  OTP_REQUIRED: "Nhập mã gồm 6 chữ số mà hội viên nhận được.",
  OTP_INVALID: "Mã không đúng. Hãy hỏi lại hội viên.",
  OTP_EXPIRED: "Mã đã hết hạn. Hãy gửi mã mới.",
  OTP_ATTEMPTS_EXCEEDED: "Nhập sai quá nhiều lần. Hãy gửi mã mới.",
  OTP_ALREADY_USED: "Mã này đã được dùng.",
  OTP_CHALLENGE_INVALID: "Mã không thuộc yêu cầu này. Hãy gửi mã mới.",
  OTP_RESEND_TOO_SOON: "Vừa gửi mã xong. Vui lòng đợi rồi gửi lại.",
  OTP_DAILY_LIMIT: "Đã gửi mã quá số lần cho phép hôm nay. Dùng cách xác minh khác hoặc xin quản lý duyệt.",
  OTP_DELIVERY_FAILED: "Không gửi được e-mail. Vui lòng thử lại hoặc dùng cách xác minh khác.",
  MEMBER_EMAIL_UNAVAILABLE: "Hội viên chưa có e-mail để nhận mã. Dùng cách xác minh khác hoặc xin quản lý duyệt.",
  NOT_ACTIVE: "Gói của hội viên đã hết hạn hoặc đang tạm khoá nên không thể check-in.",
  VISIT_LIMIT_REACHED: "Hội viên đã dùng hết số buổi của gói.",
  TOO_SOON: "Hội viên vừa check-in cách đây chưa đến 1 phút.",
  GYM_NOT_ACTIVE: "Chi nhánh đang tạm đóng cửa hoặc chưa hoạt động.",
  NO_MEMBERSHIP: "Hội viên không có gói dùng được ở chi nhánh này.",
  IDEMPOTENCY_KEY_REUSED: "Yêu cầu này đã được gửi với nội dung khác. Vui lòng tải lại trang và thử lại.",
  IDEMPOTENCY_KEY_REQUIRED: "Thiếu mã yêu cầu. Vui lòng tải lại trang.",
  VALIDATION_ERROR: "Thông tin chưa hợp lệ. Hãy kiểm tra lý do và các ô đã nhập.",
  EXCEPTION_ALREADY_OPEN: "Hội viên này đã có một yêu cầu ngoại lệ đang mở.",
  EXCEPTION_NOT_FOUND: "Không tìm thấy yêu cầu ngoại lệ.",
  EXCEPTION_NOT_APPROVED: "Yêu cầu ngoại lệ chưa được quản lý duyệt.",
  EXCEPTION_EXPIRED: "Yêu cầu ngoại lệ đã hết hạn (chỉ có hiệu lực trong ngày).",
  EXCEPTION_ALREADY_USED: "Yêu cầu ngoại lệ này đã được dùng.",
  EXCEPTION_ALREADY_DECIDED: "Yêu cầu này đã được xử lý.",
  EXCEPTION_SELF_APPROVAL: "Bạn không thể tự duyệt yêu cầu do chính mình tạo.",
  REASON_REQUIRED: "Cần ghi lý do (ít nhất 5 ký tự).",
  EXCEPTION_REQUIRED: "Chưa chọn yêu cầu ngoại lệ đã duyệt.",
  OWNER_ROLE_REQUIRED: "Vai trò của bạn không có quyền thực hiện việc này.",
  PERMISSION_DENIED: "Vai trò của bạn không có quyền thực hiện việc này.",
  GYM_OUT_OF_SCOPE: "Bạn không được phân công chi nhánh này.",
};

export function assistedErrorText(e: unknown): string {
  const r = (e as { response?: { status?: number; data?: { error?: { code?: string } } } })?.response;
  const code = r?.data?.error?.code;
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (r?.status === 429) return "Thao tác quá nhanh. Vui lòng đợi một chút.";
  if (r?.status === 403) return "Bạn không có quyền thực hiện việc này.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

export function assistedErrorCode(e: unknown): string | null {
  return (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code ?? null;
}

export function blockedText(code: string | null): string {
  return code ? ERROR_TEXT[code] ?? "Không thể check-in lúc này." : "";
}

export function planTypeLabel(p: MemberResult): string {
  return p.planType === "VISIT_BASED" ? "Gói theo số buổi" : "Gói theo thời hạn";
}

export function formatExpiry(iso: string | null): string {
  if (!iso) return "Không giới hạn";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "HV";
}

/** Đã đủ điều kiện bấm "Xác nhận" ở phương thức đang chọn chưa (chỉ để bật/tắt nút; server vẫn kiểm lại tất cả). */
export function canConfirm(p: {
  method: AssistedMethod;
  reason: string;
  photoAttested: boolean;
  statedCode: string;
  otp: string;
  challengeId: string | null;
  exceptionId: string | null;
}): boolean {
  if (p.reason.trim().length < 3) return false;
  if (p.method === "PHOTO_MATCH") return p.photoAttested && isFullCode(p.statedCode);
  if (p.method === "MEMBER_OTP") return !!p.challengeId && /^\d{6}$/.test(p.otp);
  return !!p.exceptionId;
}
