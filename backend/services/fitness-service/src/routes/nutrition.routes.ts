import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { nutritionController } from '../controllers/nutrition.controller';

const router = Router();

router.get('/goals', authMiddleware, nutritionController.getGoal as any);
router.put('/goals', authMiddleware, nutritionController.upsertGoal as any);
router.get('/', authMiddleware, nutritionController.listLogs as any);
router.post('/', authMiddleware, nutritionController.createLog as any);
// PATCH /nutrition/:id — owner-only partial update (BUG-008 / TC-NUT-05).
router.patch('/:id', authMiddleware, nutritionController.updateLog as any);
router.delete('/:id', authMiddleware, nutritionController.deleteLog as any);

export default router;
