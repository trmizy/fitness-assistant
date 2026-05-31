import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { exerciseService } from '../services/exercise.service';
import type { AuthRequest } from '../middleware/auth.middleware';

export const exerciseController = {
  async listExercises(req: Request, res: Response): Promise<void> {
    try {
      const { search, bodyPart, muscleGroup, equipment, activityType, type, typeOfActivity, typeOfEquipment, page, limit } =
        req.query as Record<string, string>;
      const exercises = await exerciseService.listExercises({
        search,
        bodyPart,
        muscleGroup,
        equipment,
        activityType,
        type,
        typeOfActivity,
        typeOfEquipment,
        page,
        limit,
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

  async getFilterOptions(_req: Request, res: Response): Promise<void> {
    try {
      const options = await exerciseService.getFilterOptions();
      res.json(options);
    } catch (error: any) {
      logger.error({ err: error }, 'Error fetching exercise filter options');
      res.status(500).json({ error: 'Failed to fetch exercise filter options' });
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

  // POST /exercises — admin-only (BUG-027 / TC-ADMIN-ADV-05). Accepts both the
  // canonical schema (exerciseName, typeOfActivity, ...) and a friendlier alias
  // shape that the test cases use ({ name, muscleGroups, equipment, difficulty }).
  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: 'Admin role required' });
        return;
      }
      const b = req.body || {};
      const payload = {
        exerciseName: b.exerciseName ?? b.name,
        typeOfActivity: b.typeOfActivity ?? 'STRENGTH',
        typeOfEquipment:
          b.typeOfEquipment ?? (Array.isArray(b.equipment) ? b.equipment[0] : b.equipment) ?? 'BODYWEIGHT',
        bodyPart: b.bodyPart ?? 'FULL_BODY',
        type: b.type ?? 'PUSH',
        muscleGroupsActivated: b.muscleGroupsActivated ?? b.muscleGroups ?? [],
        instructions: b.instructions ?? b.description ?? 'TBD',
        videoUrl: b.videoUrl ?? null,
      };
      if (!payload.exerciseName) {
        res.status(400).json({ error: 'name / exerciseName is required' });
        return;
      }
      const created = await exerciseService.create(payload);
      res.status(201).json(created);
    } catch (error: any) {
      if (error.status) { res.status(error.status).json({ error: error.message }); return; }
      logger.error('Error creating exercise:', error);
      res.status(500).json({ error: 'Failed to create exercise' });
    }
  },
};
