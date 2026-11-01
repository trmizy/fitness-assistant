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

/**
 * C2-02: VND has no minor unit, so a payout cannot be 10000.555 (the ledger stored 10000.56 and locked/refunded exactly that).
 * Whole-dong only: "10000" and "10000.00" pass (same value), "10000.5" / "10000.555" do not. Ledger math is untouched.
 */
export function isValidWithdrawalAmount(raw: unknown): boolean {
  if (!isParsableAmount(raw)) return false;
  return new Prisma.Decimal(raw as string).isInteger();
}

export const INVALID_AMOUNT_BODY = {
  success: false,
  error: { code: 'INVALID_AMOUNT', message: 'Số tiền rút không hợp lệ' },
} as const;
