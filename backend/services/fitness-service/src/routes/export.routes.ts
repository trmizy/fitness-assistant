import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { exportController } from "../controllers/export.controller";

// Roadmap P2.5 "Export / data portability"
// (docs/features/JSON_CSV_EXPORT_IMPACT_ANALYSIS.md).
const router = Router();

router.get("/json", authMiddleware, exportController.exportJson as any);
router.get("/csv", authMiddleware, exportController.exportCsv as any);

export default router;
