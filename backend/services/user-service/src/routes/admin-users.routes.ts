import { Router, Response } from "express";
import { logger } from "@gym-coach/shared";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";
import { authServiceClient } from "../clients/auth-service.client";
import { contractRepository } from "../repositories/contract.repository";
import { gymClient } from "../clients/gym.client";
import { listAdminUsers } from "../services/admin-users-list.service";

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

/**
 * FIX5-ADMIN-PERF port: the answer is ALWAYS one page; filtering (role, status, search, partnerRole, id, ids) and the slicing happen in
 * auth-service's database, and only that page is enriched. See services/admin-users-list.service.ts. The caller's own Authorization
 * header goes to auth-service and gym-service, which re-check the admin role themselves.
 */
router.get("/users", ...adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization as string;
    const answer = await listAdminUsers(req.query as Record<string, unknown>, {
      listAuthUsers: async (params) =>
        (await authServiceClient.forward("get", "/auth/users", authHeader, undefined, { timeoutMs: 8000, query: params })).data ?? {},
      partnerRoles: (ids) => gymClient.listPartnerRoles(ids, authHeader),
      contractCounts: (ids) => contractRepository.countByUsers(ids),
    });
    for (const [k, v] of Object.entries(answer.headers ?? {})) res.setHeader(k, v);
    res.status(answer.status).json(answer.body);
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, "Admin users aggregation failed");
    res.status(502).json({ success: false, error: { code: "ADMIN_USERS_FAILED", message: "Không tải được danh sách người dùng" } });
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
