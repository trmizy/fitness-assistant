import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { exerciseService } from '../services/exercise.service';

export const exerciseController = {
  async listExercises(req: Request, res: Response): Promise<void> {
    try {
      const { bodyPart, typeOfActivity, typeOfEquipment, search } =
        req.query as Record<string, string>;
      const exercises = await exerciseService.listExercises({
        bodyPart,
        typeOfActivity,
        typeOfEquipment,
        search,
      });
      res.json(exercises);
    } catch (error: any) {
      logger.error(
        {
          message: error?.message,
          stack: error?.stack,
          name: error?.name,
          code: error?.code,
        },
        'Error fetching exercises',
      );
      res.status(500).json({ error: 'Failed to fetch exercises' });
    }
  },

  async getExercise(req: Request, res: Response): Promise<void> {
    try {
      const exercise = await exerciseService.getExercise(req.params.id);
      res.json(exercise);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error('Error fetching exercise:', error);
      res.status(500).json({ error: 'Failed to fetch exercise' });
    }
  },
};
