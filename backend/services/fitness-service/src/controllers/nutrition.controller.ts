import { Response } from "express";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import { nutritionService } from "../services/nutrition.service";
import {
  createNutritionSchema,
  upsertNutritionGoalSchema,
} from "../models/fitness.models";
import { resolveNutritionTargetForUser } from "../services/nutrition-onboarding-bootstrap.service";
import type { AuthRequest } from "../middleware/auth.middleware";

const foodSubstituteSchema = z.object({
  foodId: z.string().optional().nullable(),
  foodName: z.string().min(1),
  quantityG: z.number().positive(),
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  mode: z.enum(["REPLACE", "CHEAPER", "HIGHER_PROTEIN", "VEGETARIAN"]),
});

export const nutritionController = {
  async listLogs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { startDate, endDate, mealType } = req.query as Record<
        string,
        string
      >;
      const logs = await nutritionService.listLogs(req.user!.id, {
        startDate,
        endDate,
        mealType,
      });
      res.json(logs);
    } catch (error) {
      logger.error("Error fetching nutrition logs:", error);
      res.status(500).json({ error: "Failed to fetch nutrition logs" });
    }
  },

  async createLog(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = createNutritionSchema.parse(req.body);
      const log = await nutritionService.createLog(req.user!.id, data);
      res.status(201).json(log);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Validation failed", details: error.errors });
        return;
      }
      logger.error("Error creating nutrition log:", error);
      res.status(500).json({ error: "Failed to create nutrition log" });
    }
  },

  async deleteLog(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await nutritionService.deleteLog(
        req.params.id,
        req.user!.id,
      );
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error deleting nutrition log:", error);
      res.status(500).json({ error: "Failed to delete nutrition log" });
    }
  },

  // PATCH /nutrition/:id — owner-only partial update (snapshot model).
  async updateLog(req: AuthRequest, res: Response): Promise<void> {
    try {
      const log = await nutritionService.updateLog(
        req.params.id,
        req.user!.id,
        req.body,
      );
      res.json(log);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error updating nutrition log:", error);
      res.status(500).json({ error: "Failed to update nutrition log" });
    }
  },

  async getGoal(req: AuthRequest, res: Response): Promise<void> {
    try {
      const goal = await nutritionService.getGoal(req.user!.id);
      res.json(goal);
    } catch (error) {
      logger.error("Error fetching nutrition goal:", error);
      res.status(500).json({ error: "Failed to fetch nutrition goal" });
    }
  },

  // Read-only authoritative target for AI-Coach standalone nutrition generation
  // (ai-service fitness-agent.service.ts::proposeNutritionPlan) — see
  // resolveNutritionTargetForUser. Never writes.
  async getTargetPreview(req: AuthRequest, res: Response): Promise<void> {
    try {
      res.json(await resolveNutritionTargetForUser(req.user!.id));
    } catch (error) {
      logger.error("Error resolving nutrition target preview:", error);
      res.status(500).json({ error: "Failed to resolve nutrition target" });
    }
  },

  async getGoalHistory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const history = await nutritionService.getGoalHistory(req.user!.id);
      res.json({ history });
    } catch (error) {
      logger.error("Error fetching nutrition goal history:", error);
      res.status(500).json({ error: "Failed to fetch nutrition goal history" });
    }
  },

  // Goal <-> Plan sync gap (docs/audit/nutrition-ai-current-flow-audit.md,
  // câu 6) — read-only, never archives/regenerates anything.
  async getActiveState(req: AuthRequest, res: Response): Promise<void> {
    try {
      const consistency = await nutritionService.getGoalPlanConsistency(req.user!.id);
      res.json(consistency);
    } catch (error) {
      logger.error("Error computing nutrition goal/plan consistency:", error);
      res.status(500).json({ error: "Failed to compute nutrition active state" });
    }
  },

  async upsertGoal(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = upsertNutritionGoalSchema.parse(req.body);
      // Now returns { goal, planConsistency } — planConsistency lets the
      // UI immediately warn if this newly-saved goal makes the user's
      // active plan stale, instead of the mismatch only surfacing later.
      const result = await nutritionService.upsertGoal(req.user!.id, data);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Validation failed", details: error.errors });
        return;
      }
      // Typed {status, message, code} throws (e.g. macro/calorie
      // consistency check) — surface the real, actionable message instead
      // of collapsing every non-Zod error into a generic 500.
      if (error && typeof error.status === "number") {
        res
          .status(error.status)
          .json({ error: error.message, code: error.code });
        return;
      }
      logger.error("Error saving nutrition goal:", error);
      res.status(500).json({ error: "Failed to save nutrition goal" });
    }
  },

  async importAiPlan(req: AuthRequest, res: Response): Promise<void> {
    try {
      // The user id either comes from auth header or internal header, set by internalAuthMiddleware
      const userId = (req.headers["x-user-id"] as string) || req.user!.id;

      const payload = req.body;
      if (!payload.sourcePlanId || !payload.weeklySchedule) {
        res.status(400).json({
          success: false,
          error: "Missing sourcePlanId or weeklySchedule",
        });
        return;
      }

      const result = await nutritionService.importAiPlan(userId, payload);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err: error }, "Error importing AI nutrition plan");
      res
        .status(500)
        .json({ success: false, error: "Failed to import AI nutrition plan" });
    }
  },

  async deletePlanMeal(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await nutritionService.deletePlanMeal(
        req.params.mealId,
        req.user!.id,
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err: error }, "Error deleting plan meal");
      res.status(500).json({ success: false, error: "Failed to delete meal" });
    }
  },

  async deactivateNutritionProgram(
    req: AuthRequest,
    res: Response,
  ): Promise<void> {
    try {
      const result = await nutritionService.deactivateNutritionProgram(
        req.params.programId,
        req.user!.id,
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err: error }, "Error deactivating nutrition program");
      res
        .status(500)
        .json({ success: false, error: "Failed to deactivate program" });
    }
  },

  async getMonthlySummary(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { startDate, endDate } = req.query as Record<string, string>;
      if (!startDate || !endDate) {
        res
          .status(400)
          .json({ error: "startDate and endDate are required (YYYY-MM-DD)" });
        return;
      }
      const result = await nutritionService.getMonthlySummary(
        req.user!.id,
        startDate,
        endDate,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error({ err: error }, "Error fetching monthly nutrition summary");
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch monthly summary" });
    }
  },

  async getDailyTask(req: AuthRequest, res: Response): Promise<void> {
    try {
      const date =
        (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const result = await nutritionService.getDailyTask(req.user!.id, date);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error({ err: error }, "Error fetching daily nutrition task");
      res.status(500).json({
        success: false,
        error: "Failed to fetch daily nutrition task",
      });
    }
  },

  // AI Nutrition Cycle Engine (Gymini) — Phase 2 §VI: persist a food
  // suggestion the user tapped "Thêm bữa này" on. Real writes, not a fake
  // success toast — see nutritionService.applyFoodSuggestion's doc comment.
  async applyFoodSuggestion(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { date, items } = req.body as {
        date?: string;
        items?: Array<{ foodName: string; quantityG: number; calories: number; protein: number; carbs: number; fat: number }>;
      };
      const dateStr = date || new Date().toISOString().slice(0, 10);
      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, error: "items is required" });
        return;
      }
      const result = await nutritionService.applyFoodSuggestion(req.user!.id, dateStr, items);
      res.status(201).json({ success: true, data: { created: result.length } });
    } catch (error: any) {
      if (error?.status) {
        res.status(error.status).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err: error }, "Error applying food suggestion");
      res.status(500).json({ success: false, error: "Failed to apply food suggestion" });
    }
  },

  // Smart Substitute variants (Production Hardening report §16) — "Đổi
  // món" / "Rẻ hơn" / "Nhiều đạm hơn" / "Món chay" for a single food item
  // (from a suggestion option or an already-logged item), region- and
  // dietary-preference-aware. Deterministic, no LLM call — see
  // nutrition-food-substitution.engine.ts.
  async getFoodSubstitute(req: AuthRequest, res: Response): Promise<void> {
    try {
      const parsed = foodSubstituteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid substitute request", details: parsed.error.errors });
        return;
      }
      const { mode, ...item } = parsed.data;
      const result = await nutritionService.getFoodSubstitute(req.user!.id, item, mode);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error?.status) {
        res.status(error.status).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err: error }, "Error finding food substitute");
      res.status(500).json({ success: false, error: "Failed to find food substitute" });
    }
  },

  // AI Nutrition Cycle Engine (Gymini) — Phase 2 canonical consumption
  // history, for any consumer (currently: none wired yet — see
  // nutrition-onboarding-bootstrap report §21) that needs "what did this
  // user actually eat over the last N days" using the SAME totals the
  // dashboard shows, never a second independently-computed number.
  async getDailyConsumptionHistory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const days = req.query.days ? Number(req.query.days) : 7;
      const result = await nutritionService.getDailyConsumptionHistory(req.user!.id, days);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error({ err: error }, "Error fetching daily consumption history");
      res.status(500).json({
        success: false,
        error: "Failed to fetch daily consumption history",
      });
    }
  },

  // AI Nutrition Cycle Engine (Gymini) — spec §XII/§XIII: translate "you
  // have 450 kcal and 35g protein left" into concrete, budget-aware food
  // combos. `budgetLevel` is an optional query override; the frontend
  // normally omits it and lets the service fall back to the caller's own
  // saved profile preference (see nutritionService.getFoodSuggestions).
  async getFoodSuggestions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const date =
        (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const budgetLevelOverride = req.query.budgetLevel as string | undefined;
      const result = await nutritionService.getFoodSuggestions(
        req.user!.id,
        date,
        budgetLevelOverride,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error({ err: error }, "Error building food suggestions");
      res.status(500).json({
        success: false,
        error: "Failed to build food suggestions",
      });
    }
  },

  async upsertMealCompletion(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        mealId,
        date,
        status,
        percentConsumed,
        overrideCalories,
        overrideProtein,
        overrideCarbs,
        overrideFat,
      } = req.body;
      if (!mealId || !date || !status) {
        res
          .status(400)
          .json({ error: "mealId, date, and status are required" });
        return;
      }
      const result = await nutritionService.upsertMealCompletion(
        req.user!.id,
        mealId,
        date,
        {
          status,
          percentConsumed,
          overrideCalories,
          overrideProtein,
          overrideCarbs,
          overrideFat,
        },
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error upserting meal completion");
      res.status(500).json({ error: "Failed to update meal completion" });
    }
  },

  async deleteMealCompletion(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { mealId, date } = req.query as Record<string, string>;
      if (!mealId || !date) {
        res.status(400).json({ error: "mealId and date are required" });
        return;
      }
      const result = await nutritionService.deleteMealCompletion(
        req.user!.id,
        mealId,
        date,
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error deleting meal completion");
      res.status(500).json({ error: "Failed to delete meal completion" });
    }
  },

  async getCurrentProgram(req: AuthRequest, res: Response): Promise<void> {
    try {
      const program = await nutritionService.getCurrentProgram(req.user!.id);
      res.json({ success: true, data: program });
    } catch (error) {
      logger.error({ err: error }, "Error fetching current nutrition program");
      res.status(500).json({
        success: false,
        error: "Failed to fetch current nutrition program",
      });
    }
  },

  async updateProgram(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await nutritionService.updateProgram(
        req.params.programId,
        req.user!.id,
        req.body,
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error updating nutrition program");
      res.status(500).json({ error: "Failed to update nutrition program" });
    }
  },

  async deleteProgram(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await nutritionService.deleteProgram(
        req.params.programId,
        req.user!.id,
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error deleting nutrition program");
      res.status(500).json({ error: "Failed to delete nutrition program" });
    }
  },

  async addMealItem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await nutritionService.addMealItem(
        req.params.mealId,
        req.user!.id,
        req.body,
      );
      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error adding meal item");
      res.status(500).json({ error: "Failed to add meal item" });
    }
  },

  async updateMealItem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await nutritionService.updateMealItem(
        req.params.itemId,
        req.user!.id,
        req.body,
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error updating meal item");
      res.status(500).json({ error: "Failed to update meal item" });
    }
  },

  async deleteMealItem(req: AuthRequest, res: Response): Promise<void> {
    try {
      await nutritionService.deleteMealItem(req.params.itemId, req.user!.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error deleting meal item");
      res.status(500).json({ error: "Failed to delete meal item" });
    }
  },
};
