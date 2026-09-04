import { Router } from "express";
import {
  authMiddleware,
  internalAuthMiddleware,
} from "../middleware/auth.middleware";
import { nutritionController } from "../controllers/nutrition.controller";

const router = Router();

router.post(
  "/from-ai-plan",
  internalAuthMiddleware,
  nutritionController.importAiPlan as any,
);

router.get(
  "/monthly-summary",
  authMiddleware,
  nutritionController.getMonthlySummary as any,
);
router.get(
  "/daily-task",
  authMiddleware,
  nutritionController.getDailyTask as any,
);
router.post(
  "/meal-completions",
  authMiddleware,
  nutritionController.upsertMealCompletion as any,
);
router.delete(
  "/meal-completions",
  authMiddleware,
  nutritionController.deleteMealCompletion as any,
);

router.get(
  "/programs/current",
  authMiddleware,
  nutritionController.getCurrentProgram as any,
);
router.get(
  "/plans/current",
  authMiddleware,
  nutritionController.getCurrentProgram as any,
);
router.patch(
  "/programs/:programId",
  authMiddleware,
  nutritionController.updateProgram as any,
);
router.delete(
  "/programs/:programId",
  authMiddleware,
  nutritionController.deleteProgram as any,
);
router.post(
  "/programs/:programId/deactivate",
  authMiddleware,
  nutritionController.deactivateNutritionProgram as any,
);
router.delete(
  "/plan-meals/:mealId",
  authMiddleware,
  nutritionController.deletePlanMeal as any,
);
router.post(
  "/program-meals/:mealId/items",
  authMiddleware,
  nutritionController.addMealItem as any,
);
router.patch(
  "/program-meal-items/:itemId",
  authMiddleware,
  nutritionController.updateMealItem as any,
);
router.delete(
  "/program-meal-items/:itemId",
  authMiddleware,
  nutritionController.deleteMealItem as any,
);

router.get("/goals", authMiddleware, nutritionController.getGoal as any);
// Must be registered before /goals/:something-else would ever exist, but
// since there's no such param route, ordering relative to GET/PUT /goals
// above doesn't matter here — kept adjacent for readability.
router.get("/goals/history", authMiddleware, nutritionController.getGoalHistory as any);
router.put("/goals", authMiddleware, nutritionController.upsertGoal as any);
// Goal <-> Plan sync gap (docs/audit/nutrition-ai-current-flow-audit.md,
// câu 6): read-only consistency check between the active goal and active
// program. Never mutates anything.
router.get("/active-state", authMiddleware, nutritionController.getActiveState as any);
router.get("/", authMiddleware, nutritionController.listLogs as any);
router.post("/", authMiddleware, nutritionController.createLog as any);
// PATCH /nutrition/:id — owner-only partial update (BUG-008 / TC-NUT-05).
router.patch("/:id", authMiddleware, nutritionController.updateLog as any);
router.delete("/:id", authMiddleware, nutritionController.deleteLog as any);

export default router;
