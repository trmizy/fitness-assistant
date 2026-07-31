import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { affiliationController } from '../controllers/affiliation.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// Mounted at '/' in app.ts — see client.routes.ts for why the gate is per-route here.
const gate = [extractUser, requireAuth, requireRoles('PT')];

router.get('/pt/gym-invitations', ...gate, asyncHandler(affiliationController.listInvitations));
router.patch('/pt/gym-invitations/:id', ...gate, asyncHandler(affiliationController.respond));
router.get('/pt/gym-affiliations', ...gate, asyncHandler(affiliationController.listAffiliations));

export default router;
