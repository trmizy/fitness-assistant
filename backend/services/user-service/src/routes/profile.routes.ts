import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { profileController } from '../controllers/profile.controller';

const router = Router();

router.get('/me', authMiddleware, profileController.getProfile as any);
router.put('/me', authMiddleware, profileController.upsertProfile as any);
router.delete('/me', authMiddleware, profileController.deleteProfile as any);

export default router;
