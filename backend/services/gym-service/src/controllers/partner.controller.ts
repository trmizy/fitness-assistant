import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { partnerService } from '../services/partner.service';
import { partnerInvitationService } from '../services/partner-invitation.service';
import { partnerAuditService } from '../services/partner-audit.service';
import { partnerRepository } from '../repositories/partner.repository';
import { authClient } from '../clients/auth.client';
import { gymRepository } from '../repositories/gym.repository';
import { brandRepository } from '../repositories/brand.repository';

const APP_BASE_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function fail(res: Response, e: any, fallback = 'Đã có lỗi xảy ra') {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || fallback } });
}

/**
 * Link trong email. Ưu tiên x-public-base-url do gateway gắn theo từng yêu cầu (LAN, máy
 * ảo, tunnel — cùng cơ chế đã dùng cho VNPay return URL) rồi mới đến FRONTEND_URL tĩnh:
 * một link mời trỏ về "localhost" thì vô dụng với người nhận ở máy khác.
 */
function appBaseUrl(req: Request): string {
  const header = req.headers['x-public-base-url'];
  const raw = Array.isArray(header) ? header[0] : header;
  return (raw || APP_BASE_URL).replace(/\/$/, '');
}

export const partnerController = {
  // ── Danh sách + hồ sơ ─────────────────────────────────────────────────────
  async list(req: Request, res: Response) {
    const raw = req.query.status;
    const VALID = ['PROSPECT', 'INVITED', 'ACTIVE', 'SUSPENDED', 'TERMINATED'];
    const status = typeof raw === 'string' && VALID.includes(raw) ? (raw as any) : undefined;
    const rawVerification = req.query.verificationStatus;
    const VALID_VERIFICATION = ['NOT_VERIFIED', 'IN_REVIEW', 'NEEDS_INFO', 'VERIFIED', 'REJECTED'];
    const verificationStatus =
      typeof rawVerification === 'string' && VALID_VERIFICATION.includes(rawVerification) ? (rawVerification as any) : undefined;
    const assignedAdminId = typeof req.query.assignedAdminId === 'string' ? req.query.assignedAdminId : undefined;
    const partners = await partnerService.listPartners({ status, verificationStatus, assignedAdminId });
    res.json({ success: true, data: partners });
  },

  /**
   * Màn hình 360°: một lần gọi trả đủ hồ sơ, tài khoản, thư mời, chi nhánh, thương hiệu.
   * Cố ý gộp — quản trị viên đang nghe điện thoại của chủ gym cần thấy đủ ngay, không phải
   * mở 5 tab rồi chờ 5 vòng mạng.
   */
  async detail(req: Request, res: Response) {
    try {
      const partner = await partnerService.getPartner(req.params.id);
      const owner = partner.accounts.find((a) => a.role === 'OWNER' && a.status === 'ACTIVE');

      const [gyms, brand, invitations] = await Promise.all([
        owner ? gymRepository.findByOwner(owner.userId) : Promise.resolve([]),
        partner.brandId ? brandRepository.findById(partner.brandId) : Promise.resolve(null),
        partnerInvitationService.listForPartner(partner.id),
      ]);

      // Email/tên của từng tài khoản nằm ở auth-service — gộp vào đây để tab "Tài khoản"
      // hiển thị được người thật chứ không phải một dãy uuid.
      const identities = await Promise.all(
        partner.accounts.map(async (a) => {
          try {
            return { accountId: a.id, ...(await authClient.getUser(a.userId)) };
          } catch {
            return { accountId: a.id, id: a.userId, email: null, firstName: null, lastName: null, isActive: null };
          }
        }),
      );

      res.json({ success: true, data: { partner, gyms, brand, invitations, identities } });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const partner = await partnerService.createPartner(req.body, adminId);
      await partnerAuditService.record({
        partnerId: partner.id,
        actorUserId: adminId,
        action: 'PARTNER_CREATED',
        req,
        metadata: { legalName: partner.legalName, contactEmail: partner.contactEmail },
      });
      res.status(201).json({ success: true, data: partner });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const partner = await partnerService.updatePartner(req.params.id, req.body);
      await partnerAuditService.record({
        partnerId: partner.id,
        actorUserId: adminId,
        action: 'PARTNER_UPDATED',
        req,
        metadata: { fields: Object.keys(req.body ?? {}) },
      });
      res.json({ success: true, data: partner });
    } catch (e: any) {
      fail(res, e);
    }
  },

  // ── Cấp tài khoản + thư mời ───────────────────────────────────────────────
  async provision(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { partner, invitation, rawToken } = await partnerService.provisionOwnerAccount(req.params.id, adminId);

      const link = `${appBaseUrl(req)}/partner/invite/${rawToken}`;
      const emailed = await authClient.sendEmail({
        to: partner.contactEmail!,
        subject: 'Lời mời trở thành đối tác phòng tập',
        text: [
          `Xin chào,`,
          ``,
          `Bạn được mời thiết lập tài khoản đối tác cho "${partner.legalName}".`,
          `Mở liên kết dưới đây để tự đặt mật khẩu và hoàn tất thiết lập:`,
          ``,
          link,
          ``,
          `Liên kết có hiệu lực đến ${invitation.expiresAt.toLocaleString('vi-VN')}.`,
          `Nếu bạn không mong đợi email này, hãy bỏ qua.`,
        ].join('\n'),
      });

      await partnerAuditService.record({
        partnerId: partner.id,
        actorUserId: adminId,
        action: 'ACCOUNT_PROVISIONED',
        req,
        metadata: { email: partner.contactEmail, invitationId: invitation.id, emailSent: emailed },
      });

      // rawToken trả về cho quản trị viên: nếu SMTP chưa cấu hình (môi trường dev) thì vẫn
      // có đường đưa link cho đối tác qua đúng kênh đã liên hệ.
      res.status(201).json({ success: true, data: { partner, invitation, inviteLink: link, emailSent: emailed } });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async resendInvitation(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { invitation, rawToken } = await partnerInvitationService.resendInvitation(req.params.invitationId, adminId);
      const link = `${appBaseUrl(req)}/partner/invite/${rawToken}`;
      const emailed = await authClient.sendEmail({
        to: invitation.email,
        subject: 'Lời mời đối tác phòng tập (gửi lại)',
        text: `Liên kết thiết lập tài khoản của bạn:\n\n${link}\n\nHiệu lực đến ${invitation.expiresAt.toLocaleString('vi-VN')}.`,
      });

      await partnerAuditService.record({
        partnerId: invitation.partnerId,
        actorUserId: adminId,
        action: 'INVITATION_RESENT',
        req,
        metadata: { email: invitation.email, sentCount: invitation.sentCount, emailSent: emailed },
      });
      res.json({ success: true, data: { invitation, inviteLink: link, emailSent: emailed } });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async revokeInvitation(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const invitation = await partnerInvitationService.revokeInvitation(req.params.invitationId, adminId);
      await partnerAuditService.record({
        partnerId: invitation.partnerId,
        actorUserId: adminId,
        action: 'INVITATION_REVOKED',
        req,
        metadata: { email: invitation.email },
      });
      res.json({ success: true, data: invitation });
    } catch (e: any) {
      fail(res, e);
    }
  },

  // ── Hành động lên từng tài khoản ──────────────────────────────────────────
  async resetPassword(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const account = await partnerRepository.findAccountById(req.params.accountId);
      if (!account) throw Object.assign(new Error('Không tìm thấy tài khoản'), { status: 404 });

      const { rawToken, expiresAt, user } = await authClient.issuePasswordReset(account.userId, adminId);
      const link = `${appBaseUrl(req)}/dat-lai-mat-khau/${rawToken}`;
      const emailed = await authClient.sendEmail({
        to: user.email,
        subject: 'Đặt lại mật khẩu tài khoản đối tác',
        text: `Mở liên kết sau để đặt mật khẩu mới:\n\n${link}\n\nHiệu lực đến ${new Date(expiresAt).toLocaleString('vi-VN')}.\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
      });

      await partnerAuditService.record({
        partnerId: account.partnerId,
        actorUserId: adminId,
        action: 'PASSWORD_RESET_SENT',
        targetAccountId: account.id,
        req,
        metadata: { email: user.email, emailSent: emailed },
      });
      res.json({ success: true, data: { resetLink: link, expiresAt, emailSent: emailed } });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async forceLogout(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const account = await partnerRepository.findAccountById(req.params.accountId);
      if (!account) throw Object.assign(new Error('Không tìm thấy tài khoản'), { status: 404 });

      const result = await authClient.revokeSessions(account.userId);
      await partnerAuditService.record({
        partnerId: account.partnerId,
        actorUserId: adminId,
        action: 'SESSIONS_REVOKED',
        targetAccountId: account.id,
        req,
        metadata: { revoked: result.revoked },
      });
      res.json({ success: true, data: result });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async revokeAccount(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const reason = req.body?.reason;
      const account = await partnerService.revokeAccount(req.params.accountId, adminId, reason);

      // Thu hồi quyền mà để phiên đang mở sống tiếp thì việc thu hồi chỉ có tác dụng ở lần
      // đăng nhập sau — không phải ý nghĩa của "thu hồi".
      await authClient.revokeSessions(account.userId).catch(() => null);

      await partnerAuditService.record({
        partnerId: account.partnerId,
        actorUserId: adminId,
        action: 'ACCOUNT_REVOKED',
        targetAccountId: account.id,
        reason,
        req,
      });
      res.json({ success: true, data: account });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async transferOwnership(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { toAccountId, reason } = req.body ?? {};
      if (!toAccountId) throw Object.assign(new Error('toAccountId là bắt buộc'), { status: 400 });

      const result = await partnerService.transferOwnership(req.params.id, toAccountId, adminId);
      await partnerAuditService.record({
        partnerId: req.params.id,
        actorUserId: adminId,
        action: 'OWNERSHIP_TRANSFERRED',
        targetAccountId: toAccountId,
        reason,
        req,
        metadata: {
          previousOwnerAccountId: result.previousOwnerAccountId,
          gymsMoved: result.gymsMoved,
          brandsMoved: result.brandsMoved,
        },
      });
      res.json({ success: true, data: result });
    } catch (e: any) {
      fail(res, e);
    }
  },

  // ── Xem dưới góc nhìn đối tác ─────────────────────────────────────────────
  /**
   * ⚠️ KHÔNG phát hành token mạo danh. Đây là ảnh chụp CHỈ ĐỌC dữ liệu của đối tác, kết
   * xuất bằng chính quyền quản trị viên — không có credential nào của đối tác được tạo ra,
   * nên không có gì để rò rỉ hay dùng lại. Vẫn ghi nhật ký bắt buộc: một quản trị viên đọc
   * dữ liệu kinh doanh của đối tác là việc phải để lại dấu vết.
   */
  async viewAsPartner(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const partner = await partnerService.getPartner(req.params.id);
      const owner = partner.accounts.find((a) => a.role === 'OWNER' && a.status === 'ACTIVE');
      if (!owner) throw Object.assign(new Error('Đối tác chưa có chủ sở hữu đang hoạt động'), { status: 409 });

      const [gyms, brand] = await Promise.all([
        gymRepository.findByOwner(owner.userId),
        partner.brandId ? brandRepository.findById(partner.brandId) : Promise.resolve(null),
      ]);

      await partnerAuditService.record({
        partnerId: partner.id,
        actorUserId: adminId,
        action: 'VIEWED_AS_PARTNER',
        req,
        metadata: { readOnly: true, gymCount: gyms.length },
      });
      logger.info(`[Partner] admin ${adminId} viewed partner ${partner.id} in read-only mode`);

      res.json({ success: true, data: { readOnly: true, partner, brand, gyms } });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async auditLog(req: Request, res: Response) {
    const logs = await partnerAuditService.listForPartner(req.params.id);
    res.json({ success: true, data: logs });
  },

  // ── Phase 5 — tạm khoá / bỏ tạm khoá / chấm dứt ───────────────────────────
  async suspend(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const reason = req.body?.reason;
      const partner = await partnerService.suspend(req.params.id, adminId, reason);
      await partnerAuditService.record({ partnerId: partner.id, actorUserId: adminId, action: 'PARTNER_SUSPENDED', reason, req });
      res.json({ success: true, data: partner });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async unsuspend(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const partner = await partnerService.unsuspend(req.params.id, adminId);
      await partnerAuditService.record({ partnerId: partner.id, actorUserId: adminId, action: 'PARTNER_UNSUSPENDED', req });
      res.json({ success: true, data: partner });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async terminationImpact(req: Request, res: Response) {
    try {
      const impact = await partnerService.terminationImpact(req.params.id);
      res.json({ success: true, data: impact });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async terminate(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { reason, memberPolicy } = req.body ?? {};
      const result = await partnerService.terminate(req.params.id, adminId, reason, memberPolicy);
      await partnerAuditService.record({
        partnerId: req.params.id,
        actorUserId: adminId,
        action: 'PARTNER_TERMINATED',
        reason,
        req,
        metadata: { memberPolicy, refunded: result.refunded, refundErrors: result.refundErrors },
      });
      res.json({ success: true, data: result });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
