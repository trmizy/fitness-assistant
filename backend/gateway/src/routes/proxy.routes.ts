import { Router, Request, Response, json } from "express";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import { logger } from "@gym-coach/shared";
import { authMiddleware, requireRoles } from "../middleware/auth.middleware";
import axios from "axios";
import http from "http";
import https from "https";
import {
  validateInternalSecret,
  INTERNAL_SERVICE_SECRET_DEFAULT,
} from "../utils/internal-secret";
import { authRateLimiter, aiAskRateLimiter } from "../middleware/rateLimit.middleware";
import { adminRoleBreakdown, adminRoleLabel, adminUserStatus } from "../utils/adminUserView";
import { relayRestChatMessage } from "../socket/chatRestRelay";
import {
  partnerApplicationLimiter,
  partnerApplicationStartLimiter,
} from "../middleware/partnerApplicationRateLimit.middleware";

export { validateInternalSecret };

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "http://localhost:3001";
const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || "http://localhost:3004";
const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL || "http://localhost:3002";
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:3003";
const CHAT_SERVICE_URL =
  process.env.CHAT_SERVICE_URL || "http://localhost:3005";
const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL || "http://localhost:3007";
const GYM_SERVICE_URL =
  process.env.GYM_SERVICE_URL || "http://localhost:3006";
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || INTERNAL_SERVICE_SECRET_DEFAULT;

validateInternalSecret(
  process.env.INTERNAL_SERVICE_SECRET,
  process.env.NODE_ENV,
);

type ProbeService = {
  key: "api" | "auth" | "user" | "fitness" | "ai" | "chat";
  name: string;
  url: string;
  healthPath?: string; // override default '/health' path
  optional?: boolean; // true = down state doesn't lower core health score
};

type ProbeResult = {
  key: ProbeService["key"];
  name: string;
  status: "healthy" | "degraded" | "down";
  statusCode: number;
  latencyMs: number;
  uptimeSeconds: number | null;
  timestamp: string;
  error: string | null;
  optional?: boolean; // true = down state doesn't lower health score
};

type AuthUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: "ADMIN" | "CUSTOMER" | "PT" | "GYM_OWNER";
  // auth-service has returned this all along; GAP-21 — the aggregates now read it.
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
};

type PTProfile = {
  userId: string;
  isPT: boolean;
};

const MONITOR_SERVICES: ProbeService[] = [
  {
    key: "api",
    name: "API Gateway",
    url: process.env.GATEWAY_URL || "http://localhost:3000",
  },
  { key: "auth", name: "Auth Service", url: AUTH_SERVICE_URL },
  { key: "user", name: "User Service", url: USER_SERVICE_URL },
  { key: "fitness", name: "Fitness Service", url: FITNESS_SERVICE_URL },
  { key: "ai", name: "AI Service", url: AI_SERVICE_URL },
  { key: "chat", name: "Chat Service", url: CHAT_SERVICE_URL },
];

function serviceUnavailable(serviceName: string) {
  return (err: Error, _req: Request, res: Response) => {
    logger.error({ error: `${serviceName} proxy error`, message: err.message });
    // For a WebSocket-upgrade proxy (chatSocketProxy — anything with
    // `ws: true`), http-proxy's ws-incoming error path calls this with the raw duplex socket
    // in place of `res`, which has no .status()/.json(). Calling it unconditionally used to
    // throw a TypeError straight out of a raw socket 'error' event — Node treats that as an
    // uncaught exception and crashes the ENTIRE gateway process, taking down every route for
    // every user, not just the one WebSocket connection that failed. Confirmed reproducing
    // this exactly: chat-service was briefly unreachable during a routine container restart,
    // chatSocketProxy's WS error fired, and the whole gateway went down until restarted by
    // hand — nothing about it was specific to chat-service or to that one restart.
    if (typeof (res as Response)?.status === "function") {
      (res as Response).status(503).json({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: `${serviceName} is unavailable`,
        },
      });
      return;
    }
    const socket = res as unknown as { destroyed?: boolean; end?: (data: string) => void };
    if (socket && !socket.destroyed && typeof socket.end === "function") {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    }
  };
}

const router = Router();

async function probeServices(): Promise<ProbeResult[]> {
  const probes = await Promise.all(
    MONITOR_SERVICES.map(async (service) => {
      const started = Date.now();
      const healthEndpoint = service.healthPath ?? "/health";

      try {
        // Optional services get a shorter timeout so they can't stall the dashboard.
        const response = await axios.get(`${service.url}${healthEndpoint}`, {
          timeout: service.optional ? 2000 : 5000,
          validateStatus: () => true,
        });

        const latencyMs = Date.now() - started;
        const body = response.data || {};
        // A service with a non-standard health path may answer plain text; the rest return JSON { status: 'ok' | 'healthy' }
        const isHealthy =
          response.status < 400 &&
          (service.healthPath
            ? true // non-standard health path: 2xx means healthy
            : body.status === "ok" || body.status === "healthy");
        const uptimeSeconds =
          typeof body.uptime === "number" ? body.uptime : null;

        return {
          key: service.key,
          name: service.name,
          status: isHealthy ? "healthy" : "degraded",
          statusCode: response.status,
          latencyMs,
          uptimeSeconds,
          timestamp: body.timestamp || new Date().toISOString(),
          error: isHealthy
            ? null
            : `Health endpoint returned status ${response.status}`,
          optional: service.optional ?? false,
        } as ProbeResult;
      } catch (error: any) {
        return {
          key: service.key,
          name: service.name,
          status: "down",
          statusCode: 0,
          latencyMs: Date.now() - started,
          uptimeSeconds: null,
          timestamp: new Date().toISOString(),
          error: error?.message || "Health check failed",
          optional: service.optional ?? false,
        } as ProbeResult;
      }
    }),
  );

  return probes;
}

