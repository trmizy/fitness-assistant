/**
 * AD-02 "Duyệt → Chi nhánh phòng gym" — phần thuần. Nguồn hành vi: web `AdminGymModeration.tsx` +
 * `BranchReviewIssuesPanel` / `RequestChangesPanel` / `BranchReviewDetail`, và hình dạng thật của
 * gym-service `/admin/gyms`, `/admin/brands`, `/admin/gyms/permanently-closed`,
 * `/admin/gyms/:id/{hours,photos,branch-documents}` (gọi 28/9).
 *
 * Năm hàng việc, đúng như web:
 * 1. Chi nhánh chờ duyệt LẦN ĐẦU (`PENDING_REVIEW`) — duyệt / yêu cầu sửa theo 7 mục (đưa về Nháp) /
 *    từ chối. Duyệt chi nhánh đầu của một thương hiệu chưa từng được duyệt thì **duyệt luôn tên thương
 *    hiệu** — màn hình phải nói trước điều đó.
 * 2. Chi nhánh đã chạy xin **đổi tên / địa chỉ** (`pendingName` / `pendingAddress`) — duyệt, hoặc ghi
 *    chú yêu cầu sửa (không đổi trạng thái chi nhánh).
 * 3. Thương hiệu xin **đổi tên** (`brand.pendingName`) — chỉ có duyệt.
 * 4. Chi nhánh **đóng cửa vĩnh viễn** còn hội viên — chỉ để biết; hoàn tiền làm ở AD-04.
 * 5. **Tất cả chi nhánh** — tìm và sửa trực tiếp thông tin.
 */
import { foldVi } from "../../lib/text";

export type AdminGym = {
  id: string;
  name: string;
  approvedName?: string | null;
  pendingName?: string | null;
  address: string;
  approvedAddress?: string | null;
  pendingAddress?: string | null;
  pendingNameNote?: string | null;
  pendingAddressNote?: string | null;
  changesRequestedAt?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  description?: string | null;
  facilities?: string[] | null;
  status: string;
  operationalStatus?: string | null;
  closedAt?: string | null;
  closureReason?: string | null;
  activeMembershipCount?: number;
  latitude?: number | null;
  longitude?: number | null;
  locationNote?: string | null;
  brand?: { id: string; name: string; approvedName?: string | null; pendingName?: string | null } | null;
  createdAt?: string | null;
};

export type AdminBrand = { id: string; name: string; approvedName?: string | null; pendingName?: string | null };

function list<T>(raw: unknown): T[] {
  const d = (raw as any)?.data ?? raw;
  return Array.isArray(d) ? (d.filter((x: any) => x?.id) as T[]) : [];
}

export const gymRows = (raw: unknown) => list<AdminGym>(raw);
export const brandRows = (raw: unknown) => list<AdminBrand>(raw);

export const displayName = (g: AdminGym) => g.approvedName ?? g.name;
export const displayAddress = (g: AdminGym) => [g.approvedAddress ?? g.address, g.city].filter(Boolean).join(", ");

/** Cũ nhất lên đầu — chi nhánh chờ lâu nhất được xem trước. */
function oldestFirst<T extends { createdAt?: string | null }>(rows: T[]): T[] {
  const t = (r: T) => new Date(r.createdAt ?? 0).getTime() || 0;
  return [...rows].sort((a, b) => t(a) - t(b));
}

export function firstTimeQueue(gyms: AdminGym[]): AdminGym[] {
  return oldestFirst(gyms.filter((g) => g.status === "PENDING_REVIEW"));
}

/**
 * Một lần XIN ĐỔI thật: chi nhánh đã từng được duyệt (có `approvedName`) và tên/địa chỉ chờ khác bản
 * đang hiển thị. Chi nhánh chưa từng được duyệt (nháp, hoặc bị tạm ngưng trước khi được duyệt) cũng mang
 * `pendingName` — đó là tên khai trong wizard, không phải đổi tên. Web gộp cả hai (thấy thật 28/9: một
 * bản nháp hiện "đổi tên" từ X thành chính X); duyệt "đổi tên" ở đó sẽ công khai tên của một chi nhánh
 * chưa bao giờ được duyệt.
 */
