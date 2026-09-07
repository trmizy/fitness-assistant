import { Router } from "express";
import { z } from "zod";
import { AgentPreferencesSchema, logger } from "@gym-coach/shared";
import { authMiddleware, type AuthRequest } from "../middleware/auth.middleware";
import { agentProgramService } from "../services/agent-program.service";

const router = Router();
router.use(authMiddleware);
const handler = (apply: boolean) => async (req: AuthRequest, res: any) => {
  if (!req.user?.id) return res.status(401).json({ error: "Authentication required" });
  try {
    const result = apply ? await agentProgramService.apply(req.user.id, z.object({
      templateId: z.string().uuid(), actionId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), preferences: AgentPreferencesSchema, confirmed: z.literal(true),
    }).strict().parse(req.body)) : await agentProgramService.candidates(req.user.id, req.body);
    logger.info({ tool: apply ? "applyTrainingPlan" : "findTrainingPrograms", status: "success" }, "fitness agent tool");
    return res.json(result);
  } catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : error.status ?? 500;
    return res.status(status).json({ error: status >= 500 ? "Service unavailable" : error.message });
  }
};
router.post("/candidates", handler(false));
router.post("/apply", handler(true));
export default router;
