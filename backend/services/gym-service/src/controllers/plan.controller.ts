import { Request, Response } from 'express';
import { planService } from '../services/plan.service';
import { gymService } from '../services/gym.service';

export const planController = {
  /** Public — reached from a specific branch's page, but a plan belongs to its BRAND, so this
   * resolves that branch's brandId and lists what the whole brand sells. A gym with no brand
   * (legacy standalone, pre-dating one-owner-one-brand) simply has nothing to list. */
  async listPublic(req: Request, res: Response) {
    const brandId = await gymService.getBrandIdForGym(req.params.gymId);
    const plans = brandId ? await planService.listActiveByBrand(brandId) : [];
    res.json({ success: true, data: plans });
  },

  async create(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const plan = await planService.createPlan(req.params.brandId, ownerId, req.body);
      res.status(201).json({ success: true, data: plan });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listOwned(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const plans = await planService.listOwnedPlans(req.params.brandId, ownerId);
      res.json({ success: true, data: plans });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async update(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const plan = await planService.updatePlan(req.params.brandId, req.params.planId, ownerId, req.body);
      res.json({ success: true, data: plan });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
