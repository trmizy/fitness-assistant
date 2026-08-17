import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { gymController } from '../controllers/gym.controller';
import { brandController } from '../controllers/brand.controller';
import { planController } from '../controllers/plan.controller';
import { membershipController } from '../controllers/membership.controller';
import { affiliationController } from '../controllers/affiliation.controller';
import { checkinController } from '../controllers/checkin.controller';
import { collaborationController } from '../controllers/collaboration.controller';
import { paymentClient } from '../clients/payment.client';
import { gymService } from '../services/gym.service';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
router.use(extractUser, requireAuth, requireRoles('GYM_OWNER'));

// A chain: one owner, many branches (Gym rows below with brandId set). Optional — an owner
// who never creates a brand just keeps creating standalone gyms exactly as before.
router.post('/brands', asyncHandler(brandController.create));
router.get('/brands', asyncHandler(brandController.listOwned));
router.get('/brands/:id', asyncHandler(brandController.getOwnedById));
router.patch('/brands/:id', asyncHandler(brandController.update));

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

// Phase 4 — the gym displays this QR at the desk; members scan it to check themselves in.
router.get('/gyms/:gymId/checkin-qr', asyncHandler(checkinController.getGymQr));
router.get('/gyms/:gymId/checkins', asyncHandler(checkinController.listForGym));

router.post('/gyms/:gymId/trainers', asyncHandler(affiliationController.invite));

// Gym-owner-initiated side of a revenue-share negotiation (plan §1.2/F3). Note this router
// is mounted at /owner, so `POST /owner/gyms/:gymId/collaborations` and
// `PATCH|DELETE /owner/collaborations/:id` are the real paths — kept distinct from the PT
// side's identical-looking `/gyms/:gymId/collaborations` in pt.routes.ts (mounted at '/').
router.post('/gyms/:gymId/collaborations', asyncHandler(collaborationController.proposeAsGym));
router.patch('/collaborations/:id', asyncHandler(collaborationController.respondAsGym));
router.delete('/collaborations/:id', asyncHandler(collaborationController.terminateAsGym));

export default router;
