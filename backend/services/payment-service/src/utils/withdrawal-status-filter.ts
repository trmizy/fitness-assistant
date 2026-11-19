import type { WithdrawalRequestStatus } from '../generated/prisma';

const VALID: WithdrawalRequestStatus[] = ['PENDING', 'APPROVED', 'PAID', 'REJECTED'];

/** `?status=` of GET /admin/payments/withdrawals: absent => no filter; unknown => not ok (400). */
export function parseWithdrawalStatusFilter(
  value: unknown,
): { ok: true; status?: WithdrawalRequestStatus } | { ok: false } {
  if (value === undefined) return { ok: true };
  if (typeof value === 'string' && (VALID as string[]).includes(value)) {
    return { ok: true, status: value as WithdrawalRequestStatus };
  }
  return { ok: false };
}