function buildMonitorSummary(probes: ProbeResult[]) {
  const serviceCount = probes.length;
  const healthyCount = probes.filter((s) => s.status === "healthy").length;
  const degradedCount = probes.filter((s) => s.status === "degraded").length;
  const downCount = probes.filter((s) => s.status === "down").length;
  // Optional services don't count against the core health score
  const coreProbes = probes.filter((s) => !s.optional);
  const coreHealthy = coreProbes.filter((s) => s.status === "healthy").length;
  const healthScore =
    coreProbes.length > 0
      ? Math.round((coreHealthy / coreProbes.length) * 100)
      : 0;

  const recentErrors = probes
    .filter((s) => s.status !== "healthy")
    .map((s) => ({
      level: s.status === "down" ? "error" : "warning",
      service: s.name,
      message: s.error || "Unknown issue",
      time: new Date(s.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));

  return {
    serviceCount,
    healthyCount,
    degradedCount,
    downCount,
    healthScore,
    recentErrors,
  };
}

router.get(
  "/admin/system-monitor",
  authMiddleware,
  requireRoles("ADMIN"),
  async (_req, res) => {
    const startAll = Date.now();
    const probes = await probeServices();
    const summary = buildMonitorSummary(probes);

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - startAll,
        summary: {
          serviceCount: summary.serviceCount,
          healthyCount: summary.healthyCount,
          degradedCount: summary.degradedCount,
          downCount: summary.downCount,
          healthScore: summary.healthScore,
        },
        services: probes,
        recentErrors: summary.recentErrors,
      },
    });
  },
);

router.get(
  "/admin/dashboard",
  authMiddleware,
  requireRoles("ADMIN"),
  async (req, res) => {
    const startAll = Date.now();

    try {
      const authHeader = req.headers.authorization;

      const [usersResult, ptsResult, statsResult, probesResult, reconResult] =
        await Promise.allSettled([
          axios.get(`${AUTH_SERVICE_URL}/auth/users`, {
            headers: authHeader ? { Authorization: authHeader } : undefined,
            timeout: 6000,
          }),
          axios.get(`${USER_SERVICE_URL}/profile/pts`, {
            headers: authHeader ? { Authorization: authHeader } : undefined,
            timeout: 6000,
          }),
          axios.get(`${USER_SERVICE_URL}/profile/admin/stats`, {
            headers: authHeader ? { Authorization: authHeader } : undefined,
            timeout: 6000,
          }),
          probeServices(),
          // Platform-wide money state — the dashboard is the admin's landing page, and
          // "where is the money" is the first thing they ask; it was previously nowhere
          // in this aggregation at all, not just missing from the frontend render.
          axios.get(`${PAYMENT_SERVICE_URL}/admin/payments/reconciliation`, {
            headers: authHeader ? { Authorization: authHeader } : undefined,
            timeout: 6000,
            validateStatus: () => true, // 409 (unbalanced) is still data we want to show
          }),
        ]);

      const usersRes =
        usersResult.status === "fulfilled" ? usersResult.value : null;
      const ptsRes = ptsResult.status === "fulfilled" ? ptsResult.value : null;
      const statsRes =
        statsResult.status === "fulfilled" ? statsResult.value : null;
      const probes =
        probesResult.status === "fulfilled" ? probesResult.value : [];
      const reconRes =
        reconResult.status === "fulfilled" ? reconResult.value : null;

      if (usersResult.status === "rejected") {
        logger.error(
          { error: usersResult.reason?.message },
          "Admin dashboard users upstream failed",
        );
      }
      if (ptsResult.status === "rejected") {
        logger.error(
          { error: ptsResult.reason?.message },
          "Admin dashboard PT upstream failed",
        );
      }
      if (statsResult.status === "rejected") {
        logger.error(
          { error: statsResult.reason?.message },
          "Admin dashboard stats upstream failed",
        );
      }
      if (probesResult.status === "rejected") {
        logger.error(
          { error: probesResult.reason?.message },
          "Admin dashboard monitor probe failed",
        );
      }
      if (reconResult.status === "rejected") {
        logger.error(
          { error: reconResult.reason?.message },
          "Admin dashboard reconciliation upstream failed",
        );
      }

      const users = ((usersRes?.data?.users || []) as AuthUser[]).filter(
        (u) => u.role !== "ADMIN",
      );
      const ptProfiles = (ptsRes?.data?.pts || []) as PTProfile[];
      const activeContracts = statsRes?.data?.activeContracts || 0;
      const ptSet = new Set(
        ptProfiles.filter((p) => p.isPT).map((p) => p.userId),
      );

      const totalUsers = users.length;
      const verifiedPTs = users.filter(
        (u) => u.role === "PT" || ptSet.has(u.id),
      ).length;
      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);
      const sessionsToday = users.filter(
        (u) => u.updatedAt?.slice(0, 10) === todayIso,
      ).length;
      const pendingPT = users.filter(
        (u) => u.role !== "PT" && ptSet.has(u.id),
      ).length;

      const sortedUsers = [...users].sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
      );
      const monthLabels: string[] = [];
      for (let i = 5; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthLabels.push(d.toLocaleString("en-US", { month: "short" }));
      }

      const usersByMonth = new Map<string, number>();
      let cumulative = 0;
      for (const label of monthLabels) {
        usersByMonth.set(label, 0);
      }
      for (const u of sortedUsers) {
        const label = new Date(u.createdAt).toLocaleString("en-US", {
          month: "short",
        });
        if (usersByMonth.has(label)) {
          usersByMonth.set(label, (usersByMonth.get(label) || 0) + 1);
        }
      }
      const userGrowth = monthLabels.map((label) => {
        cumulative += usersByMonth.get(label) || 0;
        return { month: label, users: cumulative };
      });


      const monitorSummary = buildMonitorSummary(probes);
      const upstreamWarnings = [
        usersResult.status === "rejected"
          ? {
              level: "warning",
              service: "Auth Service",
              message:
                "Unable to fetch user list for dashboard. Showing partial data.",
              time: new Date().toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }
          : null,
        ptsResult.status === "rejected"
          ? {
              level: "warning",
              service: "User Service",
              message:
                "Unable to fetch PT profiles for dashboard. Showing partial data.",
              time: new Date().toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }
          : null,
        statsResult.status === "rejected"
          ? {
              level: "warning",
              service: "User Service",
              message:
                "Unable to fetch admin stats for dashboard. Showing partial data.",
              time: new Date().toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }
          : null,
      ].filter(Boolean);

      const recentUsers = users.slice(0, 4).map((u) => ({
        name:
          [u.firstName, u.lastName].filter(Boolean).join(" ") ||
          u.email.split("@")[0],
        email: u.email,
        role: adminRoleLabel(u.role),
        joined: new Date(u.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
        }),
        // GAP-21: was "Pending" for every PT (meaningless for an approved trainer).
        status: adminUserStatus(u.isActive),
      }));

      const alerts = [
        ...monitorSummary.recentErrors,
        ...upstreamWarnings,
        pendingPT > 0
          ? {
              level: "info",
              service: "PT Management",
              message: `${pendingPT} PT verification requests pending admin review`,
              time: new Date().toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }
          : null,
      ].filter(Boolean);

      res.json({
        success: true,
        data: {
          generatedAt: new Date().toISOString(),
          responseTimeMs: Date.now() - startAll,
          kpis: {
            totalUsers,
            verifiedPTs,
            activeContracts,
            sessionsToday,
            pendingPT,
          },
          userGrowth,
          // GAP-21: gym owners used to fall outside every slice.
          roleData: adminRoleBreakdown(users, (u) => u.role === "PT" || ptSet.has(u.id)),
          systemAlerts: alerts,
          recentUsers,
          ocrStats: statsRes?.data?.ocrStats || {
            total: 0,
            extracted: 0,
            manual: 0,
            pending: 0,
          },
          monitor: {
            healthScore: monitorSummary.healthScore,
            healthyCount: monitorSummary.healthyCount,
            serviceCount: monitorSummary.serviceCount,
          },
          // null (not zeros) when payment-service didn't answer, so the UI can tell "no
          // money on the platform yet" apart from "couldn't reach payment-service".
          money: reconRes?.data?.data
            ? {
                escrow: reconRes.data.data.escrow,
                platformRevenue: reconRes.data.data.breakdown.platformRevenueAvailable,
                balanced: reconRes.data.data.balanced,
              }
            : null,
        },
      });
    } catch (error: any) {
      logger.error(
        { error: error?.message, stack: error?.stack },
        "Admin dashboard aggregation failed",
      );
      res.status(500).json({
        success: false,
        error: {
          code: "DASHBOARD_AGGREGATION_FAILED",
          message: "Failed to aggregate dashboard data",
        },
      });
    }
  },
);

