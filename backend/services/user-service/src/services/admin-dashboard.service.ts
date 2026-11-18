import { isTestAccountEmail } from "@gym-coach/shared";
import { adminRoleLabel, adminUserStatus } from "../utils/admin-user-view";

/**
 * Pure aggregation behind GET /admin/dashboard on AWS (the gateway's own version cannot run there).
 * Output keys match what AdminDashboard.tsx reads. Anything this service cannot know is left out or
 * null rather than invented: `monitor` (no per-service probe on AWS — the page hides it when absent)
 * and `money` (payment-service reconciliation) are not produced here.
 *
 * Two ways in, ONE way out: the route feeds the numbers computed in auth-service's database
 * (`buildAdminDashboardFromAggregate`; a Lambda cannot carry every account of a 37k-account system in one answer), while
 * `buildAdminDashboard` derives the same aggregate from a user list (kept for small stacks and for the unit tests).
 */
export type DashboardAuthUser = {
  id: string; email: string; firstName?: string | null; lastName?: string | null;
  role: string; isActive?: boolean | null; createdAt: string;
};

export interface DashboardInput {
  users: DashboardAuthUser[] | null; // null = auth-service unreachable
  ptUserIds: string[] | null; // userIds whose profile has isPT; null = unreadable
  activeContracts: number | null;
  ocrStats: { total: number; extracted: number; manual: number; pending: number } | null;
  sessionsToday: number | null;
  now?: Date;
}

/** Everything the dashboard needs to know about accounts: counts, accounts per month, and the newest rows. */
export interface DashboardUserAggregate {
  /** accounts other than admins (and other than the ones the caller excluded) */
  totalUsers: number;
  roleCounts: { CUSTOMER: number; PT: number; GYM_OWNER: number };
  /** role PT, or a profile flagged isPT */
  trainers: number;
  /** flagged isPT but the auth role is not PT yet */
  pendingPT: number;
  /** "YYYY-MM" (Vietnam month of createdAt) -> accounts created that month */
  monthCounts: Record<string, number>;
  /** newest first; `partnerRole` is the real role inside a gym partner when the caller knows it */
  recent: Array<DashboardAuthUser & { partnerRole?: string | null }>;
}

/**
 * Test/seed/eval accounts left out of the server dashboard: reserved test email domains (@gym-coach/shared) plus any profile
 * marked dataOrigin SYNTHETIC. `users` null (auth unreachable) stays null — then only the SYNTHETIC ids are known.
 */
export function excludeTestAccounts(users: DashboardAuthUser[] | null, syntheticUserIds: string[]): { users: DashboardAuthUser[] | null; testIds: string[] } {
  const testIds = [...new Set([...(users ?? []).filter((u) => isTestAccountEmail(u.email)).map((u) => u.id), ...syntheticUserIds])];
  const set = new Set(testIds);
  return { users: users === null ? null : users.filter((u) => !set.has(u.id)), testIds };
}

/** [start, end) of the Vietnam calendar day (UTC+7, no DST) containing `now`, as UTC instants. */
export function vietnamDayBounds(now: Date): { start: Date; end: Date } {
  const OFFSET = 7 * 60 * 60 * 1000, DAY = 24 * 60 * 60 * 1000;
  const startMs = Math.floor((now.getTime() + OFFSET) / DAY) * DAY - OFFSET;
  return { start: new Date(startMs), end: new Date(startMs + DAY) };
}

const hhmm =(d: Date) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

export const RECENT_USERS_COUNT = 4;
const pad2 = (n: number) => String(n).padStart(2, "0");
const monthKeyOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

/** The six calendar months shown by the growth chart, oldest first (process time zone = Asia/Ho_Chi_Minh on the Lambda). */
export function dashboardMonths(now: Date): { key: string; label: string }[] {
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKeyOf(d), label: d.toLocaleString("en-US", { month: "short" }) });
  }
  return months;
}

/** Start of the oldest month of `dashboardMonths` — what auth-service needs to bucket signups. */
export function dashboardSince(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() - 5, 1);
}

/** The aggregate derived from a plain user list (what auth-service's database now computes for the route). */
export function aggregateFromUsers(allUsers: DashboardAuthUser[], ptUserIds: string[]): DashboardUserAggregate {
  const users = allUsers.filter((u) => u.role !== "ADMIN");
  const ptSet = new Set(ptUserIds);
  const monthCounts: Record<string, number> = {};
  for (const u of users) {
    const k = monthKeyOf(new Date(u.createdAt));
    monthCounts[k] = (monthCounts[k] ?? 0) + 1;
  }
  return {
    totalUsers: users.length,
    roleCounts: {
      CUSTOMER: users.filter((u) => u.role === "CUSTOMER").length,
      PT: users.filter((u) => u.role === "PT").length,
      GYM_OWNER: users.filter((u) => u.role === "GYM_OWNER").length,
    },
    trainers: users.filter((u) => u.role === "PT" || ptSet.has(u.id)).length,
    pendingPT: users.filter((u) => u.role !== "PT" && ptSet.has(u.id)).length,
    monthCounts,
    recent: users.slice(0, RECENT_USERS_COUNT),
  };
}

