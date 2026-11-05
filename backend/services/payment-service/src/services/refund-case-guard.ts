import { postServiceJson } from '../clients/service-lambda.client';

/**
 * E6 / F2 (Ngài, 05/11/2026) - a refund through POST /admin/payments/:id/refund must not BYPASS a dispute Case. Before anything is written, the SERVICE THAT OWNS the paid entity is asked
 * (read-only internal route, nothing is changed there):
 *   GYM_MEMBERSHIP -> gym-service   POST /internal/gym-memberships/:id/refund-guard   (gym refund-guard.ts: an unfinished Case or an approved decision on the membership)
 *   PT_CONTRACT    -> user-service  POST /internal/contracts/:id/refund-guard         (an open Case or an approved decision on any session of the contract)
 * 409 from the owner = refused with the owner's stable code. The owner not answering (network, 5xx, malformed answer) = REFUSED (503, fail-closed): an unreadable guard is never read as "no Case".
 * Other payment kinds have no Case and are not asked. An independent refund of an entity with no Case works exactly as before.
 */
export class RefundGuardError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function assertRefundNotBypassingCase(original: { relatedEntityType: string | null; relatedEntityId: string | null }): Promise<void> {
  const type = original.relatedEntityType;
  if (type !== 'GYM_MEMBERSHIP' && type !== 'PT_CONTRACT') return;
  const id = original.relatedEntityId;
  if (!id) throw new RefundGuardError(503, 'REFUND_GUARD_UNAVAILABLE', 'Không xác định được đối tượng của khoản thanh toán để kiểm tra hồ sơ khiếu nại, nên chưa hoàn tiền');
  const headers = { 'x-service-secret': process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production' };
  const service = type === 'GYM_MEMBERSHIP' ? 'gym' : 'user';
  const path = type === 'GYM_MEMBERSHIP' ? `/internal/gym-memberships/${encodeURIComponent(id)}/refund-guard` : `/internal/contracts/${encodeURIComponent(id)}/refund-guard`;
  let answer: any;
  try {
    answer = await postServiceJson({ service, path, body: {}, headers, timeoutMs: 5000 });
  } catch (e: any) {
    const status = e?.response?.status ?? e?.statusCode;
    const body = e?.response?.data ?? e?.body;
    const code = body?.error?.code;
    if (status === 409 && typeof code === 'string') {
      throw new RefundGuardError(409, code, body?.error?.message || 'Khoản thanh toán này thuộc một hồ sơ khiếu nại: không hoàn tiền ngoài hồ sơ', body?.error?.details);
    }
    throw new RefundGuardError(503, 'REFUND_GUARD_UNAVAILABLE', 'Không hỏi được dịch vụ sở hữu khoản thanh toán về hồ sơ khiếu nại, nên chưa hoàn tiền. Chưa ghi gì.');
  }
  if (answer?.success !== true || answer?.data?.allowed !== true) {
    throw new RefundGuardError(503, 'REFUND_GUARD_UNAVAILABLE', 'Dịch vụ sở hữu khoản thanh toán trả lời không rõ về hồ sơ khiếu nại, nên chưa hoàn tiền. Chưa ghi gì.');
  }
}
