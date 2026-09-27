/**
 * WB-15/16 + GY-09 — hồ sơ đối tác tự đăng ký, phần thuần.
 *
 * NGUỒN SỰ THẬT LÀ MÁY CHỦ. `GET /owner/application` trả về `missing[]` — danh sách những mục còn
 * thiếu, theo từng `section`. Bước nào "xong", tiến độ bao nhiêu phần trăm, còn gì chặn việc gửi
 * hồ sơ: tất cả suy từ danh sách đó, **không** từ một bộ kiểm hợp lệ thứ hai ở máy. Hai bộ luật song
 * song là hai bộ luật sẽ lệch nhau.
 */
import type { PartnerAccessState, PartnerDocType, PartnerPhotoCategory, PartnerRepresentativeRole } from "../../services/api";

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

export type MissingSection =
  | "REPRESENTATIVE"
  | "BRAND"
  | "SCALE"
  | "BRANCH"
  | "LOCATION"
  | "PHOTOS"
  | "LEGAL"
  | "TERMS";

export type MissingItem = { section: MissingSection; message: string };

export type StepId =
  | "representative"
  | "brand"
  | "social"
  | "scale"
  | "branch"
  | "location"
  | "photos"
  | "legal"
  | "review";

export const STEPS: { id: StepId; title: string; sections: MissingSection[] }[] = [
  { id: "representative", title: "Người đại diện", sections: ["REPRESENTATIVE"] },
  { id: "brand", title: "Thương hiệu", sections: ["BRAND"] },
  // Không bắt buộc — không có mục "còn thiếu" nào, bỏ trống vẫn nộp được.
  { id: "social", title: "Mạng xã hội", sections: [] },
  { id: "scale", title: "Quy mô", sections: ["SCALE"] },
  { id: "branch", title: "Chi nhánh đầu tiên", sections: ["BRANCH"] },
  { id: "location", title: "Vị trí", sections: ["LOCATION"] },
  { id: "photos", title: "Ảnh cơ sở", sections: ["PHOTOS"] },
  { id: "legal", title: "Xác minh doanh nghiệp", sections: ["LEGAL"] },
  { id: "review", title: "Xem lại & gửi", sections: ["TERMS"] },
];

export type ApplicationView = {
  accessState?: PartnerAccessState | null;
  editable?: boolean | null;
  minPhotos?: number | null;
  partner?: Record<string, any> | null;
  representativePhone?: string | null;
  brand?: Record<string, any> | null;
  branch?: Record<string, any> | null;
  photos?: any[] | null;
  documents?: any[] | null;
  issues?: any[] | null;
  missing?: MissingItem[] | null;
};

export function missingItems(view: ApplicationView | null | undefined): MissingItem[] {
  const list = view?.missing;
  return Array.isArray(list) ? list.filter((m) => m?.section) : [];
}

/** Một bước xong khi máy chủ không còn kể mục nào thuộc phần của nó. */
export function stepDone(view: ApplicationView | null | undefined, step: (typeof STEPS)[number]): boolean {
  if (step.sections.length === 0) return true;
  const missing = missingItems(view);
  return !missing.some((m) => step.sections.includes(m.section));
}

/** Bước đầu tiên còn thiếu — chỗ mở hồ sơ ra sẽ đứng. Không còn thiếu gì thì về bước xem lại. */
export function firstIncompleteStep(view: ApplicationView | null | undefined): number {
  const idx = STEPS.findIndex((s) => s.id !== "review" && !stepDone(view, s));
  return idx === -1 ? STEPS.length - 1 : idx;
}

/** Tiến độ tính trên tám bước nhập liệu; bước "xem lại" không phải là một phần việc. */
export function progressPercent(view: ApplicationView | null | undefined): number {
  const filling = STEPS.filter((s) => s.id !== "review");
  const done = filling.filter((s) => stepDone(view, s)).length;
  return Math.round((done / filling.length) * 100);
}

/** Những mục còn thiếu thuộc đúng một bước — để hiện ngay tại chỗ người dùng sửa được. */
export function missingForStep(view: ApplicationView | null | undefined, step: (typeof STEPS)[number]): MissingItem[] {
  if (step.sections.length === 0) return [];
  return missingItems(view).filter((m) => step.sections.includes(m.section));
}

// ── Lựa chọn cố định ───────────────────────────────────────────────────────────────────────

export const REPRESENTATIVE_ROLES: { value: PartnerRepresentativeRole; label: string }[] = [
  { value: "GYM_OWNER", label: "Chủ phòng gym" },
  { value: "CO_FOUNDER", label: "Đồng sáng lập" },
  { value: "LEGAL_REPRESENTATIVE", label: "Người đại diện pháp luật" },
  { value: "AUTHORIZED_MANAGER", label: "Quản lý được uỷ quyền" },
];

