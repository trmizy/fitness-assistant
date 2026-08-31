import { Response } from "express";
import { logger } from "@gym-coach/shared";
import type { AuthRequest } from "../middleware/auth.middleware";
import { getCatalogQualityMatrix } from "../services/catalog-quality.service";

// Roadmap P1.8 "Logging-mode catalog discoverability" — admin-only, same
// role check as Gate 7's review queue (exercise-review.controller.ts).
function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ error: "Admin role required" });
    return false;
  }
  return true;
}

export const catalogQualityController = {
  async getMatrix(req: AuthRequest, res: Response): Promise<void> {
    if (!requireAdmin(req, res)) return;
    try {
      const { loggingMode, status, search, page, limit } = req.query as Record<string, string>;
      const result = await getCatalogQualityMatrix({ loggingMode, status, search, page, limit });
      res.json(result);
    } catch (error: any) {
      logger.error({ err: error }, "Error building catalog quality matrix");
      res.status(500).json({ error: "Failed to build catalog quality matrix" });
    }
  },
};
