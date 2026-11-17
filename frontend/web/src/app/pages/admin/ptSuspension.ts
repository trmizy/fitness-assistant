/**
 * N15B-04: admin web switch to suspend / lift the suspension of an APPROVED PT.
 * Backend (pt-restriction.service.ts): POST /admin/pts/:id/suspend { category, reason(1-1000), publicReason?(<=500) } and
 * POST /admin/pts/:id/lift-suspension { reason(1-1000) }; GET /admin/pts/:id/restrictions answers every episode, newest first.
 * Pure helpers only (run under `npx tsx --test`).
 */
export const SUSPEND_REASON_MAX = 1000;
export const SUSPEND_PUBLIC_REASON_MAX = 500;

/** The categories an admin can pick (UNSPECIFIED is only written by the auth-service lock stream). */
export const SUSPEND_CATEGORY_OPTIONS = [
  { value: "COMPLAINT_REVIEW", label: "Đang xem xét một phản ánh" },
  { value: "CONDUCT_REVIEW", label: "Đang xem xét hoạt động huấn luyện" },
  { value: "PAYMENT_REVIEW", label: "Đang đối soát thanh toán" },
  { value: "DOCUMENT_VERIFICATION", label: "Cần xác minh lại hồ sơ, chứng chỉ" },
  { value: "ACCOUNT_SECURITY", label: "Kiểm tra bảo mật tài khoản" },
  { value: "OTHER", label: "Lý do khác" },
] as const;
export type SuspendCategory = (typeof SUSPEND_CATEGORY_OPTIONS)[number]["value"];

const CATEGORY_LABEL: Record<string, string> = {
  ...Object.fromEntries(SUSPEND_CATEGORY_OPTIONS.map((o) => [o.value, o.label])),
  UNSPECIFIED: "Không nêu nhóm lý do",
};
export const suspendCategoryLabel = (c: string | null | undefined): string => (c && CATEGORY_LABEL[c]) || "Lý do khác";

export const SUSPEND_EFFECT =
  "Huấn luyện viên bị ẩn khỏi tìm kiếm và không nhận hợp đồng mới. Các buổi sắp tới bị huỷ (khách không bị trừ buổi, không bị tính vắng). Hợp đồng đang chạy được giữ nguyên nhưng tạm dừng, thời hạn sẽ được cộng bù khi mở lại. Khách và huấn luyện viên đều được báo.";
export const LIFT_EFFECT =
  "Huấn luyện viên hiện lại trong tìm kiếm và nhận hợp đồng mới. Hợp đồng tạm dừng chạy lại, ngày kết thúc được cộng bù đúng thời gian đã tạm dừng. Khách và huấn luyện viên được báo.";

/** One episode of `GET /admin/pts/:id/restrictions` the card needs. */
export interface PtRestrictionEpisode {
  id: string;
  scope?: string | null;
  type?: string | null;
  endedAt?: string | null;
  startedAt?: string | null;
  reasonCategory?: string | null;
  reasonText?: string | null;
  publicReason?: string | null;
  overdue?: boolean;
  reviewDueAt?: string | null;
}

export type PtAccountState =
  | { kind: "ACTIVE" }
  | { kind: "SUSPENDED"; episode: PtRestrictionEpisode }
  | { kind: "BANNED"; episode: PtRestrictionEpisode };

/** The ACCOUNT-scope episode still open decides the state; a contract-only restriction leaves the PT fully active. */
export function ptAccountState(rows: PtRestrictionEpisode[] | null | undefined): PtAccountState {
  const open = (rows ?? []).find((r) => !r.endedAt && (r.scope == null || r.scope === "ACCOUNT"));
  if (!open) return { kind: "ACTIVE" };
  return open.type === "PERMANENT_BAN" ? { kind: "BANNED", episode: open } : { kind: "SUSPENDED", episode: open };
}

export const PT_STATE_LABEL: Record<PtAccountState["kind"], string> = {
  ACTIVE: "Đang hoạt động",
  SUSPENDED: "Đang tạm khoá",
  BANNED: "Đã khoá vĩnh viễn",
};

/** Client-side check mirroring the server (`REASON_REQUIRED` / `REASON_TOO_LONG`). null = fine. */
export function suspensionReasonError(reason: string, max = SUSPEND_REASON_MAX): string | null {
  const t = reason.trim();
  if (!t) return "Hãy nhập lý do.";
  if (t.length > max) return `Lý do tối đa ${max} ký tự.`;
  return null;
}

export function publicReasonError(text: string): string | null {
  return text.trim().length > SUSPEND_PUBLIC_REASON_MAX ? `Lời nhắn tối đa ${SUSPEND_PUBLIC_REASON_MAX} ký tự.` : null;
}

export function buildSuspendBody(category: SuspendCategory, reason: string, publicReason: string) {
  const pub = publicReason.trim();
  return { category, reason: reason.trim(), ...(pub ? { publicReason: pub } : {}) };
}

const ERROR_VI: Record<string, string> = {
  PT_NOT_FOUND: "Không tìm thấy huấn luyện viên này.",
  PT_ALREADY_BANNED: "Huấn luyện viên này đang bị khoá vĩnh viễn nên không tạm khoá được.",
  PT_BAN_LIFTS_VIA_ACCOUNT_UNLOCK: "Huấn luyện viên này đang bị khoá vĩnh viễn; hãy mở khoá tài khoản để gỡ.",
  REASON_REQUIRED: "Hãy nhập lý do.",
  REASON_TOO_LONG: "Lý do quá dài.",
  REASON_CATEGORY_INVALID: "Nhóm lý do không hợp lệ.",
  PT_LOCK_BUSY: "Hệ thống đang xử lý huấn luyện viên này. Vui lòng thử lại sau vài giây.",
};

/** Server refusals are `{ error: "<sentence>", code }`; a known code wins, the server's Vietnamese sentence is next. */
export function ptSuspensionError(e: unknown): string {
  const data = (e as { response?: { data?: { code?: string; error?: unknown } } } | null)?.response?.data;
  if (data?.code && ERROR_VI[data.code]) return ERROR_VI[data.code];
  if (typeof data?.error === "string" && /[àáâãăạảấầẩẫậắằẳẵặèéêẹẻẽếềểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳỵỷỹđ]/i.test(data.error)) return data.error;
  return "Không thực hiện được. Vui lòng thử lại.";
}

export const SUSPEND_SUCCESS = "Đã tạm khoá huấn luyện viên";
export const LIFT_SUCCESS = "Đã mở lại huấn luyện viên";
