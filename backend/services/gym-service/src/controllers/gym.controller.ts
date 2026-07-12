import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { gymService } from '../services/gym.service';

export const gymController = {
  async listPublic(_req: Request, res: Response) {
    const gyms = await gymService.listApproved();
    res.json({ success: true, data: gyms });
  },

  async getPublicById(req: Request, res: Response) {
    try {
      const gym = await gymService.getApprovedById(req.params.id);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { code: 'NOT_FOUND', message: e.message } });
    }
  },

  async createOwned(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const gym = await gymService.createGym(ownerId, req.body);
      res.status(201).json({ success: true, data: gym });
    } catch (e: any) {
      logger.error(e, 'createOwned gym error');
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listOwned(req: Request, res: Response) {
    const ownerId = req.user!.userId;
    const gyms = await gymService.listOwned(ownerId);
    res.json({ success: true, data: gyms });
  },

  async getOwnedById(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const gym = await gymService.getOwnedGym(req.params.id, ownerId);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async updateOwned(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const gym = await gymService.updateOwnedGym(req.params.id, ownerId, req.body);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async setStatus(req: Request, res: Response) {
    try {
      const { status } = req.body;
      const gym = await gymService.setStatus(req.params.id, status);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
