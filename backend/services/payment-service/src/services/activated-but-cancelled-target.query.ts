import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

/**
 * FH-5 / R2 - READ-ONLY detection of the rows the bug already damaged.
 *
 * Before FH-5, a client who cancelled a personalized-service order or a gym membership while at the bank's page and
 * then paid left a transaction that the owning service answered "ok" to and payment-service marked ACTIVATED, while
 * the target is CANCELLED and the client's money sits in the partners' PENDING buckets. Those rows are NOT repaired
 * automatically (owner decision: FH-8, per group, after the production inventory) - this only lists them, for the
 * admin reconciliation report (FH-4).
 *
 * payment-service owns no order/membership status, so the caller supplies `lookupTargetStatus` (the report wires it
 * to the owning services).
 *
 * FH-4 accuracy rule: money still sitting in PENDING says NOTHING about the target's status (a normal ACTIVE membership
 * or order keeps its money in PENDING until release), so CANCELLED is never inferred from the ledger. A row is only
 * ever classified CANCELLED when `lookupTargetStatus` returns exactly 'CANCELLED'; a lookup that returns null / throws
 * is "unverified" (`classifyActivatedProductPayments().unverified`), a status other than CANCELLED drops the row.
 * No read-only status API exists on gym-service / ai-service today, so the admin report passes no lookup and lists every
 * row as unverified (neutral), not as a suspected cancellation.
 *
 * A row is a candidate only if ALL hold, so a legitimate cancel-after-activation (which refunds or forfeits through its own
 * ledger operation) is not mistaken for the defect:
 *   - transaction is PAID + ACTIVATED, purpose/entity is one of the two products, not itself a REFUND, carries no
 *     `unactivatedRefund` marker and has no REFUND child;
 *   - (CANCELLED list only) the owning service reports the target CANCELLED;
 *   - the transaction still has money sitting in non-client PENDING buckets (credits - debits > 0) and the client
 *     has received no refund credit for it.
 */
export type TargetStatusLookup = (txn: {
  id: string;
  relatedEntityType: string;
  relatedEntityId: string;
}) => Promise<string | null>;

export interface ActivatedButCancelledRow {
  transactionId: string;
  relatedEntityType: string;
  relatedEntityId: string;
  payerId: string;
  amount: string;
  targetStatus: string;
  /** Still held in partners' PENDING buckets on behalf of this transaction. */
  partnerPendingRemaining: string;
  /** Refund credits the client has already received for this transaction (expected 0.00). */
  clientRefundCredited: string;
}

const PRODUCTS = ['PERSONALIZED_SERVICE_PURCHASE', 'GYM_MEMBERSHIP'] as const;

type Outcome = 'CANCELLED' | 'UNVERIFIED';

async function scanCandidates(
  lookupTargetStatus: TargetStatusLookup | null,
  opts: { limit?: number },
): Promise<Array<{ outcome: Outcome; row: ActivatedButCancelledRow }>> {
  const candidates = await prisma.paymentTransaction.findMany({
    where: {
      status: 'PAID',
      activationStatus: 'ACTIVATED',
      purpose: { not: 'REFUND' },
      relatedEntityType: { in: [...PRODUCTS] },
      relatedEntityId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 1000,
  });

  const found: Array<{ outcome: Outcome; row: ActivatedButCancelledRow }> = [];
  for (const txn of candidates) {
    if ((txn.metadata as Record<string, unknown> | null)?.unactivatedRefund) continue;

    let targetStatus: string | null = null;
    if (lookupTargetStatus) {
      try {
        targetStatus = await lookupTargetStatus({
          id: txn.id,
          relatedEntityType: String(txn.relatedEntityType),
          relatedEntityId: txn.relatedEntityId as string,
        });
      } catch {
        targetStatus = null;
      }
    }
    // The owning service answered with a status that is not CANCELLED (ACTIVE, EXPIRED, ...): not a candidate at all.
    if (targetStatus !== null && targetStatus !== undefined && targetStatus !== 'CANCELLED') continue;
    const outcome: Outcome = targetStatus === 'CANCELLED' ? 'CANCELLED' : 'UNVERIFIED';

    const refundChild = await prisma.paymentTransaction.count({ where: { refundOfTransactionId: txn.id } });
    if (refundChild > 0) continue;

    const entries = await prisma.walletLedgerEntry.findMany({
      where: { transactionId: txn.id },
      include: { wallet: { select: { ownerType: true } } },
    });
    let partnerPending = new Prisma.Decimal(0);
    let clientRefund = new Prisma.Decimal(0);
    for (const e of entries) {
      const amt = new Prisma.Decimal(e.amount);
      if (e.wallet.ownerType !== 'CLIENT' && e.bucket === 'PENDING') {
        partnerPending = e.entryType === 'CREDIT' ? partnerPending.plus(amt) : partnerPending.minus(amt);
      } else if (e.wallet.ownerType === 'CLIENT' && e.bucket === 'AVAILABLE' && e.entryType === 'CREDIT' && /refund/i.test(e.description ?? '')) {
        clientRefund = clientRefund.plus(amt);
      }
    }
    if (partnerPending.lessThanOrEqualTo(0) || clientRefund.greaterThan(0)) continue;

    found.push({
      outcome,
      row: {
        transactionId: txn.id,
        relatedEntityType: String(txn.relatedEntityType),
        relatedEntityId: txn.relatedEntityId as string,
        payerId: txn.payerId,
        amount: new Prisma.Decimal(txn.amount).toFixed(2),
        targetStatus: outcome === 'CANCELLED' ? 'CANCELLED' : 'UNVERIFIED',
        partnerPendingRemaining: partnerPending.toFixed(2),
        clientRefundCredited: clientRefund.toFixed(2),
      },
    });
  }
  return found;
}

/** Rows whose owning service reported the target CANCELLED (and whose money is still held, no client refund). */
export async function findActivatedButCancelledTargets(
  lookupTargetStatus: TargetStatusLookup,
  opts: { limit?: number } = {},
): Promise<ActivatedButCancelledRow[]> {
  return (await scanCandidates(lookupTargetStatus, opts)).filter((x) => x.outcome === 'CANCELLED').map((x) => x.row);
}

/**
 * `cancelled`: the owning service said CANCELLED. `unverified`: the status could not be determined (lookup returned
 * null / threw / was not available) - a neutral "not checked yet" list, NEVER a cancellation warning.
 */
export async function classifyActivatedProductPayments(
  lookupTargetStatus: TargetStatusLookup | null,
  opts: { limit?: number } = {},
): Promise<{ cancelled: ActivatedButCancelledRow[]; unverified: ActivatedButCancelledRow[] }> {
  const all = await scanCandidates(lookupTargetStatus, opts);
  return {
    cancelled: all.filter((x) => x.outcome === 'CANCELLED').map((x) => x.row),
    unverified: all.filter((x) => x.outcome === 'UNVERIFIED').map((x) => x.row),
  };
}
