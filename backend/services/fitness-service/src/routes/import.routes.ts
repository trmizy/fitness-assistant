import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { importController } from "../controllers/import.controller";

// Roadmap P2 "Canonical import framework" + P2.1 "Hevy import"
// (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md). The
// larger express.json() body limit this router needs (a CSV export can be
// a few MB of text) is applied in app.ts, scoped to this path only.
const router = Router();

router.get("/", authMiddleware, importController.list as any);
router.post("/hevy/preview", authMiddleware, importController.previewHevy as any);
router.post("/strong/preview", authMiddleware, importController.previewStrong as any);
router.post("/:batchId/commit", authMiddleware, importController.commit as any);
router.post("/:batchId/cancel", authMiddleware, importController.cancel as any);

export default router;