export const BUSINESS_SCALES: { value: "ONE_BRANCH" | "MULTIPLE_BRANCHES"; label: string; hint: string }[] = [
  { value: "ONE_BRANCH", label: "Một chi nhánh", hint: "Bạn đang vận hành đúng một cơ sở." },
  {
    value: "MULTIPLE_BRANCHES",
    label: "Nhiều chi nhánh",
    hint: "Hồ sơ này vẫn chỉ khai một chi nhánh — thêm các chi nhánh khác sau khi được duyệt.",
  },
];

/**
 * `REQUIRED_DOC_TYPES` của gym-service là ba loại đầu; ba loại sau là tuỳ chọn. Cờ `required` thật
 * vẫn do máy chủ trả trong từng `document`, đây chỉ là nhãn và thứ tự hiển thị.
 */
export const DOC_TYPES: { value: PartnerDocType; label: string; hint: string }[] = [
  { value: "BUSINESS_LICENSE", label: "Giấy phép kinh doanh", hint: "Bản chụp rõ nét, đủ trang." },
  { value: "REPRESENTATIVE_ID", label: "Giấy tờ tuỳ thân người đại diện", hint: "Mặt trước và mặt sau." },
  { value: "PREMISES_PROOF", label: "Chứng minh mặt bằng", hint: "Hợp đồng thuê hoặc giấy tờ sở hữu." },
  { value: "TAX_CODE_CERTIFICATE", label: "Giấy chứng nhận mã số thuế", hint: "Tuỳ chọn." },
  { value: "FIRE_SAFETY_CERTIFICATE", label: "Giấy chứng nhận phòng cháy chữa cháy", hint: "Tuỳ chọn." },
  { value: "SITE_PHOTOS", label: "Ảnh hiện trạng bổ sung", hint: "Tuỳ chọn." },
];

export const PHOTO_CATEGORIES: { value: PartnerPhotoCategory; label: string }[] = [
  { value: "EXTERIOR", label: "Mặt tiền" },
  { value: "MAIN_TRAINING_AREA", label: "Khu tập chính" },
  { value: "EQUIPMENT", label: "Trang thiết bị" },
  { value: "CARDIO", label: "Khu cardio" },
  { value: "CHANGING_ROOM", label: "Phòng thay đồ" },
  { value: "AMENITIES", label: "Tiện ích" },
  { value: "OTHER", label: "Khác" },
];

/** Trùng `MAX_FILES_PER_DOCUMENT` của gym-service — máy chủ vẫn là nơi chặn thật. */
export const MAX_FILES_PER_DOCUMENT = 4;

// ── Giấy tờ (GY-09) ────────────────────────────────────────────────────────────────────────

export type ApplicationDocument = {
  docType: PartnerDocType;
  required?: boolean | null;
  status?: string | null;
  reviewNote?: string | null;
  hasFile?: boolean | null;
  files?: { id: string; mimeType?: string | null; sizeBytes?: number | null; previewUrl?: string | null }[] | null;
  version?: number | null;
};

/**
 * `PartnerDocumentStatus` dùng lại enum sẵn có, nên nhãn phải nói đúng nghĩa nghiệp vụ chứ không
 * dịch thẳng tên enum: `RECEIVED` là "đã nộp, chờ duyệt", và `REJECTED` là "cần cập nhật" chứ không
 * phải "bị loại" — ứng viên thay tệp là nó quay lại hàng chờ.
 */
export const DOC_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  PENDING: { label: "Chưa nộp", tone: "neutral" },
  RECEIVED: { label: "Chờ duyệt", tone: "warning" },
  VERIFIED: { label: "Đã xác minh", tone: "success" },
  REJECTED: { label: "Cần cập nhật", tone: "danger" },
};

export function docStatus(status: string | null | undefined) {
  return DOC_STATUS[status ?? ""] ?? { label: status || "Chưa nộp", tone: "neutral" as StatusTone };
}

export function documentsOf(view: ApplicationView | null | undefined): ApplicationDocument[] {
  const list = view?.documents;
  return Array.isArray(list) ? list.filter((d) => d?.docType) : [];
}

export function findDocument(view: ApplicationView | null | undefined, docType: PartnerDocType) {
  return documentsOf(view).find((d) => d.docType === docType) ?? null;
}

export function documentFiles(doc: ApplicationDocument | null | undefined) {
  return Array.isArray(doc?.files) ? doc!.files! : [];
}

export function canAddDocumentFile(doc: ApplicationDocument | null | undefined): boolean {
  return documentFiles(doc).length < MAX_FILES_PER_DOCUMENT;
}

// ── Góp ý của Gymini ───────────────────────────────────────────────────────────────────────

export type ApplicationIssue = {
  id: string;
  category?: string | null;
  message?: string | null;
  status?: string | null;
  resubmitNote?: string | null;
  adminFollowUp?: string | null;
  createdAt?: string | null;
};

export const ISSUE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  OPEN: { label: "Đang mở", tone: "warning" },
  RESUBMITTED: { label: "Đã gửi lại", tone: "info" },
  RESOLVED: { label: "Đã đóng", tone: "success" },
};

