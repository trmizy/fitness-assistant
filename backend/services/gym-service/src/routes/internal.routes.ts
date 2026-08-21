import { Router } from 'express';
import { serviceSecretMiddleware } from '../middleware/serviceSecret.middleware';
import { internalController } from '../controllers/internal.controller';
import { collaborationController } from '../controllers/collaboration.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
router.use(serviceSecretMiddleware);

// Idempotent — the internal.controller verifies the transaction (§1.8) before mutating.
router.post('/gym-memberships/:id/activate', asyncHandler(internalController.activate));
router.post('/gym-memberships/:id/cancel-after-refund', asyncHandler(internalController.cancelAfterRefund));

// user-service resolves a PT-via-gym contract's frozen rate table here at signing time
// (plan §1.4). 404 (NO_ACTIVE_COLLABORATION) means the caller must fall back to its own
// 400 — this endpoint never invents a rate table.
router.get('/collaborations/active', asyncHandler(collaborationController.internalActiveRates));

export default router;