/**
 * Adds the real partner role to the newest rows that are gym-partner accounts: OWNER / MANAGER / RECEPTIONIST / ACCOUNTANT lives in gym-service,
 * not on the auth account. A GYM_OWNER login with no partner account is a legacy owner (gym-service answers null = OWNER). Any other role has no
 * partner role (null). A failed lookup leaves the partner roles null (unknown) and never fails the dashboard.
 */
export async function attachPartnerRoles(
  recent: DashboardUserAggregate["recent"],
  lookup: (userIds: string[]) => Promise<Array<{ userId: string; partnerRole: string | null }>>,
): Promise<DashboardUserAggregate["recent"]> {
  const ownerIds = recent.filter((u) => u.role === "GYM_OWNER").map((u) => u.id);
  if (ownerIds.length === 0) return recent.map((u) => ({ ...u, partnerRole: null }));
  let byId: Map<string, string | null> | null = null;
  try {
    byId = new Map((await lookup(ownerIds)).map((r) => [r.userId, r.partnerRole]));
  } catch {
    byId = null;
  }
  return recent.map((u) => ({
    ...u,
    partnerRole: u.role !== "GYM_OWNER" || byId === null ? null : (byId.get(u.id) ?? "OWNER"),
  }));
}

export interface DashboardFromAggregateInput {
  /** null = auth-service unreachable */
  aggregate: DashboardUserAggregate | null;
  /** false = the trainer profiles could not be read */
  ptKnown: boolean;
  activeContracts: number | null;
  ocrStats: { total: number; extracted: number; manual: number; pending: number } | null;
  sessionsToday: number | null;
  now?: Date;
}

export function buildAdminDashboardFromAggregate(input: DashboardFromAggregateInput) {
  const now = input.now ?? new Date();
  const a: DashboardUserAggregate = input.aggregate ?? {
    totalUsers: 0, roleCounts: { CUSTOMER: 0, PT: 0, GYM_OWNER: 0 }, trainers: 0, pendingPT: 0, monthCounts: {}, recent: [],
  };

  // Cumulative user count over the last 6 calendar months (same method as the gateway).
  const months = dashboardMonths(now);
  let cumulative = 0;
  const userGrowth = months.map((m) => {
    cumulative += a.monthCounts[m.key] ?? 0;
    return { month: m.label, users: cumulative };
  });

  const name = (u: DashboardAuthUser) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email.split("@")[0];
  const recentUsers = a.recent.slice(0, RECENT_USERS_COUNT).map((u) => ({
    // `id` and `partnerRole` let the mobile admin show the right owner / manager / receptionist / accountant instead of guessing from the role.
    id: u.id,
    name: name(u), email: u.email, role: adminRoleLabel(u.role),
    partnerRole: u.partnerRole ?? null,
    joined: new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
    status: adminUserStatus(u.isActive),
  }));

  const warn = (service: string, message: string) => ({ level: "warning", service, message, time: hhmm(now) });
  const systemAlerts = [
    input.aggregate === null ? warn("Auth Service", "Không lấy được số liệu người dùng cho bảng điều khiển. Đang hiển thị dữ liệu một phần.") : null,
    !input.ptKnown ? warn("User Service", "Không lấy được hồ sơ huấn luyện viên cho bảng điều khiển. Đang hiển thị dữ liệu một phần.") : null,
    input.activeContracts === null || input.ocrStats === null
      ? warn("User Service", "Không lấy được số liệu quản trị cho bảng điều khiển. Đang hiển thị dữ liệu một phần.") : null,
    a.pendingPT > 0
      ? { level: "info", service: "PT Management", message: `${a.pendingPT} yêu cầu xác minh huấn luyện viên đang chờ quản trị viên duyệt`, time: hhmm(now) }
      : null,
  ].filter(Boolean);

  return {
    kpis: { totalUsers: a.totalUsers, verifiedPTs: a.trainers, activeContracts: input.activeContracts ?? 0, sessionsToday: input.sessionsToday, pendingPT: a.pendingPT },
    userGrowth,
    roleData: [
      { name: "Clients", value: a.roleCounts.CUSTOMER },
      { name: "Trainers", value: a.trainers },
      { name: "Gym owners", value: a.roleCounts.GYM_OWNER },
    ],
    systemAlerts,
    recentUsers,
    ocrStats: input.ocrStats ?? { total: 0, extracted: 0, manual: 0, pending: 0 },
  };
}

export function buildAdminDashboard(input: DashboardInput) {
  return buildAdminDashboardFromAggregate({
    aggregate: input.users === null ? null : aggregateFromUsers(input.users, input.ptUserIds ?? []),
    ptKnown: input.ptUserIds !== null,
    activeContracts: input.activeContracts,
    ocrStats: input.ocrStats,
    sessionsToday: input.sessionsToday,
    now: input.now,
  });
}
