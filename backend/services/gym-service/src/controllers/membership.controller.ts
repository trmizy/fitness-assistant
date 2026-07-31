import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { membershipService } from '../services/membership.service';

export const membershipController = {
  async purchase(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const { planId } = req.body;
      const result = await membershipService.purchase(req.params.gymId, planId, clientId);
      return res.status(201).json({ success: true, data: result });
    } catch (e: any) {
      if (e.message === 'ALREADY_HAS_PENDING_MEMBERSHIP') {
        return res.status(409).json({
          success: false,
          error: { code: e.message, retryPaymentUrl: `/me/gym-memberships/${e.membershipId}/pay` },
        });
      }
      if (e.message === 'ALREADY_HAS_OPEN_MEMBERSHIP' || e.message === 'ALREADY_PAID') {
        return res.status(409).json({ success: false, error: { code: e.message } });
      }
      logger.error(e, 'membership purchase error');
      return res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async pay(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const result = await membershipService.retryPay(req.params.id, clientId);
      return res.json({ success: true, data: result });
    } catch (e: any) {
      if (e.message === 'ALREADY_PAID') {
        return res.status(409).json({ success: false, error: { code: e.message } });
      }
      return res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async cancel(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const result = await membershipService.cancelPending(req.params.id, clientId);
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async refund(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const result = await membershipService.refund(req.params.id, clientId);
      return res.json({ success: true, data: result });
    } catch (e: any) {
      const known = ['INSUFFICIENT_REFUND_FUNDS', 'ALREADY_REFUNDED', 'NOT_REFUNDABLE', 'REFUND_FAILED'];
      if (known.includes(e.message)) {
        return res.status(e.status || 409).json({ success: false, error: { code: e.message } });
      }
      logger.error(e, 'membership refund error');
      return res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listForClient(req: Request, res: Response) {
    const clientId = req.user!.userId;
    const list = await membershipService.listForClient(clientId);
    res.json({ success: true, data: list });
  },

  async getForClient(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const m = await membershipService.getForClient(req.params.id, clientId);
      res.json({ success: true, data: m });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listForOwner(req: Request, res: Response) {
    try {
      const ownerId = req.user!.userId;
      const list = await membershipService.listForOwner(req.params.gymId, ownerId);
      res.json({ success: true, data: list });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
