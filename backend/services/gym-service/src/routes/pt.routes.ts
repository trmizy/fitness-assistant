import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { affiliationController } from '../controllers/affiliation.controller';
import { collaborationController } from '../controllers/collaboration.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireOperationalAccessForOwners } from '../middleware/operational-access.middleware';

const router = Router();

// Mounted at '/' in app.ts — see client.routes.ts for why the gate is per-route here.
const gate = [extractUser, requireAuth, requireRoles('PT')];

router.get('/pt/gym-invitations', ...gate, asyncHandler(affiliationController.listInvitations));
router.patch('/pt/gym-invitations/:id', ...gate, asyncHandler(affiliationController.respond));
router.get('/pt/gym-affiliations', ...gate, asyncHandler(affiliationController.listAffiliations));

// PT-initiated side of a revenue-share negotiation (plan §1.2). The gym-owner side lives in
// owner.routes.ts under /owner — same collaborationController, different actor.
router.post('/gyms/:gymId/collaborations', ...gate, asyncHandler(collaborationController.proposeAsPt));
router.patch('/collaborations/:id', ...gate, asyncHandler(collaborationController.respondAsPt));
router.delete('/collaborations/:id', ...gate, asyncHandler(collaborationController.terminateAsPt));

// One shared URL for both roles rather than duplicating it under /owner (which would give
// GYM_OWNER a *different* path, /owner/me/collaborations — not what the gateway/plan expect).
// Mounted here because this router sits at '/', same reasoning as client.routes.ts's gate.
router.get(
  '/me/collaborations',
  extractUser,
  requireAuth,
  requireRoles('PT', 'GYM_OWNER'),
  // Nhánh GYM_OWNER của route dùng chung này nằm NGOÀI /owner nên không đi qua cổng vận hành ở
  // owner.routes.ts — phải tự đi qua nó, nếu không một ứng viên (JWT role GYM_OWNER) đọc được
  // danh sách đề xuất cộng tác PT. PT đi tiếp như cũ.
  asyncHandler(requireOperationalAccessForOwners),
  asyncHandler(collaborationController.listMine),
);

export default router;
