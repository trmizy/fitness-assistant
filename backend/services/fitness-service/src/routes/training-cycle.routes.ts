import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { trainingCycleController } from "../controllers/training-cycle.controller";

const router = Router();

// NOTE: named routes must be declared BEFORE /:id to avoid route shadowing
router.post("/", authMiddleware, trainingCycleController.start as any);
router.get("/active", authMiddleware, trainingCycleController.active as any);
router.get("/", authMiddleware, trainingCycleController.list as any);
router.post("/:id/complete", authMiddleware, trainingCycleController.complete as any);
router.post("/:id/cancel", authMiddleware, trainingCycleController.cancel as any);
router.post("/:id/approve", authMiddleware, trainingCycleController.approveDecision as any);

// Adaptive Training Cycle Evaluation additions — additive, existing routes
// above are unchanged.
router.post("/:id/start", authMiddleware, trainingCycleController.startDraft as any);
router.patch("/:id", authMiddleware, trainingCycleController.update as any);
router.get("/:id/progress", authMiddleware, trainingCycleController.progress as any);
router.post("/:id/evaluate", authMiddleware, trainingCycleController.evaluate as any);
router.get("/:id/assessments/latest", authMiddleware, trainingCycleController.latestAssessment as any);
router.get("/:id/assessments", authMiddleware, trainingCycleController.listAssessments as any);
router.post("/:id/recommendation/accept", authMiddleware, trainingCycleController.acceptRecommendation as any);
router.post("/:id/recommendation/reject", authMiddleware, trainingCycleController.rejectRecommendation as any);
router.post("/:id/inbody-links", authMiddleware, trainingCycleController.linkInBodyEntry as any);
router.post("/:id/sessions/:scheduleId/feedback", authMiddleware, trainingCycleController.submitSessionFeedback as any);
router.get("/:id/report", authMiddleware, trainingCycleController.report as any);
router.get("/:id/audit", authMiddleware, trainingCycleController.listRecommendationAudits as any);
router.delete("/:id", authMiddleware, trainingCycleController.remove as any);

router.get("/:id", authMiddleware, trainingCycleController.getById as any);

export default router;
