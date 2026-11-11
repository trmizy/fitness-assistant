import { Router, Response } from "express";
import { logger } from "@gym-coach/shared";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";
import { authServiceClient } from "../clients/auth-service.client";
import { contractRepository } from "../repositories/contract.repository";

/**
 * Admin user management on AWS. The web admin UI calls GET /admin/users and
 * PATCH /admin/users/:id/{role,enable,disable}; locally those are aggregation routes inside
 * backend/gateway, which does not exist on AWS (API Gateway routes /admin/* straight to this
 * Lambda), so the page answered 404 ("Failed to load users"). Same response shapes as the gateway
 * (backend/gateway/src/routes/proxy.routes.ts), data from auth-service (users) and the local
 * contract repository (counts). Every mutation is forwarded with the admin's own Authorization
 * header, so auth-service still enforces its own rules (CANNOT_DISABLE_SELF, LAST_ADMIN, ...).
 */
const router = Router();
const adminOnly = [authMiddleware, roleMiddleware(["ADMIN"])];

type AuthUser = {
  id: string; email: string; firstName?: string | null; lastName?: string | null;
  role: string; isActive?: boolean | null; createdAt: string; updatedAt: string;
};

const roleLabel = (role: string | null | undefined) =>
  role === "ADMIN" ? "Admin" : role === "PT" ? "PT" : role === "GYM_OWNER" ? "Gym Owner" : "Client";

router.get("/users", ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization as string;
    const [usersRes, contractsRes] = await Promise.allSettled([
      authServiceClient.forward("get", "/auth/users", authHeader, undefined, { timeoutMs: 8000 }),
      (async () => {
        // [seed-discovery X] findAll/countByUsers filter dataOrigin="REAL"; drop 10k truncation
        const all = await contractRepository.findAll(0);
        const ids = [...new Set([...all.map((c) => c.ptUserId), ...all.map((c) => c.clientUserId)])];
        return contractRepository.countByUsers(ids);
      })(),
    ]);
    if (usersRes.status === "rejected") {
      logger.error({ err: (usersRes.reason as Error)?.message }, "Admin users: auth-service list failed");
      res.status(502).json({ success: false, error: { code: "ADMIN_USERS_FAILED", message: "Failed to fetch user list" } });
      return;
    }
    const authUsers = ((usersRes.value.data as any)?.users ?? []) as AuthUser[];
    const summary = (contractsRes.status === "fulfilled" ? contractsRes.value : {}) as Record<string, number>;
    const fmt = (iso: string, withYear: boolean) =>
      new Date(iso).toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
    const users = authUsers.map((u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email.split("@")[0],
      email: u.email,
      role: roleLabel(u.role),
      status: u.isActive === false ? "Inactive" : "Active",
      joined: fmt(u.createdAt, true),
      lastActive: fmt(u.updatedAt, false),
      sessions: 0,
      contracts: summary[u.id] ?? 0,
    }));
    res.json({ success: true, data: { total: users.length, users } });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, "Admin users aggregation failed");
    res.status(500).json({ success: false, error: { code: "ADMIN_USERS_FAILED", message: "Failed to fetch user list" } });
  }
});

function forwardMutation(action: "role" | "enable" | "disable") {
  return async (req: AuthRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const body =
        action === "role"
          ? { role: req.body?.role }
          : typeof req.body?.reason === "string" ? { reason: req.body.reason } : {};
      const r = await authServiceClient.forward(
        "patch", `/auth/users/${encodeURIComponent(userId)}/${action}`, req.headers.authorization as string, body, { timeoutMs: 8000 },
      );
      res.json({ success: true, data: r.data });
    } catch (err: any) {
      const status = err?.response?.status ?? 502;
      logger.warn({ action, status }, "Admin user mutation failed");
      res.status(status).json({
        success: false,
        error: {
          code: err?.response?.data?.code ?? `${action.toUpperCase()}_FAILED`,
          message: err?.response?.data?.error ?? `Failed to ${action === "role" ? "update user role" : `${action} user`}`,
        },
      });
    }
  };
}

router.patch("/users/:userId/role", ...adminOnly, forwardMutation("role"));
router.patch("/users/:userId/enable", ...adminOnly, forwardMutation("enable"));
router.patch("/users/:userId/disable", ...adminOnly, forwardMutation("disable"));

export default router;
