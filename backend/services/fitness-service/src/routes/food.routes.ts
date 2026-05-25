import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { foodController } from '../controllers/food.controller';

const router = Router();

router.get('/search', authMiddleware, foodController.search as any);

export default router;
