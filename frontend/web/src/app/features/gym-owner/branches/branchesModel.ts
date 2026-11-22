/**
 * "Chi nhánh" model (batch G2) - pure functions, no React, no network.
 * Branch list grouping, status tags, the tab <-> URL map of the branch detail page, which tabs a role may use, and the
 * redirect of the legacy `/gym-owner/listings` screen. Nothing here decides business rules: every permission mirrors the
 * existing guards (`canUseFeature`, gym-service `owner.routes.ts`) and the server stays the real gate.
 */
import { canViewWallet, type PartnerRole } from "../../../utils/gymStaffRole";
import { ratingLabel } from "../today/todayModel";
import type { TagTone } from "../scope/scopeModel";

export interface BranchLike {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  status?: string | null;
  operationalStatus?: string | null;
  activeMemberCount?: number | null;
  averageRating?: number | null;
  reviewCount?: number | null;
  wizardStep?: number | null;
  adminSuspensionReason?: string | null;
  pendingName?: string | null;
  pendingAddress?: string | null;
  pendingNameNote?: string | null;
  pendingAddressNote?: string | null;
  changesRequestedAt?: string | null;
  expectedReopenAt?: string | null;
}

export const WIZARD_TOTAL_STEPS = 7;

export interface Tag {
  text: string;
  tone: TagTone;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tags + row text
// ---------------------------------------------------------------------------------------------------------------------

/** Approval state as words (never colour only). Same states as the legacy `STATUS_CONFIG` of MyGymsPage. */
export function approvalTag(status: string | null | undefined): Tag {
  switch (status) {
    case "DRAFT":
      return { text: "Bản nháp", tone: "neutral" };
    case "PENDING_REVIEW":
      return { text: "Chờ duyệt", tone: "info" };
    case "APPROVED":
      return { text: "Đã duyệt", tone: "ok" };
    case "REJECTED":
      return { text: "Bị từ chối", tone: "risk" };
    case "SUSPENDED":
      // N15C-08: an admin suspension is a platform measure, not the owner's own pause.
      return { text: "Gymini tạm khoá", tone: "risk" };
    default:
      return { text: "Chưa rõ", tone: "neutral" };
  }
}

/** Only an approved / admin-suspended branch has ever been open to the public (legacy `showStats`). */
export function hasLiveStats(g: Pick<BranchLike, "status">): boolean {
  return g.status === "APPROVED" || g.status === "SUSPENDED";
}

/** Operational state as words. A branch that is not approved yet has no operational life: say so instead of "Đang mở cửa". */
export function operationalTag(g: Pick<BranchLike, "status" | "operationalStatus">): Tag {
  if (g.operationalStatus === "PERMANENTLY_CLOSED") return { text: "Đã đóng cửa vĩnh viễn", tone: "neutral" };
  if (!hasLiveStats(g)) return { text: "Chưa hoạt động", tone: "neutral" };
  if (g.operationalStatus === "TEMPORARILY_CLOSED") return { text: "Tạm đóng cửa", tone: "warn" };
  return { text: "Đang mở cửa", tone: "ok" };
}

export function addressLine(g: Pick<BranchLike, "address" | "city">): string {
  const a = (g.address ?? "").trim();
  const c = (g.city ?? "").trim();
  if (a && c && !a.toLowerCase().includes(c.toLowerCase())) return `${a}, ${c}`;
  return a || c || "Chưa có địa chỉ";
}

export interface BranchTableRow {
  id: string;
  name: string;
  address: string;
  approval: Tag;
  operational: Tag;
  /** Count text, or null when the branch has never had members (not approved). */
  members: number | null;
  rating: string | null;
  /** Admin suspension reason, shown under the address (legacy `gym-card-suspension-reason`). */
  suspensionReason: string | null;
}

export function tableRow(g: BranchLike): BranchTableRow {
  const live = hasLiveStats(g);
  return {
    id: g.id,
    name: g.name,
    address: addressLine(g),
    approval: approvalTag(g.status),
    operational: operationalTag(g),
    members: live ? (typeof g.activeMemberCount === "number" ? g.activeMemberCount : 0) : null,
    rating: live ? ratingLabel(g.averageRating ?? undefined, g.reviewCount ?? undefined) : null,
    suspensionReason: g.status === "SUSPENDED" && g.adminSuspensionReason ? g.adminSuspensionReason : null,
  };
}

export function draftProgress(g: Pick<BranchLike, "wizardStep">): number {
  const step = typeof g.wizardStep === "number" && g.wizardStep >= 1 ? g.wizardStep : 1;
  return Math.max(0, Math.min(100, Math.round(((step - 1) / WIZARD_TOTAL_STEPS) * 100)));
}

// ---------------------------------------------------------------------------------------------------------------------
// List grouping
// ---------------------------------------------------------------------------------------------------------------------

export type AttentionKind = "draft" | "changes" | "pending" | "rejected";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  name: string;
  /** Sentence about what is needed, from fields the API really sends. */
  text: string;
  progress: number | null;
  /** Where the primary action goes: wizard for a draft, branch detail otherwise. */
  href: string;
  actionLabel: string;
}

