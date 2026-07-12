import crypto from 'crypto';
import { transactionRepository } from '../repositories/transaction.repository';
import type { PaymentTransaction } from '../generated/prisma';

export function computeFingerprint(fields: Record<string, unknown>): string {
  const sorted = Object.keys(fields)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = fields[key] ?? null;
      return acc;
    }, {});
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

export type IdempotencyCheckResult =
  | { kind: 'NEW' }
  | { kind: 'REPLAY'; transaction: PaymentTransaction }
  | { kind: 'CONFLICT' };

/**
 * Looks up an idempotencyKey. If it already exists, the request payload's
 * fingerprint must match the one stored at first-write time — otherwise the
 * same key was reused with different data, which is rejected instead of
 * silently replaying either payload.
 */
export async function checkIdempotency(
  idempotencyKey: string,
  fingerprint: string,
): Promise<IdempotencyCheckResult> {
  const existing = await transactionRepository.findByIdempotencyKey(idempotencyKey);
  if (!existing) return { kind: 'NEW' };
  if (existing.requestFingerprint !== fingerprint) return { kind: 'CONFLICT' };
  return { kind: 'REPLAY', transaction: existing };
}
