import { Router } from "express";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import { authMiddleware, type AuthRequest } from "../middleware/auth.middleware";
import { nutritionAgentService } from "../services/nutrition-agent.service";

const router = Router();
router.use(authMiddleware);

const substituteSchema = z
  .object({
    currentFoodMention: z.string().min(1).max(200),
    desiredFoodMention: z.string().min(1).max(200).nullable().optional(),
    mode: z.enum(["REPLACE", "CHEAPER", "HIGHER_PROTEIN", "VEGETARIAN"]).optional(),
    mealHint: z.string().min(1).max(200).nullable().optional(),
    resolvedMealId: z.string().uuid().nullable().optional(),
  })
  .strict();

router.post("/substitute-meal-item", async (req: AuthRequest, res) => {
  if (!req.user?.id) return res.status(401).json({ error: "Authentication required" });
  try {
    const input = substituteSchema.parse(req.body);
    const result = await nutritionAgentService.substituteMealItem(req.user.id, input);
    logger.info({ tool: "substituteMealItem", status: result.status }, "fitness agent tool");
    return res.json(result);
  } catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : (error.status ?? 500);
    return res.status(status).json({ error: status >= 500 ? "Service unavailable" : error.message });
  }
});

export default router;
