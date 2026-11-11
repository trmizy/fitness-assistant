import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';

// Scaffold created by the coordinator (11/11) so parallel workers never edit app.ts at the same time.
// The worker owning this file adds its read-only admin routes below.
const router = Router();
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

export default router;
