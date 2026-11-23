/**
 * Thương hiệu & nhân sự (batch G6) - pure functions, no React. Same services, same payloads and the same scope rules as the legacy
 * `ManageManagersPage` (staff) and the brand block of `GymOwnerProfilePage` / `MyGymsPage` (brand). Nothing here invents an API:
 * there is no call that edits the role or the branches of an account that already accepted its invitation, so the screen has none.
 */
import type { CanFn } from "../../../utils/gymStaffRole";
import type { GymBrand } from "../../../types";
import { SOCIALS, type SocialKey } from "../../../components/gym/SocialLinks";
import { ABOUT_MAX } from "../../../components/gym/AboutCounter";

export const BRAND_ROOT = "/gym-owner/brand";

// ----------------------------------------------------------------------------------------------------------------------- tabs
export type BrandTabId = "info" | "staff";
export interface BrandTabDef {
  id: BrandTabId;
  label: string;
  readOnly?: boolean;
}
/** Tabs by permissions[] (fail-closed). Thông tin thương hiệu needs brand.view (read for O, M, A; write only brand.write); Nhân sự needs staff.manage (owner only). */
export function brandTabsFor(can: CanFn): BrandTabDef[] {
  const tabs: BrandTabDef[] = [];
  if (can("brand.view")) tabs.push({ id: "info", label: "Thông tin thương hiệu", readOnly: !can("brand.write") });
  if (can("staff.manage")) tabs.push({ id: "staff", label: "Nhân sự" });
  return tabs;
}
export function resolveBrandTab(raw: string | null | undefined, can: CanFn): BrandTabId | null {
  const tabs = brandTabsFor(can);
  if (tabs.length === 0) return null;
  return tabs.find((t) => t.id === raw)?.id ?? tabs[0].id;
}
export function brandHref(tab: BrandTabId): string {
  return tab === "info" ? BRAND_ROOT : `${BRAND_ROOT}?tab=${tab}`;
}

// ----------------------------------------------------------------------------------------------------------------------- staff roles
export type StaffRole = "MANAGER" | "RECEPTIONIST" | "ACCOUNTANT";
export interface StaffRoleInfo {
  label: string;
  chip: string;
  needsBranch: boolean;
  blurb: string;
  /** The rule about branches, said before the owner picks any. */
  scopeRule: string;
}
/** Permissions of each role are the backend's (`gym-service/partner-permissions.ts`); this is only the words. Branch rules: M, R need at least one; A empty = the whole brand. */
export const STAFF_ROLES: Record<StaffRole, StaffRoleInfo> = {
  MANAGER: {
    label: "Quản lý chi nhánh",
    chip: "Quản lý",
    needsBranch: true,
    blurb: "Vận hành chi nhánh được gán: hội viên, check-in, tạm đóng hoặc mở lại. Không xem ví, không mời người, không sửa thương hiệu hay gói.",
    scopeRule: "Phải gán ít nhất 1 chi nhánh.",
  },
  RECEPTIONIST: {
    label: "Lễ tân",
    chip: "Lễ tân",
    needsBranch: true,
    blurb: "Chỉ việc ở quầy của chi nhánh được gán: mã QR check-in, hạn thẻ hội viên, thông tin chi nhánh. Không thấy doanh thu, giá, ví hay cộng tác PT.",
    scopeRule: "Phải gán ít nhất 1 chi nhánh.",
  },
  ACCOUNTANT: {
    label: "Kế toán (chỉ xem)",
    chip: "Kế toán",
    needsBranch: false,
    blurb: "Chỉ đọc dữ liệu tài chính: doanh số, ví, lịch sử rút tiền, xuất CSV. Không sửa, không duyệt, không rút tiền.",
    scopeRule: "Bỏ trống chi nhánh = toàn thương hiệu.",
  },
};
export const STAFF_ROLE_ORDER: readonly StaffRole[] = ["MANAGER", "RECEPTIONIST", "ACCOUNTANT"];
export const roleChipText = (role: string): string => STAFF_ROLES[role as StaffRole]?.chip ?? "Nhân sự";

// ----------------------------------------------------------------------------------------------------------------------- staff rows
export interface RawAccount {
  id: string;
  role?: string;
  status?: string;
  scopedGymIds?: string[] | null;
  identity?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
}
export interface RawInvitation {
  id: string;
  email?: string;
  role?: string;
  status?: string;
  createdAt?: string;
}

