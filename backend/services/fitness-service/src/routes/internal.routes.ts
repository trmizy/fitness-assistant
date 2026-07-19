import { Router } from "express";
import { internalController } from "../controllers/internal.controller";
import { internalAuthMiddleware } from "../middleware/auth.middleware";

const router = Router();

// Only internal services with the internal token may call these endpoints
router.get(
  "/exercises/for-ai-plans",
  internalAuthMiddleware,
  internalController.exercisesForAiPlans as any,
);
router.get(
  "/foods/for-ai-nutrition",
  internalAuthMiddleware,
  internalController.foodsForAiNutrition as any,
);
router.get(
  "/training-cycles/completed",
  internalAuthMiddleware,
  internalController.hasCompletedCycleForPlan as any,
);
router.get(
  "/training-cycles/latest-closed",
  internalAuthMiddleware,
  internalController.getLatestClosedCycle as any,
);

export default router;
