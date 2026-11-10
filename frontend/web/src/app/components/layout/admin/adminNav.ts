/**
 * Admin navigation — the single source for the sidebar, the breadcrumb, the finance tab strip
 * and the sidebar count badges (Master Plan §2.2–2.4 / §5).
 *
 * Pure data (no React, no icon imports) so it can be unit-tested with `tsx --test`; icons are
 * resolved by `adminNavIcons.tsx` from `iconKey`, badge queries by `useAdminNavBadges.ts` from
 * `badge`.
 *
 * Rules this file encodes:
 *  - 5 groups, always expanded (level 1). Level 2 (tabs) exists ONLY under "Tài chính".
 *  - Every pre-redesign admin URL still resolves (see `adminRedirects.ts` for the ones that
 *    became redirects). Nothing here is a 404.
 *  - "Giao dịch" (finance transactions, B7) sits between "Đối soát" and "Rút tiền"; it is read-only
 *    (backend G-04/G-05). It reuses the finance overview icon key (no new icon key = no change to adminNavIcons).
 */

export type AdminIconKey =
  | "today"
  | "financeOverview"
  | "reconciliation"
  | "withdrawals"
  | "refunds"
  | "users"
  | "ptProfiles"
  | "gymOverview"
  | "partners"
  | "branches"
  | "listings"
  | "disputes"
  | "complaints"
  | "marketplace"
  | "exerciseReview"
  | "catalogQuality"
  | "system"
  | "ai";

/**
 * Which existing list query feeds an item's count badge. The queries themselves (and their
 * query keys, shared with the pages so no extra endpoint is hit) live in `useAdminNavBadges.ts`.
 */
export type AdminBadgeKey =
  | "withdrawals"
  | "serviceRefunds"
  | "reconciliation"
  | "ptApplications"
  | "partnerApplications"
  | "gymsPending"
  | "listingsPending";

export interface AdminNavItem {
  /** Stable id (also used as a React key and in tests). */
  id: string;
  /** Sidebar label. */
  label: string;
  /** Breadcrumb label for this page (defaults to `label`). */
  crumb?: string;
  to: string;
  iconKey: AdminIconKey;
  /** `true` when the item is active ONLY on an exact path match (parents of nested routes). */
  end?: boolean;
  badge?: AdminBadgeKey;
  /** Extra path prefixes that should also highlight this item (nested pages). */
  matchPrefixes?: string[];
}

export interface AdminNavGroup {
  id: string;
  /** Grey uppercase section label. `null` = the unlabeled first group ("Hôm nay"). */
  title: string | null;
  items: AdminNavItem[];
}

export const ADMIN_HOME_PATH = "/admin/dashboard";
export const ADMIN_FINANCE_PATH = "/admin/finance";

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    id: "today",
    title: null,
    items: [{ id: "today", label: "Hôm nay", to: ADMIN_HOME_PATH, iconKey: "today" }],
  },
  {
    id: "finance",
    title: "Tài chính",
    items: [
      { id: "finance-overview", label: "Tổng quan tài chính", crumb: "Tổng quan", to: ADMIN_FINANCE_PATH, iconKey: "financeOverview", end: true },
      { id: "finance-reconciliation", label: "Đối soát", to: `${ADMIN_FINANCE_PATH}/reconciliation`, iconKey: "reconciliation", badge: "reconciliation" },
      { id: "finance-transactions", label: "Giao dịch", to: `${ADMIN_FINANCE_PATH}/transactions`, iconKey: "financeOverview" },
      { id: "finance-withdrawals", label: "Rút tiền", to: `${ADMIN_FINANCE_PATH}/withdrawals`, iconKey: "withdrawals", badge: "withdrawals" },
      { id: "finance-refunds", label: "Hoàn tiền", to: `${ADMIN_FINANCE_PATH}/refunds`, iconKey: "refunds", badge: "serviceRefunds" },
    ],
  },
  {
    id: "partners-users",
    title: "Đối tác & người dùng",
    items: [
      { id: "users", label: "Người dùng", to: "/admin/users", iconKey: "users" },
      { id: "pts", label: "Hồ sơ PT", to: "/admin/pts", iconKey: "ptProfiles", badge: "ptApplications" },
      { id: "gym-management", label: "Tổng quan phòng gym", to: "/admin/gym-management", iconKey: "gymOverview" },
      { id: "partners", label: "Đối tác phòng gym", to: "/admin/partners", iconKey: "partners", badge: "partnerApplications" },
      { id: "gyms", label: "Chi nhánh", to: "/admin/gyms", iconKey: "branches", badge: "gymsPending" },
      { id: "listings", label: "Tin đăng & tiện ích", to: "/admin/listings", iconKey: "listings", badge: "listingsPending" },
    ],
  },
  {
    id: "cases",
    title: "Xử lý vụ việc",
    items: [
      // Dispute queue + Case Workspace (`/admin/disputes[/:caseId]`). No badge: a count would need an extra list read, and every read of the case list writes access-log rows.
      { id: "disputes", label: "Tranh chấp buổi tập", to: "/admin/disputes", iconKey: "disputes" },
      { id: "complaints", label: "Khiếu nại phòng gym", to: "/admin/complaints", iconKey: "complaints" },
      { id: "marketplace", label: "Chợ kế hoạch", to: "/admin/marketplace", iconKey: "marketplace" },
      { id: "exercise-review", label: "Bài tập trùng lặp", crumb: "Duyệt bài tập trùng lặp", to: "/admin/exercise-review", iconKey: "exerciseReview" },
      { id: "catalog-quality", label: "Chất lượng bài tập", crumb: "Ma trận chất lượng catalog", to: "/admin/catalog-quality", iconKey: "catalogQuality" },
    ],
  },
  {
    id: "system",
    title: "Hệ thống",
    items: [
      { id: "system", label: "Giám sát hệ thống", to: "/admin/system", iconKey: "system" },
      { id: "ai-observability", label: "Giám sát AI", to: "/admin/ai-observability", iconKey: "ai" },
    ],
  },
];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV.flatMap((g) => g.items);

