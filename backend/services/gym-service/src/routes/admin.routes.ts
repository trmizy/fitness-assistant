import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { gymController } from '../controllers/gym.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

router.patch('/gyms/:id/status', asyncHandler(gymController.setStatus));

export default router;
