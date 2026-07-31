import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { membershipController } from '../controllers/membership.controller';
import { checkinController } from '../controllers/checkin.controller';
import { reviewController } from '../controllers/review.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// This router is mounted at '/' in app.ts (its routes don't share one common prefix),
// so the auth/role gate is applied per-route rather than via a blanket router.use() —
// a blanket use() on a router mounted at '/' would intercept every request path in the
// app (including /admin/* and /owner/*) before Express ever reaches those other routers.
const gate = [extractUser, requireAuth, requireRoles('CUSTOMER', 'PT')];

// First purchase at this gym.
router.post('/gyms/:gymId/memberships', ...gate, asyncHandler(membershipController.purchase));

// Retry payment on an existing PENDING_PAYMENT membership (separate from the first-purchase
// route above — see plan §2.3 for why these must not be overloaded into one endpoint).
router.post('/me/gym-memberships/:id/pay', ...gate, asyncHandler(membershipController.pay));

// Abandon a stuck PENDING_PAYMENT membership so the client isn't locked out of buying a
// different plan at the same gym (the open-membership unique index blocks a second purchase
// while one is still PENDING_PAYMENT).
router.post('/me/gym-memberships/:id/cancel', ...gate, asyncHandler(membershipController.cancel));

// Client cancels an ACTIVE membership → prorated refund (unused days) to their wallet.
router.post('/me/gym-memberships/:id/refund', ...gate, asyncHandler(membershipController.refund));

router.get('/me/gym-memberships', ...gate, asyncHandler(membershipController.listForClient));
router.get('/me/gym-memberships/:id', ...gate, asyncHandler(membershipController.getForClient));

// Phase 4 — member's rotating QR check-in token for an ACTIVE membership.
router.get('/me/gym-memberships/:id/checkin-token', ...gate, asyncHandler(checkinController.getToken));

// Phase 4 — gym review (only members who paid can write; one review per client per gym).
router.post('/gyms/:gymId/reviews', ...gate, asyncHandler(reviewController.submit));
router.delete('/gyms/:gymId/reviews', ...gate, asyncHandler(reviewController.remove));

export default router;
