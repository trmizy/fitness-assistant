import { Router } from 'express';
import { serviceSecretMiddleware } from '../middleware/serviceSecret.middleware';
import { internalController } from '../controllers/internal.controller';
import { collaborationController } from '../controllers/collaboration.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import internalMembershipRoutes from './internal-memberships.routes';
import internalStatusRoutes from './internal-status.routes';

const router = Router();
router.use(serviceSecretMiddleware);

// Idempotent — the internal.controller verifies the transaction (§1.8) before mutating.
router.post('/gym-memberships/:id/activate', asyncHandler(internalController.activate));
router.post('/gym-memberships/:id/cancel-after-refund', asyncHandler(internalController.cancelAfterRefund));

// user-service resolves a PT-via-gym contract's frozen rate table here at signing time
// (plan §1.4). 404 (NO_ACTIVE_COLLABORATION) means the caller must fall back to its own
// 400 — this endpoint never invents a rate table.
router.get('/collaborations/active', asyncHandler(collaborationController.internalActiveRates));

// Phase 3 / P3.1 - read-only membership lookups (new file, secret-protected by the router.use above).
router.use(internalMembershipRoutes);
// FH-4 - read-only status facts (new file, secret-protected by the router.use above).
router.use(internalStatusRoutes);

export default router;
