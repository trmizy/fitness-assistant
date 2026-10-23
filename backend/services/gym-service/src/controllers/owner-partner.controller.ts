import { Request, Response } from 'express';
import { partnerService } from '../services/partner.service';
import { partnerInvitationService } from '../services/partner-invitation.service';
import { partnerRepository } from '../repositories/partner.repository';
import { authClient } from '../clients/auth.client';
import { principalId } from '../middleware/partner-context.middleware';

const ROLE_EMAIL_LABEL: Record<string, string> = {
  MANAGER: 'quản lý chi nhánh',
  RECEPTIONIST: 'lễ tân',
  ACCOUNTANT: 'kế toán (chỉ xem)',
};

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || 'Đã có lỗi xảy ra' } });
}

/** Host của link mời — cùng quy tắc với partner.controller.ts: header tin cậy của gateway, không
 *  bao giờ x-public-base-url (giả mạo được qua X-Forwarded-Host). */
function appBaseUrl(req: Request): string {
  // Cùng lý do: chỉ tin header khi request đi qua gateway (khớp secret nội bộ).
  const secret = req.headers['x-gateway-secret'];
  const fromGateway =
    (Array.isArray(secret) ? secret[0] : secret) ===
    (process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production');
  const header = fromGateway ? req.headers['x-trusted-web-origin'] : undefined;
  const raw = Array.isArray(header) ? header[0] : header;
  return (raw || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

/**
 * Phase 3 mục 3.2 — chủ sở hữu tự quản lý người quản lý chi nhánh của MÌNH, không cần
 * admin. Mọi hàm ở đây phải tự kiểm `X.partnerId === req.partner!.partnerId` trước khi
 * đụng vào bất cứ thứ gì — requirePartnerOwner chỉ chứng minh "là chủ sở hữu MỘT đối tác
 * nào đó", không chứng minh "đối tượng này thuộc đúng đối tác của họ".
 */
export const ownerPartnerController = {
  async listAccounts(req: Request, res: Response) {
    const accounts = await partnerService.listAccounts(req.partner!.partnerId!);
    const identities = await Promise.all(
      accounts.map(async (a) => {
        try {
          return { accountId: a.id, ...(await authClient.getUser(a.userId)) };
        } catch {
          return { accountId: a.id, id: a.userId, email: null, firstName: null, lastName: null, isActive: null };
        }
      }),
    );
    res.json({ success: true, data: accounts.map((a) => ({ ...a, identity: identities.find((i) => i.accountId === a.id) })) });
  },

  async revokeAccount(req: Request, res: Response) {
    try {
      const target = await partnerRepository.findAccountById(req.params.accountId);
      if (!target || target.partnerId !== req.partner!.partnerId) {
        throw Object.assign(new Error('Không tìm thấy tài khoản trong đối tác của bạn'), { status: 404 });
      }
      if (target.role === 'OWNER') {
        throw Object.assign(new Error('Không thu hồi được tài khoản chủ sở hữu — chuyển quyền sở hữu trước nếu cần đổi chủ'), { status: 403 });
      }
      const account = await partnerService.revokeAccount(target.id, principalId(req), req.body?.reason);
      await authClient.revokeSessions(account.userId).catch(() => null);
      res.json({ success: true, data: account });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async listInvitations(req: Request, res: Response) {
    const invitations = await partnerInvitationService.listForPartner(req.partner!.partnerId!);
    res.json({ success: true, data: invitations });
  },

  async inviteManager(req: Request, res: Response) {
    try {
      // `role` mặc định MANAGER để client cũ (chỉ gửi email + scopedGymIds) chạy y như trước.
      const { email, scopedGymIds, role = 'MANAGER' } = req.body ?? {};
      const { invitation, rawToken } = await partnerService.inviteStaff(
        req.partner!.partnerId!,
        principalId(req),
        { email, role, scopedGymIds },
        principalId(req),
      );
      const link = `${appBaseUrl(req)}/partner/invite/${rawToken}`;
      const label = ROLE_EMAIL_LABEL[invitation.role] ?? 'thành viên';
      const emailed = await authClient.sendEmail({
        to: invitation.email,
        subject: `Lời mời làm ${label} phòng tập`,
        text: `Bạn được mời làm ${label}. Mở liên kết sau để tự đặt mật khẩu:\n\n${link}\n\nHiệu lực đến ${invitation.expiresAt.toLocaleString('vi-VN')}.`,
      });
      res.status(201).json({ success: true, data: { invitation, inviteLink: link, emailSent: emailed } });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async resendInvitation(req: Request, res: Response) {
    try {
      const existing = await partnerRepository.findInvitationById(req.params.id);
      if (!existing || existing.partnerId !== req.partner!.partnerId) {
        throw Object.assign(new Error('Không tìm thấy thư mời'), { status: 404 });
      }
      const { invitation, rawToken } = await partnerInvitationService.resendInvitation(req.params.id, principalId(req));
      const link = `${appBaseUrl(req)}/partner/invite/${rawToken}`;
      const emailed = await authClient.sendEmail({
        to: invitation.email,
        subject: 'Lời mời quản lý chi nhánh (gửi lại)',
        text: `Liên kết mới:\n\n${link}\n\nHiệu lực đến ${invitation.expiresAt.toLocaleString('vi-VN')}.`,
      });
      res.json({ success: true, data: { invitation, inviteLink: link, emailSent: emailed } });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async revokeInvitation(req: Request, res: Response) {
    try {
      const existing = await partnerRepository.findInvitationById(req.params.id);
      if (!existing || existing.partnerId !== req.partner!.partnerId) {
        throw Object.assign(new Error('Không tìm thấy thư mời'), { status: 404 });
      }
      const invitation = await partnerInvitationService.revokeInvitation(req.params.id, principalId(req));
      res.json({ success: true, data: invitation });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