export function staffName(a: RawAccount): string {
  const n = `${a.identity?.firstName ?? ""} ${a.identity?.lastName ?? ""}`.trim();
  return n || a.identity?.email || "nhân sự này";
}

/** Same filters as the legacy page: accounts that are not the owner and still ACTIVE; invitations still PENDING and not for an owner. */
export const activeStaff = (accounts: readonly RawAccount[] | undefined): RawAccount[] => (accounts ?? []).filter((a) => a.role !== "OWNER" && a.status === "ACTIVE");
export const pendingInvites = (list: readonly RawInvitation[] | undefined): RawInvitation[] => (list ?? []).filter((i) => i.status === "PENDING" && i.role !== "OWNER");

export interface ScopeView {
  kind: "all" | "some" | "none";
  names: { id: string; name: string }[];
  /** Words for a screen reader and for a list row at narrow width. */
  text: string;
}
export function scopeOf(role: string | undefined, ids: readonly string[] | null | undefined, gyms: readonly { id: string; name: string }[]): ScopeView {
  const list = ids ?? [];
  if (list.length === 0) {
    // The rule comes from the role table above (a role that needs no branch and has none = the whole brand), not from a role name.
    const needsBranch = STAFF_ROLES[role as StaffRole]?.needsBranch;
    return needsBranch === false ? { kind: "all", names: [], text: "Toàn thương hiệu" } : { kind: "none", names: [], text: "Chưa gán chi nhánh" };
  }
  const names = list.map((id) => ({ id, name: gyms.find((g) => g.id === id)?.name ?? "Chi nhánh khác" }));
  return { kind: "some", names, text: names.map((n) => n.name).join(", ") };
}

const DAY = 86_400_000;
export function inviteAgeDays(createdAt: string | undefined, nowMs: number): number | null {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((nowMs - t) / DAY));
}
export function inviteAgeText(createdAt: string | undefined, nowMs: number): string {
  const d = inviteAgeDays(createdAt, nowMs);
  if (d === null) return "Chưa rõ ngày mời";
  return d === 0 ? "Mời hôm nay" : `Đã mời ${d} ngày trước`;
}
/** Older than a week: said in words, so the owner can resend or revoke. */
export const inviteIsOld = (createdAt: string | undefined, nowMs: number): boolean => (inviteAgeDays(createdAt, nowMs) ?? 0) > 7;

// ----------------------------------------------------------------------------------------------------------------------- invite form
export interface InviteForm {
  role: StaffRole;
  email: string;
  scopedGymIds: string[];
}
export const EMPTY_INVITE: InviteForm = { role: "MANAGER", email: "", scopedGymIds: [] };
export const inviteDirty = (f: InviteForm): boolean => f.email.trim() !== "" || f.scopedGymIds.length > 0 || f.role !== EMPTY_INVITE.role;