// ── Admin: User Management list ──────────────────────────────────────────────
// Aggregates auth-service (name/email/role/createdAt) with user-service
// (isPT flag, contract count) into a single normalized list for the admin UI.
router.get(
  "/admin/users",
  authMiddleware,
  requireRoles("ADMIN"),
  async (req, res) => {
    try {
      const authHeader = req.headers.authorization;

      // Fetch users + PT profiles in parallel
      const [usersRes, contractsRes] = await Promise.allSettled([
        axios.get(`${AUTH_SERVICE_URL}/auth/users`, {
          headers: authHeader ? { Authorization: authHeader } : undefined,
          timeout: 6000,
        }),
        axios.get(`${USER_SERVICE_URL}/profile/admin/contracts/summary`, {
          headers: authHeader ? { Authorization: authHeader } : undefined,
          timeout: 6000,
        }),
      ]);

      const authUsers = (
        usersRes.status === "fulfilled" ? usersRes.value.data?.users || [] : []
      ) as AuthUser[];

      // contractSummary: { [userId]: number } — pre-aggregated counts per user
      const contractSummary: Record<string, number> =
        contractsRes.status === "fulfilled"
          ? contractsRes.value.data?.summary || {}
          : {};

      const users = authUsers.map((u) => {
        const name =
          [u.firstName, u.lastName].filter(Boolean).join(" ") ||
          u.email.split("@")[0];
        const role = adminRoleLabel(u.role);
        const contracts = contractSummary[u.id] ?? 0;

        // GAP-21: from auth-service isActive (disable/enable), not a hard-coded "Active".
        const status = adminUserStatus(u.isActive);

        return {
          id: u.id,
          name,
          email: u.email,
          role,
          status,
          joined: new Date(u.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          lastActive: new Date(u.updatedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
          sessions: 0, // future: pull from fitness-service
          contracts,
        };
      });

      res.json({ success: true, data: { total: users.length, users } });
    } catch (error: any) {
      logger.error({ error: error?.message }, "Admin users aggregation failed");
      res.status(500).json({
        success: false,
        error: {
          code: "ADMIN_USERS_FAILED",
          message: "Failed to fetch user list",
        },
      });
    }
  },
);

// ── Admin: Update user role ───────────────────────────────────────────────────
router.patch(
  "/admin/users/:userId/role",
  authMiddleware,
  requireRoles("ADMIN"),
  json(),
  async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const { userId } = req.params;
      const { role } = req.body;

      const response = await axios.patch(
        `${AUTH_SERVICE_URL}/auth/users/${userId}/role`,
        { role },
        {
          headers: authHeader ? { Authorization: authHeader } : undefined,
          timeout: 5000,
        },
      );

      res.json({ success: true, data: response.data });
    } catch (error: any) {
      logger.error({ error: error?.message }, "Admin update user role failed");
      const status = error?.response?.status || 500;
      res.status(status).json({
        success: false,
        error: {
          code: "UPDATE_ROLE_FAILED",
          message: error?.response?.data?.error || "Failed to update user role",
        },
      });
    }
  },
);

// Admin disable/enable user (BUG-002, BUG-025, BUG-026). Proxies to auth-service.
for (const action of ["disable", "enable"] as const) {
  router.patch(
    `/admin/users/:userId/${action}`,
    authMiddleware,
    requireRoles("ADMIN"),
    async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        const { userId } = req.params;
        const response = await axios.patch(
          `${AUTH_SERVICE_URL}/auth/users/${userId}/${action}`,
          {},
          {
            headers: authHeader ? { Authorization: authHeader } : undefined,
            timeout: 5000,
          },
        );
        res.json({ success: true, data: response.data });
      } catch (error: any) {
        logger.error({ error: error?.message }, `Admin ${action} user failed`);
        const status = error?.response?.status || 500;
        res.status(status).json({
          success: false,
          error: {
            code:
              action === "disable"
                ? "DISABLE_USER_FAILED"
                : "ENABLE_USER_FAILED",
            message: error?.response?.data?.error || `Failed to ${action} user`,
          },
        });
      }
    },
  );
}

