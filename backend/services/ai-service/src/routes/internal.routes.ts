import { Router, Request, Response, NextFunction } from 'express';
import { conversationRepository } from '../repositories/conversation.repository';

const router = Router();

router.delete('/users/:userId', async (req: Request, res: Response, next: NextFunction) => {
  const SECRET = process.env.INTERNAL_SERVICE_SECRET;
  if (!SECRET) {
    res.status(500).json({ error: 'Internal secret not configured' });
    return;
  }
  if (!req.headers['x-service-secret'] || req.headers['x-service-secret'] !== SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    await conversationRepository.deleteByUserId(req.params.userId);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
