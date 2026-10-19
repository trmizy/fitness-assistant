import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { clientErrorMessage } from "../utils/db-error.util";
import { adminReconciliationService } from "../services/admin-reconciliation.service";

/** Positive integer from a query string value, or undefined (the service clamps and defaults). */
function intParam(v: unknown): number | undefined {
  if (typeof v !== "string" || !/^\d{1,9}$/.test(v)) return undefined;
  return Number(v);
}

export const adminReconciliationController = {
  /**
   * GET /admin/sessions/reconciliation?limit=&endingMinAgeMinutes=&endedMinAgeMinutes=
   * FH-4 part 1: read-only. The role check is router-level (admin.routes.ts) AND repeated here on x-user-role, so the handler
   * never runs for anybody else even if the route is mounted somewhere else later.
   */
  async get(req: any, res: Response) {
    if (req.headers["x-user-role"] !== "ADMIN") return res.status(403).json({ error: "Permission denied" });
    try {
      const report = await adminReconciliationService.report({
        limit: intParam(req.query.limit),
        endingMinAgeMinutes: intParam(req.query.endingMinAgeMinutes),
        endedMinAgeMinutes: intParam(req.query.endedMinAgeMinutes),
      });
      res.set("Cache-Control", "no-store");
      return res.json(report);
    } catch (error: any) {
      logger.error(error, "Admin reconciliation report error");
      return res.status(error.status || 500).json({ error: clientErrorMessage(error, "Không tải được báo cáo đối soát. Vui lòng thử lại.") });
    }
  },
};
