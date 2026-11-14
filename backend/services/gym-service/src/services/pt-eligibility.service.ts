import { authClient } from '../clients/auth.client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(message: string, status: number, code: string) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * N13E-03 / N13E-04 (14/11/2026): a gym owner may only invite / propose to a REAL, ACTIVE trainer. Before this, "not-a-uuid", an unknown id and even a CUSTOMER's id
 * were accepted and left dangling PENDING rows that the owner pages then 404 on.
 *   400 INVALID_PT_USER_ID   not a UUID
 *   404 PT_NOT_FOUND         no such account
 *   422 NOT_A_PT             the account exists but is not a trainer (a PT role is only granted when the PT application is approved)
 *   422 PT_NOT_ACTIVE        the trainer account is disabled
 *   503 PT_CHECK_UNAVAILABLE auth-service could not be asked (fail closed: never invite on a guess)
 * Reads the account's role from auth-service (the owner of `role`): the same source the `requireRoles('PT')` gate of every PT route is built on.
 */
export async function assertInvitablePt(ptUserId: unknown): Promise<string> {
  if (typeof ptUserId !== 'string' || !UUID_RE.test(ptUserId.trim())) {
    throw err('Mã huấn luyện viên không hợp lệ', 400, 'INVALID_PT_USER_ID');
  }
  const id = ptUserId.trim();
  let user: { role: string; isActive?: boolean } | null = null;
  try {
    user = await authClient.getUser(id);
  } catch (e: any) {
    if (e?.response?.status === 404) throw err('Không tìm thấy huấn luyện viên này', 404, 'PT_NOT_FOUND');
    if (e?.response?.status === 400) throw err('Mã huấn luyện viên không hợp lệ', 400, 'INVALID_PT_USER_ID');
    throw err('Chưa kiểm tra được huấn luyện viên lúc này, vui lòng thử lại sau ít phút', 503, 'PT_CHECK_UNAVAILABLE');
  }
  if (!user || user.role !== 'PT') throw err('Người này không phải huấn luyện viên đã được duyệt', 422, 'NOT_A_PT');
  if (user.isActive === false) throw err('Tài khoản huấn luyện viên này đang bị khoá', 422, 'PT_NOT_ACTIVE');
  return id;
}
