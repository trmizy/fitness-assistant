import { Request, Response } from 'express';
import { gymHoursService } from '../services/gym-hours.service';
import { gymService } from '../services/gym.service';
import { principalId } from '../middleware/partner-context.middleware';

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || 'Đã có lỗi xảy ra' } });
}

/** GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 3 "Opening Hours". §74: free edit whether the
 * branch is still a draft or already approved — one pair of routes serves both. */
export const gymHoursController = {
  async get(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      await gymService.getOwnedGym(req.params.id, ownerId);
      const hours = await gymHoursService.getHours(req.params.id);
      res.json({ success: true, data: hours });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async set(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const days = req.body?.days;
      if (!Array.isArray(days)) {
        res.status(400).json({ success: false, error: { message: 'days phải là một mảng 7 ngày' } });
        return;
      }
      const hours = await gymHoursService.setHours(req.params.id, ownerId, days);
      res.json({ success: true, data: hours });
    } catch (e: any) {
      fail(res, e);
    }
  },

  /** GYM_BRANCH_FORM_SPEC.md, Phase 6 — admin review workspace. No ownership check — an
   * admin reviews any gym; getHours itself never depended on one. */
  async getForAdmin(req: Request, res: Response) {
    try {
      const hours = await gymHoursService.getHours(req.params.id);
      res.json({ success: true, data: hours });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
