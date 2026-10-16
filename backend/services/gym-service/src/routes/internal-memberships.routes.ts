import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { membershipEligibilityController } from '../controllers/membership-eligibility.controller';

/**
 * Phase 3 / P3.1 - read-only membership lookups for other services. Mounted from
 * internal.routes.ts AFTER its serviceSecretMiddleware, so every route here requires the
 * service secret. Never mutates anything.
 */
const router = Router();

// GET /internal/clients/:clientId/active-memberships?gymId=... | ?brandId=...   (neither = all brands)
router.get('/clients/:clientId/active-memberships', asyncHandler(membershipEligibilityController.activeMemberships));
// GET /internal/clients/:clientId/active-gyms -> { gymIds } (what user-service pt-discovery calls)
router.get('/clients/:clientId/active-gyms', asyncHandler(membershipEligibilityController.activeGyms));

export default router;
