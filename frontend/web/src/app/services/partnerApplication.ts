import axios from "axios";
import { api } from "./api";

/**
 * Hồ sơ đối tác tự đăng ký (Gym Owner onboarding). Ba nhóm: công khai (auth-service), ứng viên
 * (`/owner/application`), admin (`/admin/partners/...`).
 *
 * Tải lên độc lập nhà cung cấp lưu trữ: presign → POST tới đích backend trả về → confirm.
 * Frontend không biết (và không được biết) đích là S3 hay kho tương thích nào.
 */

// ── Kiểu dữ liệu ────────────────────────────────────────────────────────────────────────────

export type AccessState =
  | "SETUP_INCOMPLETE"
  | "ONBOARDING"
  | "UNDER_REVIEW"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "APPROVED_PAYOUT_PENDING"
  | "ACTIVE"
  | "LEGACY"
  | "SUSPENDED"
  | "TERMINATED"
  | "RESTRICTED";

export const APPLICANT_STATES: AccessState[] = ["SETUP_INCOMPLETE", "ONBOARDING", "UNDER_REVIEW", "CHANGES_REQUESTED", "REJECTED"];

export interface AccessStatus {
  accessState: AccessState;
  editable: boolean;
  partnerId: string | null;
  role: string | null;
}

export type RepresentativeRole = "GYM_OWNER" | "CO_FOUNDER" | "LEGAL_REPRESENTATIVE" | "AUTHORIZED_MANAGER";
export type BusinessScale = "ONE_BRANCH" | "MULTIPLE_BRANCHES";
export type UploadKind = "PHOTO" | "DOCUMENT" | "LOGO";
export type DocType = "BUSINESS_LICENSE" | "REPRESENTATIVE_ID" | "PREMISES_PROOF" | "TAX_CODE_CERTIFICATE" | "SITE_PHOTOS" | "FIRE_SAFETY_CERTIFICATE";
export type PhotoCategory = "EXTERIOR" | "MAIN_TRAINING_AREA" | "EQUIPMENT" | "CARDIO" | "CHANGING_ROOM" | "AMENITIES" | "OTHER";
export type ReviewCategory = "REPRESENTATIVE" | "BRAND" | "BRANCH" | "LOCATION" | "PHOTOS" | "LEGAL" | "OTHER";
export type IssueStatus = "OPEN" | "RESUBMITTED" | "RESOLVED";
export type DocStatus = "PENDING" | "RECEIVED" | "VERIFIED" | "REJECTED";

export interface MissingItem {
  section: "REPRESENTATIVE" | "BRAND" | "SCALE" | "BRANCH" | "LOCATION" | "PHOTOS" | "LEGAL" | "TERMS";
  message: string;
}

export interface ApplicationIssue {
  id: string;
  category: ReviewCategory;
  message: string;
  status: IssueStatus;
  resubmitNote?: string | null;
  adminFollowUp?: string | null;
  createdAt: string;
}

export interface ApplicationDocument {
  docType: DocType;
  required: boolean;
  status: DocStatus;
  reviewNote: string | null;
  hasFile: boolean;
  mimeType: string | null;
  sizeBytes: number | null;
  version: number;
}

export interface ApplicationPhoto {
  id: string;
  category: PhotoCategory | null;
  sortOrder: number;
  isCover: boolean;
  url: string | null;
}

export interface ApplicationBranch {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  provinceCode: number | null;
  wardCode: number | null;
  latitude: number | null;
  longitude: number | null;
  locationNote: string | null;
}

export interface ApplicationView {
  accessState: AccessState;
  editable: boolean;
  minPhotos: number;
  partner: {
    id: string;
    legalName: string | null;
    contactEmail: string | null;
    taxCode: string | null;
    businessLicenseNo: string | null;
    representativeName: string | null;
    representativeRole: RepresentativeRole | null;
    businessScale: BusinessScale | null;
    submittedAt: string | null;
    termsAcceptedAt: string | null;
    createdAt: string;
    rejectedAt: string | null;
    rejectionReason: string | null;
    adminNote: string | null;
  };
  representativePhone: string | null;
  brand: { id: string; name: string; description: string | null; logoUrl: string | null } | null;
  branch: ApplicationBranch | null;
  photos: ApplicationPhoto[];
  documents: ApplicationDocument[];
  issues: ApplicationIssue[];
  missing: MissingItem[];
}