// Protected — AI observability admin endpoints (admin only, proxied to AI service)
// Registered BEFORE the generic /ai proxy so /admin/ai/* is matched first.
router.use(
  "/admin/ai",
  authMiddleware,
  requireRoles("ADMIN"),
  (req, _res, next) => {
    req.headers["x-internal-token"] = INTERNAL_SERVICE_SECRET;
    next();
  },
  createProxyMiddleware({
    target: AI_SERVICE_URL,
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
      const userId = req.headers["x-user-id"];
      const userEmail = req.headers["x-user-email"];
      const userRole = req.headers["x-user-role"];
      const authorization = req.headers.authorization;
      if (typeof userId === "string") proxyReq.setHeader("x-user-id", userId);
      if (typeof userEmail === "string")
        proxyReq.setHeader("x-user-email", userEmail);
      if (typeof userRole === "string")
        proxyReq.setHeader("x-user-role", userRole);
      if (typeof authorization === "string")
        proxyReq.setHeader("Authorization", authorization);
      proxyReq.setHeader("x-internal-token", INTERNAL_SERVICE_SECRET);
      fixRequestBody(proxyReq, req);
    },
    onError: serviceUnavailable("AI service (admin)"),
  }),
);

// Protected — Auth role management (admin only)
router.use(
  "/auth/users/:userId/role",
  authMiddleware,
  requireRoles("ADMIN"),
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("Auth service"),
  }),
);

// Protected — Auth user management (admin only)
router.use(
  "/auth/users",
  authMiddleware,
  requireRoles("ADMIN"),
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("Auth service"),
  }),
);

// Đối tác Gym tự đăng ký (công khai): giới hạn tần suất THEO IP, store Redis khi có — xem
// partnerApplicationRateLimit.middleware.ts. Đặt TRƯỚC proxy /auth bên dưới; trần theo EMAIL
// nằm ở auth-service. `start` gửi email nên chặt hơn hẳn.
router.post("/auth/partner-applications/start", partnerApplicationStartLimiter);
router.use("/auth/partner-applications", partnerApplicationLimiter);

// Public — Auth Service
router.use(
  "/auth",
  authRateLimiter,
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("Auth service"),
  }),
);

// Protected — PT registration (only customer/admin can trigger)
router.use(
  "/profile/me/become-pt",
  authMiddleware,
  requireRoles("CUSTOMER", "ADMIN"),
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/profile": "/profile" },
    onError: serviceUnavailable("User service"),
  }),
);

// Protected — Admin-only user-service endpoints. Previously only had
// authMiddleware (any logged-in Client/PT/Gym Owner could call
// /profile/admin/contracts/summary and /profile/admin/stats and read
// platform-wide contract/OCR data). Registered before the general
// /profile mount below so Express matches this more specific prefix first.
router.use(
  "/profile/admin",
  authMiddleware,
  requireRoles("ADMIN"),
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/profile": "/profile" },
    onError: serviceUnavailable("User service"),
  }),
);

// Protected — User Service
router.use(
  "/profile",
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/profile": "/profile" },
    onError: serviceUnavailable("User service"),
  }),
);

