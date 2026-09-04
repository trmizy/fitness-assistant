import { Request, Response } from 'express';
import { planService } from '../services/plan.service';

export const planController = {
  async listPublic(req: Request, res: Response) {
    const plans = await planService.listActiveByGym(req.params.gymId);
    res.json({ success: true, data: plans });
  },

  async create(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const plan = await planService.createPlan(req.params.gymId, ownerId, req.body);
      res.status(201).json({ success: true, data: plan });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listOwned(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const plans = await planService.listOwnedPlans(req.params.gymId, ownerId);
      res.json({ success: true, data: plans });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async update(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const plan = await planService.updatePlan(req.params.gymId, req.params.planId, ownerId, req.body);
      res.json({ success: true, data: plan });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
