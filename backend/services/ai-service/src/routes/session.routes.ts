import { Router } from "express";
import { sessionController } from "../controllers/session.controller";
import { validateBody, validateQuery } from "../middleware/validate.middleware";
import {
  RenameSessionRequestSchema,
  GetSessionsQuerySchema,
} from "../schemas/session.schemas";

const router = Router();

// Mounted under /ai/sessions by ai.routes.ts — inherits requireAuth from there.
router.get("/", validateQuery(GetSessionsQuerySchema), sessionController.list);
router.get("/:sessionId/messages", sessionController.getMessages);
router.patch(
  "/:sessionId",
  validateBody(RenameSessionRequestSchema),
  sessionController.rename,
);
router.delete("/:sessionId", sessionController.archive);

export default router;
