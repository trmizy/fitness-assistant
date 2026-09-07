import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AgentPreferencesSchema, logger } from "@gym-coach/shared";
import { authMiddleware } from "../middleware/auth.middleware";
import { agenticFitnessService } from "../services/agentic-fitness.service";

const router = Router();
router.use(authMiddleware);
const handle = (run: (req: Request, userId: string) => Promise<unknown>) => async (req: Request, res: Response) => {
  const started = Date.now();
  const user = (req as any).user;
  if (!user?.id) return res.status(401).json({ error: "Authentication required" });
  try {
    const result = await run(req, user.id);
    logger.info({ tool: req.route.path, latencyMs: Date.now() - started, status: "success" }, "fitness agent domain tool");
    return res.json(result);
  } catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : error.status ?? 500;
    logger.warn({ tool: req.route.path, latencyMs: Date.now() - started, status }, "fitness agent domain tool failed");
    return res.status(status).json({ error: status >= 500 ? "Service unavailable" : error.message });
  }
};
router.get("/context", handle((_req, id) => agenticFitnessService.context(id)));
router.post("/goal", handle((req, id) => agenticFitnessService.confirmGoal(id, req.body)));
router.post("/candidates", handle((req, id) => agenticFitnessService.candidates(id, req.body)));
router.post("/drafts", handle((req, id) => {
  const data = z.object({ ptId: z.string().uuid(), packageId: z.string().uuid(), preferences: AgentPreferencesSchema, actionId: z.string().uuid() }).strict().parse(req.body);
  return agenticFitnessService.createDraft(id, data.ptId, data.packageId, data.preferences, data.actionId);
}));
router.post("/drafts/:id/confirm", handle((req, id) => {
  const body = z.object({ confirmed: z.literal(true) }).strict().parse(req.body);
  return agenticFitnessService.confirmDraft(id, z.string().uuid().parse(req.params.id), body.confirmed);
}));
export default router;
