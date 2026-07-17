import { Router } from "express";
import { aiController } from "../controllers/ai.controller";
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

export default router;
