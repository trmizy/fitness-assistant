import { Request, Response } from 'express';
import { commissionRateService } from '../services/commission-rate.service';

export const commissionRateController = {
  async current(_req: Request, res: Response) {
    const rate = await commissionRateService.getEffectiveConfigRate();
    res.json({ success: true, data: { rate } });
  },

  async history(_req: Request, res: Response) {
    const rows = await commissionRateService.history();
    res.json({ success: true, data: rows });
  },

  async setRate(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { rate, effectiveFrom } = req.body ?? {};
      const row = await commissionRateService.setRate(Number(rate), new Date(effectiveFrom ?? Date.now()), adminId);
      res.status(201).json({ success: true, data: row });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
