import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { aiController } from '../controllers/ai.controller';

const router = Router();

// POST /plans/workout/generate → delegates to aiController.generatePlan
router.post('/workout/generate', (req: Request, res: Response) => {
  aiController.generatePlan(req, res);
});

// POST /plans/explain — stub until full implementation
router.post('/explain', (_req: Request, res: Response) => {
  logger.info('Plan explain requested');
  res.json({
    success: true,
    explanation: 'Plan explanation feature is coming soon.',
  });
});

// POST /plans/adjust — stub until full implementation
router.post('/adjust', (_req: Request, res: Response) => {
  logger.info('Plan adjust requested');
  res.json({
    success: true,
    message: 'Plan adjustment feature is coming soon.',
  });
});

// GET /plans/shopping-list — stub
router.get('/shopping-list', (_req: Request, res: Response) => {
  res.json({ success: true, items: [] });
});

// GET /plans/current — stub
router.get('/current', (_req: Request, res: Response) => {
  res.json({ success: true, plans: [] });
});

export default router;
