import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { nutritionController } from '../controllers/nutrition.controller';

const router = Router();

router.get('/', authMiddleware, nutritionController.listLogs as any);
router.post('/', authMiddleware, nutritionController.createLog as any);
router.delete('/:id', authMiddleware, nutritionController.deleteLog as any);

export default router;
