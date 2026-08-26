import { Response } from "express";
import { logger } from "@gym-coach/shared";
import type { AuthRequest } from "../middleware/auth.middleware";
import { buildExportData, workoutsToCsv } from "../services/export.service";

// Roadmap P2.5 "Export / data portability"
// (docs/features/JSON_CSV_EXPORT_IMPACT_ANALYSIS.md). Strictly
// read-only — every handler here only ever SELECTs the requesting
// user's own data.
export const exportController = {
  async exportJson(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await buildExportData(req.user!.id);
      res.setHeader("Content-Disposition", `attachment; filename="fitness-assistant-export-${data.exportedAt.slice(0, 10)}.json"`);
      res.json(data);
    } catch (error: any) {
      logger.error({ err: error }, "Error building JSON export");
      res.status(500).json({ error: "Failed to build export" });
    }
  },

  async exportCsv(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await buildExportData(req.user!.id);
      const csv = workoutsToCsv(data.workouts);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="fitness-assistant-workouts-${data.exportedAt.slice(0, 10)}.csv"`);
      res.send(csv);
    } catch (error: any) {
      logger.error({ err: error }, "Error building CSV export");
      res.status(500).json({ error: "Failed to build export" });
    }
  },
};
