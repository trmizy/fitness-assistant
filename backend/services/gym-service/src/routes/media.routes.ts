import { Router } from 'express';
import { gymMediaController } from '../controllers/gym-media.controller';
import { asyncHandler } from '../middleware/asyncHandler';

/** Public, read-only media (mounted at /media): the gateway lets only GET/HEAD through. */
const router = Router();

router.get('/gym-photos/:photoId', asyncHandler(gymMediaController.servePhoto));

export default router;
