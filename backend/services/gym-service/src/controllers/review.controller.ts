import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { reviewService } from '../services/review.service';
import { requirePubliclyVisibleGym } from '../services/gym-public';

export const reviewController = {
  async listForGym(req: Request, res: Response) {
    try {
      if (!(await requirePubliclyVisibleGym(req, res))) return;
      // extractUser is optional on this public route: a logged-in caller gets `isMine` on their own review.
      const data = await reviewService.listForGym(req.params.gymId, req.user?.userId ?? null);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async submit(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const { rating, comment } = req.body ?? {};
      const { review, created } = await reviewService.submit(req.params.gymId, clientId, Number(rating), comment);
      // 201 when a review was created, 200 when the caller's existing review was edited (B46). `created` repeats it.
      return res.status(created ? 201 : 200).json({ success: true, data: review, created });
    } catch (e: any) {
      if (e.message === 'NOT_A_MEMBER') {
        return res.status(403).json({
          success: false,
          error: { code: 'NOT_A_MEMBER', message: 'Chỉ hội viên đã mua gói tại phòng gym này mới được đánh giá.' },
        });
      }
      if (e.status && e.status < 500) {
        return res.status(e.status).json({ success: false, error: { ...(e.code ? { code: e.code } : {}), message: e.message }, message: e.message });
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
      res.status(e.status || 500).json({ success: false, error: { ...(e.code ? { code: e.code } : {}), message: e.message } });
    }
  },
};
