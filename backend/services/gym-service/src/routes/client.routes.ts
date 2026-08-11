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

// Client cancels their own ACTIVE membership — forfeits the unused portion, no refund
// (money-flow plan §2.4). A prorated refund is now an admin-only exceptional action, see
// POST /admin/gym-memberships/:id/refund in admin.routes.ts.
router.post('/me/gym-memberships/:id/cancel-membership', ...gate, asyncHandler(membershipController.cancelActive));

// A4: does the client already hold an active membership at a different gym? The UI calls
// this before the final purchase confirmation to show the warning.
router.get('/gyms/:gymId/membership-warnings', ...gate, asyncHandler(membershipController.warnOtherActiveMemberships));

router.get('/me/gym-memberships', ...gate, asyncHandler(membershipController.listForClient));
router.get('/me/gym-memberships/:id', ...gate, asyncHandler(membershipController.getForClient));

// Phase 4 — member scans the gym's front-desk QR to record their own visit.
router.post('/me/gym-checkins', ...gate, asyncHandler(checkinController.checkInByScan));
router.get('/me/gym-checkins', ...gate, asyncHandler(checkinController.listForClient));

// Phase 4 — gym review (only members who paid can write; one review per client per gym).
router.post('/gyms/:gymId/reviews', ...gate, asyncHandler(reviewController.submit));
router.delete('/gyms/:gymId/reviews', ...gate, asyncHandler(reviewController.remove));

export default router;
