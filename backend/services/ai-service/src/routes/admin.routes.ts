import { Router } from 'express';
import { adminController } from '../controllers/admin.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

// All admin endpoints require a verified gateway identity.
// The API gateway enforces ADMIN role before forwarding to this service.
router.use(requireAuth);

/** GET /admin/ai/overview — aggregate stats */
router.get('/overview', adminController.getOverview);

/** GET /admin/ai/requests — paginated conversation list */
router.get('/requests', adminController.listRequests);

/** GET /admin/ai/requests/:id — full conversation trace detail */
router.get('/requests/:id', adminController.getRequest);

/** GET /admin/ai/queue — plan queue + BullMQ live counts */
router.get('/queue', adminController.getQueue);

/** GET /admin/ai/errors — failed plans + high-warning conversations */
router.get('/errors', adminController.getErrors);

export default router;