export interface TimelineEvent {
  id: string;
  action: string;
  at: string;
  byYou: boolean;
  category?: string;
  docType?: string;
  count?: number;
}

export interface Timeline {
  accountCreatedAt: string | null;
  events: TimelineEvent[];
}

export interface PresignResult {
  uploadId: string;
  url: string;
  fields: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
}

// ── Lỗi ─────────────────────────────────────────────────────────────────────────────────────

export interface FriendlyError {
  message: string;
  code?: string;
  status?: number;
  retryAfterSeconds?: number;
}

/** Chuẩn hoá mọi dạng lỗi backend (auth `{error,code}`, gym `{error:{code,message}}`, mạng) thành câu tiếng Việt. */
export function friendlyError(e: unknown, fallback = "Đã có lỗi xảy ra. Vui lòng thử lại."): FriendlyError {
  if (!axios.isAxiosError(e)) return { message: (e as Error)?.message || fallback };
  const status = e.response?.status;
  if (!e.response) return { message: "Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.", status };
  const d: any = e.response.data;
  const nested = d?.error && typeof d.error === "object" ? d.error : null;
  const message: string | undefined = nested?.message ?? (typeof d?.error === "string" ? d.error : undefined) ?? d?.message;
  const code: string | undefined = nested?.code ?? d?.code;
  const retryAfterSeconds: number | undefined = d?.retryAfterSeconds ?? nested?.retryAfterSeconds;
  if (status === 429 && !message) return { message: "Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.", code, status, retryAfterSeconds };
  if (status && status >= 500) return { message: fallback, code, status };
  return { message: message || fallback, code, status, retryAfterSeconds };
}

const unwrap = <T>(res: { data: any }): T => (res.data?.data ?? res.data) as T;

// ── Công khai (auth-service) ────────────────────────────────────────────────────────────────

export type VerifyResult =
  | { status: "VALID"; email: string; setupToken: string; setupExpiresAt: string }
  | { status: "INVALID" | "EXPIRED" | "USED" };

export const partnerApplyPublic = {
  start: async (email: string) => {
    const { data } = await api.post("/auth/partner-applications/start", { email });
    return data as { status: "SENT" | "DELIVERY_FAILED"; email: string; expiresInHours: number; devVerifyLink?: string };
  },
  verify: async (token: string) => {
    const { data } = await api.post("/auth/partner-applications/verify", { token });
    return data as VerifyResult;
  },
  setPassword: async (setupToken: string, password: string) => {
    const { data } = await api.post("/auth/partner-applications/set-password", { setupToken, password });
    return data;
  },
};

// ── Ứng viên ────────────────────────────────────────────────────────────────────────────────

