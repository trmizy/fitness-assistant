import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { membershipService } from '../services/membership.service';

export const internalController = {
  async activate(req: Request, res: Response) {
    try {
      const { transactionId } = req.body;
      const membership = await membershipService.activateViaTransaction(req.params.id, transactionId);
      res.json({ success: true, data: membership });
    } catch (e: any) {
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
