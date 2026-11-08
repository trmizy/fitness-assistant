import { Router, Response } from "express";
import { logger, testAccountsBlocked } from "@gym-coach/shared";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";
import { authServiceClient } from "../clients/auth-service.client";
import { contractRepository } from "../repositories/contract.repository";
import { prisma } from "../repositories/profile.repository";
import { buildAdminDashboard, excludeTestAccounts, vietnamDayBounds, type DashboardAuthUser } from "../services/admin-dashboard.service";
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
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // Test/seed/eval accounts (reserved test email domains, or a profile marked SYNTHETIC) are left out of every number on
    // the server dashboard (2026-11-08). Same switch as the sign-up block: on for the deployed server, off on local stacks
    // where nearly every account is a test account.
    const excludeTest = testAccountsBlocked();
    const allUsers = await orNull("auth-users", authServiceClient.forward("get", "/auth/users", authHeader, undefined, { timeoutMs: 8000 })
      .then((r) => ((r.data as any)?.users ?? []) as DashboardAuthUser[]));
    const syntheticIds = excludeTest
      ? (await orNull("synthetic-profiles", prisma.userProfile.findMany({ where: { dataOrigin: "SYNTHETIC" }, select: { userId: true } })) ?? []).map((r) => r.userId)
      : [];
    const { users, testIds } = excludeTest ? excludeTestAccounts(allUsers, syntheticIds) : { users: allUsers, testIds: [] as string[] };
    const notTest = testIds.length ? { notIn: testIds } : undefined;
    const [ptUserIds, activeContracts, ocrStats, sessionsToday] = await Promise.all([
      orNull("pt-profiles", prisma.userProfile.findMany({ where: { isPT: true, ...(notTest ? { userId: notTest } : {}) }, select: { userId: true } })
        .then((rows) => rows.map((r) => r.userId))),
      orNull("active-contracts", excludeTest
        ? prisma.contract.count({ where: { status: "ACTIVE", dataOrigin: { not: "SYNTHETIC" }, ...(notTest ? { clientUserId: notTest, ptUserId: notTest } : {}) } })
        : contractRepository.countActive()),
      orNull("ocr-stats", prisma.inBodyEntry.groupBy({ by: ["status"], where: { createdAt: { gte: sevenDaysAgo }, ...(notTest ? { userId: notTest } : {}) }, _count: true })
        .then((rows) => ({
          total: rows.reduce((acc, r) => acc + r._count, 0),
          extracted: rows.find((r) => r.status === "extracted")?._count ?? 0,
          manual: rows.find((r) => r.status === "manual")?._count ?? 0,
          pending: rows.find((r) => r.status === "pending")?._count ?? 0,
        }))),
      orNull("sessions-today", (async () => {
        // Same rule as the internal today-count: starts today (Vietnam time), not cancelled / unanswered.
        const { start, end } = vietnamDayBounds(new Date());
        return prisma.session.count({ where: { scheduledStartAt: { gte: start, lt: end }, status: { notIn: ["REQUESTED", "CANCELLED"] }, ...(notTest ? { clientUserId: notTest, ptUserId: notTest } : {}) } });
      })()),
    ]);
    const body = buildAdminDashboard({ users, ptUserIds, activeContracts, ocrStats, sessionsToday });
    res.json({ success: true, data: {
      generatedAt: new Date().toISOString(), responseTimeMs: Date.now() - startedAt, ...body, money: null,
      // how many accounts were left out as test data (null = filter off, or the user list could not be read)
      excludedTestAccounts: excludeTest && allUsers !== null ? testIds.length : null,
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