// Protected — Fitness Service (workouts)
router.use(
  "/workouts",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (training cycles)
router.use(
  "/training-cycles",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (FitnessRoadmap + RoadmapPhase — long-horizon
// journey orchestration on top of training cycles, see
// docs/fitness-roadmap-phase-integration-plan.md).
router.use(
  "/fitness-roadmaps",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (PT/coach client data + plan assignment —
// Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md). authMiddleware
// only identifies the caller; coach.service.ts does the real per-request
// authorization check against Contract.status===ACTIVE — no role gate here
// since PT-ness is relationship-scoped (this PT + this client), not a
// blanket role permission.
router.use(
  "/coach",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (nutrition)
router.use(
  "/nutrition",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (roadmap P2 canonical import framework +
// P2.1 Hevy import). No body-parser in front of this proxy (same as every
// other fitness-service route above) — the raw request stream is
// forwarded unconsumed, so fitness-service's own route-scoped 15mb
// express.json() limit (app.ts) is the only size limit that applies.
router.use(
  "/imports",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (roadmap P2.5 JSON/CSV export). Read-only,
// GET-only — no request body to worry about either way.
router.use(
  "/exports",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (roadmap P2.6 workout template sharing/import).
router.use(
  "/templates",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (stats)
router.use(
  "/stats",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Public — Exercises (no auth needed to browse)
router.use(
  "/exercises",
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Equipment catalog + per-user equipment (gym-onboarding project). Every
// real caller (onboarding wizard, Profile → Training Setup) is already
// authenticated, so — unlike /exercises — the whole prefix is gated here
// rather than leaving the catalog GET publicly reachable for no benefit.
router.use(
  "/equipment",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Food search (Fitness Service)
router.use(
  "/food",
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Dedicated SSE streaming route for /plans/explain/stream.
// Keep this before the generic /plans proxy so plan explanations are not buffered.
router.post(
  "/plans/explain/stream",
  authMiddleware,
  (req: Request, res: Response) => {
    const userId = req.headers["x-user-id"];
    const userEmail = req.headers["x-user-email"];
    const userRole = req.headers["x-user-role"];
    const authorization = req.headers.authorization;

    const targetUrl = new URL(AI_SERVICE_URL);
    const isHttps = AI_SERVICE_URL.startsWith("https");
    const transport = isHttps ? https : http;
    const query = req.url.includes("?")
      ? req.url.slice(req.url.indexOf("?"))
      : "";

    const bodyChunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
    req.on("end", () => {
      const bodyData = Buffer.concat(bodyChunks);

      const requestHeaders: http.OutgoingHttpHeaders = {
        "content-type": "application/json",
        "content-length": bodyData.length,
        "x-internal-token": INTERNAL_SERVICE_SECRET,
      };
      if (typeof userId === "string") requestHeaders["x-user-id"] = userId;
      if (typeof userEmail === "string")
        requestHeaders["x-user-email"] = userEmail;
      if (typeof userRole === "string")
        requestHeaders["x-user-role"] = userRole;
      if (typeof authorization === "string")
        requestHeaders["authorization"] = authorization;

      const proxyReq = transport.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port ? Number(targetUrl.port) : isHttps ? 443 : 80,
          path: `/plans/explain/stream${query}`,
          method: "POST",
          headers: requestHeaders,
        },
        (proxyRes) => {
          res.writeHead(
            proxyRes.statusCode ?? 200,
            proxyRes.headers as Record<string, string | string[]>,
          );
          proxyRes.pipe(res, { end: true });
        },
      );

      proxyReq.on("error", (err) => {
        logger.error({ err }, "Plan explain SSE stream error");
        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "AI service unavailable",
            },
          });
        } else {
          res.end();
        }
      });

      res.on("close", () => {
        if (!res.writableEnded && !proxyReq.destroyed) {
          proxyReq.destroy();
        }
      });
      proxyReq.write(bodyData);
      proxyReq.end();
    });

    req.on("error", (err) => {
      logger.error({ err }, "Plan explain stream request read error");
      if (!res.headersSent) {
        res.status(400).json({
          success: false,
          error: { code: "REQUEST_ERROR", message: "Request error" },
        });
      }
    });
  },
);

// Protected — Plans (AI Service)
router.post(
  "/plans/nutrition/:planId/save-to-nutrition",
  authMiddleware,
  json(),
  async (req: Request, res: Response) => {
    const userId = req.headers["x-user-id"];
    const userEmail = req.headers["x-user-email"];
    const userRole = req.headers["x-user-role"];
    const authorization = req.headers.authorization;

    try {
      const response = await axios.post(
        `${AI_SERVICE_URL}/plans/nutrition/${encodeURIComponent(req.params.planId)}/save-to-nutrition`,
        req.body,
        {
          timeout: 30000,
          headers: {
            ...(typeof userId === "string" ? { "x-user-id": userId } : {}),
            ...(typeof userEmail === "string"
              ? { "x-user-email": userEmail }
              : {}),
            ...(typeof userRole === "string"
              ? { "x-user-role": userRole }
              : {}),
            ...(typeof authorization === "string"
              ? { Authorization: authorization }
              : {}),
            "x-internal-token": INTERNAL_SERVICE_SECRET,
          },
          validateStatus: () => true,
        },
      );

      res.status(response.status).json(response.data);
    } catch (err) {
      logger.error({ err }, "Nutrition plan save proxy error");
      res.status(503).json({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "AI service is unavailable",
        },
      });
    }
  },
);

router.use(
  "/plans",
  authMiddleware,
  (req, _res, next) => {
    req.headers["x-internal-token"] = INTERNAL_SERVICE_SECRET;
    next();
  },
  createProxyMiddleware({
    target: AI_SERVICE_URL,
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
      const userId = req.headers["x-user-id"];
      const userEmail = req.headers["x-user-email"];
      const userRole = req.headers["x-user-role"];
      const authorization = req.headers.authorization;

      if (typeof userId === "string") proxyReq.setHeader("x-user-id", userId);
      if (typeof userEmail === "string") {
        proxyReq.setHeader("x-user-email", userEmail);
      }
      if (typeof userRole === "string") {
        proxyReq.setHeader("x-user-role", userRole);
      }
      if (typeof authorization === "string") {
        proxyReq.setHeader("Authorization", authorization);
      }
      proxyReq.setHeader("x-internal-token", INTERNAL_SERVICE_SECRET);
    },
    onError: serviceUnavailable("AI service"),
  }),
);

router.use(
  "/marketplace",
  authMiddleware,
  (req, _res, next) => {
    req.headers["x-internal-token"] = INTERNAL_SERVICE_SECRET;
    next();
  },
  createProxyMiddleware({
    target: AI_SERVICE_URL,
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
      const userId = req.headers["x-user-id"];
      const userEmail = req.headers["x-user-email"];
      const userRole = req.headers["x-user-role"];
      const authorization = req.headers.authorization;

      if (typeof userId === "string") proxyReq.setHeader("x-user-id", userId);
      if (typeof userEmail === "string") {
        proxyReq.setHeader("x-user-email", userEmail);
      }
      if (typeof userRole === "string") {
        proxyReq.setHeader("x-user-role", userRole);
      }
      if (typeof authorization === "string") {
        proxyReq.setHeader("Authorization", authorization);
      }
      proxyReq.setHeader("x-internal-token", INTERNAL_SERVICE_SECRET);
    },
    onError: serviceUnavailable("AI service"),
  }),
);

// Cost-aware limiter for real LLM calls — matches both /ai/ask and
// /ai/ask/stream (Express `use()` does prefix matching), registered before
// both so it applies regardless of which route below actually handles the
// request. Every other /ai/* endpoint (sessions, memories, feedback) stays
// on the flat global limiter — those are cheap CRUD, not LLM calls.
router.use("/ai/ask", aiAskRateLimiter);

// Dedicated SSE streaming route for /ai/ask/stream.
// http-proxy-middleware v2 buffers chunked responses, which breaks SSE.
// This route uses Node's native http module to pipe the response without buffering.
// Body is collected manually (not piped) to avoid stream-state issues after async authMiddleware.
// MUST be registered BEFORE the generic /ai proxy below.
router.post("/ai/ask/stream", authMiddleware, (req: Request, res: Response) => {
  const userId = req.headers["x-user-id"];
  const userEmail = req.headers["x-user-email"];
  const userRole = req.headers["x-user-role"];
  const authorization = req.headers.authorization;

  const targetUrl = new URL(AI_SERVICE_URL);
  const isHttps = AI_SERVICE_URL.startsWith("https");
  const transport = isHttps ? https : http;

  // Collect request body before forwarding. authMiddleware is async so the req
  // stream may be in an uncertain state — reading it explicitly is safer than piping.
  const bodyChunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
  req.on("end", () => {
    const bodyData = Buffer.concat(bodyChunks);

    const requestHeaders: http.OutgoingHttpHeaders = {
      "content-type": "application/json",
      "content-length": bodyData.length,
      "x-internal-token": INTERNAL_SERVICE_SECRET,
    };
    if (typeof userId === "string") requestHeaders["x-user-id"] = userId;
    if (typeof userEmail === "string")
      requestHeaders["x-user-email"] = userEmail;
    if (typeof userRole === "string") requestHeaders["x-user-role"] = userRole;
    if (typeof authorization === "string")
      requestHeaders["authorization"] = authorization;

    const proxyReq = transport.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port ? Number(targetUrl.port) : isHttps ? 443 : 80,
        path: "/ai/ask/stream",
        method: "POST",
        headers: requestHeaders,
      },
      (proxyRes) => {
        res.writeHead(
          proxyRes.statusCode ?? 200,
          proxyRes.headers as Record<string, string | string[]>,
        );
        proxyRes.pipe(res, { end: true });
      },
    );

    proxyReq.on("error", (err) => {
      logger.error({ err }, "AI service SSE stream error");
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "AI service unavailable",
          },
        });
      } else {
        res.end();
      }
    });

    res.on("close", () => {
      if (!res.writableEnded && !proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });
    proxyReq.write(bodyData);
    proxyReq.end();
  });

  req.on("error", (err) => {
    logger.error({ err }, "SSE stream request read error");
    if (!res.headersSent) {
      res.status(400).json({
        success: false,
        error: { code: "REQUEST_ERROR", message: "Request error" },
      });
    }
  });
});

// Protected — AI Service
router.use(
  "/ai",
  authMiddleware,
  createProxyMiddleware({
    target: AI_SERVICE_URL,
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
      const userId = req.headers["x-user-id"];
      const userEmail = req.headers["x-user-email"];
      const userRole = req.headers["x-user-role"];
      const authorization = req.headers.authorization;

      if (typeof userId === "string") proxyReq.setHeader("x-user-id", userId);
      if (typeof userEmail === "string")
        proxyReq.setHeader("x-user-email", userEmail);
      if (typeof userRole === "string")
        proxyReq.setHeader("x-user-role", userRole);
      if (typeof authorization === "string") {
        proxyReq.setHeader("Authorization", authorization);
      }
      proxyReq.setHeader("x-internal-token", INTERNAL_SERVICE_SECRET);
    },
    onError: serviceUnavailable("AI service"),
  }),
);

