/**
 * WB-17 — "Duyệt hồ sơ đối tác", phần thuần.
 *
 * NGUỒN SỰ THẬT LÀ MÁY CHỦ, y như phía ứng viên (§31.1): `approve.canApprove` và `approve.blockers`
 * do gym-service tính (`computeApproveBlockers`) và đã kèm sẵn câu tiếng Việt. Ứng dụng **không**
 * dựng lại luật duyệt — nếu dựng, hai bộ luật sẽ lệch và màn hình sẽ hứa một nút mà máy chủ từ chối.
 */
import type { PartnerDocType } from "../../services/api";

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

export type AdminApplicationRow = {
  id: string;
  contactEmail?: string | null;
  applicantName?: string | null;
  legalName?: string | null;
  brandName?: string | null;
  firstBranchName?: string | null;
  businessScale?: string | null;
  submittedAt?: string | null;
  createdAt?: string | null;
  status?: string | null;
  verificationStatus?: string | null;
};

/**
 * Hàng chờ của quản trị viên, theo `PartnerVerificationStatus`. Nhãn nói theo việc phải làm chứ
 * không dịch tên enum: `IN_REVIEW` với admin nghĩa là "đang chờ MÌNH xem".
 */
export const REVIEW_TABS: { value: string; label: string; tone: StatusTone }[] = [
  { value: "IN_REVIEW", label: "Chờ duyệt", tone: "warning" },
  { value: "NEEDS_INFO", label: "Đã yêu cầu sửa", tone: "info" },
  { value: "VERIFIED", label: "Đã duyệt", tone: "success" },
  { value: "REJECTED", label: "Đã từ chối", tone: "danger" },
];

export const VERIFICATION_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  NOT_VERIFIED: { label: "Chưa nộp", tone: "neutral" },
  IN_REVIEW: { label: "Chờ duyệt", tone: "warning" },
  NEEDS_INFO: { label: "Đã yêu cầu sửa", tone: "info" },
  VERIFIED: { label: "Đã duyệt", tone: "success" },
  REJECTED: { label: "Đã từ chối", tone: "danger" },
};

export function verificationStatus(s: string | null | undefined) {
  return VERIFICATION_STATUS[s ?? ""] ?? { label: s || "Không rõ", tone: "neutral" as StatusTone };
}

export function applicationRows(raw: unknown): AdminApplicationRow[] {
  const list = Array.isArray(raw) ? raw : ((raw as any)?.items ?? (raw as any)?.data?.items ?? (raw as any)?.data ?? []);
  return (Array.isArray(list) ? list : []).filter((r: any) => r?.id);
}

export function applicationCounts(raw: unknown): Record<string, number> {
  const c = (raw as any)?.counts ?? (raw as any)?.data?.counts;
  return c && typeof c === "object" ? (c as Record<string, number>) : {};
}

/** Tên hiển thị của một hồ sơ: thương hiệu là thứ admin nhận ra, email là thứ luôn có. */
export function applicationTitle(r: AdminApplicationRow): string {
  return (r.brandName ?? r.legalName ?? r.applicantName ?? r.contactEmail ?? "Hồ sơ chưa đặt tên").trim();
}

export function applicationSubtitle(r: AdminApplicationRow): string {
  const parts = [r.firstBranchName, r.contactEmail].filter((x) => !!x && String(x).trim());
  return parts.join(" · ") || "Chưa có chi nhánh";
}

