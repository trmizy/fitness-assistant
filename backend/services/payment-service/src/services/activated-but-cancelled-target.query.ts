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
 * to read-only internal routes on gym-service / ai-service: target-status.client.ts).
 *
 * Outcomes per PAID + ACTIVATED product payment:
 *   - owner says the target is alive (ACTIVE, EXPIRED, ...)              -> counted as `activeValid`, never listed;
 *   - owner says CANCELLED/REFUNDED, money still held, client unrefunded -> `cancelled` (the warning);
 *   - owner says CANCELLED/REFUNDED and the client was refunded          -> `refundCompleted` (refund >= expected) or
 *                                                                           `refundShort` (joined with the ledger and any OPEN obligation);
 *   - lookup failed / timed out / owner has no such row / no lookup      -> `unverified` (pending verification, neutral).
 *
 * FH-4 accuracy rule: money still sitting in PENDING says NOTHING about the target's status (a normal ACTIVE membership
 * or order keeps its money in PENDING until release), so CANCELLED is never inferred from the ledger. A row is only
 * ever classified CANCELLED when `lookupTargetStatus` returns CANCELLED (or REFUNDED for an order); a lookup that returns
 * null / throws is "unverified"; any other status is "alive". Passing no lookup lists every row as unverified.
 *
 * A legitimate cancel-after-activation (which refunds or forfeits through its own ledger operation) is not mistaken
 * for the defect: a transaction that is itself a REFUND, carries an `unactivatedRefund` marker, or (unverified group
 * only) already has a REFUND child is skipped.
 */
export type TargetRef = { id: string; relatedEntityType: string; relatedEntityId: string };

/**
 * `prime` (optional) lets a lookup fetch every candidate in a few batched calls before the per-row loop;
 * `ownerRefundedAmount` (optional) exposes what the owning service says was refunded (personalized orders only).
 */
export type TargetStatusLookup = ((txn: TargetRef) => Promise<string | null>) & {
  prime?: (txns: TargetRef[]) => Promise<void>;
  ownerRefundedAmount?: (txn: TargetRef) => number | null;
};

export type ProductPaymentOutcome = 'CANCELLED_PAID' | 'UNVERIFIED' | 'REFUND_COMPLETED' | 'REFUND_SHORT';

export interface ActivatedButCancelledRow {
  transactionId: string;
  relatedEntityType: string;
  relatedEntityId: string;
  payerId: string;
  amount: string;
  targetStatus: string;
  outcome: ProductPaymentOutcome;
  /** Still held in partners' PENDING buckets on behalf of this transaction. */
  partnerPendingRemaining: string;
  /** Refund credits the client has received for this transaction (ledger; 0.00 for the warning group). */
  clientRefundCredited: string;
  /** What the owning service says was refunded (personalized orders only), else null. */
  ownerRefundedAmount: string | null;
  /** What the client should have got back minus what the ledger shows (refund-short rows), else 0.00. */
  refundShortBy: string;
  /** OPEN unpaid obligations recorded against this transaction. */
  openObligationUnpaid: string;
}

const PRODUCTS = ['PERSONALIZED_SERVICE_PURCHASE', 'GYM_MEMBERSHIP'] as const;
/** Owner statuses meaning "this target no longer exists as a live product". */
const TERMINATED = new Set(['CANCELLED', 'REFUNDED']);
const CENT = new Prisma.Decimal('0.01');

interface Scan {
  found: Array<{ outcome: ProductPaymentOutcome; row: ActivatedButCancelledRow }>;
  /** Candidates the owning service confirmed alive: not a problem, only counted. */
  activeValid: number;
}

