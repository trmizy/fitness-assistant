import { Router } from "express";
import { aiController } from "../controllers/ai.controller";
import { cycleAnalysisController } from "../controllers/cycle-analysis.controller";
import { cycleAssessmentController } from "../controllers/cycle-assessment.controller";
import { feedbackAnalysisController } from "../controllers/feedback-analysis.controller";
import { clientPlanDraftController } from "../controllers/client-plan-draft.controller";
import { roadmapDraftController } from "../controllers/roadmap-draft.controller";
import { exerciseProgressionExplanationController } from "../controllers/exercise-progression-explanation.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { createRateLimiter } from "../middleware/rate-limit.middleware";
import { validateBody, validateQuery } from "../middleware/validate.middleware";
import {
  AskRequestSchema,
  FeedbackRequestSchema,
  GenerateWorkoutRequestSchema,
  GetConversationsQuerySchema,
} from "../schemas/ai.schemas";
import sessionRoutes from "./session.routes";
import memoryRoutes from "./memory.routes";
import fitnessAgentRoutes from "./fitness-agent.routes";

const router = Router();

// All /ai/* routes require a verified user identity.
router.use(requireAuth);
router.use("/agent", fitnessAgentRoutes);

router.use("/sessions", sessionRoutes);
router.use("/memories", memoryRoutes);

// Restores the old Express gateway's aiAskRateLimiter (20 req/60s/user) now
// that traffic reaches this Lambda directly, without that gateway process in
// front of it — see middleware/rate-limit.middleware.ts's doc comment.
// Mounted after requireAuth: req.context.userId is only trustworthy from
// this point on.
const askRateLimiter = createRateLimiter({
  name: "ai-ask",
  max: Number.parseInt(process.env.AI_ASK_RATE_LIMIT_MAX || "20", 10),
  windowSeconds: Number.parseInt(
    process.env.AI_ASK_RATE_LIMIT_WINDOW_SECONDS || "60",
    10,
  ),
});

router.post(
  "/ask",
  askRateLimiter,
  validateBody(AskRequestSchema),
  aiController.ask,
);

router.post(
  "/ask/stream",
  askRateLimiter,
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

// Second, more conservative tier for endpoints that call the LLM/vision
// model directly and synchronously outside the /ai/ask chat path — a plain
// quick-workout generation, same cost profile as one ask. The vision routes
// (goal-image, image-chat) share this same tier — see fitness-agent.routes.ts.
const expensiveRateLimiter = createRateLimiter({
  name: "ai-expensive",
  max: Number.parseInt(process.env.AI_EXPENSIVE_RATE_LIMIT_MAX || "10", 10),
  windowSeconds: Number.parseInt(
    process.env.AI_EXPENSIVE_RATE_LIMIT_WINDOW_SECONDS || "60",
    10,
  ),
});

router.post(
  "/generate-workout",
  expensiveRateLimiter,
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

// FitnessRoadmap AI Draft generation (Phase B of the roadmap next-phase
// work) — called by fitness-service's POST /fitness-roadmaps/ai-draft.
// Returns a DRAFT phase-sequence proposal only, never persisted here; the
// user/PT must explicitly accept it via fitness-service's own
// POST /fitness-roadmaps/ai-draft/accept before a real FitnessRoadmap row
// is created. See docs/FITNESS_ROADMAP_AI_DRAFT_DESIGN.md.
router.post("/generate-roadmap-draft", roadmapDraftController.generateDraft);

// openGym FINAL P0 CLOSURE PASS — docs/TRAINING_PROGRESSION_ARCHITECTURE.md
// §5. Called by fitness-service's GET /workouts/exercises/:id/progression/
// explanation, an OPTIONAL, separate, slower endpoint the frontend calls
// on demand — never a dependency of the fast, always-available deterministic
// /workouts/exercises/:id/progression endpoint itself. Explains an
// already-computed exercise-progression decision; the response schema has
// no field for a decision/target at all, so there is no code path by which
// this could ever override the deterministic engine's output.
router.post("/explain-exercise-progression", exerciseProgressionExplanationController.explain);

export default router;