/** Chờ bao lâu rồi — hàng chờ mà không thấy thời gian thì không biết cái nào để lâu nhất. */
export function waitingDays(r: AdminApplicationRow, now: Date = new Date()): number | null {
  const iso = r.submittedAt ?? r.createdAt;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export function waitingLabel(r: AdminApplicationRow, now: Date = new Date()): string {
  const d = waitingDays(r, now);
  if (d == null) return "";
  if (d === 0) return "Hôm nay";
  return `${d} ngày trước`;
}

/** Hồ sơ nộp lâu nhất lên đầu — hàng chờ xử lý theo thứ tự đến, không theo thứ tự máy chủ trả. */
export function sortByWaiting(rows: AdminApplicationRow[]): AdminApplicationRow[] {
  const at = (r: AdminApplicationRow) => new Date(r.submittedAt ?? r.createdAt ?? 0).getTime() || 0;
  return [...rows].sort((a, b) => at(a) - at(b));
}

// ── Chi tiết một hồ sơ ─────────────────────────────────────────────────────────────────────

export type Blocker = { code?: string | null; message?: string | null };

export type AdminApplicationDetail = {
  accessState?: string | null;
  partner?: Record<string, any> | null;
  representativePhone?: string | null;
  brand?: Record<string, any> | null;
  branch?: Record<string, any> | null;
  photos?: any[] | null;
  documents?: any[] | null;
  issues?: any[] | null;
  missing?: { section: string; message: string }[] | null;
  approve?: { canApprove?: boolean | null; blockers?: Blocker[] | null } | null;
  history?: any[] | null;
};

/**
 * Máy chủ đã nói được vì sao chưa duyệt được. Lấy nguyên câu của nó; chỉ khi máy chủ không nói gì
 * mới dùng một câu chung — và khi đó cũng KHÔNG đoán lý do.
 */
export function approveBlockers(d: AdminApplicationDetail | null | undefined): string[] {
  const list = d?.approve?.blockers;
  if (!Array.isArray(list) || list.length === 0) return [];
  return list.map((b) => (b?.message ?? "").trim() || "Còn một điều kiện chưa đạt").filter(Boolean);
}

export function canApprove(d: AdminApplicationDetail | null | undefined): boolean {
  return d?.approve?.canApprove === true;
}

export function adminDocuments(d: AdminApplicationDetail | null | undefined) {
  const list = d?.documents;
  return Array.isArray(list) ? list.filter((x) => x?.docType) : [];
}

export function adminIssues(d: AdminApplicationDetail | null | undefined) {
  const list = d?.issues;
  return Array.isArray(list) ? list.filter((x) => x?.id) : [];
}

/** Giấy tờ đã có tệp nhưng chưa được chấp nhận — đúng việc admin phải làm trước khi duyệt. */
export function documentsAwaitingReview(d: AdminApplicationDetail | null | undefined) {
  return adminDocuments(d).filter((x) => x.hasFile && x.status !== "VERIFIED");
}

export const REVIEW_CATEGORIES: { value: string; label: string }[] = [
  { value: "REPRESENTATIVE", label: "Người đại diện" },
  { value: "BRAND", label: "Thương hiệu" },
  { value: "BRANCH", label: "Chi nhánh" },
  { value: "LOCATION", label: "Vị trí" },
  { value: "PHOTOS", label: "Ảnh cơ sở" },
  { value: "LEGAL", label: "Xác minh doanh nghiệp" },
  { value: "OTHER", label: "Khác" },
];

export type ChangeRequestDraft = {
  category: string;
  message: string;
  documents: { docType: PartnerDocType; note: string }[];
};

export const EMPTY_CHANGE_REQUEST: ChangeRequestDraft = { category: "OTHER", message: "", documents: [] };

/**
 * Yêu cầu sửa phải NÓI ĐƯỢC phải sửa gì. Một yêu cầu rỗng đẩy ứng viên vào trạng thái chờ mà không
 * biết làm gì — máy chủ cũng từ chối, nhưng chặn ở đây thì người duyệt biết ngay.
 */
export function changeRequestError(d: ChangeRequestDraft): string | null {
  const hasIssue = d.message.trim().length > 0;
  const hasDocNote = d.documents.some((x) => x.note.trim().length > 0);
  if (!hasIssue && !hasDocNote) return "Nêu rõ cần sửa gì — ít nhất một mục hoặc một giấy tờ.";
  if (hasIssue && d.message.trim().length < 10) return "Mô tả quá ngắn để ứng viên hiểu phải sửa gì.";
  return null;
}

export function changeRequestPayload(d: ChangeRequestDraft) {
  return {
    issues: d.message.trim() ? [{ category: d.category, message: d.message.trim() }] : [],
    documents: d.documents.filter((x) => x.note.trim()).map((x) => ({ docType: x.docType, note: x.note.trim() })),
  };
}

/** Từ chối là điểm cuối với ứng viên (chỉ admin mở lại được), nên bắt buộc có lý do. */
export function rejectError(reason: string): string | null {
  if (!reason.trim()) return "Nhập lý do từ chối — ứng viên sẽ đọc câu này.";
  if (reason.trim().length < 10) return "Lý do quá ngắn để ứng viên hiểu.";
  return null;
}
