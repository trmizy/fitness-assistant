/**
 * Admin aggregates (dashboard KPIs, user list), composed in the browser from routes every
 * deployment exposes.
 *
 * `GET /admin/dashboard` and `GET /admin/users` only ever existed in the Express gateway. The
 * AWS deployment has no gateway — API Gateway sends `/admin/{proxy+}` straight to the user
 * Lambda, which has neither route — so both answered 404. This reproduces the gateway's
 * aggregation (backend/gateway/src/routes/proxy.routes.ts, utils/adminUserView.ts) over the
 * underlying per-service routes, which work identically behind the gateway and on AWS.
 */
import { api } from "./api";

type AuthUser = {
  id: string;
  email: string;
  role: string;
  firstName?: string | null;
  lastName?: string | null;
  isActive?: boolean | null;
  createdAt: string;
  updatedAt: string;
};

const authHeaderless = { timeout: 15000 };

function roleLabel(role: string | null | undefined): "Admin" | "PT" | "Gym Owner" | "Client" {
  switch (role) {
    case "ADMIN":
      return "Admin";
    case "PT":
      return "PT";
    case "GYM_OWNER":
      return "Gym Owner";
    default:
      return "Client";
  }
}

/** `isActive` missing means "not known to be locked". */
function userStatus(isActive: boolean | null | undefined): "Active" | "Inactive" {
  return isActive === false ? "Inactive" : "Active";
}

function displayName(u: AuthUser): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email.split("@")[0];
}

const clock = () =>
  new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

export async function getAdminUsers(): Promise<{ total: number; users: any[] }> {
  const [usersRes, contractsRes] = await Promise.allSettled([
    api.get("/auth/users", authHeaderless),
    api.get("/profile/admin/contracts/summary", authHeaderless),
  ]);
  // The user list is the whole point of this page — surface its failure instead of an empty table.
  if (usersRes.status === "rejected") throw usersRes.reason;

  const authUsers = (usersRes.value.data?.users ?? []) as AuthUser[];
  const summary: Record<string, number> =
    contractsRes.status === "fulfilled" ? contractsRes.value.data?.summary ?? {} : {};

  const users = authUsers.map((u) => ({
    id: u.id,
    name: displayName(u),
    email: u.email,
    role: roleLabel(u.role),
    status: userStatus(u.isActive),
    joined: new Date(u.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    lastActive: new Date(u.updatedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    sessions: 0,
    contracts: summary[u.id] ?? 0,
  }));

  return { total: users.length, users };
}

export async function getAdminDashboard(): Promise<any> {
  const started = Date.now();
  // Two waves of two, not four at once: each call makes its Lambda invoke the auth Lambda to
  // verify the token, and the AWS account caps Lambda concurrency at 10.
  const [usersResult, ptsResult] = await Promise.allSettled([
    api.get("/auth/users", authHeaderless),
    api.get("/profile/pts", authHeaderless),
  ]);
  const [statsResult, reconResult] = await Promise.allSettled([
    api.get("/profile/admin/stats", authHeaderless),
    // 409 (unbalanced) is still data we want to show.
    api.get("/admin/payments/reconciliation", { ...authHeaderless, validateStatus: () => true }),
  ]);

  // Nothing to show if the user list itself is unreachable (e.g. expired session / offline).
  if (usersResult.status === "rejected" && statsResult.status === "rejected") {
    throw usersResult.reason;
  }

  const usersRes = usersResult.status === "fulfilled" ? usersResult.value : null;
  const ptsRes = ptsResult.status === "fulfilled" ? ptsResult.value : null;
  const statsRes = statsResult.status === "fulfilled" ? statsResult.value : null;
  const reconRes = reconResult.status === "fulfilled" ? reconResult.value : null;

  const users = ((usersRes?.data?.users ?? []) as AuthUser[]).filter((u) => u.role !== "ADMIN");
  const ptProfiles = (ptsRes?.data?.pts ?? []) as { userId: string; isPT?: boolean }[];
  const ptSet = new Set(ptProfiles.filter((p) => p.isPT).map((p) => p.userId));
  const isTrainer = (u: AuthUser) => u.role === "PT" || ptSet.has(u.id);

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const pendingPT = users.filter((u) => u.role !== "PT" && ptSet.has(u.id)).length;

  const monthLabels: string[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthLabels.push(d.toLocaleString("en-US", { month: "short" }));
  }
  const perMonth = new Map<string, number>(monthLabels.map((l) => [l, 0]));
  for (const u of [...users].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    const label = new Date(u.createdAt).toLocaleString("en-US", { month: "short" });
    if (perMonth.has(label)) perMonth.set(label, (perMonth.get(label) ?? 0) + 1);
  }
  let cumulative = 0;
  const userGrowth = monthLabels.map((label) => {
    cumulative += perMonth.get(label) ?? 0;
    return { month: label, users: cumulative };
  });

  const warn = (service: string, what: string) => ({
    level: "warning",
    service,
    message: `Unable to fetch ${what} for dashboard. Showing partial data.`,
    time: clock(),
  });
  const alerts = [
    usersResult.status === "rejected" ? warn("Auth Service", "user list") : null,
    ptsResult.status === "rejected" ? warn("User Service", "PT profiles") : null,
    statsResult.status === "rejected" ? warn("User Service", "admin stats") : null,
    pendingPT > 0
      ? {
          level: "info",
          service: "PT Management",
          message: `${pendingPT} PT verification requests pending admin review`,
          time: clock(),
        }
      : null,
  ].filter(Boolean);

  const recon = reconRes?.data?.data;

  return {
    generatedAt: now.toISOString(),
    responseTimeMs: Date.now() - started,
    kpis: {
      totalUsers: users.length,
      verifiedPTs: users.filter(isTrainer).length,
      activeContracts: statsRes?.data?.activeContracts ?? 0,
      sessionsToday: users.filter((u) => u.updatedAt?.slice(0, 10) === todayIso).length,
      pendingPT,
    },
    userGrowth,
    roleData: [
      { name: "Clients", value: users.filter((u) => u.role === "CUSTOMER").length },
      { name: "Trainers", value: users.filter(isTrainer).length },
      { name: "Gym owners", value: users.filter((u) => u.role === "GYM_OWNER").length },
    ],
    systemAlerts: alerts,
    recentUsers: users.slice(0, 4).map((u) => ({
      name: displayName(u),
      email: u.email,
      role: roleLabel(u.role),
      joined: new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
      status: userStatus(u.isActive),
    })),
    ocrStats: statsRes?.data?.ocrStats ?? { total: 0, extracted: 0, manual: 0, pending: 0 },
    // Per-service health probing is gateway-only (no equivalent on AWS); the UI hides this.
    monitor: null,
    // null (not zeros) when payment-service didn't answer.
    money: recon
      ? {
          escrow: recon.escrow,
          platformRevenue: recon.breakdown?.platformRevenueAvailable,
          balanced: recon.balanced,
        }
      : null,
  };
}
