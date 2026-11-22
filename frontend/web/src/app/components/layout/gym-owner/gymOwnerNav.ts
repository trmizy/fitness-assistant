/**
 * Gym Owner navigation per role (docs/gym-owner-redesign/05_IA_SCOPE_MODEL.md section 3). Pure data + functions.
 * G0 keeps the EXISTING pages, so an entry is shown only when the existing route guard (`canUseFeature`) lets the role in:
 * the nav can never list a page that would bounce the user to their home. Later batches replace pages and widen entries
 * (for example Accountant: Hoi vien & goi in sales mode, Doi tac PT > Hoa hong) together with the matching guard.
 */
import { canUseFeature, homePathFor, type PartnerRole, type StaffFeature } from "../../../utils/gymStaffRole";
import type { ScopeKind } from "../../../features/gym-owner/scope/scopeModel";
import { partnersScopeKind } from "../../../features/gym-owner/partners/partnersModel";

export type GoIconKey = "today" | "desk" | "plans" | "members" | "branches" | "listings" | "pt" | "finance" | "cases" | "staff" | "profile";
export type GoNavGroupId = "ops" | "money" | "account";

export interface GoNavItem {
  id: string;
  label: string;
  to: string;
  feature: StaffFeature;
  scopeKind: ScopeKind;
  group: GoNavGroupId;
  icon: GoIconKey;
}

export const GO_NAV_GROUPS: readonly { id: GoNavGroupId; label: string }[] = [
  { id: "ops", label: "Vận hành" },
  { id: "money", label: "Đối tác và tiền" },
  { id: "account", label: "Thương hiệu và tài khoản" },
];

export const GO_NAV_ITEMS: readonly GoNavItem[] = [
  { id: "today", label: "Hôm nay", to: "/gym-owner/dashboard", feature: "dashboard", scopeKind: "brand-or-branch", group: "ops", icon: "today" },
  { id: "front-desk", label: "Quầy lễ tân", to: "/gym-owner/front-desk", feature: "frontDesk", scopeKind: "branch", group: "ops", icon: "desk" },
  // G3: members and plans share one page; the Hội viên tab is a branch screen, the Gói tab a brand screen (scopeKindForLocation).
  { id: "members", label: "Hội viên & gói", to: "/gym-owner/members", feature: "members", scopeKind: "branch", group: "ops", icon: "members" },
  { id: "branches", label: "Chi nhánh", to: "/gym-owner/gyms", feature: "gyms", scopeKind: "brand", group: "ops", icon: "branches" },
  // G4: one entry, three screens by role (owner agreements; manager PT check-ins of the branch; accountant PT commission). The legacy
  // "collaborations" guard stays owner-only for the flag-off page; this entry uses the V2-only "partners" feature.
  { id: "pt", label: "Đối tác PT", to: "/gym-owner/collaborations", feature: "partners", scopeKind: "brand", group: "money", icon: "pt" },
  { id: "finance", label: "Tài chính", to: "/gym-owner/finance", feature: "finance", scopeKind: "brand-or-branch", group: "money", icon: "finance" },
  { id: "cases", label: "Khiếu nại", to: "/gym-owner/complaint-cases", feature: "complaintCases", scopeKind: "brand-or-branch", group: "money", icon: "cases" },
  { id: "staff", label: "Nhân sự", to: "/gym-owner/managers", feature: "staff", scopeKind: "brand", group: "account", icon: "staff" },
  { id: "profile", label: "Hồ sơ của tôi", to: "/gym-owner/profile", feature: "profile", scopeKind: "none", group: "account", icon: "profile" },
];

/** Routes that are not nav entries but still need a scope kind / title (detail + wizard pages). */
const EXTRA_ROUTES: readonly { prefix: string; label: string; scopeKind: ScopeKind }[] = [
  // G3: the listings editor is a tab of the branch detail now, so the sidebar entry is gone; the old URL still works (redirect / picker).
  { prefix: "/gym-owner/listings", label: "Tin đăng", scopeKind: "brand-or-branch" },
  // G3: `/gym-owner/plans` only redirects to `/gym-owner/members?tab=plans`.
  { prefix: "/gym-owner/plans", label: "Hội viên & gói", scopeKind: "brand" },
  { prefix: "/gym-owner/gyms/wizard", label: "Thêm chi nhánh", scopeKind: "none" },
  { prefix: "/gym-owner/gyms/", label: "Chi nhánh", scopeKind: "none" },
];

export interface GoNavGroup {
  id: GoNavGroupId;
  label: string;
  items: GoNavItem[];
}

/** Role-aware navigation. Unknown role (still loading / failed) returns [] - never the owner menu (fail-closed). */
export function navFor(role: PartnerRole | undefined): GoNavGroup[] {
  if (!role) return [];
  return GO_NAV_GROUPS.map((g) => ({
    ...g,
    items: GO_NAV_ITEMS.filter((i) => i.group === g.id && canUseFeature(role, i.feature)),
  })).filter((g) => g.items.length > 0);
}

export function flatNavFor(role: PartnerRole | undefined): GoNavItem[] {
  return navFor(role).flatMap((g) => g.items);
}

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

export function navItemForPath(pathname: string): GoNavItem | undefined {
  // Longest `to` first so "/gym-owner/gyms" never shadows a deeper entry.
  return [...GO_NAV_ITEMS].sort((a, b) => b.to.length - a.to.length).find((i) => matches(pathname, i.to));
}

export function scopeKindForPath(pathname: string): ScopeKind {
  const extra = EXTRA_ROUTES.find((r) => pathname.startsWith(r.prefix));
  if (extra) return extra.scopeKind;
  return navItemForPath(pathname)?.scopeKind ?? "none";
}

/**
 * Scope kind of the CURRENT location. Same as `scopeKindForPath`, except the Hội viên & gói page: its Gói tab is brand-wide
 * ("Áp dụng toàn thương hiệu"), its Hội viên tab needs a branch (`?gymId=`); and Đối tác PT, which depends on the role.
 */
export function scopeKindForLocation(pathname: string, tab: string | null, role?: PartnerRole): ScopeKind {
  if (pathname === "/gym-owner/members" || pathname === "/gym-owner/members/") return tab === "plans" ? "brand" : "branch";
  // G4: Đối tác PT is brand-wide for the owner, a branch screen for the manager (PT check-ins), brand-or-branch for the accountant.
  if (pathname === "/gym-owner/collaborations" || pathname === "/gym-owner/collaborations/") return role ? partnersScopeKind(role) : "brand";
  return scopeKindForPath(pathname);
}

export function pageTitleForPath(pathname: string): string {
  const extra = EXTRA_ROUTES.find((r) => pathname.startsWith(r.prefix));
  if (extra) return extra.label;
  return navItemForPath(pathname)?.label ?? "Phòng tập";
}

/** Which nav entry is highlighted: the entry owning the path; detail pages (gyms/:id) highlight "Chi nhánh". */
export function activeNavIdForPath(pathname: string): string | undefined {
  if (pathname.startsWith("/gym-owner/gyms/") || pathname.startsWith("/gym-owner/listings")) return "branches";
  if (pathname.startsWith("/gym-owner/plans")) return "members";
  return navItemForPath(pathname)?.id;
}

export function homeFor(role: PartnerRole | undefined): string {
  return homePathFor(role);
}