export function issueStatus(status: string | null | undefined) {
  return ISSUE_STATUS[status ?? ""] ?? { label: status || "Không rõ", tone: "neutral" as StatusTone };
}

export const ISSUE_CATEGORY: Record<string, string> = {
  REPRESENTATIVE: "Người đại diện",
  BRAND: "Thương hiệu",
  BRANCH: "Chi nhánh",
  LOCATION: "Vị trí",
  PHOTOS: "Ảnh cơ sở",
  LEGAL: "Xác minh doanh nghiệp",
  OTHER: "Khác",
};

export function issuesOf(view: ApplicationView | null | undefined): ApplicationIssue[] {
  const list = view?.issues;
  return Array.isArray(list) ? list.filter((i) => i?.id) : [];
}

export function openIssues(view: ApplicationView | null | undefined): ApplicationIssue[] {
  return issuesOf(view).filter((i) => i.status === "OPEN");
}

/**
 * Nộp lại chỉ mở khi ứng viên đã đánh dấu "đã cập nhật" cho MỌI góp ý đang mở. Nộp lại **không**
 * đóng góp ý nào — chỉ quản trị viên đóng được; máy chủ cũng từ chối nếu còn `OPEN`.
 */
export function canResubmit(view: ApplicationView | null | undefined): boolean {
  const issues = issuesOf(view);
  return issues.length > 0 && openIssues(view).length === 0;
}

// ── Đăng ký công khai (WB-15) ──────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function applyEmailError(email: string): string | null {
  const v = email.trim();
  if (!v) return "Nhập email của bạn.";
  if (!EMAIL_RE.test(v)) return "Email không hợp lệ.";
  return null;
}

/** Máy chủ đòi tối thiểu 8 ký tự (`changePasswordSchema`, `set-password`). */
export const PASSWORD_MIN = 8;

export function newPasswordError(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `Mật khẩu tối thiểu ${PASSWORD_MIN} ký tự.`;
  if (password !== confirm) return "Hai ô mật khẩu chưa khớp.";
  return null;
}

/**
 * Rút mã xác minh ra khỏi một liên kết.
 *
 * Mã nằm ở **fragment** (`#token=…`) chứ không phải query, và đó là cố ý: fragment không đi lên máy
 * chủ, không vào log, không vào Referer. Vẫn chấp nhận `?token=` vì một số trình duyệt/ứng dụng thư
 * viết lại liên kết, và chấp nhận cả khi người dùng chỉ dán mỗi mã.
 */
export function extractApplyToken(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const fromPart = (part: string): string | null => {
    const m = /(?:^|[#&?])token=([^&#\s]+)/.exec(part);
    return m ? decodeURIComponent(m[1]) : null;
  };

  const found = fromPart(raw);
  if (found) return found;

  // Không phải liên kết: coi như chính là mã, miễn là trông như một mã chứ không phải một câu.
  if (!/[\s/]/.test(raw) && raw.length >= 16) return raw;
  return null;
}

export const VERIFY_RESULT_TEXT: Record<string, { title: string; body: string }> = {
  EXPIRED: {
    title: "Liên kết đã hết hạn",
    body: "Liên kết xác minh chỉ dùng được trong thời gian ngắn. Hãy yêu cầu gửi lại từ đầu.",
  },
  USED: {
    title: "Liên kết đã được dùng",
    body: "Liên kết này đã dùng để tạo tài khoản. Hãy đăng nhập, hoặc yêu cầu gửi lại nếu bạn chưa đặt được mật khẩu.",
  },
  INVALID: {
    title: "Liên kết không hợp lệ",
    body: "Không đọc được mã trong liên kết. Hãy mở lại liên kết trong thư, hoặc yêu cầu gửi lại.",
  },
};

export function verifyResultText(status: string | null | undefined) {
  return (
    VERIFY_RESULT_TEXT[status ?? ""] ?? {
      title: "Không xác minh được",
      body: "Hãy thử lại, hoặc yêu cầu gửi liên kết mới.",
    }
  );
}

// ── Thông báo lỗi ──────────────────────────────────────────────────────────────────────────

/**
 * Chuẩn hoá mọi dạng lỗi backend thành một câu tiếng Việt: auth-service trả `{error}` là chuỗi,
 * gym-service trả `{error:{code,message}}`, còn mất mạng thì không có `response` nào cả.
 */
export function friendlyError(e: unknown, fallback = "Đã có lỗi xảy ra. Vui lòng thử lại."): string {
  const res = (e as any)?.response;
  if (!res) {
    const msg = (e as any)?.message;
    if (typeof msg === "string" && msg && !/network/i.test(msg)) return msg;
    return "Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.";
  }
  const d = res.data;
  const nested = d?.error && typeof d.error === "object" ? d.error : null;
  const message: string | undefined =
    nested?.message ?? (typeof d?.error === "string" ? d.error : undefined) ?? d?.message;
  if (res.status === 429 && !message) return "Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.";
  if (res.status >= 500) return fallback;
  return message || fallback;
}
