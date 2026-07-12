import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { gymController } from '../controllers/gym.controller';

const router = Router();
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

router.patch('/gyms/:id/status', gymController.setStatus);

export default router;
