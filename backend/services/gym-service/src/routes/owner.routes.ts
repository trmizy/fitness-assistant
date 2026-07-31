import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { gymController } from '../controllers/gym.controller';
import { planController } from '../controllers/plan.controller';
import { membershipController } from '../controllers/membership.controller';
import { affiliationController } from '../controllers/affiliation.controller';
import { checkinController } from '../controllers/checkin.controller';
import { paymentClient } from '../clients/payment.client';
import { gymService } from '../services/gym.service';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
router.use(extractUser, requireAuth, requireRoles('GYM_OWNER'));

// Ownership is verified per-row inside each service method (gymService.getOwnedGym) —
// requireRoles('GYM_OWNER') alone only proves the caller is *a* gym owner, not that
// they own *this* gym.
router.post('/gyms', asyncHandler(gymController.createOwned));
router.get('/gyms', asyncHandler(gymController.listOwned));
router.get('/gyms/:id', asyncHandler(gymController.getOwnedById));
router.patch('/gyms/:id', asyncHandler(gymController.updateOwned));

router.get('/gyms/:gymId/wallet', asyncHandler(async (req, res) => {
  try {
    const ownerId = req.user!.userId;
    const gym = await gymService.getOwnedGym(req.params.gymId, ownerId);
    const wallet = await paymentClient.getWallet('GYM', gym.id);
    res.json({ success: true, data: wallet });
  } catch (e: any) {
    res.status(e.status || 500).json({ success: false, error: { message: e.message } });
  }
}));

router.post('/gyms/:gymId/plans', asyncHandler(planController.create));
router.get('/gyms/:gymId/plans', asyncHandler(planController.listOwned));
router.patch('/gyms/:gymId/plans/:planId', asyncHandler(planController.update));

router.get('/gyms/:gymId/memberships', asyncHandler(membershipController.listForOwner));

// Phase 4 — gym scans a member's QR to record entry; owner sees recent check-ins.
router.post('/gyms/:gymId/checkins', asyncHandler(checkinController.record));
router.get('/gyms/:gymId/checkins', asyncHandler(checkinController.listForGym));

router.post('/gyms/:gymId/trainers', asyncHandler(affiliationController.invite));

export default router;
