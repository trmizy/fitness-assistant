import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { chatController } from '../controllers/chat.controller';

const router: Router = Router();

// All chat routes require authentication
router.post('/conversations/direct', authMiddleware, chatController.createDirectConversation as any);
router.get('/conversations', authMiddleware, chatController.listConversations as any);
router.get('/conversations/:id/messages', authMiddleware, chatController.getMessages as any);
router.post('/conversations/:id/messages', authMiddleware, chatController.sendMessage as any);

export default router;
