import { Request, Response } from 'express';
import { partnerInvitationService } from '../services/partner-invitation.service';
import { authClient } from '../clients/auth.client';

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || 'Đã có lỗi xảy ra' } });
}

/**
 * Không xác thực — người mở link chưa có tài khoản nào. Bằng chứng duy nhất là cầm được
 * token trong link (xem partnerInvitationService's doc comment về việc chỉ lưu băm).
 */
export const publicPartnerController = {
  async previewInvitation(req: Request, res: Response) {
    try {
      const invitation = await partnerInvitationService.validateToken(req.params.token);
      res.json({
        success: true,
        data: {
          role: invitation.role,
          email: invitation.email,
          partnerName: invitation.partner.legalName,
          expiresAt: invitation.expiresAt,
        },
      });
    } catch (e: any) {
      fail(res, e);
    }
  },

  /**
   * Chấp nhận thư mời: tạo tài khoản đăng nhập ở auth-service (mật khẩu do CHÍNH người
   * này đặt — gym-service không bao giờ chạm tới mật khẩu, xem authClient.createInvitedAccount's
   * doc comment) rồi gắn vào đối tác. Trả về email/role để frontend tự gọi
   * POST /auth/login ngay sau đó — gym-service không phát hành access token của riêng nó.
   */
  async acceptInvitation(req: Request, res: Response) {
    try {
      const { password, firstName, lastName } = req.body ?? {};
      if (!password || !firstName?.trim()) {
        res.status(400).json({ success: false, error: { message: 'password và firstName là bắt buộc' } });
        return;
      }
      const invitation = await partnerInvitationService.validateToken(req.params.token);
      const user = await authClient.createInvitedAccount({
        email: invitation.email,
        password,
        firstName: firstName.trim(),
        lastName: lastName?.trim(),
      });
      const account = await partnerInvitationService.acceptInvitation(req.params.token, user.id);
      res.status(201).json({ success: true, data: { email: user.email, role: account.role } });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
