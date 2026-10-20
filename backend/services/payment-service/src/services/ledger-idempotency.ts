import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import type { LedgerOps } from './wallet.service';

/**
 * Runs `run` at most once for a given business key, inside the same DB transaction as the
 * wallet movements it guards (money-flow redesign plan item 1.1).
 *
 * Every cross-service financial call in this system can legitimately be retried: the caller
 * (user-service, gym-service) may have crashed or timed out *after* payment-service committed
 * the money movement but *before* it recorded that success locally. Without a business-level
 * key, that retry re-executes the same movement a second time — the `transactionId` these
 * functions also take is only ever an FK anchor for WalletLedgerEntry rows and a label, never
 * a uniqueness check.
 *
 * The check-and-record happens inside the SAME `prisma.$transaction` as `run`'s wallet writes
 * (both share `ops.tx`), so a crash between "money moved" and "this row committed" is
 * impossible: either the whole transaction commits — money moved AND the key is claimed — or
 * it rolls back entirely and a retry starts clean. Two concurrent callers racing on the same
 * key that also touch the same wallets already serialize on the wallet FOR UPDATE locks
 * `withWallets` takes before this ever runs, so the loser simply finds the row the winner just
 * committed and replays it rather than racing on the key's unique index.
 *
 * FH-2b. A caller may also hand over a fingerprint of the IMMUTABLE fields of its request (kind,
 * transaction, price, session count, rates, parties, reason/outcome). It is stored with the key, and
 * a later call under the same key with a DIFFERENT fingerprint is refused (IdempotencyKeyConflictError,
 * 409 upstream) instead of silently replaying the first caller's result. Rows without a stored
 * fingerprint (written before the column existed, or by a caller that does not fingerprint) replay
 * as they always did — nothing is back-filled.
 */


/** Same business key, different immutable request fields. Mapped to 409 IDEMPOTENCY_KEY_CONFLICT. */
export class IdempotencyKeyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_CONFLICT';
  constructor(public readonly key: string) {
    super(`idempotency key ${key} was already used for a different request`);
  }
}

/** LEDGER_FINGERPRINT_ENFORCE (default true). false: a mismatch is only logged and the old result replays. */
export function ledgerFingerprintEnforced(): boolean {
  return (process.env.LEDGER_FINGERPRINT_ENFORCE ?? 'true').trim().toLowerCase() !== 'false';
}

export interface LedgerOpMeta {
  /** computeFingerprint(...) of the immutable request fields. */
  fingerprint: string;
  transactionId: string;
  kind: string;
}

export async function withIdempotentLedgerOp<T>(ops: LedgerOps, key: string, run: () => Promise<T>): Promise<T>;
export async function withIdempotentLedgerOp<T>(ops: LedgerOps, key: string, meta: LedgerOpMeta, run: () => Promise<T>): Promise<T>;
export async function withIdempotentLedgerOp<T>(
  ops: LedgerOps,
  key: string,
  metaOrRun: LedgerOpMeta | (() => Promise<T>),
  maybeRun?: () => Promise<T>,
): Promise<T> {
  const meta = typeof metaOrRun === 'function' ? undefined : metaOrRun;
  const run = typeof metaOrRun === 'function' ? metaOrRun : maybeRun!;

  const existing = await ops.tx.ledgerOperation.findUnique({ where: { key } });
  if (existing) {
    if (meta && existing.requestFingerprint && existing.requestFingerprint !== meta.fingerprint) {
      if (ledgerFingerprintEnforced()) throw new IdempotencyKeyConflictError(key);
      logger.warn(`[LedgerIdempotency] key ${key} reused with different request fields — replaying the stored result (LEDGER_FINGERPRINT_ENFORCE=false)`);
    }
    return existing.result as T;
  }
  const result = await run();
  await ops.tx.ledgerOperation.create({
    data: {
      key,
      result: result as unknown as Prisma.InputJsonValue,
      requestFingerprint: meta?.fingerprint ?? null,
      transactionId: meta?.transactionId ?? null,
      kind: meta?.kind ?? null,
    },
  });
  return result;
}
