import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { membershipService, ADMIN_REFUND_REASONS } from '../services/membership.service';
import { principalId } from '../middleware/partner-context.middleware';
import { membershipsFor } from '../services/staff-views';

// See the identical helper's comment in ai-service/controllers/personalized-service.controller.ts
// — same signal (Capacitor's fixed `http://localhost` WebView origin), same purpose (pick the
// gateway return-URL), duplicated rather than shared because backend/shared isn't hot-reloaded.
function detectPlatform(req: Request): 'web' | 'mobile' {
  return req.headers.origin === 'http://localhost' ? 'mobile' : 'web';
}

function publicBaseUrl(req: Request): string | undefined {
  const h = req.headers['x-public-base-url'];
  return typeof h === 'string' ? h : undefined;
}

/** Vietnamese fallbacks for payment-service error codes whose upstream message is just the code. */
const PAYMENT_ERROR_MESSAGES: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: 'Cổng thanh toán này chưa sẵn sàng — hãy chọn cổng thanh toán khác',
  GATEWAY_ERROR: 'Cổng thanh toán đang gặp sự cố, vui lòng thử lại hoặc chọn cổng khác',
  CHECKOUT_FAILED: 'Không tạo được giao dịch thanh toán, vui lòng thử lại hoặc chọn cổng khác',
};

/**
 * B24 - the final catch of purchase / pay used to answer { error: { message } } and so dropped the `code` payment-service
 * gave (PROVIDER_NOT_CONFIGURED 400, GATEWAY_ERROR 502, ...). Status, code and a readable message are kept.
 */
function failBody(e: any) {
  const code: string | undefined = typeof e?.code === 'string' ? e.code : undefined;
  const message = code && (!e.message || e.message === code) ? (PAYMENT_ERROR_MESSAGES[code] ?? e.message ?? code) : e.message;
  return { success: false, error: { ...(code ? { code } : {}), message }, message };
}

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
        detectPlatform(req),
        publicBaseUrl(req),
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
      return res.status(e.status || 500).json(failBody(e));
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
      const result = await membershipService.retryPay(req.params.id, clientId, provider, detectPlatform(req), publicBaseUrl(req));
      return res.json({ success: true, data: result });
    } catch (e: any) {
      if (e.message === 'ALREADY_PAID') {
        return res.status(409).json({ success: false, error: { code: e.message } });
      }
      return res.status(e.status || 500).json(failBody(e));
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
      if (e.code === 'MEMBERSHIP_CANCEL_DISABLED') {
        // B47: an expected refusal, not an error to log.
        return res.status(e.status || 409).json({ success: false, error: { code: e.code, message: e.message }, message: e.message });
      }
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
      const ownerId = principalId(req);
      const list = await membershipService.listForOwner(req.params.gymId, ownerId);
      // D15: lễ tân thấy hạn/lượt, kế toán thấy doanh số (không có danh tính hội viên), chủ/quản lý thấy đủ.
      res.json({ success: true, data: req.partner ? membershipsFor(req.partner.role, list) : list });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