export const partnerApplication = {
  status: async () => unwrap<AccessStatus>(await api.get("/owner/application/status")),
  bootstrap: async () => unwrap<{ created: boolean; partnerId: string }>(await api.post("/owner/application/bootstrap")),
  get: async () => unwrap<ApplicationView>(await api.get("/owner/application")),
  timeline: async () => unwrap<Timeline>(await api.get("/owner/application/timeline")),

  saveRepresentative: async (v: { name: string; phone: string; role: RepresentativeRole }) =>
    unwrap(await api.put("/owner/application/representative", v)),
  saveBusinessScale: async (scale: BusinessScale) => unwrap(await api.put("/owner/application/business-scale", { scale })),
  saveBrand: async (v: { name: string; description?: string }) => unwrap(await api.put("/owner/application/brand", v)),
  saveBranch: async (v: Record<string, unknown>) => unwrap(await api.put("/owner/application/branch", v)),
  saveLegal: async (v: { legalName: string; taxCode?: string | null; businessLicenseNo?: string | null }) =>
    unwrap(await api.put("/owner/application/legal", v)),

  presign: async (v: { kind: UploadKind; contentType: string; sizeBytes: number; docType?: DocType; photoCategory?: PhotoCategory }) =>
    unwrap<PresignResult>(await api.post("/owner/application/uploads/presign", v)),
  confirm: async (uploadId: string) => unwrap<{ kind: UploadKind }>(await api.post("/owner/application/uploads/confirm", { uploadId })),
  reorderPhotos: async (ids: string[]) => unwrap(await api.put("/owner/application/photos/reorder", { ids })),
  setCover: async (photoId: string) => unwrap(await api.patch(`/owner/application/photos/${photoId}/cover`)),
  deletePhoto: async (photoId: string) => unwrap(await api.delete(`/owner/application/photos/${photoId}`)),

  submit: async (acceptTerms: boolean) => unwrap(await api.post("/owner/application/submit", { acceptTerms })),
  resubmit: async () => unwrap(await api.post("/owner/application/resubmit")),
  markIssueUpdated: async (issueId: string, note?: string) =>
    unwrap(await api.post(`/owner/application/issues/${issueId}/mark-updated`, note ? { note } : {})),
};

/**
 * Tải một tệp lên qua đúng đích backend cho phép: xin uỷ quyền → POST multipart tới `url` với các
 * `fields` trả về (tệp phải là phần tử CUỐI của form) → xác nhận. Không có logic riêng cho bất kỳ
 * nhà cung cấp lưu trữ nào.
 */
