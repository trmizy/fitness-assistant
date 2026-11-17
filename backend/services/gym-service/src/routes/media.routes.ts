import { Router } from 'express';
import { gymMediaController } from '../controllers/gym-media.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { extractUser } from '../middleware/auth.middleware';

/** Public, read-only media (mounted at /media): the gateway lets only GET/HEAD through. */
const router = Router();

// extractUser only reads an OPTIONAL Bearer token (never rejects): an anonymous request takes the unchanged public path.
router.get('/gym-photos/:photoId', asyncHandler(extractUser), asyncHandler(gymMediaController.servePhoto));

export default router;