export interface InviteProblems {
  email?: string;
  branches?: string;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function inviteProblems(f: InviteForm): InviteProblems {
  const out: InviteProblems = {};
  if (!f.email.trim()) out.email = "Nhập email của nhân sự.";
  else if (!EMAIL.test(f.email.trim())) out.email = "Email chưa hợp lệ. Ví dụ nhanvien@example.com.";
  if (STAFF_ROLES[f.role].needsBranch && f.scopedGymIds.length === 0) out.branches = `${STAFF_ROLES[f.role].chip} phải được gán ít nhất 1 chi nhánh.`;
  return out;
}
/** Exactly the body of the legacy page: `{ email, role, scopedGymIds }` (the accountant may send an empty list). */
export function invitePayload(f: InviteForm): { email: string; role: StaffRole; scopedGymIds: string[] } {
  return { email: f.email.trim(), role: f.role, scopedGymIds: f.scopedGymIds };
}
export function toggleBranch(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

// ----------------------------------------------------------------------------------------------------------------------- revoke copy
export interface ConfirmCopy {
  title: string;
  body: string;
  confirm: string;
}
export function revokeAccountCopy(name: string, role: string): ConfirmCopy {
  return {
    title: `Thu hồi quyền của ${name}?`,
    body: `${roleChipText(role)} này sẽ không còn truy cập được phòng tập của bạn ngay khi bạn xác nhận. Việc này không hoàn tác được: muốn cấp lại, bạn phải mời họ lần nữa.`,
    confirm: "Thu hồi quyền",
  };
}
export function revokeInviteCopy(email: string): ConfirmCopy {
  return {
    title: `Thu hồi lời mời gửi tới ${email}?`,
    body: "Người nhận sẽ không nhận lời mời này được nữa. Muốn mời lại, bạn gửi một lời mời mới.",
    confirm: "Thu hồi lời mời",
  };
}
export const RESEND_NOTE = "Gửi lại: liên kết cũ hết hiệu lực ngay và người nhận dùng liên kết mới.";
export const NO_EDIT_NOTE = "Hệ thống chưa có thao tác sửa vai trò hoặc chi nhánh của một tài khoản đã nhận lời mời. Muốn đổi, hãy thu hồi rồi mời lại.";

// ----------------------------------------------------------------------------------------------------------------------- server answers
type ErrLike = { response?: { status?: number; data?: { error?: { message?: unknown } | string; message?: unknown } } } | null | undefined;
const VI = /[àáâãăạảấầẩẫậắằẳẵặèéêẹẻẽếềểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳỵỷỹđ]/i;
function serverText(e: ErrLike): string | null {
  const err = e?.response?.data?.error;
  const m = typeof err === "string" ? err : typeof err?.message === "string" ? err.message : typeof e?.response?.data?.message === "string" ? e.response.data.message : null;
  return m && VI.test(m) ? m.trim() : null;
}
export type StaffAction = "invite" | "resend" | "revokeInvite" | "revokeAccount";
export interface StaffFailure {
  text: string;
  /** A 5xx / no answer on a write: the request may already exist. The list is reloaded and the person is told so. */
  unclear: boolean;
}
/** One Vietnamese sentence per answer: 400 / 403 / 404 / 409 / 5xx. The server's own sentence wins when it is Vietnamese; a raw code never shows. */
export function staffFailure(error: unknown, action: StaffAction): StaffFailure {
  const e = error as ErrLike;
  const status = e?.response?.status;
  const own = serverText(e);
  if (!e?.response) return { text: "Chưa kết nối được máy chủ nên chưa rõ thao tác đã được ghi nhận chưa. Danh sách sẽ được tải lại để kiểm tra.", unclear: true };
  if (status === 401) return { text: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.", unclear: false };
  if (status === 403) return { text: "Chỉ chủ phòng tập được mời hoặc thu hồi nhân sự.", unclear: false };
  if (status === 404) return { text: action === "revokeAccount" ? "Không tìm thấy tài khoản này. Có thể đã được thu hồi. Danh sách đã được tải lại." : "Không tìm thấy lời mời này. Có thể đã được xử lý. Danh sách đã được tải lại.", unclear: false };
  if (status === 409) return { text: own ?? (action === "invite" ? "Email này đã có lời mời đang chờ hoặc đã là nhân sự. Hãy kiểm tra danh sách." : "Lời mời hoặc tài khoản đã đổi trạng thái. Danh sách đã được tải lại."), unclear: false };
  if (status === 400 || status === 422) return { text: own ?? "Thông tin chưa hợp lệ. Kiểm tra email và chi nhánh.", unclear: false };
  return { text: "Máy chủ gặp lỗi nên chưa rõ thao tác đã được ghi nhận chưa. Danh sách sẽ được tải lại để kiểm tra.", unclear: true };
}

export type BrandAction = "save" | "create";
export function brandFailure(error: unknown, action: BrandAction): StaffFailure {
  const e = error as ErrLike;
  const status = e?.response?.status;
  const own = serverText(e);
  if (!e?.response) return { text: "Chưa kết nối được máy chủ nên chưa rõ thông tin đã được lưu chưa. Tải lại trang để kiểm tra.", unclear: true };
  if (status === 401) return { text: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.", unclear: false };
  if (status === 403) return { text: "Chỉ chủ phòng tập được sửa thương hiệu.", unclear: false };
  if (status === 404) return { text: "Không tìm thấy thương hiệu này. Tải lại trang rồi thử lại.", unclear: false };
  if (status === 409) return { text: own ?? "Thương hiệu vừa đổi trạng thái hoặc tên đang chờ duyệt. Tải lại rồi thử lại.", unclear: false };
  if (status === 400 || status === 422) return { text: own ?? (action === "create" ? "Tên thương hiệu chưa hợp lệ." : "Không lưu được. Kiểm tra lại các liên kết mạng xã hội."), unclear: false };
  return { text: "Máy chủ gặp lỗi nên chưa rõ thông tin đã được lưu chưa. Tải lại trang để kiểm tra.", unclear: true };
}

// ----------------------------------------------------------------------------------------------------------------------- brand form
export type BrandForm = { name: string; description: string } & Record<SocialKey, string>;
export const EMPTY_BRAND_FORM: BrandForm = { name: "", description: "", ...(Object.fromEntries(SOCIALS.map((s) => [s.key, ""])) as Record<SocialKey, string>) };

/** The name the owner sees: a pending rename wins over the approved one (the guests still see the approved one). */
export const currentBrandName = (b: Pick<GymBrand, "name" | "approvedName" | "pendingName">): string => b.pendingName ?? b.approvedName ?? b.name;
export const publicBrandName = (b: Pick<GymBrand, "name" | "approvedName">): string => b.approvedName ?? b.name;

export function brandFormFrom(b: GymBrand | null | undefined): BrandForm {
  if (!b) return { ...EMPTY_BRAND_FORM };
  return {
    name: currentBrandName(b),
    description: b.description ?? "",
    ...(Object.fromEntries(SOCIALS.map((s) => [s.key, (b as unknown as Record<string, string | null | undefined>)[s.key] ?? ""])) as Record<SocialKey, string>),
  };
}
export const nameChanged = (b: GymBrand | null | undefined, f: BrandForm): boolean => !!b && f.name.trim() !== currentBrandName(b);
export function brandDirty(b: GymBrand | null | undefined, f: BrandForm): boolean {
  if (!b) return f.name.trim() !== "" || f.description.trim() !== "";
  const base = brandFormFrom(b);
  return f.name.trim() !== base.name.trim() || f.description.trim() !== base.description.trim() || SOCIALS.some((s) => f[s.key].trim() !== base[s.key].trim());
}
export interface BrandProblems {
  name?: string;
  description?: string;
}
export function brandProblems(f: BrandForm): BrandProblems {
  const out: BrandProblems = {};
  if (!f.name.trim()) out.name = "Nhập tên thương hiệu.";
  if (f.description.trim().length > ABOUT_MAX) out.description = `Giới thiệu tối đa ${ABOUT_MAX} ký tự. Hãy rút gọn.`;
  return out;
}
/** Exactly the legacy body: the name only when it really changed (sending it asks Gymini to approve a rename); description and the four links always, trimmed. */
export function brandUpdatePayload(b: GymBrand, f: BrandForm): Record<string, string> {
  return {
    ...(nameChanged(b, f) ? { name: f.name.trim() } : {}),
    description: f.description.trim(),
    ...(Object.fromEntries(SOCIALS.map((s) => [s.key, f[s.key].trim()])) as Record<SocialKey, string>),
  };
}
export const brandSavedText = (renamed: boolean): string => (renamed ? "Đã lưu. Tên thương hiệu mới sẽ hiển thị cho khách sau khi Gymini duyệt." : "Đã lưu thông tin thương hiệu.");

// ----------------------------------------------------------------------------------------------------------------------- logo
export const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const LOGO_MAX_BYTES = 10 * 1024 * 1024;
/** Same three checks as the legacy uploader. */
export function logoProblem(file: { type: string; size: number }): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return "Định dạng không được hỗ trợ. Dùng JPG, PNG hoặc WebP.";
  if (file.size > LOGO_MAX_BYTES) return "Tệp quá lớn (tối đa 10 MB).";
  if (file.size === 0) return "Tệp rỗng.";
  return null;
}

// ----------------------------------------------------------------------------------------------------------------------- leaving
/** Typed, unsaved input asks before another page or the other tab takes the screen (the form would unmount). */
export function shouldAskBeforeLeaving(p: { dirty: boolean; from: { pathname: string; search: string }; to: { pathname: string; search: string } }): boolean {
  if (!p.dirty) return false;
  if (p.from.pathname.replace(/\/$/, "") !== p.to.pathname.replace(/\/$/, "")) return true;
  return new URLSearchParams(p.from.search).get("tab") !== new URLSearchParams(p.to.search).get("tab");
}
