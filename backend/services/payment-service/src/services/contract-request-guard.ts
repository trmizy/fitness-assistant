import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { computeFingerprint } from '../utils/idempotency';
import { IdempotencyKeyConflictError, ledgerFingerprintEnforced, type LedgerOpMeta } from './ledger-idempotency';
import type { RateTable } from './contract-money';

/**
 * FH-2b. What payment-service checks about a contract-money request BEFORE it trusts it:
 *
 *  1. A fingerprint of the request's IMMUTABLE fields, stored with the idempotency key
 *     (ledger-idempotency.ts) so the same key cannot be replayed for a different request.
 *  2. A binding to the payment transaction itself: price, rates and parties are frozen onto the
 *     transaction at checkout (`amount`, `metadata.rates`, `metadata.parties`), so a request that
 *     disagrees with them is refused (422) instead of moving money in the wrong wallets.
 *
 * What is deliberately NOT fingerprinted: anything that legitimately changes between a call and its
 * retry — terminate's usedSessions / compensatedSessions / unresolvedSessions / alreadyReleased
 * (a held session being resolved changes them), the label, the holdback rate (the caller sends 0
 * once the holdback was released for inactivity).
 */

export class RequestDoesNotMatchTransactionError extends Error {
  readonly code = 'REQUEST_DOES_NOT_MATCH_TRANSACTION';
  constructor(message: string) {
    super(message);
  }
}

/** LEDGER_STRICT_OWN_FUNDS (default ON). OFF restores the pre-FH-1 pooled draw / platform fronting: emergency rollback only. */
export function ledgerStrictOwnFunds(): boolean {
  return (process.env.LEDGER_STRICT_OWN_FUNDS ?? 'true').trim().toLowerCase() !== 'false';
}

export type ContractOpKind =
  | 'RELEASE_SESSION'
  | 'NO_SHOW'
  | 'LATE_ARRIVAL'
  | 'TERMINATE'
  | 'RESOLVE_UNRESOLVED'
  | 'RELEASE_HOLDBACK'
  | 'UNACTIVATED_REFUND';

interface PartiesLike {
  ptUserId: string;
  gymId?: string | null;
  clientUserId: string;
}

const normGym = (g: string | null | undefined) => (g ? g : null);

export function contractOpMeta(
  kind: ContractOpKind,
  p: {
    transactionId: string;
    price?: Prisma.Decimal;
    totalSessions?: number;
    rates?: RateTable;
    parties?: PartiesLike;
    /** termination reason or resolve outcome */
    reason?: string;
  },
): LedgerOpMeta {
  return {
    kind,
    transactionId: p.transactionId,
    fingerprint: computeFingerprint({
      kind,
      transactionId: p.transactionId,
      price: p.price ? p.price.toFixed(2) : null,
      totalSessions: p.totalSessions ?? null,
      rates: p.rates
        ? {
            platformRate: p.rates.platformRate.toString(),
            ptRate: p.rates.ptRate.toString(),
            gymRate: p.rates.gymRate.toString(),
          }
        : null,
      parties: p.parties
        ? { ptUserId: p.parties.ptUserId, gymId: normGym(p.parties.gymId), clientUserId: p.parties.clientUserId }
        : null,
      reason: p.reason ?? null,
    }),
  };
}

/**
 * Refuses a request whose price / rates / parties disagree with the payment transaction it names.
 *
 * Runs only for a key that has NOT been used yet: a replay of an existing key returns the stored result
 * (and the fingerprint decides whether it is the same request), and a legacy key must keep replaying
 * whatever the caller now sends. A transaction that carries no snapshot (created before checkout froze
 * one) is allowed through and logged — there is nothing to compare with. Read-only, outside the wallet
 * locks: the fields compared are never rewritten after checkout.
 */
export async function assertRequestMatchesTransaction(p: {
  idempotencyKey: string;
  transactionId: string;
  price?: Prisma.Decimal;
  rates?: RateTable;
  parties?: PartiesLike;
  /** The operation's fingerprint: lets a conflicting reuse of a key be refused before any wallet is even resolved. */
  meta?: LedgerOpMeta;
}): Promise<void> {
  const used = await prisma.ledgerOperation.findUnique({
    where: { key: p.idempotencyKey },
    select: { requestFingerprint: true },
  });
  if (used) {
    // Same key, different immutable fields: refuse here, before resolveWallets could create a wallet for a party
    // that should not exist. The authoritative check is the one withIdempotentLedgerOp repeats under the wallet locks.
    if (p.meta && used.requestFingerprint && used.requestFingerprint !== p.meta.fingerprint && ledgerFingerprintEnforced()) {
      throw new IdempotencyKeyConflictError(p.idempotencyKey);
    }
    return;
  }

  const txn = await prisma.paymentTransaction.findUnique({
    where: { id: p.transactionId },
    select: { amount: true, metadata: true },
  });
  if (!txn) return; // the FK on the ledger rows turns an unknown transaction into a failed op, as before

  if (p.price && !new Prisma.Decimal(txn.amount).equals(p.price)) {
    throw new RequestDoesNotMatchTransactionError(
      `price ${p.price.toFixed(2)} does not match transaction ${p.transactionId} amount ${new Prisma.Decimal(txn.amount).toFixed(2)}`,
    );
  }

  const meta = (txn.metadata ?? {}) as Record<string, unknown>;

  if (p.rates) {
    const r = meta.rates as Record<string, string> | undefined;
    if (!r) {
      logger.warn(`[ContractRequestGuard] transaction ${p.transactionId} carries no rate snapshot — rates not checked`);
    } else {
      const same =
        new Prisma.Decimal(r.platformRate ?? NaN).equals(p.rates.platformRate) &&
        new Prisma.Decimal(r.ptRate ?? NaN).equals(p.rates.ptRate) &&
        new Prisma.Decimal(r.gymRate ?? NaN).equals(p.rates.gymRate);
      if (!same) {
        throw new RequestDoesNotMatchTransactionError(`rates do not match the snapshot frozen on transaction ${p.transactionId}`);
      }
    }
  }

  if (p.parties) {
    const t = meta.parties as { ptUserId?: string; gymId?: string | null; clientUserId?: string } | undefined;
    if (!t) {
      logger.warn(`[ContractRequestGuard] transaction ${p.transactionId} carries no party snapshot — parties not checked`);
    } else if (
      t.ptUserId !== p.parties.ptUserId ||
      t.clientUserId !== p.parties.clientUserId ||
      normGym(t.gymId) !== normGym(p.parties.gymId)
    ) {
      throw new RequestDoesNotMatchTransactionError(`parties do not match the snapshot frozen on transaction ${p.transactionId}`);
    }
  }
}
