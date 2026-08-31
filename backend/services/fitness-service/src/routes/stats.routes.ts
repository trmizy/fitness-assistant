import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { statsController } from "../controllers/stats.controller";

const router = Router();

router.get("/workouts", authMiddleware, statsController.getWorkoutStats as any);
router.get(
  "/nutrition",
  authMiddleware,
  statsController.getNutritionStats as any,
);
router.get(
  "/muscle-heatmap",
  authMiddleware,
  statsController.getMuscleHeatmap as any,
);
router.get(
  "/activity-heatmap",
  authMiddleware,
  statsController.getActivityHeatmap as any,
);
router.get(
  "/activity-heatmap/day/:date",
  authMiddleware,
  statsController.getActivityDayDetail as any,
);
router.get(
  "/exercise-progress/:exerciseId",
  authMiddleware,
  statsController.getExerciseProgress as any,
);

export default router;
