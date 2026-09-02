import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { gymController } from '../controllers/gym.controller';
import { brandController } from '../controllers/brand.controller';
import { membershipController } from '../controllers/membership.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

// Vòng 4 / Phase C — there was no admin-facing gym/brand moderation list at all before this
// phase; ?status= defaults to everything (the UI defaults it to PENDING_REVIEW itself).
router.get('/gyms', asyncHandler(gymController.listAllForAdmin));
router.patch('/gyms/:id/status', asyncHandler(gymController.setStatus));
// C2 — the dedicated action for a rename/address-change on an ALREADY-approved gym (the
// gym's very FIRST approval piggybacks on the /status route above instead — see
// gymService.setStatus's own doc comment).
router.patch('/gyms/:id/approve-rename', asyncHandler(gymController.approveRename));
// C3 — the actionable item for a gym the owner permanently closed: still-ACTIVE memberships
// there need an admin to run the existing refundByAdmin(reason: 'GYM_CLOSED') on them.
router.get('/gyms/permanently-closed', asyncHandler(gymController.listPermanentlyClosed));

// C1 — same shape as the gym routes above: list for moderation, plus the dedicated
// "Duyệt đổi tên thương hiệu" action for a rename on a brand that already has an approved name.
router.get('/brands', asyncHandler(brandController.listAllForAdmin));
router.patch('/brands/:id/approve-rename', asyncHandler(brandController.approveRename));

// Exceptional, admin-only membership refund (money-flow plan §2.4) — gym violation/closure/
// transaction error only, `reason` required and validated against that fixed list. Replaces
// the old client-facing POST /me/gym-memberships/:id/refund, which let any client cancel for
// a prorated refund; clients now only get POST /me/gym-memberships/:id/cancel-membership,
// which forfeits the unused portion.
router.post('/gym-memberships/:id/refund', asyncHandler(membershipController.refundByAdmin));

// P0 cluster E2 — memberships whose auto-refund kept failing past payment-service's own
// activation-retry budget; a human resolves them from here.
router.get('/gym-memberships/pending-issues', asyncHandler(membershipController.listPendingIssues));
router.post('/gym-memberships/:id/resolve-pending-issue', asyncHandler(membershipController.resolvePendingIssue));

export default router;
