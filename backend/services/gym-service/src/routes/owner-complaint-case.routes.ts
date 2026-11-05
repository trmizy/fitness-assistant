import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { resolvePartnerContext } from '../middleware/partner-context.middleware';
import { requireOperationalAccess } from '../middleware/operational-access.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { complaintCaseController } from '../controllers/complaint-case.controller';

/**
 * C10 - the Gym's side of a gym complaint case: it may read what it is entitled to and provide EVIDENCE and an EXPLANATION for its own branches, nothing else.
 * Mounted at /owner/complaint-cases BEFORE the generic /owner router (app.ts) so this narrow surface does not depend on the partner permission catalogue: there
 * is deliberately no route here that decides, approves, executes, appeals or reads the investigation. The service re-checks the branch scope on every call
 * (owner of the gym, or a MANAGER whose scoped branches include it; receptionists and accountants see nothing).
 */
const router = Router();
router.use(extractUser, requireAuth, requireRoles('GYM_OWNER'), resolvePartnerContext, requireOperationalAccess);
router.get('/', asyncHandler(complaintCaseController.gymList));
router.get('/:id', asyncHandler(complaintCaseController.gymDetail));
router.post('/:id/explanations', asyncHandler(complaintCaseController.gymExplain));
router.post('/:id/evidence', asyncHandler(complaintCaseController.gymEvidence));
export default router;
