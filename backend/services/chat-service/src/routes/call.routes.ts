import { Router, type RequestHandler } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware';
import { callController } from '../controllers/call.controller';

const router: Router = Router();

const wrapAuthHandler = (
  handler: (req: AuthRequest, res: Parameters<RequestHandler>[1]) => Promise<unknown>,
): RequestHandler => async (req, res, next) => {
  try {
    await handler(req as AuthRequest, res);
  } catch (error) {
    next(error);
  }
};

// Video/voice call REST signaling. WebRTC media and ringing events still travel
// over Socket.IO; these endpoints persist CallSession records and run the policy
// gate for chat membership or confirmed online coaching sessions.
router.post('/', authMiddleware as RequestHandler, wrapAuthHandler(callController.create));
router.patch('/:id/accept', authMiddleware as RequestHandler, wrapAuthHandler(callController.accept));
router.patch('/:id/end', authMiddleware as RequestHandler, wrapAuthHandler(callController.end));

export default router;