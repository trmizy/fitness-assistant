/**
 * N15M-08 — pure part of the receptionist's front desk on the phone: today's guests, today's trainers and the
 * assisted ("check-in hộ") flow. Ported from web `utils/assistedCheckin.ts` + `utils/frontDeskToday.ts`.
 *
 * gym-service (staff-views.ts / assisted-checkin.views.ts) already returns the minimum field set. The `normalize*`
 * functions keep ONLY those fields, so even if the server ever sent more (phone, e-mail, price…) there is no place on
 * screen for it. The server re-checks everything (plan active, brand, visits, OTP, photo, exception); this only guides.
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

export type ExceptionStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "USED";

export interface ExceptionRow {
  id: string;
  membershipId: string;
  status: ExceptionStatus;
  displayName: string;
  memberCode: string;
  planName: string;
  requestReason: string;
  requestedByName: string;
  createdAt: string | null;
  decisionReason: string | null;
  decidedByName: string | null;
  mine: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function normalizeConfig(raw: unknown): AssistedConfig {
  const d = (raw ?? {}) as Record<string, unknown>;
  const methods = (Array.isArray(d.methods) ? d.methods : []).filter(
    (m): m is AssistedMethod => m === "PHOTO_MATCH" || m === "MEMBER_OTP",
  );
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
    const status: MemberStatus = x.status === "ACTIVE" || x.status === "SUSPENDED" ? x.status : "EXPIRED";
    return [
      {
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
      } satisfies MemberResult,
    ];
  });
}

const EXCEPTION_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "USED"];

export function normalizeExceptions(raw: unknown): { canApprove: boolean; exceptions: ExceptionRow[] } {
  const d = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(d.exceptions) ? d.exceptions : [];
  return {
    canApprove: d.canApprove === true,
    exceptions: list.flatMap((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      const id = str(x.id);
      if (!id) return [];
      return [
        {
          id,
          membershipId: str(x.membershipId) ?? "",
          status: (EXCEPTION_STATUSES.includes(String(x.status)) ? x.status : "PENDING") as ExceptionStatus,
          displayName: str(x.displayName) ?? "Hội viên",
          memberCode: str(x.memberCode) ?? "",
          planName: str(x.planName) ?? "",
          requestReason: str(x.requestReason) ?? "",
          requestedByName: str(x.requestedByName) ?? "Nhân viên",
          createdAt: str(x.createdAt),
          decisionReason: str(x.decisionReason),
          decidedByName: str(x.decidedByName),
          mine: x.mine === true,
        } satisfies ExceptionRow,
      ];
    }),
  };
}

/** Member code as typed: strip stray characters, UPPERCASE, dash after 4 when 8 are present. */
export function formatCodeInput(v: string): string {
  const c = v.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export const isFullCode = (v: string) => v.replace(/[^0-9A-Za-z]/g, "").length === 8;

/** Last 4 characters of the member code, as typed. */
export function formatLast4(v: string): string {
  return v.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 4);
}

/** Client-side idempotency key (server accepts 8-100 chars of [A-Za-z0-9_.:-]). */
export function newRequestId(): string {
  const rnd = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
  return `app-${rnd}`;
}

export const REASON_PRESETS = ["Quên điện thoại", "Hết pin điện thoại", "Ứng dụng bị lỗi"] as const;

export const MEMBER_STATUS_LABEL: Record<MemberStatus, { text: string; tone: "success" | "danger" | "warning" }> = {
  ACTIVE: { text: "Còn hạn", tone: "success" },
  EXPIRED: { text: "Hết hạn", tone: "danger" },
  SUSPENDED: { text: "Tạm khoá", tone: "warning" },
};

export const EXCEPTION_STATUS_LABEL: Record<ExceptionStatus, { text: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  PENDING: { text: "Chờ duyệt", tone: "warning" },
  APPROVED: { text: "Đã duyệt", tone: "success" },
  REJECTED: { text: "Bị từ chối", tone: "danger" },
  EXPIRED: { text: "Hết hạn", tone: "neutral" },
  USED: { text: "Đã dùng", tone: "neutral" },
};

