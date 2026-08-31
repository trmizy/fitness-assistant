import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { membershipService, ADMIN_REFUND_REASONS } from '../services/membership.service';

export const membershipController = {
  async purchase(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const { planId } = req.body;
      const provider = typeof req.body?.provider === 'string' ? req.body.provider.toUpperCase() : undefined;
      const referralCode = typeof req.body?.referralCode === 'string' ? req.body.referralCode.trim().toUpperCase() : undefined;
      const acknowledgedMultiGymWarning = req.body?.acknowledgedMultiGymWarning === true;
      const result = await membershipService.purchase(
        req.params.gymId,
        planId,
        clientId,
        provider,
        referralCode || undefined,
        acknowledgedMultiGymWarning,
      );
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
      const referralErrors = [
        'REFERRAL_CODE_NOT_FOUND',
        'CANNOT_REFER_YOURSELF',
        'REFERRAL_NOT_APPLICABLE_AT_THIS_GYM',
        'REFERRAL_ONLY_FOR_FIRST_MEMBERSHIP',
      ];
      if (referralErrors.includes(e.message)) {
        return res.status(400).json({ success: false, error: { code: e.message } });
      }
      logger.error(e, 'membership purchase error');
      return res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  // A4: warns the client before they confirm a purchase if they already hold an active
  // membership elsewhere — called by the UI before showing the final "Buy" confirmation.
  async warnOtherActiveMemberships(req: Request, res: Response) {
    const clientId = req.user!.userId;
    const warnings = await membershipService.warnOtherActiveMemberships(clientId, req.params.gymId);
    res.json({ success: true, data: warnings });
  },

  async pay(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const provider = typeof req.body?.provider === 'string' ? req.body.provider.toUpperCase() : undefined;
      const result = await membershipService.retryPay(req.params.id, clientId, provider);
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

  /**
   * Money-flow plan §2.4: the client cancelling their own ACTIVE membership forfeits the
   * unused portion — there is no refund on this path any more (that is now
   * `refundByAdmin`, gated to admins and the three exceptional reasons).
   */
  async cancelActive(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const result = await membershipService.cancelByClient(req.params.id, clientId);
      return res.json({ success: true, data: result });
    } catch (e: any) {
      logger.error(e, 'membership self-cancel error');
      return res.status(e.status || 500).json({ success: false, error: { code: e.message, message: e.message } });
    }
  },

  /** Admin-only exceptional refund — see membership.service.ts#refundByAdmin. */
  async refundByAdmin(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { reason } = req.body ?? {};
      if (!ADMIN_REFUND_REASONS.includes(reason)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_REFUND_REASON', message: `reason must be one of: ${ADMIN_REFUND_REASONS.join(', ')}` },
        });
      }
      const result = await membershipService.refundByAdmin(req.params.id, adminId, reason);
      return res.json({ success: true, data: result });
    } catch (e: any) {
      logger.error(e, 'membership admin refund error');
      return res.status(e.status || 500).json({ success: false, error: { code: e.message, message: e.message } });
    }
  },

  /** Admin queue — see membership.service.ts#listPendingIssues (P0 cluster E2). */
  async listPendingIssues(_req: Request, res: Response) {
    const list = await membershipService.listPendingIssues();
    res.json({ success: true, data: list });
  },

  /** Admin manual retry — see membership.service.ts#resolvePendingIssueByAdmin (P0 cluster E2). */
  async resolvePendingIssue(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const result = await membershipService.resolvePendingIssueByAdmin(req.params.id, adminId);
      return res.json({ success: true, data: result });
    } catch (e: any) {
      logger.error(e, 'resolve pending-issue membership error');
      return res.status(e.status || 500).json({ success: false, error: { code: e.message, message: e.message } });
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
