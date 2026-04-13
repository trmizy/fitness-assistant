import { Router } from 'express';
import { planController } from '../controllers/plan.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import {
  GeneratePlanRequestSchema,
  ExplainPlanRequestSchema,
  AdjustPlanRequestSchema,
} from '../schemas/plan.schemas';

const router = Router();

// All /plans/* routes require a verified user identity.
router.use(requireAuth);

/**
 * POST /plans/workout/generate
 * Queue async plan generation. Returns 202 with planId + jobId.
 * Poll GET /plans/job/:jobId or GET /plans/:planId for status.
 */
router.post(
  '/workout/generate',
  validateBody(GeneratePlanRequestSchema),
  planController.generatePlan,
);

/**
 * GET /plans/current
 * Fetch the authenticated user's most recent COMPLETED plans (up to 10).
 * Register BEFORE /:planId to avoid "current" being matched as a UUID.
 */
router.get('/current', planController.getCurrentPlans);

/**
 * GET /plans/job/:jobId
 * Poll the status of an async plan generation job.
 * Register BEFORE /:planId to avoid "job" prefix being matched as a UUID.
 */
router.get('/job/:jobId', planController.getJobStatus);

/**
 * POST /plans/explain
 * Generate a natural-language explanation for a COMPLETED plan.
 * Accepts optional ?lang=vi|en query parameter.
 */
router.post(
  '/explain',
  validateBody(ExplainPlanRequestSchema),
  planController.explainPlan,
);

/**
 * POST /plans/adjust
 * Queue a new adjusted version of an existing COMPLETED plan.
 */
router.post(
  '/adjust',
  validateBody(AdjustPlanRequestSchema),
  planController.adjustPlan,
);

/**
 * GET /plans/:planId
 * Fetch a single plan by ID (any status).
 */
router.get('/:planId', planController.getPlanById);

export default router;
