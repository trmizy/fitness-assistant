import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { internalStatusController } from '../controllers/internal-status.controller';

/**
 * FH-4 - read-only membership status facts for payment-service. Mounted from internal.routes.ts AFTER its
 * serviceSecretMiddleware, so every route requires the service secret. Never mutates anything.
 */
const router = Router();
router.get('/gym-memberships/by-transaction/:txnId', asyncHandler(internalStatusController.byTransaction));
router.post('/gym-memberships/status', asyncHandler(internalStatusController.batchStatus));
export default router;
