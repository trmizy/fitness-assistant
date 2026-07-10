import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { exerciseController } from "../controllers/exercise.controller";

const router = Router();

router.get("/", exerciseController.listExercises);
router.get("/filter-options", exerciseController.getFilterOptions);
router.get("/:id", exerciseController.getExercise);
// BUG-027: admin can create exercises (admin role enforced inside controller).
router.post("/", authMiddleware, exerciseController.create as any);

export default router;
