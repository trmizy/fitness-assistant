import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { checkinService } from '../services/checkin.service';
import { ptCheckinService } from '../services/pt-checkin.service';
import { principalId } from '../middleware/partner-context.middleware';

// Typed check-in outcomes → HTTP status; the UI shows a friendly message per code.
const CODE_STATUS: Record<string, number> = {
  INVALID_TOKEN: 400,
  TOKEN_EXPIRED: 400,
  NO_MEMBERSHIP: 403,
  NOT_ACTIVE: 409,
  VISIT_LIMIT_REACHED: 409,
  TOO_SOON: 429,
  // Was missing: the member path threw GYM_NOT_ACTIVE (409) but, with no entry here, answered
  // { error: { message } } without a code, so the apps could not show a friendly message.
  GYM_NOT_ACTIVE: 409,
  // Phase 2 — PT check-in (separate route; the member path never emits these).
  GYM_NOT_FOUND: 404,
  PT_NOT_FOUND: 403,
  NOT_A_PT: 403,
  PT_RESTRICTED: 403,
  PT_BANNED: 403,
  PT_NO_QUALIFYING_SESSION: 403,
  PT_SESSION_CHECK_UNAVAILABLE: 503,
};

export const checkinController = {
  /** Owner: the QR to display at the front desk. */
  async getGymQr(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
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

  /**
   * PT: scanned the branch's QR. Identity comes from the session (PT role only, enforced on the
   * route). Idempotent per (branch, PT, local day): first scan, re-scan, concurrent scan and a
   * network retry all answer 200 with the same record id. Typed codes, no free-text on refusals.
   */
  async ptCheckInByScan(req: Request, res: Response) {
    try {
      const ptUserId = req.user!.userId;
      const { token } = req.body ?? {};
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN' } });
      }
      const data = await ptCheckinService.checkInByGymToken(ptUserId, token);
      return res.status(200).json({ success: true, data });
    } catch (e: any) {
      const status = CODE_STATUS[e.message];
      if (status) return res.status(status).json({ success: false, error: { code: e.message } });
      logger.error(e, 'pt checkin scan error');
      return res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  /** Owner/manager: PT entries at one branch (Q19) - no client identity. */
  async listPtForGym(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const list = await ptCheckinService.listForGym(req.params.gymId, ownerId);
      res.json({ success: true, data: list });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listForGym(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
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