/** Tabs of the only level-2 surface (Tài chính). Keys double as the legacy `?tab=` values. */
export interface AdminFinanceTab {
  key: "overview" | "reconciliation" | "transactions" | "withdrawals" | "refunds";
  label: string;
  to: string;
  end?: boolean;
}

export const ADMIN_FINANCE_TABS: AdminFinanceTab[] = [
  { key: "overview", label: "Tổng quan", to: ADMIN_FINANCE_PATH, end: true },
  { key: "reconciliation", label: "Đối soát", to: `${ADMIN_FINANCE_PATH}/reconciliation` },
  { key: "transactions", label: "Giao dịch", to: `${ADMIN_FINANCE_PATH}/transactions` },
  { key: "withdrawals", label: "Rút tiền", to: `${ADMIN_FINANCE_PATH}/withdrawals` },
  { key: "refunds", label: "Hoàn tiền", to: `${ADMIN_FINANCE_PATH}/refunds` },
];

function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/** Does `item` own `pathname`? Exact for `end` items, otherwise exact or a child path. */
export function isNavItemActive(item: AdminNavItem, pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path === item.to) return true;
  if (item.end) return false;
  return [item.to, ...(item.matchPrefixes ?? [])].some((prefix) => path.startsWith(`${prefix}/`));
}

/**
 * The item that owns `pathname`, preferring the most specific (longest `to`) match so
 * `/admin/finance/withdrawals` selects "Rút tiền", not "Tổng quan tài chính".
 */
export function findActiveNavItem(pathname: string): { group: AdminNavGroup; item: AdminNavItem } | null {
  let best: { group: AdminNavGroup; item: AdminNavItem } | null = null;
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (!isNavItemActive(item, pathname)) continue;
      if (!best || item.to.length > best.item.to.length) best = { group, item };
    }
  }
  return best;
}

export interface AdminCrumb {
  label: string;
  /** Absent on the last (current) crumb. */
  to?: string;
}

/** Breadcrumb for the thin topbar: "Quản trị › <group> › <page>". Unknown paths → just "Quản trị". */
export function getAdminBreadcrumb(pathname: string): AdminCrumb[] {
  const found = findActiveNavItem(pathname);
  if (!found) return [{ label: "Quản trị" }];
  const { group, item } = found;
  const crumbs: AdminCrumb[] = [{ label: "Quản trị", to: ADMIN_HOME_PATH }];
  if (group.title) crumbs.push({ label: group.title });
  crumbs.push({ label: item.crumb ?? item.label });
  // The last crumb is the current page: no link.
  return crumbs.map((c, i) => (i === crumbs.length - 1 ? { label: c.label } : c));
}

/** Document title segment for the current admin page. */
export function getAdminPageTitle(pathname: string): string {
  const found = findActiveNavItem(pathname);
  return found ? (found.item.crumb ?? found.item.label) : "Quản trị";
}

// ─── Badge counting (pure — the queries live in useAdminNavBadges.ts) ───────

/**
 * A badge count is a positive integer or `null`. `null` means "show NO badge": the query
 * failed, has not loaded, returned an unexpected shape, or the count is zero. A failed query
 * must never render as "0" (Master Plan: error ≠ empty ≠ zero).
 */
export type BadgeCount = number | null;

export function badgeFromNumber(n: unknown): BadgeCount {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function badgeFromLength(list: unknown): BadgeCount {
  return Array.isArray(list) ? badgeFromNumber(list.length) : null;
}

/** Gyms waiting for first-time approval (same filter the "Chờ duyệt lần đầu" tab uses). */
export function badgeFromPendingGyms(gyms: unknown): BadgeCount {
  if (!Array.isArray(gyms)) return null;
  return badgeFromNumber(gyms.filter((g) => g && (g as { status?: unknown }).status === "PENDING_REVIEW").length);
}

/** Partner applications waiting for review (`counts.IN_REVIEW`, as the applications panel shows). */
export function badgeFromApplicationCounts(data: unknown): BadgeCount {
  const counts = (data as { counts?: Record<string, unknown> } | null | undefined)?.counts;
  return badgeFromNumber(counts?.IN_REVIEW);
}

/** Reconciliation: only items that need attention NOW; both sources must have loaded. */
export function badgeFromAttention(critical: number | null | undefined, bothLoaded: boolean): BadgeCount {
  if (!bothLoaded) return null;
  return badgeFromNumber(critical);
}

/** Display text for a badge: caps at 99+ so a wide number never breaks the pill. */
export function formatBadge(n: number): string {
  return n > 99 ? "99+" : String(n);
}
