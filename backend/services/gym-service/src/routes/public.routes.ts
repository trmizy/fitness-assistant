import { Router } from 'express';
import { gymController } from '../controllers/gym.controller';
import { planController } from '../controllers/plan.controller';
import { affiliationController } from '../controllers/affiliation.controller';
import { reviewController } from '../controllers/review.controller';
import { collaborationController } from '../controllers/collaboration.controller';
import { publicPartnerController } from '../controllers/public-partner.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { extractUser } from '../middleware/auth.middleware';

const router = Router();

// Public — only ever return APPROVED gyms / ACTIVE plans / ACTIVE+PUBLIC trainers.
router.get('/gyms', asyncHandler(gymController.listPublic));
router.get('/gyms/:id', asyncHandler(gymController.getPublicById));
router.get('/gyms/:gymId/plans', asyncHandler(planController.listPublic));
router.get('/gyms/:gymId/trainers', asyncHandler(affiliationController.listPublic));
// extractUser (never requireAuth): the list stays public; a logged-in caller only gets `isMine` on their own review (B45).
router.get('/gyms/:gymId/reviews', extractUser, asyncHandler(reviewController.listForGym));

// Which gyms a trainer has an accepted revenue-share partnership with — feeds the client's
// "where do you train?" picker on the hire-a-PT flow (plan §1.2/C2).
router.get('/pt/:ptUserId/gyms', asyncHandler(collaborationController.listAcceptedGymsForPt));

// Phase 3 — người nhận thư mời đối tác chưa có tài khoản, không thể xác thực.
router.get('/partner-invitations/:token', asyncHandler(publicPartnerController.previewInvitation));
router.post('/partner-invitations/:token/accept', asyncHandler(publicPartnerController.acceptInvitation));

export default router;
