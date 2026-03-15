import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { statsController } from '../controllers/stats.controller';

const router = Router();

router.get('/workouts', authMiddleware, statsController.getWorkoutStats as any);
router.get('/nutrition', authMiddleware, statsController.getNutritionStats as any);

export default router;
