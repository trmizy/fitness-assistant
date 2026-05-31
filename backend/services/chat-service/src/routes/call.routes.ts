import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { callController } from '../controllers/call.controller';

const router = Router();

// Video/voice call REST signaling. WebRTC media + ringing channel still travels over
// Socket.IO; these endpoints persist a CallSession record and trigger the policy
// gate (chat conversation membership or confirmed online coaching session).
router.post('/', authMiddleware, callController.create as any);
router.patch('/:id/accept', authMiddleware, callController.accept as any);
router.patch('/:id/end', authMiddleware, callController.end as any);

export default router;
