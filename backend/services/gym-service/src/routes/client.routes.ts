import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { membershipController } from '../controllers/membership.controller';

const router = Router();

// This router is mounted at '/' in app.ts (its routes don't share one common prefix),
// so the auth/role gate is applied per-route rather than via a blanket router.use() —
// a blanket use() on a router mounted at '/' would intercept every request path in the
// app (including /admin/* and /owner/*) before Express ever reaches those other routers.
const gate = [extractUser, requireAuth, requireRoles('CUSTOMER', 'PT')];

// First purchase at this gym.
router.post('/gyms/:gymId/memberships', ...gate, membershipController.purchase);

// Retry payment on an existing PENDING_PAYMENT membership (separate from the first-purchase
// route above — see plan §2.3 for why these must not be overloaded into one endpoint).
router.post('/me/gym-memberships/:id/pay', ...gate, membershipController.pay);

// Abandon a stuck PENDING_PAYMENT membership so the client isn't locked out of buying a
// different plan at the same gym (the open-membership unique index blocks a second purchase
// while one is still PENDING_PAYMENT).
router.post('/me/gym-memberships/:id/cancel', ...gate, membershipController.cancel);

router.get('/me/gym-memberships', ...gate, membershipController.listForClient);
router.get('/me/gym-memberships/:id', ...gate, membershipController.getForClient);

export default router;
