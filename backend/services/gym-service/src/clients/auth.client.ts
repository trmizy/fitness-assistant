import axios from 'axios';
import { logger } from '@gym-coach/shared';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

/**
 * Phase 2 — những việc auth-service phải làm hộ luồng quản trị đối tác. gym-service không
 * bao giờ chạm tới mật khẩu hay phiên đăng nhập; nó chỉ nhờ dịch vụ sở hữu credential làm
 * và ghi lại kết quả vào nhật ký kiểm toán của mình.
 */
export const authClient = {
  /** Phát hành link đặt lại mật khẩu — trả về token gốc đúng một lần để dựng link. */
  async issuePasswordReset(userId: string, requestedBy: string) {
    const { data } = await axios.post(
      `${AUTH_SERVICE_URL}/auth/internal/partner-auth/password-reset`,
      { userId, requestedBy },
      { headers, timeout: 5000 },
    );
    return data as { rawToken: string; expiresAt: string; user: { id: string; email: string; firstName: string | null } };
  },

  /**
   * Đăng nhập/khoá đăng nhập của MỘT tài khoản cụ thể — dùng cho tạm khoá/bỏ tạm khoá
   * đối tác (Phase 5 mục 5.1): chỉ khoá tài khoản OWNER, không đụng tới MANAGER.
   */
  async setUserActive(userId: string, isActive: boolean, actorUserId: string, reason?: string) {
    const { data } = await axios.post(
      `${AUTH_SERVICE_URL}/auth/internal/partner-auth/set-active`,
      { userId, isActive, actorUserId, reason },
      { headers, timeout: 5000 },
    );
    return data.user;
  },

  /** Buộc đăng xuất — huỷ mọi refresh token của tài khoản. */
  async revokeSessions(userId: string) {
    const { data } = await axios.post(
      `${AUTH_SERVICE_URL}/auth/internal/partner-auth/revoke-sessions`,
      { userId },
      { headers, timeout: 5000 },
    );
    return data as { revoked: number };
  },

  /** Lập tài khoản đăng nhập cho người vừa nhận thư mời (mật khẩu do chính họ đặt). */
  async createInvitedAccount(payload: { email: string; password: string; firstName: string; lastName?: string }) {
    const { data } = await axios.post(
      `${AUTH_SERVICE_URL}/auth/internal/partner-auth/create-invited-account`,
      payload,
      { headers, timeout: 5000 },
    );
    return data.user as { id: string; email: string; firstName: string | null; lastName: string | null; role: string };
  },

  async getUser(userId: string) {
    const { data } = await axios.get(`${AUTH_SERVICE_URL}/auth/internal/users/${userId}`, { headers, timeout: 5000 });
    return data.user as { id: string; email: string; firstName: string | null; lastName: string | null; role: string; isActive: boolean };
  },

  /**
   * Gửi email. Lỗi gửi mail KHÔNG được làm hỏng hành động chính: thư mời đã tồn tại trong
   * CSDL và quản trị viên có thể gửi lại — ném lỗi ở đây thì tình huống tệ nhất là thư mời
   * đã tạo nhưng phía gọi tưởng thất bại rồi tạo thêm cái nữa.
   */
  async sendEmail(payload: { to: string; subject: string; text: string; html?: string }): Promise<boolean> {
    try {
      await axios.post(`${AUTH_SERVICE_URL}/auth/internal/send-email`, payload, { headers, timeout: 8000 });
      return true;
    } catch (e) {
      logger.error({ err: (e as Error).message, to: payload.to }, '[gym-service] gửi email thất bại');
      return false;
    }
  },
};