/** Server code → plain Vietnamese for the desk (no technical codes). */
const ERROR_TEXT: Record<string, string> = {
  SEARCH_QUERY_INVALID:
    "Nhập mã hội viên đầy đủ (8 ký tự), hoặc tên kèm 4 ký tự cuối của mã. Tên hay số điện thoại một mình là không đủ.",
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
  IDEMPOTENCY_KEY_REUSED: "Yêu cầu này đã được gửi với nội dung khác. Vui lòng thử lại.",
  IDEMPOTENCY_KEY_REQUIRED: "Thiếu mã yêu cầu. Vui lòng thử lại.",
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

export function assistedErrorCode(e: unknown): string | null {
  return (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code ?? null;
}

export function assistedErrorText(e: unknown): string {
  const r = (e as { response?: { status?: number } })?.response;
  const code = assistedErrorCode(e);
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (r?.status === 429) return "Thao tác quá nhanh. Vui lòng đợi một chút.";
  if (r?.status === 403) return "Bạn không có quyền thực hiện việc này.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

export function blockedText(code: string | null): string {
  return code ? (ERROR_TEXT[code] ?? "Không thể check-in lúc này.") : "";
}

export function planTypeLabel(p: Pick<MemberResult, "planType">): string {
  return p.planType === "VISIT_BASED" ? "Gói theo số buổi" : "Gói theo thời hạn";
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Vietnam is UTC+7 all year — shifted by hand so the label never depends on the phone's time zone or Intl support. */
function vnParts(iso: string | null | undefined): { d: Date } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return { d: new Date(t + 7 * 3600 * 1000) };
}

/** "dd/mm/yyyy" (Vietnam date) or "Không giới hạn". */
export function formatExpiry(iso: string | null): string {
  if (!iso) return "Không giới hạn";
  const p = vnParts(iso);
  return p ? `${pad(p.d.getUTCDate())}/${pad(p.d.getUTCMonth() + 1)}/${p.d.getUTCFullYear()}` : "";
}

/** "09:15" in Vietnam time. */
export function clockLabel(iso: string | null | undefined): string {
  const p = vnParts(iso);
  return p ? `${pad(p.d.getUTCHours())}:${pad(p.d.getUTCMinutes())}` : "";
}

/** Ready to press "Xác nhận" for the chosen method (the server still re-checks all of it). */
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

// ── Today at the desk ──────────────────────────────────────────────────────────────────────

export interface FrontDeskClient {
  displayName: string;
  checkedInAt: string | null;
  bookedAt: string | null;
}
export interface TodayPt {
  id: string;
  ptName: string;
  firstScanAt: string | null;
}
export interface FrontDeskToday {
  localDate: string | null;
  bookingsAvailable: boolean;
  clients: FrontDeskClient[];
}

export function normalizeFrontDeskToday(raw: unknown): FrontDeskToday {
  const d = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(d.clients) ? d.clients : [];
  return {
    localDate: str(d.localDate),
    bookingsAvailable: d.bookingsAvailable !== false,
    clients: list.map((c) => {
      const r = (c ?? {}) as Record<string, unknown>;
      return { displayName: str(r.displayName) ?? "Hội viên", checkedInAt: str(r.checkedInAt), bookedAt: str(r.bookedAt) };
    }),
  };
}

export function normalizeTodayPts(raw: unknown): TodayPt[] {
  const d = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(d.pts) ? d.pts : Array.isArray(raw) ? (raw as unknown[]) : [];
  return list.map((p, i) => {
    const r = (p ?? {}) as Record<string, unknown>;
    return { id: str(r.id) ?? `pt-${i}`, ptName: str(r.ptName) ?? "Huấn luyện viên", firstScanAt: str(r.firstScanAt) };
  });
}

/** A guest can be both booked and checked in: checked in wins (already here). */
export function presenceOf(c: FrontDeskClient): { kind: "CHECKED_IN" | "BOOKED"; label: string } {
  if (c.checkedInAt) return { kind: "CHECKED_IN", label: `Đã vào ${clockLabel(c.checkedInAt)}`.trim() };
  return { kind: "BOOKED", label: `Có lịch ${clockLabel(c.bookedAt)}`.trim() };
}

export function filterByName<T extends { displayName: string }>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.displayName.toLowerCase().includes(q)) : [...rows];
}
