import { Request, Response } from 'express';
import { partnerInvitationService } from '../services/partner-invitation.service';
import { authClient } from '../clients/auth.client';

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { ...(typeof e.code === 'string' ? { code: e.code } : {}), message: e.message || 'Đã có lỗi xảy ra' } });
}

const MIN_PASSWORD_LENGTH = 8;
/** C1-03 - cùng chính sách mật khẩu với đăng ký thường (auth-service models/auth.models.ts: PASSWORD_COMPLEXITY = chữ thường + chữ hoa + chữ số, tối thiểu 8). */
const PASSWORD_COMPLEXITY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
export const PASSWORD_COMPLEXITY_MESSAGE = 'Mật khẩu phải có chữ hoa, chữ thường và chữ số';

/**
 * B11 - lỗi từ auth-service khi lập tài khoản cho người nhận lời mời. axios ném "Request failed with status code 400" và
 * người dùng không biết sai gì; ở đây lấy đúng thông điệp (tiếng Việt) auth-service trả về và gắn mã:
 *   409 -> EMAIL_IN_USE · 400 mật khẩu -> WEAK_PASSWORD · 400 khác -> INVALID_ACCOUNT_DATA · không gọi được -> AUTH_SERVICE_UNAVAILABLE.
 */
export function describeAuthAccountError(e: any): Error & { status: number; code: string } {
  const status: number | undefined = e?.response?.status;
  const raw = e?.response?.data;
  const upstream: string = typeof raw?.error === 'string' ? raw.error : typeof raw?.error?.message === 'string' ? raw.error.message : typeof raw?.message === 'string' ? raw.message : '';
  const make = (st: number, code: string, message: string) => Object.assign(new Error(message), { status: st, code });
  if (status === 409) return make(409, 'EMAIL_IN_USE', 'Email này đã có tài khoản Gymini nên không dùng để nhận lời mời được — hãy nhờ người mời gửi lời mời tới một email khác');
  if (status === 400) {
    const weak = /mật khẩu|password/i.test(upstream);
    return make(400, weak ? 'WEAK_PASSWORD' : 'INVALID_ACCOUNT_DATA', upstream || (weak ? 'Mật khẩu chưa đủ mạnh' : 'Thông tin tạo tài khoản chưa hợp lệ'));
  }
  if (status && status >= 400 && status < 500) return make(status, 'ACCOUNT_CREATION_REFUSED', upstream || 'Không tạo được tài khoản');
  return make(502, 'AUTH_SERVICE_UNAVAILABLE', 'Chưa tạo được tài khoản lúc này, vui lòng thử lại sau ít phút');
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
      if (!password || typeof password !== 'string' || !firstName?.trim()) {
        res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'Vui lòng nhập mật khẩu và tên của bạn' } });
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ success: false, error: { code: 'WEAK_PASSWORD', message: `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự` } });
        return;
      }
      if (!PASSWORD_COMPLEXITY.test(password)) {
        res.status(400).json({ success: false, error: { code: 'WEAK_PASSWORD', message: PASSWORD_COMPLEXITY_MESSAGE } });
        return;
      }
      const invitation = await partnerInvitationService.validateToken(req.params.token);
      let user;
      try {
        user = await authClient.createInvitedAccount({
          email: invitation.email,
          password,
          firstName: firstName.trim(),
          lastName: lastName?.trim(),
        });
      } catch (authError) {
        throw describeAuthAccountError(authError);
      }
      const account = await partnerInvitationService.acceptInvitation(req.params.token, user.id);
      res.status(201).json({ success: true, data: { email: user.email, role: account.role } });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