export function isRenameRequest(g: AdminGym): boolean {
  if (g.status === "PENDING_REVIEW" || g.status === "DRAFT" || g.approvedName == null) return false;
  const nameChange = !!g.pendingName && g.pendingName !== g.approvedName;
  const addressChange = !!g.pendingAddress && g.pendingAddress !== (g.approvedAddress ?? g.address);
  return nameChange || addressChange;
}

export function renameQueue(gyms: AdminGym[]): AdminGym[] {
  return gyms.filter(isRenameRequest);
}

/**
 * Thương hiệu có tên chờ duyệt. Bỏ qua dòng mà tên chờ trùng tên đã duyệt: không có gì để duyệt
 * (thấy thật 28/9 trên một thương hiệu E2E cũ) — hiện ra chỉ làm hàng chờ không bao giờ hết.
 */
export function brandRenameQueue(brands: AdminBrand[]): AdminBrand[] {
  return brands.filter((b) => !!b.pendingName && b.pendingName !== b.approvedName);
}

export function closedNeedingAttention(closed: AdminGym[]): number {
  return closed.filter((g) => (g.activeMembershipCount ?? 0) > 0).length;
}

/** Thương hiệu chưa từng có chi nhánh nào được duyệt → duyệt chi nhánh này là duyệt luôn tên thương hiệu. */
export function approvesBrandToo(g: AdminGym): boolean {
  return !!g.brand && g.brand.approvedName == null;
}

export function searchGyms(gyms: AdminGym[], q: string): AdminGym[] {
  const f = foldVi(q);
  if (!f) return gyms;
  return gyms.filter((g) => [displayName(g), g.approvedAddress ?? g.address, g.city ?? "", g.brand?.name ?? ""].some((s) => foldVi(s).includes(f)));
}

// ── Yêu cầu sửa chi nhánh lần đầu: 7 mục cố định (BranchReviewIssuesPanel) ─────────────────────

export const BRANCH_REVIEW_CATEGORIES: { value: string; label: string }[] = [
  { value: "BASIC_INFO", label: "Thông tin cơ bản" },
  { value: "LOCATION", label: "Địa điểm" },
  { value: "OPENING_HOURS", label: "Giờ hoạt động" },
  { value: "FACILITIES", label: "Tiện ích & dịch vụ" },
  { value: "PHOTOS", label: "Hình ảnh" },
  { value: "VERIFICATION", label: "Xác minh" },
  { value: "OTHER", label: "Khác" },
];

/** Mục đã tích → lời nhắn. Tích mà chưa ghi gì thì chặn gửi, không lặng lẽ bỏ mục đó. */
export type BranchIssueDraft = Record<string, string>;

export function toggleBranchIssue(d: BranchIssueDraft, category: string): BranchIssueDraft {
  const next = { ...d };
  if (category in next) delete next[category];
  else next[category] = "";
  return next;
}

export function branchIssuesError(d: BranchIssueDraft): string | null {
  const keys = Object.keys(d);
  if (keys.length === 0) return "Chọn ít nhất một mục cần sửa.";
  if (keys.some((k) => !d[k].trim())) return "Ghi rõ cần sửa gì cho từng mục đã chọn.";
  return null;
}

export function branchIssuesPayload(d: BranchIssueDraft): { category: string; message: string }[] {
  // Giữ đúng thứ tự 7 mục như web, không theo thứ tự bấm.
  return BRANCH_REVIEW_CATEGORIES.filter((c) => c.value in d && d[c.value].trim()).map((c) => ({
    category: c.value,
    message: d[c.value].trim(),
  }));
}

// ── Yêu cầu sửa khi đổi tên / địa chỉ (RequestChangesPanel) ─────────────────────────────────────

export function renameNotesError(nameNote: string, addressNote: string): string | null {
  return nameNote.trim() || addressNote.trim() ? null : "Ghi chú ít nhất cho tên hoặc địa chỉ.";
}

export function renameNotesPayload(nameNote: string, addressNote: string) {
  return {
    ...(nameNote.trim() ? { nameNote: nameNote.trim() } : {}),
    ...(addressNote.trim() ? { addressNote: addressNote.trim() } : {}),
  };
}

// ── Chi tiết duyệt (BranchReviewDetail) ─────────────────────────────────────────────────────────

