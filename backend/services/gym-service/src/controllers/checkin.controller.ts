import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { checkinService } from '../services/checkin.service';

// Typed check-in outcomes → HTTP status; the UI shows a friendly message per code.
const CODE_STATUS: Record<string, number> = {
  INVALID_TOKEN: 400,
  TOKEN_EXPIRED: 400,
  NO_MEMBERSHIP: 403,
  NOT_ACTIVE: 409,
  VISIT_LIMIT_REACHED: 409,
  TOO_SOON: 429,
};

export const checkinController = {
  /** Owner: the QR to display at the front desk. */
  async getGymQr(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const data = await checkinService.getGymQr(req.params.gymId, ownerId);
      return res.json({ success: true, data });
    } catch (e: any) {
      return res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  /** Member: scanned the gym's QR — record the visit and hand back what the desk verifies. */
  async checkInByScan(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const { token } = req.body ?? {};
      if (!token) return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN' } });
      const data = await checkinService.checkInByGymToken(clientId, token);
      return res.status(201).json({ success: true, data });
    } catch (e: any) {
      const status = CODE_STATUS[e.message];
      if (status) return res.status(status).json({ success: false, error: { code: e.message } });
      logger.error(e, 'checkin scan error');
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

  async listForClient(req: Request, res: Response) {
    try {
      const list = await checkinService.listForClient(req.user!.userId);
      res.json({ success: true, data: list });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
