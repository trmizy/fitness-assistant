import { Request, Response } from 'express';
import { planService } from '../services/plan.service';
import { gymService } from '../services/gym.service';
import { principalId } from '../middleware/partner-context.middleware';
import { requirePubliclyVisibleGym } from '../services/gym-public';

export const planController = {
  /** Public — reached from a specific branch's page, but a plan belongs to its BRAND, so this
   * resolves that branch's brandId and lists what the whole brand sells. A gym with no brand
   * (legacy standalone, pre-dating one-owner-one-brand) simply has nothing to list. */
  async listPublic(req: Request, res: Response) {
    // Listing Management B1: a branch that is not publicly visible has no public plans page - 404, not an empty list.
    if (!(await requirePubliclyVisibleGym(req, res))) return;
    const brandId = await gymService.getBrandIdForGym(req.params.gymId);
    const plans = brandId ? await planService.listActiveByBrand(brandId) : [];
    res.json({ success: true, data: plans });
  },

  async create(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const plan = await planService.createPlan(req.params.brandId, ownerId, req.body);
      res.status(201).json({ success: true, data: plan });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listOwned(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const plans = await planService.listOwnedPlans(req.params.brandId, ownerId);
      res.json({ success: true, data: plans });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async update(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const plan = await planService.updatePlan(req.params.brandId, req.params.planId, ownerId, req.body);
      res.json({ success: true, data: plan });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
