import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { templateController } from "../controllers/template.controller";

// Roadmap P2.6 "Workout template sharing/import"
// (docs/features/WORKOUT_TEMPLATE_SHARING_IMPACT_ANALYSIS.md).
const router = Router();

router.get("/mine", authMiddleware, templateController.listMine as any);
router.get("/shared-with-me", authMiddleware, templateController.listSharedWithMe as any);
router.post("/", authMiddleware, templateController.createFromProgram as any);
router.post("/:id/share", authMiddleware, templateController.share as any);
router.post("/:id/import", authMiddleware, templateController.importTemplate as any);

export default router;
