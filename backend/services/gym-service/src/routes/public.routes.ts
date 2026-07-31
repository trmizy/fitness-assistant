import { Router } from 'express';
import { gymController } from '../controllers/gym.controller';
import { planController } from '../controllers/plan.controller';
import { affiliationController } from '../controllers/affiliation.controller';
import { reviewController } from '../controllers/review.controller';

const router = Router();

// Public — only ever return APPROVED gyms / ACTIVE plans / ACTIVE+PUBLIC trainers.
router.get('/gyms', gymController.listPublic);
router.get('/gyms/:id', gymController.getPublicById);
router.get('/gyms/:gymId/plans', planController.listPublic);
router.get('/gyms/:gymId/trainers', affiliationController.listPublic);
router.get('/gyms/:gymId/reviews', reviewController.listForGym);

export default router;
