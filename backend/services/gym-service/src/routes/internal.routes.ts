import { Router } from 'express';
import { serviceSecretMiddleware } from '../middleware/serviceSecret.middleware';
import { internalController } from '../controllers/internal.controller';

const router = Router();
router.use(serviceSecretMiddleware);

// Idempotent — the internal.controller verifies the transaction (§1.8) before mutating.
router.post('/gym-memberships/:id/activate', internalController.activate);
router.post('/gym-memberships/:id/cancel-after-refund', internalController.cancelAfterRefund);

export default router;
