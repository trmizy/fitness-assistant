import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { invokeHttpLambda, throwForLambdaHttpError } from './lambda-http.client';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

/**
 * Một cổng gọi auth-service. Trên AWS Lambda không có HTTP nội bộ giữa các service nên khi có
 * AUTH_LAMBDA_NAME ta invoke thẳng Lambda auth (cùng mẫu với auth-service.client.ts / profile.client.ts);
 * không có biến đó (dev/compose) thì dùng axios tới AUTH_SERVICE_URL như cũ. Lỗi từ Lambda được ném với
 * `err.response.status/data` giống axios nên các nơi gọi đọc `e.response.status` không đổi.
 */
async function authCall<T = any>(method: 'GET' | 'POST', path: string, body: unknown, timeout: number): Promise<T> {
  const lambdaName = process.env.AUTH_LAMBDA_NAME;
  if (lambdaName) {
    const result = await invokeHttpLambda({ functionName: lambdaName, method, path, headers, body: method === 'GET' ? undefined : body });
    throwForLambdaHttpError(result);
    return result.body as T;
  }
  const { data } =
    method === 'GET'
      ? await axios.get(`${AUTH_SERVICE_URL}${path}`, { headers, timeout })
      : await axios.post(`${AUTH_SERVICE_URL}${path}`, body, { headers, timeout });
  return data as T;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('auth-service timeout'), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Phase 2 — những việc auth-service phải làm hộ luồng quản trị đối tác. gym-service không
 * bao giờ chạm tới mật khẩu hay phiên đăng nhập; nó chỉ nhờ dịch vụ sở hữu credential làm
 * và ghi lại kết quả vào nhật ký kiểm toán của mình.
 */
export const authClient = {
  /** Phát hành link đặt lại mật khẩu — trả về token gốc đúng một lần để dựng link. */
  async issuePasswordReset(userId: string, requestedBy: string) {
    const data = await authCall('POST', '/auth/internal/partner-auth/password-reset', { userId, requestedBy }, 5000);
    return data as { rawToken: string; expiresAt: string; user: { id: string; email: string; firstName: string | null } };
  },

  /**
   * Đăng nhập/khoá đăng nhập của MỘT tài khoản cụ thể — dùng cho tạm khoá/bỏ tạm khoá
   * đối tác (Phase 5 mục 5.1): chỉ khoá tài khoản OWNER, không đụng tới MANAGER.
   */
  async setUserActive(userId: string, isActive: boolean, actorUserId: string, reason?: string) {
    const data = await authCall('POST', '/auth/internal/partner-auth/set-active', { userId, isActive, actorUserId, reason }, 5000);
    return data.user;
  },

  /** Buộc đăng xuất — huỷ mọi refresh token của tài khoản. */
  async revokeSessions(userId: string) {
    const data = await authCall('POST', '/auth/internal/partner-auth/revoke-sessions', { userId }, 5000);
    return data as { revoked: number };
  },

  /** Lập tài khoản đăng nhập cho người vừa nhận thư mời (mật khẩu do chính họ đặt). */
  async createInvitedAccount(payload: { email: string; password: string; firstName: string; lastName?: string }) {
    const data = await authCall('POST', '/auth/internal/partner-auth/create-invited-account', payload, 5000);
    return data.user as { id: string; email: string; firstName: string | null; lastName: string | null; role: string };
  },

  /**
   * B10 - does an auth account already use this email, and of which kind? Used before a staff invitation is created.
   * Best-effort by design: returns null when auth-service cannot be asked (unreachable, 5xx, 401, 400) so an outage never
   * blocks an invite - the accept step still refuses an existing email.
   */
  async emailStatus(email: string): Promise<{ exists: boolean; role: string | null } | null> {
    try {
      const data = await authCall('POST', '/auth/internal/partner-auth/email-status', { email }, 4000);
      return { exists: Boolean(data?.exists), role: typeof data?.role === 'string' ? data.role : null };
    } catch (e) {
      logger.warn({ err: (e as Error).message }, '[gym-service] không tra được trạng thái email ở auth-service - bỏ qua kiểm tra khi mời nhân sự');
      return null;
    }
  },

  /** Tra nhiều tài khoản một lần (id/email/tên). Lỗi mạng ném ra - phía gọi quyết định cách xử lý. */
  async getUsersBatch(userIds: string[]) {
    if (userIds.length === 0) return [] as Array<{ id: string; email: string; firstName: string | null; lastName: string | null }>;
    const data = await authCall('POST', '/auth/internal/users/batch', { userIds }, 5000);
    return (data?.users ?? []) as Array<{ id: string; email: string; firstName: string | null; lastName: string | null }>;
  },

  /**
   * Owner member search: which of THESE user ids have a display name matching `q` (auth-service owns the names; matching is
   * accent-insensitive, see auth-service utils/vi-search.ts). The route only filters the supplied ids (max 500) and returns a
   * subset of them. Network / 4xx / 5xx errors THROW - the caller must never read "could not ask" as "no match" or as "everyone".
   */
  async searchUserIdsByName(userIds: string[], q: string): Promise<string[]> {
    if (userIds.length === 0) return [];
    const data = await withTimeout(authCall('POST', '/auth/internal/users/search-by-name', { userIds, q }, 5000), 6000);
    if (!Array.isArray(data?.matchedIds)) throw new Error('auth-service search-by-name: unexpected response');
    return (data.matchedIds as unknown[]).filter((x): x is string => typeof x === 'string');
  },

  async getUser(userId: string) {
    const data = await authCall('GET', `/auth/internal/users/${encodeURIComponent(userId)}`, undefined, 5000);
    return data.user as { id: string; email: string; firstName: string | null; lastName: string | null; role: string; isActive: boolean };
  },

  /**
   * Gửi email. Lỗi gửi mail KHÔNG được làm hỏng hành động chính: thư mời đã tồn tại trong
   * CSDL và quản trị viên có thể gửi lại — ném lỗi ở đây thì tình huống tệ nhất là thư mời
   * đã tạo nhưng phía gọi tưởng thất bại rồi tạo thêm cái nữa.
   */
  async sendEmail(payload: { to: string; subject: string; text: string; html?: string }): Promise<boolean> {
    try {
      const data = await authCall('POST', '/auth/internal/send-email', payload, 8000);
      // auth-service trả 200 {delivered:false} khi SMTP chưa cấu hình — thư KHÔNG đi, không được báo "đã gửi" (N09C-04).
      if (data && typeof data === 'object' && (data as { delivered?: unknown }).delivered === false) {
        logger.warn({ to: payload.to }, '[gym-service] auth-service báo chưa gửi được email (delivered=false, SMTP chưa cấu hình?)');
        return false;
      }
      return true;
    } catch (e) {
      logger.error({ err: (e as Error).message, to: payload.to }, '[gym-service] gửi email thất bại');
      return false;
    }
  },
};
