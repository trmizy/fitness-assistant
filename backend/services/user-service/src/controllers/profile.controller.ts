import { Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { profileService } from '../services/profile.service';
import { profileRepository } from '../repositories/profile.repository';
import { adminPTStatusSchema, profileSchema } from '../models/profile.models';
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

  async listPTs(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const profiles = await profileRepository.findPTs();
      res.json({ pts: profiles });
    } catch (error) {
      logger.error(error, 'List PTs error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async becomePT(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await profileService.becomePT(req.user!.id, req.user!.role);
      res.json(result);
    } catch (error: any) {
      logger.error(error, 'Become PT error');
      res.status(error.message?.includes('not allowed') ? 403 : 500).json({
        error: error.message || 'Internal server error',
      });
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

  async adminSetPTStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden: admin role required' });
        return;
      }

      const body = adminPTStatusSchema.parse(req.body);
      const result = await profileService.adminSetPTStatus(req.params.userId, body.isPT);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      logger.error(error, 'Admin set PT status error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};
