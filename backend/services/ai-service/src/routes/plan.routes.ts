import { Router } from "express";
import { planController } from "../controllers/plan.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/requireRole.middleware";
import { validateBody } from "../middleware/validate.middleware";
import {
  GeneratePlanRequestSchema,
  ExplainPlanRequestSchema,
  AdjustPlanRequestSchema,
  SavePlanToWorkoutLogRequestSchema,
} from "../schemas/plan.schemas";
import {
  GenerateNutritionPlanRequestSchema,
  SaveNutritionPlanToNutritionRequestSchema,
} from "../schemas/nutrition-plan.schemas";

const router = Router();

// All /plans/* routes require a verified user identity.
router.use(requireAuth);

/**
 * GET /plans/llm-health
 * Preflight check used by the UI before starting LLM-backed actions.
 */
router.get("/llm-health", planController.getLlmHealth);

/**
 * POST /plans/nutrition/:planId/explain
 * Generate a natural-language explanation for a COMPLETED nutrition plan.
 */
router.post("/nutrition/:planId/explain", planController.explainNutritionPlan);

/**
 * POST /plans/nutrition/:planId/adjust
 * Queue an adjusted version of an existing COMPLETED nutrition plan.
 */
router.post("/nutrition/:planId/adjust", planController.adjustNutritionPlan);

/**
 * DELETE /plans/nutrition/:planId
 * Soft-archive a nutrition plan.
 */
router.delete("/nutrition/:planId", planController.archiveNutritionPlan);

/**
 * POST /plans/nutrition/generate
 * Queues a background job to generate an AI Nutrition Plan.
 */
router.post(
  "/nutrition/generate",
  (req, res, next) => {
    const durationWeeks = req.body?.durationWeeks;
    if (durationWeeks !== undefined && Number(durationWeeks) > 1) {
      res.status(400).json({
        success: false,
        error: {
          code: "NUTRITION_PLAN_DURATION_LIMIT",
          message: "Kế hoạch dinh dưỡng AI hiện chỉ hỗ trợ tối đa 1 tuần.",
        },
      });
      return;
    }
    next();
  },
  validateBody(GenerateNutritionPlanRequestSchema),
  planController.generateNutritionPlan,
);

/**
 * GET /plans/nutrition/current
 * Fetch the authenticated user's most recent nutrition plans.
 */
router.get("/nutrition/current", planController.getCurrentNutritionPlans);

/**
 * POST /plans/workout/generate
 * Queue async plan generation. Returns 202 with planId + jobId.
 * Poll GET /plans/job/:jobId or GET /plans/:planId for status.
 */
router.post(
  "/workout/generate",
  validateBody(GeneratePlanRequestSchema),
  planController.generatePlan,
);

/**
 * GET /plans/current
 * Fetch the authenticated user's most recent COMPLETED plans (up to 10).
 * Register BEFORE /:planId to avoid "current" being matched as a UUID.
 */
router.get("/current", planController.getCurrentPlans);

/**
 * GET /plans/job/:jobId
 * Poll the status of an async plan generation job.
 * Register BEFORE /:planId to avoid "job" prefix being matched as a UUID.
 */
router.get("/job/:jobId", planController.getJobStatus);

/**
 * POST /plans/explain
 * Generate a natural-language explanation for a COMPLETED plan.
 * Accepts optional ?lang=vi|en query parameter.
 */
router.post(
  "/explain",
  validateBody(ExplainPlanRequestSchema),
  planController.explainPlan,
);

/**
 * POST /plans/adjust
 * Queue a new adjusted version of an existing COMPLETED plan.
 */
router.post(
  "/adjust",
  validateBody(AdjustPlanRequestSchema),
  planController.adjustPlan,
);

/**
 * GET /plans/pt/pending-review
 * PT fetches plans pending their review.
 * MUST be before /:planId to avoid "pt" being matched as a planId.
 */
router.get(
  "/pt/pending-review",
  requireRole(["PT"]),
  planController.getPTPendingReviews,
);

/**
 * POST /plans/:planId/pt-review
 * PT submits approve/reject decision on a plan.
 */
router.post(
  "/:planId/pt-review",
  requireRole(["PT"]),
  planController.submitPTReview,
);

/**
 * DELETE /plans/:planId
 * Soft-archive a plan without removing workout history.
 */
router.delete("/:planId", planController.archivePlan);

/**
 * POST /plans/:planId/save-to-workout-log
 * Persist a COMPLETED AI plan into the user's workout schedule.
 */
router.post(
  "/:planId/save-to-workout-log",
  validateBody(SavePlanToWorkoutLogRequestSchema),
  planController.savePlanToWorkoutLog,
);

/**
 * POST /plans/:planId/save-to-nutrition
 * Persist a COMPLETED AI plan into the user's nutrition schedule.
 */
router.post(
  "/:planId/save-to-nutrition",
  validateBody(SaveNutritionPlanToNutritionRequestSchema),
  planController.saveNutritionPlan,
);

router.post(
  "/nutrition/:planId/save-to-nutrition",
  validateBody(SaveNutritionPlanToNutritionRequestSchema),
  planController.saveNutritionPlan,
);

/**
 * GET /plans/:planId
 * Fetch a single plan by ID (any status).
 */
router.get("/:planId", planController.getPlanById);

export default router;