// Protected — Chat Service (REST). Socket.IO has its own mount below.
router.use(
  "/chat",
  authMiddleware,
  createProxyMiddleware({
    target: CHAT_SERVICE_URL,
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
      const userId = req.headers["x-user-id"];
      const userEmail = req.headers["x-user-email"];
      const userRole = req.headers["x-user-role"];
      const authorization = req.headers.authorization;

      if (typeof userId === "string") proxyReq.setHeader("x-user-id", userId);
      if (typeof userEmail === "string")
        proxyReq.setHeader("x-user-email", userEmail);
      if (typeof userRole === "string")
        proxyReq.setHeader("x-user-role", userRole);
      if (typeof authorization === "string") {
        proxyReq.setHeader("Authorization", authorization);
      }
      proxyReq.setHeader("x-internal-token", INTERNAL_SERVICE_SECRET);
    },
    // A message sent over REST is announced on the gateway socket too — see chatRestRelay.ts.
    onProxyRes: (proxyRes, req) => relayRestChatMessage(proxyRes, req as typeof req & { originalUrl?: string }),
    onError: serviceUnavailable("Chat service"),
  }),
);

// Chat Socket.IO over the gateway — mirrors the "/chat-socket.io" proxy in
// frontend/web/vite.config.ts. chat-service runs a SEPARATE Socket.IO server from
// the gateway's own, and both default to the same "/socket.io" path, so chat gets a
// distinct prefix here that is rewritten back to the real path upstream.
//
// Why this exists: a client that can only reach ONE origin (the Capacitor APK behind
// a single tunnel — see frontend/web/CAPACITOR-NOTES.md) cannot also open a direct
// connection to chat-service on :3005. Routing chat's websocket through the gateway
// keeps that setup down to one public URL. No authMiddleware: Socket.IO carries its
// own token in the connection handshake, which chat-service verifies itself.
//
// `ws` stays OFF on purpose. With `ws: true` http-proxy-middleware subscribes ITSELF to the raw
// server's "upgrade" event on the first plain HTTP request that reaches this middleware — and
// because this proxy has no path context of its own (the "/chat-socket.io" prefix is Express's
// mount, which a raw upgrade never passes through), that listener claims EVERY upgrade,
// including the gateway's own "/socket.io". One unauthenticated polling GET here was enough to
// break realtime for everyone until the gateway restarted ("Invalid WebSocket frame: RSV1 must
// be clear", 6/10). server.ts forwards "/chat-socket.io" upgrades explicitly via `.upgrade`,
// which works without the option.
export const chatSocketProxy = createProxyMiddleware({
  target: CHAT_SERVICE_URL,
  changeOrigin: true,
  ws: false,
  pathRewrite: { "^/chat-socket.io": "/socket.io" },
  onError: serviceUnavailable("Chat service (socket)"),
});
router.use("/chat-socket.io", chatSocketProxy);

// Public — Dropbox Sign webhook passthrough (no auth, Dropbox Sign posts here directly).
// Money-flow plan 5.2: only registered while e-signing is required — user-service itself
// stops registering this route under the same flag, so proxying to it while off would just
// be forwarding to a 404 at best; not registering it here closes the surface at the edge too.
if (process.env.REQUIRE_CONTRACT_ESIGN !== "false") {
  router.post(
    "/webhooks/dropbox-sign",
    createProxyMiddleware({
      target: USER_SERVICE_URL,
      changeOrigin: true,
      onError: serviceUnavailable("User service (Dropbox Sign webhook)"),
    }),
  );
}

// Protected — Contracts (User Service)
router.use(
  "/contracts",
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("User service"),
  }),
);

// Protected — PT's own service-package CRUD (User Service). Found missing
// while building the PT Coaching Workspace E2E suite: pt_service_package.routes.ts
// (mounted at /me/service-packages in user-service) had no gateway entry at
// all, so the real app — anything going through the gateway, i.e. every
// real browser session — could never reach it; PTProfilePage.tsx's package
// management UI was silently unreachable in the real running stack.
router.use(
  "/me/service-packages",
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("User service"),
  }),
);

// Protected — Availability (User Service)
router.use(
  "/availability",
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("User service"),
  }),
);

// Protected — Sessions (User Service)
router.use(
  "/sessions",
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("User service"),
  }),
);

