import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { reviewService } from '../services/review.service';

export const reviewController = {
  async listForGym(req: Request, res: Response) {
    try {
      const data = await reviewService.listForGym(req.params.gymId);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async submit(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const { rating, comment } = req.body ?? {};
      const data = await reviewService.submit(req.params.gymId, clientId, Number(rating), comment);
      return res.status(201).json({ success: true, data });
    } catch (e: any) {
      if (e.message === 'NOT_A_MEMBER') {
        return res.status(403).json({
          success: false,
          error: { code: 'NOT_A_MEMBER', message: 'Chỉ hội viên đã mua gói tại phòng gym này mới được đánh giá.' },
        });
      }
      logger.error(e, 'review submit error');
      return res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async remove(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const data = await reviewService.remove(req.params.gymId, clientId);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
