import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { profileController } from '../controllers/profile.controller';

const router = Router();

router.get('/me', authMiddleware, profileController.getProfile as any);
router.put('/me', authMiddleware, profileController.upsertProfile as any);
router.patch('/me/become-pt', authMiddleware, profileController.becomePT as any);
router.delete('/me', authMiddleware, profileController.deleteProfile as any);

// Listing PT users — used by the chat-service to validate PT-client conversations
router.get('/pts', authMiddleware, profileController.listPTs as any);
router.patch('/admin/users/:userId/pt-status', authMiddleware, profileController.adminSetPTStatus as any);

// Admin: contract count summary — used by API Gateway to enrich user list
router.get('/admin/contracts/summary', authMiddleware, profileController.adminContractsSummary as any);
router.get('/admin/stats', authMiddleware, profileController.adminGetStats as any);

export default router;