// Admin — disputed sessions (User Service). user-service re-checks the ADMIN role itself.
router.use(
  "/admin/sessions",
  authMiddleware,
  requireRoles("ADMIN"),
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("User service (admin)"),
  }),
);

// Protected — Notifications (User Service)
router.use(
  "/notifications",
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("User service"),
  }),
);

// Protected — InBody (User Service)
router.use(
  "/inbody",
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/inbody": "/inbody" },
    // OCR image extraction can run for tens of seconds.
    timeout: 180000,
    proxyTimeout: 180000,
    onError: serviceUnavailable("User service"),
  }),
);

// Public (signature-gated, not session-gated) — PT application document
// downloads. Loaded via plain <img src=...>, which cannot attach an
// Authorization header, so this must NOT sit behind authMiddleware — it is
// registered before the general /pt-applications mount below so Express
// matches this more specific path first. Authorization is enforced by
// user-service itself via a short-lived HMAC signature in the URL's
// exp/sig query params (see ptDocumentUrl.util.ts) — those are only ever
// handed out by the already auth-gated getMe/getById/listApplications
// responses, never guessable/forgeable without the server-side secret.
router.use(
  "/pt-applications/documents",
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/pt-applications/documents": "/pt-applications/documents" },
    onError: serviceUnavailable("User service"),
  }),
);

// Protected — PT Applications (User Service)
router.use(
  "/pt-applications",
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/pt-applications": "/pt-applications" },
    onError: serviceUnavailable("User service"),
  }),
);

// Public — gym branch photo gallery (Gym Service). Must be registered BEFORE the blanket
// `/uploads` → USER_SERVICE_URL route below, since Express matches path prefixes in
// registration order and this is a more specific sub-path of it.
// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos": these are genuinely public (marketing
// gallery), same exposure level as a profile photo — unlike complaint-photos/verification
// documents, which stay behind an authenticated serve route with no static mount at all.
router.use(
  "/uploads/gym-photos",
  createProxyMiddleware({
    target: GYM_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("Gym service (Uploads)"),
  }),
);

// Public — Uploads (User Service)
router.use(
  "/uploads",
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("User service (Uploads)"),
  }),
);

// Public — Locations (User Service)
router.use(
  "/locations",
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/locations": "/locations" },
    onError: serviceUnavailable("User service (Locations)"),
  }),
);

// Protected — PT's own training-location CRUD (Phase 2 discovery/scheduling).
// Same gap as above: user-service mounts this at the top level
// (app.use("/pt/training-locations", ...)), so it needs its own explicit proxy
// route. PTProfilePage.tsx already calls it — it was 404ing in the running app.
router.use(
  "/pt/training-locations",
  authMiddleware,
  requireRoles("PT"),
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable("User service"),
  }),
);

// ── Payment Service proxy routes ─────────────────────────────────────────────

// Payment: client history (auth required)
router.use(
  '/me/payments',
  authMiddleware,
  createProxyMiddleware({
    target: PAYMENT_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Payment service'),
  }),
);

// Wallet: client wallet + top-up (auth required). payment-service serves these under /me
// and enforces its own auth via the gateway-injected x-user-* headers.
router.use(
  '/me/wallet',
  authMiddleware,
  createProxyMiddleware({
    target: PAYMENT_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Payment service'),
  }),
);

// PT earnings wallet (auth required). PT-role enforcement lives in payment-service
// (returns 403 for non-PT), so no requireRoles here — match the existing route policy.
router.use(
  '/me/pt-wallet',
  authMiddleware,
  createProxyMiddleware({
    target: PAYMENT_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Payment service'),
  }),
);

// Payment: provider webhook (no auth — signature verified in payment-service)
router.post(
  '/payments/webhook/:provider',
  createProxyMiddleware({
    target: PAYMENT_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Payment service (webhook)'),
  }),
);

// VNPay's own return-URL handler (no auth — this is VNPay redirecting the payer's browser
// back, not an authenticated app call; the query string is itself signature-verified inside
// payment-service). Previously reachable only by hitting payment-service's port 3007
// directly — fine on the same LAN, unreachable through the tunnel, which only forwards port
// 3000. Proxying it here means the SAME tunneled gateway URL now doubles as the return
// address (see app.ts's x-public-base-url, threaded into VNPAY_RETURN_URL at checkout time).
router.get(
  '/payments/vnpay/return',
  createProxyMiddleware({ target: PAYMENT_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Payment service') }),
);
// Same reachability reasoning, for VNPAY_SIMULATE=true's local stand-in checkout page.
router.get(
  '/payments/vnpay/sim',
  createProxyMiddleware({ target: PAYMENT_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Payment service') }),
);

// Withdrawal self-service (money-flow plan 5.3) — PT or CLIENT, payment-service infers which
// wallet from the caller's role via the gateway-injected x-user-role header.
router.use(
  '/me/withdrawals',
  authMiddleware,
  createProxyMiddleware({
    target: PAYMENT_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Payment service'),
  }),
);

// Payment: admin endpoints
router.use(
  '/admin/payments',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({
    target: PAYMENT_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Payment service (admin)'),
  }),
);

// ── Gym Service proxy routes ──────────────────────────────────────────────────
// Method-split: public GET routes have no auth; writes are gated by role.
// /internal/* is never proxied here — service-secret-only, reachable on the Docker
// network only (see payment-service's equivalent boundary).

// Public — browse gyms/plans/trainers (gym-service itself filters to APPROVED/ACTIVE/PUBLIC)
router.get('/gyms', createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }));
router.get('/gyms/:id', createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }));
router.get('/gyms/:gymId/plans', createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }));
router.get('/gyms/:gymId/trainers', createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }));
router.get('/gyms/:gymId/reviews', createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }));

