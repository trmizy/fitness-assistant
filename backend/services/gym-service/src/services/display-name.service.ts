import { authServiceClient } from '../clients/auth-service.client';

const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

/**
 * D15b - tên HIỂN THỊ của người dùng cho nhân sự quầy (lễ tân). auth-service là nơi giữ tên.
 *
 * Chỉ trả `firstName lastName` đã ghép. KHÔNG BAO GIỜ rơi về e-mail / số điện thoại khi thiếu tên (khác với
 * `fetchClientName` của checkin.service dùng cho màn hình của chính hội viên): thiếu tên → không có phần tử, người
 * gọi tự dùng nhãn trung tính. Lỗi mạng cũng chỉ là "thiếu tên", không bao giờ làm hỏng danh sách.
 */
export async function resolveDisplayNames(userIds: readonly string[], opts: { concurrency?: number; max?: number } = {}): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)].slice(0, opts.max ?? 200);
  const out = new Map<string, string>();
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const data = await authServiceClient.getInternalUser(id, INTERNAL_SERVICE_SECRET);
        const u = data?.user ?? data;
        const name = [u?.firstName, u?.lastName].filter((x) => typeof x === 'string' && x.trim()).join(' ').trim();
        if (name) out.set(id, name);
      } catch {
        /* thiếu tên không được chặn quầy */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}
