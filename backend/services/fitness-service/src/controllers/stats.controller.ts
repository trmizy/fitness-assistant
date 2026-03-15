import { Response } from 'express';
import { logger } from '@gym-coach/shared';
import { statsService } from '../services/stats.service';
import type { AuthRequest } from '../middleware/auth.middleware';

export const statsController = {
  async getWorkoutStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const days = parseInt((req.query.days as string) || '30');
      const stats = await statsService.getWorkoutStats(req.user!.id, days);
      res.json(stats);
    } catch (error) {
      logger.error('Error fetching workout stats:', error);
      res.status(500).json({ error: 'Failed to fetch workout stats' });
    }
  },

  async getNutritionStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const days = parseInt((req.query.days as string) || '7');
      const stats = await statsService.getNutritionStats(req.user!.id, days);
      res.json(stats);
    } catch (error) {
      logger.error('Error fetching nutrition stats:', error);
      res.status(500).json({ error: 'Failed to fetch nutrition stats' });
    }
  },
};
