import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { fitnessRoadmapController } from "../controllers/fitness-roadmap.controller";

const router = Router();

router.post("/", authMiddleware, fitnessRoadmapController.create as any);
// Gymini Guided Roadmap Creation — read-only, must stay above /:roadmapId
// (not that it collides on method/path here, but keeping all top-level
// literal routes grouped before the param routes for readability).
router.post("/diagnosis", authMiddleware, fitnessRoadmapController.diagnosis as any);
// Gymini Roadmap Projection & Strategy Report Hardening — read-only.
router.post("/projection", authMiddleware, fitnessRoadmapController.projection as any);
router.post("/ai-draft", authMiddleware, fitnessRoadmapController.generateAiDraft as any);
router.post("/ai-draft/accept", authMiddleware, fitnessRoadmapController.acceptAiDraft as any);
router.get("/current", authMiddleware, fitnessRoadmapController.current as any);
router.get("/draft/current", authMiddleware, fitnessRoadmapController.currentDraft as any);
// Gymini Adaptive Forecast Reconciliation — read-only.
router.get("/current/forecast", authMiddleware, fitnessRoadmapController.currentForecast as any);
router.post("/:roadmapId/phases", authMiddleware, fitnessRoadmapController.addPhase as any);
router.post("/:roadmapId/activate", authMiddleware, fitnessRoadmapController.activate as any);
router.post("/:roadmapId/phases/:phaseId/activate", authMiddleware, fitnessRoadmapController.activatePhase as any);
router.post("/:roadmapId/advance", authMiddleware, fitnessRoadmapController.advance as any);
router.post("/:roadmapId/rebuild/preview", authMiddleware, fitnessRoadmapController.previewRebuild as any);
router.post("/:roadmapId/rebuild/apply", authMiddleware, fitnessRoadmapController.applyRebuild as any);
router.post("/:roadmapId/archive", authMiddleware, fitnessRoadmapController.archive as any);
router.get("/:roadmapId", authMiddleware, fitnessRoadmapController.getById as any);

export default router;