async function scanCandidates(lookupTargetStatus: TargetStatusLookup | null, opts: { limit?: number }): Promise<Scan> {
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

  const usable = candidates.filter((t) => !(t.metadata as Record<string, unknown> | null)?.unactivatedRefund);
  const ref = (t: (typeof usable)[number]): TargetRef => ({
    id: t.id,
    relatedEntityType: String(t.relatedEntityType),
    relatedEntityId: t.relatedEntityId as string,
  });
  if (lookupTargetStatus?.prime) {
    try {
      await lookupTargetStatus.prime(usable.map(ref));
    } catch {
      // a failed prime leaves every row unresolved -> pending verification below
    }
  }

  const found: Scan['found'] = [];
  let activeValid = 0;
  for (const txn of usable) {
    let targetStatus: string | null = null;
    if (lookupTargetStatus) {
      try {
        targetStatus = await lookupTargetStatus(ref(txn));
      } catch {
        targetStatus = null;
      }
    }
    const known = targetStatus !== null && targetStatus !== undefined;
    const terminated = known && TERMINATED.has(targetStatus as string);
    // The owning service answered with a live status (ACTIVE, EXPIRED, ...): not a problem, only counted.
    if (known && !terminated) {
      activeValid += 1;
      continue;
    }

    const children = await prisma.paymentTransaction.findMany({ where: { refundOfTransactionId: txn.id }, select: { id: true } });
    if (!terminated && children.length > 0) continue; // unverified: a legitimate refund path, as before
    const ids = [txn.id, ...children.map((c) => c.id)];

    const entries = await prisma.walletLedgerEntry.findMany({
      where: { transactionId: { in: ids } },
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

    const amount = new Prisma.Decimal(txn.amount);
    let outcome: ProductPaymentOutcome;
    let shortBy = new Prisma.Decimal(0);
    let ownerRefunded: number | null = null;
    if (terminated) {
      ownerRefunded = lookupTargetStatus?.ownerRefundedAmount?.(ref(txn)) ?? null;
      if (clientRefund.lessThanOrEqualTo(0)) {
        if (partnerPending.lessThanOrEqualTo(0)) continue; // released to the partners with no refund: a self-cancel, not this defect
        outcome = 'CANCELLED_PAID';
      } else {
        // The refund the client should have got: what the owner says it refunded (orders), else the whole payment.
        const expected = ownerRefunded !== null && ownerRefunded > 0 ? new Prisma.Decimal(ownerRefunded) : amount;
        if (clientRefund.plus(CENT).greaterThanOrEqualTo(expected)) {
          outcome = 'REFUND_COMPLETED';
        } else {
          outcome = 'REFUND_SHORT';
          shortBy = expected.minus(clientRefund);
        }
      }
    } else {
      if (partnerPending.lessThanOrEqualTo(0) || clientRefund.greaterThan(0)) continue;
      outcome = 'UNVERIFIED';
    }

    const open = await prisma.contractUnpaidObligation.findMany({
      where: { transactionId: { in: ids }, status: 'OPEN' },
      select: { unpaid: true },
    });
    const openUnpaid = open.reduce((a, o) => a.plus(new Prisma.Decimal(o.unpaid)), new Prisma.Decimal(0));

    found.push({
      outcome,
      row: {
        transactionId: txn.id,
        relatedEntityType: String(txn.relatedEntityType),
        relatedEntityId: txn.relatedEntityId as string,
        payerId: txn.payerId,
        amount: amount.toFixed(2),
        targetStatus: terminated ? (targetStatus as string) : 'UNVERIFIED',
        outcome,
        partnerPendingRemaining: partnerPending.toFixed(2),
        clientRefundCredited: clientRefund.toFixed(2),
        ownerRefundedAmount: ownerRefunded === null ? null : new Prisma.Decimal(ownerRefunded).toFixed(2),
        refundShortBy: shortBy.toFixed(2),
        openObligationUnpaid: openUnpaid.toFixed(2),
      },
    });
  }
  return { found, activeValid };
}

/** Rows whose owning service reported the target CANCELLED (and whose money is still held, no client refund). */
export async function findActivatedButCancelledTargets(
  lookupTargetStatus: TargetStatusLookup,
  opts: { limit?: number } = {},
): Promise<ActivatedButCancelledRow[]> {
  return (await scanCandidates(lookupTargetStatus, opts)).found.filter((x) => x.outcome === 'CANCELLED_PAID').map((x) => x.row);
}

export interface ProductPaymentClassification {
  /** Owner confirmed cancelled, money still held, client not refunded: the warning. */
  cancelled: ActivatedButCancelledRow[];
  /** Status could not be determined (lookup failed / timed out / unavailable): neutral "pending verification". */
  unverified: ActivatedButCancelledRow[];
  /** Owner confirmed cancelled and the client was refunded as expected. */
  refundCompleted: ActivatedButCancelledRow[];
  /** Owner confirmed cancelled and the client was refunded less than expected. */
  refundShort: ActivatedButCancelledRow[];
  /** Owner confirmed the target is alive: counted, never listed. */
  activeValid: number;
}

export async function classifyActivatedProductPayments(
  lookupTargetStatus: TargetStatusLookup | null,
  opts: { limit?: number } = {},
): Promise<ProductPaymentClassification> {
  const { found, activeValid } = await scanCandidates(lookupTargetStatus, opts);
  const pick = (o: ProductPaymentOutcome) => found.filter((x) => x.outcome === o).map((x) => x.row);
  return {
    cancelled: pick('CANCELLED_PAID'),
    unverified: pick('UNVERIFIED'),
    refundCompleted: pick('REFUND_COMPLETED'),
    refundShort: pick('REFUND_SHORT'),
    activeValid,
  };
}
