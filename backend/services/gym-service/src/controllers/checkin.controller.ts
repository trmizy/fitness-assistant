import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { checkinService } from '../services/checkin.service';

// Typed check-in outcomes → HTTP status; the UI shows a friendly message per code.
const CODE_STATUS: Record<string, number> = {
  INVALID_TOKEN: 400,
  TOKEN_EXPIRED: 400,
  WRONG_GYM: 400,
  MEMBERSHIP_NOT_FOUND: 404,
  NOT_ACTIVE: 409,
  VISIT_LIMIT_REACHED: 409,
  TOO_SOON: 429,
};

export const checkinController = {
  async getToken(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const data = await checkinService.issueToken(req.params.id, clientId);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async record(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const { token } = req.body ?? {};
      if (!token) return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN' } });
      const data = await checkinService.recordCheckIn(req.params.gymId, ownerId, token);
      return res.status(201).json({ success: true, data });
    } catch (e: any) {
      const status = CODE_STATUS[e.message];
      if (status) return res.status(status).json({ success: false, error: { code: e.message } });
      logger.error(e, 'checkin record error');
      return res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listForGym(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const list = await checkinService.listForGym(req.params.gymId, ownerId);
      res.json({ success: true, data: list });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