export async function uploadApplicationFile(
  file: File,
  target: { kind: "PHOTO"; photoCategory?: PhotoCategory } | { kind: "DOCUMENT"; docType: DocType } | { kind: "LOGO" },
  onProgress?: (percent: number) => void,
): Promise<void> {
  const auth = await partnerApplication.presign({
    kind: target.kind,
    contentType: file.type,
    sizeBytes: file.size,
    ...(target.kind === "PHOTO" ? { photoCategory: target.photoCategory } : target.kind === "DOCUMENT" ? { docType: target.docType } : {}),
  });

  const form = new FormData();
  Object.entries(auth.fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);

  // axios thuần (không interceptor, không JWT của Gymini): đích tải lên là bên thứ ba.
  await axios.post(auth.url, form, {
    onUploadProgress: (e) => {
      if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });

  await partnerApplication.confirm(auth.uploadId);
}

// ── Admin ───────────────────────────────────────────────────────────────────────────────────

export interface AdminApplicationRow {
  id: string;
  contactEmail: string | null;
  applicantName: string | null;
  legalName: string | null;
  brandName: string | null;
  firstBranchName: string | null;
  businessScale: BusinessScale | null;
  submittedAt: string | null;
  createdAt: string;
  status: string;
  verificationStatus: "NOT_VERIFIED" | "IN_REVIEW" | "NEEDS_INFO" | "REJECTED" | "VERIFIED";
}

export interface AdminApplicationDetail {
  accessState: AccessState;
  partner: ApplicationView["partner"] & { status: string; verificationStatus: string; verificationNotes: string | null };
  representativePhone: string | null;
  brand: ApplicationView["brand"];
  branch: (ApplicationBranch & { status: string }) | null;
  photos: (ApplicationPhoto & { visibility: "PRIVATE" | "PUBLIC" })[];
  documents: (ApplicationDocument & { verifiedBy: string | null; verifiedAt: string | null; updatedAt: string | null })[];
  issues: ApplicationIssue[];
  missing: MissingItem[];
  approve: { canApprove: boolean; blockers: any[] };
  history: { id: string; action: string; at: string; actorUserId: string | null; reason: string | null; metadata: Record<string, unknown> | null }[];
}

export const adminPartnerApplications = {
  list: async (verificationStatus?: AdminApplicationRow["verificationStatus"]) =>
    unwrap<{ items: AdminApplicationRow[]; counts: Record<string, number> }>(
      await api.get("/admin/partners/applications", { params: verificationStatus ? { verificationStatus } : undefined }),
    ),
  get: async (id: string) => unwrap<AdminApplicationDetail>(await api.get(`/admin/partners/${id}/application`)),
  documentFile: async (id: string, docType: DocType) =>
    unwrap<{ url: string; expiresInSec: number | null; mimeType: string | null }>(
      await api.get(`/admin/partners/${id}/application/documents/${docType}/file`),
    ),
  acceptDocument: async (id: string, docType: DocType) => unwrap(await api.post(`/admin/partners/${id}/application/documents/${docType}/accept`)),
  requestChanges: async (
    id: string,
    v: { issues: { category: ReviewCategory; message: string }[]; documents: { docType: DocType; note: string }[] },
  ) => unwrap(await api.post(`/admin/partners/${id}/application/request-changes`, v)),
  resolveIssue: async (id: string, issueId: string) => unwrap(await api.post(`/admin/partners/${id}/application/issues/${issueId}/resolve`)),
  reopenIssue: async (id: string, issueId: string, message: string) =>
    unwrap(await api.post(`/admin/partners/${id}/application/issues/${issueId}/reopen`, { message })),
  approve: async (id: string) => unwrap(await api.post(`/admin/partners/${id}/application/approve`)),
  reject: async (id: string, reason: string, adminNote?: string) =>
    unwrap(await api.post(`/admin/partners/${id}/application/reject`, { reason, adminNote })),
  reopen: async (id: string) => unwrap(await api.post(`/admin/partners/${id}/application/reopen`)),
};

// ── Nhãn hiển thị (không lộ enum nội bộ cho người dùng) ─────────────────────────────────────

export const DOC_LABEL: Record<DocType, string> = {
  BUSINESS_LICENSE: "Giấy phép kinh doanh",
  REPRESENTATIVE_ID: "Giấy tờ tuỳ thân người đại diện",
  PREMISES_PROOF: "Giấy tờ chứng minh mặt bằng",
  TAX_CODE_CERTIFICATE: "Giấy chứng nhận mã số thuế",
  SITE_PHOTOS: "Ảnh hiện trạng cơ sở",
  FIRE_SAFETY_CERTIFICATE: "Giấy chứng nhận PCCC",
};

export const PHOTO_CATEGORY_LABEL: Record<PhotoCategory, string> = {
  EXTERIOR: "Mặt tiền",
  MAIN_TRAINING_AREA: "Khu tập chính",
  EQUIPMENT: "Thiết bị",
  CARDIO: "Khu cardio",
  CHANGING_ROOM: "Phòng thay đồ",
  AMENITIES: "Tiện ích",
  OTHER: "Khác",
};

export const CATEGORY_LABEL: Record<ReviewCategory, string> = {
  REPRESENTATIVE: "Người đại diện",
  BRAND: "Thương hiệu",
  BRANCH: "Chi nhánh",
  LOCATION: "Vị trí",
  PHOTOS: "Ảnh cơ sở",
  LEGAL: "Pháp lý",
  OTHER: "Khác",
};

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  PENDING: "Chưa tải lên",
  RECEIVED: "Chờ duyệt",
  VERIFIED: "Đã xác minh",
  REJECTED: "Cần cập nhật",
};

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  OPEN: "Đang mở",
  RESUBMITTED: "Đã gửi lại",
  RESOLVED: "Đã đóng",
};

export const ROLE_LABEL: Record<RepresentativeRole, string> = {
  GYM_OWNER: "Chủ phòng tập",
  CO_FOUNDER: "Đồng sáng lập",
  LEGAL_REPRESENTATIVE: "Đại diện pháp luật",
  AUTHORIZED_MANAGER: "Quản lý được uỷ quyền",
};

export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPTED_DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
