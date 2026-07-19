import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { trainingCycleController } from "../controllers/training-cycle.controller";

const router = Router();

// NOTE: named routes must be declared BEFORE /:id to avoid route shadowing
router.post("/", authMiddleware, trainingCycleController.start as any);
router.get("/active", authMiddleware, trainingCycleController.active as any);
router.get("/", authMiddleware, trainingCycleController.list as any);
router.post("/:id/complete", authMiddleware, trainingCycleController.complete as any);
router.post("/:id/approve", authMiddleware, trainingCycleController.approveDecision as any);
router.get("/:id", authMiddleware, trainingCycleController.getById as any);

export default router;
