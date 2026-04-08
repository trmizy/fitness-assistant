import { Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { workoutService } from '../services/workout.service';
import { createWorkoutSchema, updateWorkoutSetSchema } from '../models/fitness.models';
import type { AuthRequest } from '../middleware/auth.middleware';

export const workoutController = {
  async listWorkouts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { startDate, endDate, limit } = req.query as Record<string, string>;
      const workouts = await workoutService.listWorkouts(req.user!.id, {
        startDate,
        endDate,
        limit,
      });
      res.json(workouts);
    } catch (error) {
      logger.error('Error fetching workouts:', error);
      res.status(500).json({ error: 'Failed to fetch workouts' });
    }
  },

  async getWorkout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const workout = await workoutService.getWorkout(
        req.params.id,
        req.user!.id,
      );
      res.json(workout);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error('Error fetching workout:', error);
      res.status(500).json({ error: 'Failed to fetch workout' });
    }
  },

  async createWorkout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = createWorkoutSchema.parse(req.body);
      const workout = await workoutService.createWorkout(req.user!.id, data);
      res.status(201).json(workout);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      logger.error('Error creating workout:', error);
      res.status(500).json({ error: 'Failed to create workout' });
    }
  },

  async updateWorkout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = createWorkoutSchema.parse(req.body);
      const workout = await workoutService.updateWorkout(
        req.params.id,
        req.user!.id,
        data,
      );
      res.json(workout);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error('Error updating workout:', error);
      res.status(500).json({ error: 'Failed to update workout' });
    }
  },

  async deleteWorkout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await workoutService.deleteWorkout(
        req.params.id,
        req.user!.id,
      );
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error('Error deleting workout:', error);
      res.status(500).json({ error: 'Failed to delete workout' });
    }
  },

  async getPRs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { exerciseId } = req.query as Record<string, string>;
      const prs = await workoutService.getPRs(req.user!.id, exerciseId);
      res.json(prs);
    } catch (error) {
      logger.error('Error fetching PRs:', error);
      res.status(500).json({ error: 'Failed to fetch PRs' });
    }
  },

  async updateSet(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = updateWorkoutSetSchema.parse(req.body);
      const result = await workoutService.updateSet(req.params.setId, req.user!.id, data);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error('Error updating set:', error);
      res.status(500).json({ error: 'Failed to update set' });
    }
  },

  async generateWorkout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { goal, duration, equipment, bodyParts } = req.body;
      const result = await workoutService.queueWorkoutGeneration(
        req.user!.id,
        { goal, duration, equipment, bodyParts },
      );
      res.status(202).json(result);
    } catch (error) {
      logger.error('Error queuing workout generation:', error);
      res.status(500).json({ error: 'Failed to start workout generation' });
    }
  },
};
