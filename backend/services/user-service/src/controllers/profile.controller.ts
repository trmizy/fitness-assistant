import { Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { profileService } from '../services/profile.service';
import { profileRepository, prisma } from '../repositories/profile.repository';
import { contractRepository } from '../repositories/contract.repository';
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

  /** Returns { summary: { [userId]: contractCount } } for all user IDs.
   *  Called by the API Gateway to enrich the admin User Management list.
   */
  async adminContractsSummary(_req: AuthRequest, res: Response): Promise<void> {
    try {
      // Fetch all contracts and group counts in the repository
      // We pass an empty array to get ALL users (repository handles it)
      const allContracts = await contractRepository.findAll(0, 10000);
      const userIds = [
        ...new Set([
          ...allContracts.map((c) => c.ptUserId),
          ...allContracts.map((c) => c.clientUserId),
        ]),
      ];
      const summary = await contractRepository.countByUsers(userIds);
      res.json({ summary });
    } catch (error) {
      logger.error(error, 'Admin contracts summary error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /** Returns general system stats for the admin dashboard. */
  async adminGetStats(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const activeContracts = await contractRepository.countActive();
      
      // Calculate OCR stats for the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const inbodyStats = await prisma.inBodyEntry.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: sevenDaysAgo }
        },
        _count: true
      });

      const ocrStats = {
        total: inbodyStats.reduce((acc, curr) => acc + curr._count, 0),
        extracted: inbodyStats.find(s => s.status === 'extracted')?._count || 0,
        manual: inbodyStats.find(s => s.status === 'manual')?._count || 0,
        pending: inbodyStats.find(s => s.status === 'pending')?._count || 0,
      };

      res.json({ activeContracts, ocrStats });
    } catch (error) {
      logger.error(error, 'Admin get stats error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};
