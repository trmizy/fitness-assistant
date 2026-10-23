import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { membershipService, NOT_ACTIVATABLE } from '../services/membership.service';

export const internalController = {
  async activate(req: Request, res: Response) {
    try {
      const { transactionId } = req.body;
      const membership = await membershipService.activateViaTransaction(req.params.id, transactionId);
      res.json({ success: true, data: membership });
    } catch (e: any) {
      // 409 NOT_ACTIVATABLE is a definite answer, not a failure (payment-service refunds the client on it).
      if (e.code === NOT_ACTIVATABLE) {
        logger.warn({ membershipId: req.params.id, currentStatus: e.currentStatus }, 'internal activate: membership not activatable by this payment');
        res.status(409).json({ success: false, error: { code: NOT_ACTIVATABLE, message: e.message, currentStatus: e.currentStatus } });
        return;
      }
      logger.error(e, 'internal activate error');
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async cancelAfterRefund(req: Request, res: Response) {
    try {
      const { originalTransactionId, refundTransactionId } = req.body;
      const membership = await membershipService.cancelAfterRefundViaTransaction(req.params.id, originalTransactionId, refundTransactionId);
      res.json({ success: true, data: membership });
    } catch (e: any) {
      logger.error(e, 'internal cancel-after-refund error');
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
