import { Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { profileService } from '../services/profile.service';
import { profileSchema } from '../models/profile.models';
import type { AuthRequest } from '../middleware/auth.middleware';

export const profileController = {
  async getProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await profileService.getProfile(req.user!.id);
      res.json(result);
    } catch (error) {
      logger.error(error, 'Get profile error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async upsertProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = profileSchema.parse(req.body);
      const result = await profileService.upsertProfile(req.user!.id, body);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      logger.error(error, 'Update profile error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async deleteProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await profileService.deleteProfile(req.user!.id);
      res.json(result);
    } catch (error) {
      logger.error(error, 'Delete profile error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};