// Client — first purchase + retry/cancel/list (CUSTOMER or PT acting as buyer)
router.post(
  '/gyms/:gymId/memberships',
  authMiddleware,
  requireRoles('CUSTOMER', 'PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
// A4: checked before the purchase-confirmation dialog (money-flow plan §2.6).
router.get(
  '/gyms/:gymId/membership-warnings',
  authMiddleware,
  requireRoles('CUSTOMER', 'PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
// Gym review write/delete — only a logged-in buyer (gym-service verifies they actually purchased).
router.post(
  '/gyms/:gymId/reviews',
  authMiddleware,
  requireRoles('CUSTOMER', 'PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
router.delete(
  '/gyms/:gymId/reviews',
  authMiddleware,
  requireRoles('CUSTOMER', 'PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
router.use(
  '/me/gym-memberships',
  authMiddleware,
  requireRoles('CUSTOMER', 'PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
// Member scans the gym's front-desk QR to record their own visit.
router.use(
  '/me/gym-checkins',
  authMiddleware,
  requireRoles('CUSTOMER', 'PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);

// GYM_MANAGEMENT master spec, Phase 5 — "Báo cáo vấn đề" (private, never public — distinct
// from the review route above). Multipart upload proxies through unmodified — gym-service's
// own multer parses it, the gateway has no reason to touch the body.
router.post(
  '/gyms/:gymId/complaints',
  authMiddleware,
  requireRoles('CUSTOMER', 'PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
router.use(
  '/me/complaints',
  authMiddleware,
  requireRoles('CUSTOMER', 'PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
router.use(
  '/complaint-photos',
  authMiddleware,
  requireRoles('CUSTOMER', 'PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);

// PT — gym affiliation invitations
router.use(
  '/pt/gym-invitations',
  authMiddleware,
  requireRoles('PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
router.use(
  '/pt/gym-affiliations',
  authMiddleware,
  requireRoles('PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);

// PT ↔ gym revenue-share negotiation (money-flow plan §1.3/F3). PT-initiated side.
router.post(
  '/gyms/:gymId/collaborations',
  authMiddleware,
  requireRoles('PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
router.patch(
  '/collaborations/:id',
  authMiddleware,
  requireRoles('PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
router.delete(
  '/collaborations/:id',
  authMiddleware,
  requireRoles('PT'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
// Shared by PT and GYM_OWNER — gym-service dispatches on the caller's own role.
router.get(
  '/me/collaborations',
  authMiddleware,
  requireRoles('PT', 'GYM_OWNER'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
// Public — which gyms a trainer has an accepted partnership with.
router.get(
  '/pt/:ptUserId/gyms',
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);

// Quản lý đối tác phòng tập (Phase 3) — người nhận thư mời chưa có tài khoản, nên không
// thể gắn authMiddleware. Cùng shape với /gyms public phía trên.
router.get(
  '/partner-invitations/:token',
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
router.post(
  '/partner-invitations/:token/accept',
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);

// Owner — gym/plan/membership/wallet management (gym-service verifies per-row ownership)
router.use(
  '/owner/gyms',
  authMiddleware,
  requireRoles('GYM_OWNER'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
// Owner — brand (chain) CRUD. Sibling path outside the /owner/gyms prefix above, so — same
// gotcha as /owner/collaborations below — it needs its own explicit declaration or it 404s
// at the gateway despite working fine directly against gym-service.
router.use(
  '/owner/brands',
  authMiddleware,
  requireRoles('GYM_OWNER'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 6 "Verification". `/owner/branch-documents/:token`
// (private serve route) is a sibling path outside `/owner/gyms` — same gotcha as
// `/owner/brands` above.
router.use(
  '/owner/branch-documents',
  authMiddleware,
  requireRoles('GYM_OWNER'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
// `/owner/gyms/:gymId/collaborations` (invite a PT) is already covered by the blanket
// `/owner/gyms` proxy above. `/owner/collaborations/:id` (respond/terminate) is a sibling
// path outside that prefix and needs its own declaration (money-flow plan §1.3/F3).
router.use(
  '/owner/collaborations',
  authMiddleware,
  requireRoles('GYM_OWNER'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
// Hồ sơ đối tác TỰ ĐĂNG KÝ (GYM_PARTNER_SELF_ONBOARDING_SPEC.md) — vùng ứng viên: status/bootstrap,
// điền hồ sơ, tải lên, nộp. Phải khai báo riêng như /owner/onboarding: gateway chỉ proxy các prefix
// /owner/* được liệt kê tường minh, prefix mới không có ở đây sẽ 404 dù gym-service có route. Gateway
// chỉ chặn theo role; ai được làm gì trong vùng này do gym-service quyết định.
router.use(
  '/owner/application',
  authMiddleware,
  requireRoles('GYM_OWNER'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
// Phase 3 — trình thiết lập lần đầu (5 bước) + owner tự mời/thu hồi quản lý chi nhánh.
router.use(
  '/owner/onboarding',
  authMiddleware,
  requireRoles('GYM_OWNER'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
router.use(
  '/owner/partner-accounts',
  authMiddleware,
  requireRoles('GYM_OWNER'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);
router.use(
  '/owner/partner-invitations',
  authMiddleware,
  requireRoles('GYM_OWNER'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service') }),
);

// Admin — gym approval
router.use(
  '/admin/gyms',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service (admin)') }),
);

// Admin — brand moderation (Vòng 4 / Phase C1). Sibling path outside /admin/gyms above, same
// gotcha as /owner/brands: needs its own explicit declaration or it 404s at the gateway.
router.use(
  '/admin/brands',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service (admin)') }),
);

// Admin — exceptional membership refund (money-flow plan §2.4). Separate prefix from
// /admin/gyms above, needs its own declaration.
router.use(
  '/admin/gym-memberships',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service (admin)') }),
);

// Quản lý đối tác phòng tập (Phase 2-5) — hồ sơ đối tác, tài khoản, thư mời, thẩm định,
// tạm khoá/chấm dứt, chiết khấu. Sibling prefixes ngoài /admin/gyms, cần khai báo riêng.
router.use(
  '/admin/partners',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service (admin)') }),
);
router.use(
  '/admin/partner-accounts',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service (admin)') }),
);
router.use(
  '/admin/commission-rate',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service (admin)') }),
);

// GYM_MANAGEMENT master spec, Phase 5 — Khiếu nại/Vi phạm, admin side.
router.use(
  '/admin/complaints',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service (admin)') }),
);
router.use(
  '/admin/complaint-photos',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service (admin)') }),
);

// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 6 "Verification", admin defense-in-depth serve.
router.use(
  '/admin/branch-documents',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({ target: GYM_SERVICE_URL, changeOrigin: true, onError: serviceUnavailable('Gym service (admin)') }),
);

export default router;