const DAY_LABEL: Record<string, string> = {
  MONDAY: "Thứ 2",
  TUESDAY: "Thứ 3",
  WEDNESDAY: "Thứ 4",
  THURSDAY: "Thứ 5",
  FRIDAY: "Thứ 6",
  SATURDAY: "Thứ 7",
  SUNDAY: "Chủ nhật",
};

const hhmm = (m: number | null | undefined) =>
  m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function hoursRows(raw: unknown): { day: string; text: string }[] {
  const d = (raw as any)?.data ?? raw;
  const rows = Array.isArray(d) ? d : [];
  return rows.map((r: any) => ({
    day: DAY_LABEL[r?.day] ?? String(r?.day ?? ""),
    text: r?.type === "CLOSED" ? "Đóng cửa" : r?.type === "ALL_DAY" ? "Mở 24 giờ" : `${hhmm(r?.openMinute)} – ${hhmm(r?.closeMinute)}`,
  }));
}

/** Chưa khai giờ nào thì máy chủ trả 7 ngày "CLOSED" — nói là chưa khai, đừng nói "đóng cả tuần". */
export function hoursDeclared(raw: unknown): boolean {
  const d = (raw as any)?.data ?? raw;
  return Array.isArray(d) && d.some((r: any) => r?.id != null || r?.type !== "CLOSED");
}

export const BRANCH_DOC_LABEL: Record<string, string> = {
  LEASE_OR_PROPERTY_DOC: "Hợp đồng thuê / giấy tờ sở hữu mặt bằng",
  FIRE_SAFETY_CERTIFICATE: "Giấy chứng nhận PCCC",
  FACILITY_PHOTOS: "Ảnh thực địa cơ sở vật chất",
};

export const PARTNER_DOC_LABEL: Record<string, string> = {
  BUSINESS_LICENSE: "Giấy phép kinh doanh",
  REPRESENTATIVE_ID: "Giấy tờ tuỳ thân người đại diện",
  PREMISES_PROOF: "Chứng minh mặt bằng",
  TAX_CODE_CERTIFICATE: "Chứng nhận mã số thuế",
  SITE_PHOTOS: "Ảnh hiện trạng",
  FIRE_SAFETY_CERTIFICATE: "Giấy chứng nhận PCCC",
};

export const DOC_STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  PENDING: { label: "Chưa nộp", tone: "neutral" },
  RECEIVED: { label: "Chờ xem xét", tone: "warning" },
  VERIFIED: { label: "Đã xác minh", tone: "success" },
  REJECTED: { label: "Cần cập nhật", tone: "danger" },
};

export function branchDocuments(raw: unknown) {
  const d = (raw as any)?.data ?? raw;
  return {
    documents: (Array.isArray(d?.documents) ? d.documents : []) as { docType: string; required?: boolean; status: string; fileToken?: string | null }[],
    partnerContext: (Array.isArray(d?.partnerContext) ? d.partnerContext : []) as { docType: string; status: string }[],
  };
}

// ── Sửa trực tiếp ("Tất cả chi nhánh") ─────────────────────────────────────────────────────────

export type GymEditForm = { name: string; address: string; city: string; phone: string; email: string; description: string };

export function gymEditFormFrom(g: AdminGym): GymEditForm {
  return {
    name: displayName(g),
    address: g.approvedAddress ?? g.address,
    city: g.city ?? "",
    phone: g.phone ?? "",
    email: g.email ?? "",
    description: g.description ?? "",
  };
}

export function gymEditError(f: GymEditForm): string | null {
  if (!f.name.trim()) return "Nhập tên chi nhánh.";
  if (!f.address.trim()) return "Nhập địa chỉ.";
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "Email không hợp lệ.";
  return null;
}

/** Chỉ gửi trường đã đổi — sửa trực tiếp không nên chạm những gì người sửa không đụng tới. */
export function gymEditPayload(before: GymEditForm, after: GymEditForm): Partial<GymEditForm> {
  const out: Partial<GymEditForm> = {};
  (Object.keys(after) as (keyof GymEditForm)[]).forEach((k) => {
    if (after[k].trim() !== before[k].trim()) out[k] = after[k].trim();
  });
  return out;
}
