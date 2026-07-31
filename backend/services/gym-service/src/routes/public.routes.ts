import { Router } from 'express';
import { gymController } from '../controllers/gym.controller';
import { planController } from '../controllers/plan.controller';
import { affiliationController } from '../controllers/affiliation.controller';
import { reviewController } from '../controllers/review.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// Public — only ever return APPROVED gyms / ACTIVE plans / ACTIVE+PUBLIC trainers.
router.get('/gyms', asyncHandler(gymController.listPublic));
router.get('/gyms/:id', asyncHandler(gymController.getPublicById));
router.get('/gyms/:gymId/plans', asyncHandler(planController.listPublic));
router.get('/gyms/:gymId/trainers', asyncHandler(affiliationController.listPublic));
router.get('/gyms/:gymId/reviews', asyncHandler(reviewController.listForGym));

export default router;
