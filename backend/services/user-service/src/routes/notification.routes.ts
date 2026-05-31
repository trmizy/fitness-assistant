import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { notificationController } from '../controllers/notification.controller';

const router = Router();

router.get('/', authMiddleware, notificationController.list as any);
router.get('/unread-count', authMiddleware, notificationController.getUnreadCount as any);
router.patch('/read-all', authMiddleware, notificationController.markAllRead as any);
router.patch('/:id/read', authMiddleware, notificationController.markRead as any);

export default router;
