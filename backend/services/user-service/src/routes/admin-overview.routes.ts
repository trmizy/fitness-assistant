import { Router, Response } from "express";
import { logger, testAccountsBlocked } from "@gym-coach/shared";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";
import { authServiceClient } from "../clients/auth-service.client";
import { contractRepository } from "../repositories/contract.repository";
import { prisma } from "../repositories/profile.repository";
import {
  RECENT_USERS_COUNT, attachPartnerRoles, buildAdminDashboardFromAggregate, dashboardSince, vietnamDayBounds, type DashboardUserAggregate,
} from "../services/admin-dashboard.service";
import { countActiveContractsExcluding, getAuthTestAccountIds, ocrStatsExcluding, sessionsTodayExcluding } from "../services/admin-dashboard-stats.service";
import { gymClient } from "../clients/gym.client";
import { systemMonitorService, buildMonitorSummary } from "../services/system-monitor.service";

/**
 * GET /admin/dashboard and GET /admin/system-monitor on AWS — the gateway-side aggregations the admin
 * web UI calls, which cannot run there (no gateway; API Gateway routes /admin/* to this Lambda).
 * Same response envelope as the gateway. A source that cannot be read degrades to a visible warning
 * (see buildAdminDashboard), never to a made-up number.
 */
const router = Router();
const adminOnly = [authMiddleware, roleMiddleware(["ADMIN"])];

async function orNull<T>(label: string, p: Promise<T>): Promise<T | null> {
  try { return await p; } catch (err) {
    logger.warn({ err: (err as Error)?.message, source: label }, "Admin dashboard source unavailable");
    return null;
  }
}

router.get("/dashboard", ...adminOnly, async (req: AuthRequest, res: Response) => {
  const startedAt = Date.now();
  try {
    const authHeader = req.headers.authorization as string;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    // Test/seed/eval accounts (reserved test email domains, or a profile marked SYNTHETIC) are left out of every number on
    // the server dashboard (2026-11-08). Same switch as the sign-up block: on for the deployed server, off on local stacks
    // where nearly every account is a test account.
    const excludeTest = testAccountsBlocked();
    const syntheticIds = excludeTest
      ? (await orNull("synthetic-profiles", prisma.userProfile.findMany({ where: { dataOrigin: "SYNTHETIC" }, select: { userId: true } })) ?? []).map((r) => r.userId)
      : [];
    // auth-service owns the test-account rule; null = it could not be read (then only the SYNTHETIC ids are known, as before).
    const authTestIds = excludeTest ? await getAuthTestAccountIds() : [];
    const testIds = [...new Set([...(authTestIds ?? []), ...syntheticIds])];
    const ptUserIds = await orNull("pt-profiles", prisma.userProfile.findMany({ where: { isPT: true }, select: { userId: true } })
      .then((rows) => rows.map((r) => r.userId)));

    const { start, end } = vietnamDayBounds(now);
    const [aggregate, activeContracts, ocrStats, sessionsToday] = await Promise.all([
      // The account numbers are computed in auth-service's database (one POST, ~1 KB back) instead of reading every account:
      // a Lambda answer is capped at ~6 MB and 37k accounts are ~8 MB. Skipped when the test ids are unknown: without them the
      // counts would silently include test accounts.
      authTestIds === null
        ? Promise.resolve(null)
        : orNull("auth-users", authServiceClient
            .forward("post", "/auth/users/dashboard-summary", authHeader,
              { excludeIds: testIds, ptUserIds: ptUserIds ?? [], since: dashboardSince(now).toISOString(), recentLimit: RECENT_USERS_COUNT }, { timeoutMs: 8000 })
            .then(async (r) => {
              const summary = (r.data as any)?.summary as DashboardUserAggregate | undefined;
              if (!summary) throw new Error("auth-service answered without a summary");
              // the newest rows carry the real partner role (owner / manager / receptionist / accountant), which lives in gym-service
              summary.recent = await attachPartnerRoles(summary.recent, (ids) => gymClient.listPartnerRoles(ids, authHeader));
              return summary;
            })),
      orNull("active-contracts", excludeTest ? countActiveContractsExcluding(testIds) : contractRepository.countActive()),
      orNull("ocr-stats", excludeTest
        ? ocrStatsExcluding(testIds, sevenDaysAgo)
        : prisma.inBodyEntry.groupBy({ by: ["status"], where: { createdAt: { gte: sevenDaysAgo } }, _count: true })
          .then((rows) => ({
            total: rows.reduce((acc, r) => acc + r._count, 0),
            extracted: rows.find((r) => r.status === "extracted")?._count ?? 0,
            manual: rows.find((r) => r.status === "manual")?._count ?? 0,
            pending: rows.find((r) => r.status === "pending")?._count ?? 0,
          }))),
      orNull("sessions-today", excludeTest
        ? sessionsTodayExcluding(testIds, start, end)
        // Same rule as the internal today-count: starts today (Vietnam time), not cancelled / unanswered.
        : prisma.session.count({ where: { scheduledStartAt: { gte: start, lt: end }, status: { notIn: ["REQUESTED", "CANCELLED"] } } })),
    ]);
    const body = buildAdminDashboardFromAggregate({ aggregate, ptKnown: ptUserIds !== null, activeContracts, ocrStats, sessionsToday, now });
    res.json({ success: true, data: {
      generatedAt: new Date().toISOString(), responseTimeMs: Date.now() - startedAt, ...body, money: null,
      // how many accounts were left out as test data (null = filter off, or the account list could not be read)
      excludedTestAccounts: excludeTest && authTestIds !== null ? testIds.length : null,
    } });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, "Admin dashboard aggregation failed");
    res.status(500).json({ success: false, error: { code: "DASHBOARD_AGGREGATION_FAILED", message: "Failed to aggregate dashboard data" } });
  }
});

router.get("/system-monitor", ...adminOnly, async (_req: AuthRequest, res: Response) => {
  const startedAt = Date.now();
  try {
    const probes = await systemMonitorService.probeAll();
    const summary = buildMonitorSummary(probes);
    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - startedAt,
        summary: {
          serviceCount: summary.serviceCount, healthyCount: summary.healthyCount, degradedCount: summary.degradedCount,
          downCount: summary.downCount, healthScore: summary.healthScore,
        },
        services: probes,
        recentErrors: summary.recentErrors,
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, "Admin system monitor failed");
    res.status(500).json({ success: false, error: { code: "SYSTEM_MONITOR_FAILED", message: "Failed to probe services" } });
  }
});

export default router;
