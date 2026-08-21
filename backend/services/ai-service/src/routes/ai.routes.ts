import { Router } from "express";
import { aiController } from "../controllers/ai.controller";
import { cycleAnalysisController } from "../controllers/cycle-analysis.controller";
import { cycleAssessmentController } from "../controllers/cycle-assessment.controller";
import { feedbackAnalysisController } from "../controllers/feedback-analysis.controller";
import { clientPlanDraftController } from "../controllers/client-plan-draft.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validateBody, validateQuery } from "../middleware/validate.middleware";
import {
  AskRequestSchema,
  FeedbackRequestSchema,
  GenerateWorkoutRequestSchema,
  GetConversationsQuerySchema,
} from "../schemas/ai.schemas";
import sessionRoutes from "./session.routes";
import memoryRoutes from "./memory.routes";

const router = Router();

// All /ai/* routes require a verified user identity.
router.use(requireAuth);

router.use("/sessions", sessionRoutes);
router.use("/memories", memoryRoutes);

router.post("/ask", validateBody(AskRequestSchema), aiController.ask);

router.post(
  "/ask/stream",
  validateBody(AskRequestSchema),
  aiController.askStream,
);

router.get(
  "/conversations",
  validateQuery(GetConversationsQuerySchema),
  aiController.getConversations,
);

router.post(
  "/feedback",
  validateBody(FeedbackRequestSchema),
  aiController.submitFeedback,
);

router.get("/feedback/stats", aiController.getFeedbackStats);

router.post(
  "/generate-workout",
  validateBody(GenerateWorkoutRequestSchema),
  aiController.generateWorkout,
);

// NOTE: POST /ai/generate-plan has been removed.
// Use POST /plans/workout/generate instead (single canonical endpoint).

// Called by fitness-service (service-to-service, requireAuth accepts the
// x-internal-token + x-user-id pair) after a training cycle completes.
router.post("/analyze-cycle", cycleAnalysisController.analyzeCycle);

// Adaptive Training Cycle Evaluation — called by fitness-service's
// POST /training-cycles/:id/evaluate with an already-computed Decision
// Engine result; this endpoint only explains it, never decides. Additive:
// does not replace /analyze-cycle, which the legacy /complete flow still
// calls unchanged.
router.post("/assess-cycle", cycleAssessmentController.assessCycle);

// Phase 4 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — called by
// fitness-service with an already-computed (rule-based, no AI)
// CycleFeedbackSummary; this endpoint only interprets/explains it, never
// decides. Advisory-only signal, consumed by the Decision Engine (Phase 5)
// as one input among several, never as the final decision.
router.post("/analyze-feedback", feedbackAnalysisController.analyzeFeedback);

// Phase 7 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — called by
// fitness-service's coach.service.ts when a PT clicks "Gợi ý bằng AI" while
// building a plan for a client. Returns a DRAFT only — never persisted as a
// real plan here; the PT must review/edit and explicitly submit via the
// existing POST /coach/clients/:clientId/plans.
router.post("/generate-client-plan-draft", clientPlanDraftController.generateDraft);

export default router;
