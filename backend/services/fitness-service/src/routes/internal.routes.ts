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
router.post(
  "/exercises/validate-plan-equipment",
  internalAuthMiddleware,
  internalController.validatePlanEquipment as any,
);
router.post(
  "/workouts/manual-program",
  internalAuthMiddleware,
  internalController.commitManualProgram as any,
);
router.post(
  "/exercises/validate-marketplace-schedules",
  internalAuthMiddleware,
  internalController.validateMarketplaceSchedules as any,
);
// AI Nutrition Cycle Engine (Gymini) — called by user-service right after
// onboarding completes (see profileService.upsertProfile).
router.post(
  "/onboarding/bootstrap-nutrition",
  internalAuthMiddleware,
  internalController.bootstrapNutrition as any,
);
// AI Nutrition Cycle Engine (Gymini) Phase 3 — called by user-service right
// after a new InBody entry is recorded (create or update).
router.post(
  "/inbody/reassessment-check",
  internalAuthMiddleware,
  internalController.checkInBodyReassessment as any,
);

export default router;
