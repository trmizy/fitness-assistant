import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { gymController } from '../controllers/gym.controller';
import { membershipController } from '../controllers/membership.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

router.patch('/gyms/:id/status', asyncHandler(gymController.setStatus));

// Exceptional, admin-only membership refund (money-flow plan §2.4) — gym violation/closure/
// transaction error only, `reason` required and validated against that fixed list. Replaces
// the old client-facing POST /me/gym-memberships/:id/refund, which let any client cancel for
// a prorated refund; clients now only get POST /me/gym-memberships/:id/cancel-membership,
// which forfeits the unused portion.
router.post('/gym-memberships/:id/refund', asyncHandler(membershipController.refundByAdmin));

export default router;
