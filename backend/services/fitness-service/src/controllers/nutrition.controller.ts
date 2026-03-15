import { Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { nutritionService } from '../services/nutrition.service';
import { createNutritionSchema } from '../models/fitness.models';
import type { AuthRequest } from '../middleware/auth.middleware';

export const nutritionController = {
  async listLogs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { startDate, endDate, mealType } = req.query as Record<
        string,
        string
      >;
      const logs = await nutritionService.listLogs(req.user!.id, {
        startDate,
        endDate,
        mealType,
      });
      res.json(logs);
    } catch (error) {
      logger.error('Error fetching nutrition logs:', error);
      res.status(500).json({ error: 'Failed to fetch nutrition logs' });
    }
  },

  async createLog(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = createNutritionSchema.parse(req.body);
      const log = await nutritionService.createLog(req.user!.id, data);
      res.status(201).json(log);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      logger.error('Error creating nutrition log:', error);
      res.status(500).json({ error: 'Failed to create nutrition log' });
    }
  },

  async deleteLog(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await nutritionService.deleteLog(
        req.params.id,
        req.user!.id,
      );
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error('Error deleting nutrition log:', error);
      res.status(500).json({ error: 'Failed to delete nutrition log' });
    }
  },
};
