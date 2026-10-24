import { Prisma } from '../generated/prisma';

/**
 * Route-layer guard for a requested withdrawal amount (B28). withdrawalService.requestWithdrawal
 * builds a `Prisma.Decimal` from the raw string and throws a bare DecimalError for input like
 * "abc" (HTTP 500); this lets the route answer 400 INVALID_AMOUNT before the service is called.
 * Range/minimum rules stay in the service - this only rejects what is not a number at all.
 */
export function isParsableAmount(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  try {
    const d = new Prisma.Decimal(raw);
    return d.isFinite();
  } catch {
    return false;
  }
}

export const INVALID_AMOUNT_BODY = {
  success: false,
  error: { code: 'INVALID_AMOUNT', message: 'Số tiền rút không hợp lệ' },
} as const;