export function wizardHref(id?: string): string {
  return id ? `/gym-owner/gyms/wizard/${id}` : "/gym-owner/gyms/wizard";
}
export function branchHref(id: string, tab?: BranchTabId): string {
  return tab && tab !== "overview" ? `/gym-owner/gyms/${id}?tab=${tab}` : `/gym-owner/gyms/${id}`;
}

function hasChangeRequest(g: BranchLike): boolean {
  return !!(g.pendingNameNote || g.pendingAddressNote || (g.changesRequestedAt && (g.pendingName || g.pendingAddress)));
}

/**
 * The "Bản nháp / cần bổ sung / chờ duyệt" group. Drafts are only offered to the OWNER (the wizard is owner-only);
 * the other items are visible to anyone who can read the list. Order: things the owner must act on first.
 */
export function attentionItems(gyms: readonly BranchLike[], role: PartnerRole | undefined): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const g of gyms) {
    const name = g.name?.trim() || "Chi nhánh mới";
    if (g.status === "DRAFT") {
      if (role !== "OWNER") continue;
      out.push({ id: g.id, kind: "draft", name, text: "Chưa gửi duyệt, bạn có thể tiếp tục thiết lập", progress: draftProgress(g), href: wizardHref(g.id), actionLabel: "Tiếp tục thiết lập" });
    } else if (g.status === "REJECTED") {
      out.push({ id: g.id, kind: "rejected", name, text: "Hồ sơ bị từ chối, mở chi nhánh để xem lý do", progress: null, href: branchHref(g.id, "verification"), actionLabel: "Xem lý do" });
    } else if (g.status === "PENDING_REVIEW") {
      out.push({ id: g.id, kind: "pending", name, text: "Đang chờ Gymini duyệt hồ sơ", progress: null, href: branchHref(g.id), actionLabel: "Xem hồ sơ" });
    } else if (g.status === "APPROVED" && hasChangeRequest(g)) {
      out.push({ id: g.id, kind: "changes", name, text: "Gymini yêu cầu chỉnh sửa tên hoặc địa chỉ mới", progress: null, href: branchHref(g.id), actionLabel: "Xem yêu cầu" });
    }
  }
  const order: Record<AttentionKind, number> = { changes: 0, rejected: 1, draft: 2, pending: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** Every real branch (DRAFT rows are not branches yet, they live in the attention group). Server order is kept. */
export function tableBranches<T extends BranchLike>(gyms: readonly T[]): T[] {
  return gyms.filter((g) => g.status !== "DRAFT");
}

// ---------------------------------------------------------------------------------------------------------------------
// Tabs <-> URL
// ---------------------------------------------------------------------------------------------------------------------

export const BRANCH_TAB_IDS = ["overview", "hours", "listing", "verification", "status"] as const;
export type BranchTabId = (typeof BRANCH_TAB_IDS)[number];

export const BRANCH_TAB_LABEL: Record<BranchTabId, string> = {
  overview: "Tổng quan",
  hours: "Giờ & tiện ích",
  listing: "Tin đăng",
  verification: "Xác minh",
  status: "Trạng thái",
};

export function parseBranchTab(raw: string | null | undefined): BranchTabId | null {
  return (BRANCH_TAB_IDS as readonly string[]).includes(raw ?? "") ? (raw as BranchTabId) : null;
}

export type TabAccess = "edit" | "read" | "locked" | "hidden";

export interface TabSpec {
  id: BranchTabId;
  label: string;
  access: TabAccess;
  /** Why the tab is read-only / locked (shown inside the tab). */
  reason: string | null;
}

const OWNER_ONLY_WRITE = "Chỉ chủ phòng tập sửa được mục này. Quản lý chỉ xem.";

/**
 * Which tabs a role gets (05 section 3-4, audit/02 section 1). Unknown role (still loading / failed) gets none: never an
 * owner fallback. MANAGER: Tổng quan + Giờ read-only, Tin đăng hidden (the listing API is owner-only), Xác minh locked
 * (the documents API is owner-only, so there is nothing to read), Trạng thái available (temporary close/reopen).
 */
export function branchTabsFor(role: PartnerRole | undefined): TabSpec[] {
  const spec = (id: BranchTabId, access: TabAccess, reason: string | null = null): TabSpec => ({ id, label: BRANCH_TAB_LABEL[id], access, reason });
  if (role === "OWNER") return BRANCH_TAB_IDS.map((id) => spec(id, "edit"));
  if (role === "MANAGER") {
    return [
      spec("overview", "read", OWNER_ONLY_WRITE),
      spec("hours", "read", OWNER_ONLY_WRITE),
      spec("listing", "hidden"),
      spec("verification", "locked", "Giấy tờ xác minh chi nhánh chỉ chủ phòng tập xem và nộp được."),
      spec("status", "edit"),
    ];
  }
  return BRANCH_TAB_IDS.map((id) => spec(id, "hidden"));
}

export function visibleTabs(role: PartnerRole | undefined): TabSpec[] {
  return branchTabsFor(role).filter((t) => t.access !== "hidden");
}

/** The tab to show: the requested one when the role may see it, otherwise the first visible one (null while no role). */
export function resolveBranchTab(raw: string | null | undefined, role: PartnerRole | undefined): BranchTabId | null {
  const tabs = visibleTabs(role);
  if (tabs.length === 0) return null;
  const want = parseBranchTab(raw);
  if (want && tabs.some((t) => t.id === want)) return want;
  return tabs[0].id;
}

/** `?tab=` query for a tab ("overview" is the default and is not written). Other params (`settings`) are dropped. */
export function tabSearch(tab: BranchTabId): string {
  return tab === "overview" ? "" : `?tab=${tab}`;
}

/** `?settings=1` (profile shortcut "Sửa ảnh, giới thiệu, giờ mở cửa") opens Tổng quan already in edit mode. */
export function settingsRequested(search: string): boolean {
  return new URLSearchParams(search).get("settings") === "1";
}

// ---------------------------------------------------------------------------------------------------------------------
// Actions by role
// ---------------------------------------------------------------------------------------------------------------------

export interface StatusActions {
  /** Tạm đóng / mở lại: branch.status.temporary (OWNER + MANAGER). */
  canTemporary: boolean;
  /** Đóng cửa vĩnh viễn: OWNER only (service throws 403 OWNER_ROLE_REQUIRED otherwise). */
  canPermanent: boolean;
  permanentReason: string | null;
}

export function statusActionsFor(role: PartnerRole | undefined): StatusActions {
  const canTemporary = role === "OWNER" || role === "MANAGER";
  const canPermanent = role === "OWNER";
  return { canTemporary, canPermanent, permanentReason: role === "MANAGER" ? "Chỉ chủ phòng tập đóng cửa vĩnh viễn được." : null };
}

export interface WalletAccess {
  canSee: boolean;
  /** Withdrawal requests are owner-only on the server. */
  canWithdraw: boolean;
}

export function walletAccessFor(role: PartnerRole | undefined): WalletAccess {
  return { canSee: canViewWallet(role), canWithdraw: role === "OWNER" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Legacy `/gym-owner/listings` (flag on)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `/gym-owner/listings?gymId=X` goes to the branch's Tin đăng tab. Without a usable gymId the page lists the branches to
 * choose from. `scopeGymId` is the scope's single branch (a one-branch partner has no ?gymId=).
 */
export function listingsRedirectTarget(search: string, scopeGymId: string | null): string | null {
  const gymId = new URLSearchParams(search).get("gymId")?.trim() || scopeGymId;
  if (!gymId) return null;
  return branchHref(gymId, "listing");
}

// ---------------------------------------------------------------------------------------------------------------------
// Verification: admin review issues (category labels)
// ---------------------------------------------------------------------------------------------------------------------

export const REVIEW_CATEGORY_LABEL: Record<string, string> = {
  BASIC_INFO: "Thông tin cơ bản",
  LOCATION: "Địa điểm",
  OPENING_HOURS: "Giờ hoạt động",
  FACILITIES: "Tiện ích & dịch vụ",
  PHOTOS: "Hình ảnh",
  VERIFICATION: "Xác minh",
  OTHER: "Khác",
};

export function reviewCategoryLabel(category: string): string {
  return REVIEW_CATEGORY_LABEL[category] ?? "Khác";
}

// ---------------------------------------------------------------------------------------------------------------------
// Status tab: dialog copy
// ---------------------------------------------------------------------------------------------------------------------

export type ClosureMode = "TEMPORARILY_CLOSED" | "PERMANENTLY_CLOSED" | "OPEN";

/** Server message first (the backend answers 409/403 in Vietnamese), otherwise a sentence of ours. Never a raw code. */
export function apiMessage(error: unknown, fallback: string): string {
  const e = error as { response?: { data?: { error?: { message?: unknown } } } } | null;
  const m = e?.response?.data?.error?.message;
  return typeof m === "string" && m.trim() ? m : fallback;
}

/** Validation of the close dialog, as the legacy page enforces it (a reason is required; OPEN needs none). */
export function closeDialogProblem(mode: ClosureMode, reason: string): string | null {
  if (mode === "OPEN") return null;
  return reason.trim() ? null : "Hãy nhập lý do đóng cửa.";
}

/** Name/address go to pending (Gymini approves); description, phone, email and location land at once. */
export function updateSuccessMessage(payload: object): string {
  if ("name" in payload || "address" in payload) return "Đã lưu. Tên và địa chỉ mới sẽ hiển thị công khai sau khi Gymini duyệt";
  return "Đã lưu thay đổi";
}
