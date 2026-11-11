import { isTestAccountEmail } from "@gym-coach/shared";
import { adminRoleLabel, adminUserStatus } from "../utils/admin-user-view";

/**
 * Pure aggregation behind GET /admin/dashboard on AWS (the gateway's own version cannot run there).
 * Output keys match what AdminDashboard.tsx reads. Anything this service cannot know is left out or
 * null rather than invented: `monitor` (no per-service probe on AWS — the page hides it when absent)
 * and `money` (payment-service reconciliation) are not produced here.
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

export function buildAdminDashboard(input: DashboardInput) {
  const now = input.now ?? new Date();
  const users = (input.users ?? []).filter((u) => u.role !== "ADMIN");
  const ptSet = new Set(input.ptUserIds ?? []);

  const totalUsers = users.length;
  const verifiedPTs = users.filter((u) => u.role === "PT" || ptSet.has(u.id)).length;
  const pendingPT = users.filter((u) => u.role !== "PT" && ptSet.has(u.id)).length;

  // Cumulative user count over the last 6 calendar months (same method as the gateway).
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: d.toLocaleString("en-US", { month: "short" }) });
  }
  const perMonth = new Map(months.map((m) => [m.key, 0]));
  for (const u of users) {
    const k = monthKey(new Date(u.createdAt));
    if (perMonth.has(k)) perMonth.set(k, (perMonth.get(k) ?? 0) + 1);
  }
  let cumulative = 0;
  const userGrowth = months.map((m) => {
    cumulative += perMonth.get(m.key) ?? 0;
    return { month: m.label, users: cumulative };
  });

  const name = (u: DashboardAuthUser) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email.split("@")[0];
  const recentUsers = users.slice(0, 4).map((u) => ({
    name: name(u), email: u.email, role: adminRoleLabel(u.role),
    joined: new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
    status: adminUserStatus(u.isActive),
  }));

  const warn = (service: string, message: string) => ({ level: "warning", service, message, time: hhmm(now) });
  const systemAlerts = [
    input.users === null ? warn("Auth Service", "Unable to fetch user list for dashboard. Showing partial data.") : null,
    input.ptUserIds === null ? warn("User Service", "Unable to fetch PT profiles for dashboard. Showing partial data.") : null,
    input.activeContracts === null || input.ocrStats === null
      ? warn("User Service", "Unable to fetch admin stats for dashboard. Showing partial data.") : null,
    pendingPT > 0
      ? { level: "info", service: "PT Management", message: `${pendingPT} PT verification requests pending admin review`, time: hhmm(now) }
      : null,
  ].filter(Boolean);

  return {
    kpis: { totalUsers, verifiedPTs, activeContracts: input.activeContracts ?? 0, sessionsToday: input.sessionsToday, pendingPT },
    userGrowth,
    roleData: [
      { name: "Clients", value: users.filter((u) => u.role === "CUSTOMER").length },
      { name: "Trainers", value: users.filter((u) => u.role === "PT" || ptSet.has(u.id)).length },
      { name: "Gym owners", value: users.filter((u) => u.role === "GYM_OWNER").length },
    ],
    systemAlerts,
    recentUsers,
    ocrStats: input.ocrStats ?? { total: 0, extracted: 0, manual: 0, pending: 0 },
  };
}
