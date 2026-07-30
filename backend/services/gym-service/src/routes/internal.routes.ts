import { Router } from 'express';
import { serviceSecretMiddleware } from '../middleware/serviceSecret.middleware';
import { internalController } from '../controllers/internal.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
router.use(serviceSecretMiddleware);

// Idempotent — the internal.controller verifies the transaction (§1.8) before mutating.
router.post('/gym-memberships/:id/activate', asyncHandler(internalController.activate));
router.post('/gym-memberships/:id/cancel-after-refund', asyncHandler(internalController.cancelAfterRefund));

export default router;
