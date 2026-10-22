/**
 * FH-9 (owner decision, final) - the admin decision on a reserve kept in a contract's HOLDBACK.
 *
 * A reserve is a durable review item (pt_holdback_reviews) written by the ending of a contract that held money back for its PT. Nothing is
 * ever paid to the client out of the hold automatically: not because the PT cancelled, was banned or restricted, or the client complained.
 * An authorised admin decides, here, under the approved terms:
 *
 *   VERIFIED      the PT is responsible for `verifiedAmount` (0 < verifiedAmount <= the reserve, the PT-borne part only): that exact amount is paid
 *                 to the client out of THIS contract's HOLDBACK (ledger operation `HOLDBACK_FAULT_COMP:<contractRef>:<approvalRef>`), the rest of the
 *                 reserve goes back to the PT's AVAILABLE. For an OPEN_OBLIGATION reserve the obligation is reduced by the same amount in the same
 *                 transaction (never paid twice: once from pending / outside, once from the hold).
 *   NOT_VERIFIED  the PT is not responsible: the whole reserve goes back to the PT.
 *
 * Guards: dry-run by default (the CLI); compare-and-set on the reserve and the transaction the operator was shown; four-eyes (the person who
 * decides and the person who approves differ); idempotent per approval reference (a retry replays, a different reference on a decided review
 * is refused); the money only ever moves inside ONE contract (the review's own payment transaction): no other contract's hold, no AVAILABLE,
 * no platform money, no PartnerReceivable; a shortfall (the hold holds less than the verified amount) is recorded as an OPEN obligation
 * (D48) and never fronted. Every decision appends an event (append-only table).
 */
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { walletService } from './wallet.service';
import { withIdempotentLedgerOp } from './ledger-idempotency';
import { contractOpMeta } from './contract-request-guard';
import { ptHeld, recordObligation, releaseHeldToAvailable, OBLIGATION_STILL_OWED } from './contract-ledger.service';
import { AdjustmentError, requireText } from './adjustment-operations.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal.Value) => D(v).toFixed(2);
const ZERO = D(0);

export type HoldbackDecision = 'VERIFIED' | 'NOT_VERIFIED';

export interface HoldbackReviewDecisionInput {
  reviewId: string;
  /** CAS: the reserve the operator was shown. */
  expectedReserve: string;
  /** CAS: the payment transaction the operator was shown. */
  expectedTransactionId: string;
  decision: HoldbackDecision;
  /** VERIFIED only: what the PT is responsible for (the PT-borne part), 0 < n <= reserve. */
  verifiedAmount?: string;
  /** Why (at least 10 characters): what was checked and found. */
  note: string;
  /** Who decides. */
  actor: string;
  /** A DIFFERENT person who approves (four-eyes). */
  approvedBy: string;
  approvalRef: string;
  dryRun: boolean;
}

export interface HoldbackReviewDecisionResult {
  outcome: 'APPLIED' | 'REPLAYED' | 'DRY_RUN';
  key: string;
  reviewId: string;
  status: string;
  reserve: string;
  /** Paid to the client out of the hold. */
  paidToClient: string;
  /** Returned to the PT's AVAILABLE. */
  releasedToPt: string;
  /** VERIFIED but the hold held less than the amount: the unpaid remainder (an OPEN obligation, never fronted). */
  shortfall: string;
  obligationId?: string;
}

const opKeyOf = (contractRef: string, approvalRef: string) => `HOLDBACK_FAULT_COMP:${contractRef}:${approvalRef}`;

function parseAmount(raw: string | undefined): Prisma.Decimal {
  let v: Prisma.Decimal;
  try {
    v = D(raw ?? '');
  } catch {
    throw new AdjustmentError('INVALID_INPUT', 'verifiedAmount is not a number.');
  }
  if (v.lessThanOrEqualTo(0)) throw new AdjustmentError('INVALID_INPUT', 'verifiedAmount must be greater than 0.');
  if (v.decimalPlaces() > 0) throw new AdjustmentError('INVALID_INPUT', 'verifiedAmount must be a whole number of dong.');
  return v;
}

export async function decideHoldbackReview(input: HoldbackReviewDecisionInput): Promise<HoldbackReviewDecisionResult> {
  const note = requireText('note', input.note, 10);
  const actor = requireText('actor', input.actor, 2);
  const approvedBy = requireText('approvedBy', input.approvedBy, 2);
  const approvalRef = requireText('approvalRef', input.approvalRef, 2);
  if (actor.toLowerCase() === approvedBy.toLowerCase()) {
    throw new AdjustmentError('FOUR_EYES', 'The person who decides and the person who approves must be different.');
  }
  if (input.decision !== 'VERIFIED' && input.decision !== 'NOT_VERIFIED') throw new AdjustmentError('INVALID_INPUT', 'decision must be VERIFIED or NOT_VERIFIED.');
  const verified = input.decision === 'VERIFIED' ? parseAmount(input.verifiedAmount) : ZERO;

  const review = await prisma.ptHoldbackReview.findUnique({ where: { id: input.reviewId }, include: { transaction: { select: { id: true, relatedEntityId: true, metadata: true } } } });
  if (!review) throw new AdjustmentError('NOT_FOUND', 'No such holdback review.');
  const contractRef = review.transaction.relatedEntityId ?? review.transactionId;
  const key = opKeyOf(contractRef, approvalRef);
  const eventKey = `HBR_EVENT:${review.id}:${approvalRef}`;

  const replayed = await prisma.ptHoldbackReviewEvent.findUnique({ where: { idempotencyKey: eventKey } });
  if (replayed) {
    const op = await prisma.ledgerOperation.findUnique({ where: { key } });
    const r = (op?.result ?? {}) as Partial<HoldbackReviewDecisionResult>;
    return {
      outcome: 'REPLAYED', key, reviewId: review.id, status: replayed.toStatus, reserve: money(replayed.reserve),
      paidToClient: r.paidToClient ?? money(replayed.verifiedAmount), releasedToPt: money(replayed.releasedToPt), shortfall: r.shortfall ?? '0.00',
      ...(r.obligationId ? { obligationId: r.obligationId } : {}),
    };
  }
  if (review.status !== 'OPEN') throw new AdjustmentError('ALREADY_DECIDED', `This review is already ${review.status}; nothing to decide.`);
  if (review.transactionId !== input.expectedTransactionId || !D(review.reserve).equals(D(input.expectedReserve))) {
    throw new AdjustmentError('CAS_MISMATCH', 'The reserve or the payment transaction differs from the one the operator was shown. Nothing changed.');
  }
  const reserve = D(review.reserve);
  if (verified.greaterThan(reserve)) {
    throw new AdjustmentError('VERIFIED_EXCEEDS_RESERVE', `verifiedAmount ${money(verified)} exceeds the reserve ${money(reserve)} (the PT-borne part kept for this cause).`);
  }
  const plannedPaid = verified;
  const plannedRelease = reserve.minus(verified);
  if (input.dryRun) {
    return { outcome: 'DRY_RUN', key, reviewId: review.id, status: input.decision === 'VERIFIED' ? (verified.equals(reserve) ? 'SETTLED_VERIFIED' : 'SETTLED_PARTIAL') : 'NOT_VERIFIED', reserve: money(reserve), paidToClient: money(plannedPaid), releasedToPt: money(plannedRelease), shortfall: '0.00' };
  }

  // The PT wallet is the one that holds this contract's HOLDBACK (the ledger is the authority); the client is the payer of the payment.
  const meta = (review.transaction.metadata ?? {}) as { parties?: { ptUserId?: string; clientUserId?: string } };
  const txn = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: review.transactionId }, select: { payerId: true, ptId: true } });
  const holdRow = await prisma.walletLedgerEntry.findFirst({ where: { transactionId: review.transactionId, bucket: 'HOLDBACK' }, select: { walletId: true } });
  const clientUserId = meta.parties?.clientUserId ?? txn.payerId;
  let ptWalletId = holdRow?.walletId;
  if (!ptWalletId) {
    const ptUserId = meta.parties?.ptUserId ?? txn.ptId;
    if (!ptUserId) throw new AdjustmentError('NO_PARTIES', 'No PT wallet can be found for this contract; the decision cannot be applied.');
    ptWalletId = (await walletService.getOrCreateWallet('PT', ptUserId)).id;
  }
  const ptWallet = { id: ptWalletId };
  const clientWallet = await walletService.getOrCreateWallet('CLIENT', clientUserId);
  const opMeta = contractOpMeta('HOLDBACK_REVIEW', { transactionId: review.transactionId, reason: `${review.id}:${input.decision}:${money(verified)}` });

  try {
    return await walletService.withWallets([ptWallet.id, clientWallet.id], review.transactionId, (ops) =>
      withIdempotentLedgerOp(ops, key, opMeta, async () => {
        // Under the wallet locks: re-read the review. A concurrent decision / the sweep that already closed it leaves nothing to do.
        const cur = await ops.tx.ptHoldbackReview.findUniqueOrThrow({ where: { id: review.id } });
        if (cur.status !== 'OPEN') throw new AdjustmentError('ALREADY_DECIDED', `This review is already ${cur.status}; nothing to decide.`);
        const held = await ptHeld(ops, ptWallet.id, review.transactionId);

        let paid = ZERO;
        let obligationId: string | undefined;
        let shortfall = ZERO;
        if (verified.greaterThan(0)) {
          paid = Prisma.Decimal.min(verified, held);
          if (cur.kind === 'OPEN_OBLIGATION' && cur.relatedRef) {
            // The obligation is reduced by exactly what is paid from the hold, in this same transaction: no double counting.
            const ob = await ops.tx.contractUnpaidObligation.findUnique({ where: { id: cur.relatedRef } });
            if (!ob || !(OBLIGATION_STILL_OWED as readonly string[]).includes(ob.status)) throw new AdjustmentError('OBLIGATION_NOT_OWED', 'The related obligation is no longer owed.');
            if (ob.status !== 'OPEN' && ob.status !== 'UNDER_REVIEW') throw new AdjustmentError('PAYMENT_IN_FLIGHT', 'A manual payment of the related obligation is in flight; it must be verified or cancelled first (never paid twice).');
            if (paid.greaterThan(D(ob.unpaid))) paid = D(ob.unpaid);
          }
          if (paid.greaterThan(0)) {
            await ops.debit(ptWallet.id, paid, `${contractRef} holdback review ${cur.kind} — PT holdback used for compensation`, 'HOLDBACK');
            await ops.credit(clientWallet.id, paid, `${contractRef} holdback review — compensation for the PT's responsibility (from the PT's held-back earnings)`);
          }
          if (cur.kind === 'OPEN_OBLIGATION' && cur.relatedRef && paid.greaterThan(0)) {
            const ob = await ops.tx.contractUnpaidObligation.findUniqueOrThrow({ where: { id: cur.relatedRef } });
            const nowUnpaid = D(ob.unpaid).minus(paid);
            const toStatus = nowUnpaid.lessThanOrEqualTo(0) ? 'RESOLVED_OTHER' : ob.status;
            await ops.tx.contractUnpaidObligation.update({
              where: { id: ob.id },
              data: { paid: D(ob.paid).plus(paid), unpaid: nowUnpaid, ...(nowUnpaid.lessThanOrEqualTo(0) ? { status: 'RESOLVED_OTHER', resolvedAt: new Date(), resolvedBy: actor, resolvedNote: `paid ${money(paid)} from the contract holdback (review ${cur.id}, ${approvalRef})` } : {}) },
            });
            await ops.tx.contractUnpaidObligationEvent.create({
              data: { obligationId: ob.id, action: 'RESOLVE', note: `paid ${money(paid)} from the contract holdback (review ${cur.id})`, actor, approvalRef, idempotencyKey: `HBR_OBL:${cur.id}:${approvalRef}`, fromStatus: ob.status, toStatus, unpaid: nowUnpaid },
            });
          }
          if (verified.greaterThan(paid)) {
            shortfall = verified.minus(paid);
            obligationId = await recordObligation(ops, { key: `${key}#SHORT`, transactionId: review.transactionId, contractRef, kind: 'REFUND_SHORT', party: 'CLIENT', owed: verified, paid, reason: `holdback review ${cur.id}: the contract's hold held less than the verified amount` });
          }
        }
        // The rest of the reserve goes back to the PT (never more than is still held).
        const heldNow = await ptHeld(ops, ptWallet.id, review.transactionId);
        const released = await releaseHeldToAvailable(ops, ptWallet.id, review.transactionId, `${contractRef} holdback review`, Prisma.Decimal.min(reserve.minus(verified), heldNow));
        const status = input.decision === 'NOT_VERIFIED' ? 'NOT_VERIFIED' : paid.equals(reserve) ? 'SETTLED_VERIFIED' : 'SETTLED_PARTIAL';
        const moved = await ops.tx.ptHoldbackReview.updateMany({
          where: { id: cur.id, status: 'OPEN' },
          data: { status, decidedAt: new Date(), decidedBy: actor, approvedBy, approvalRef, verifiedAmount: verified, releasedToPt: released, note },
        });
        if (moved.count !== 1) throw new AdjustmentError('CONCURRENT_CHANGE', 'The review changed while deciding. Nothing changed.');
        await ops.tx.ptHoldbackReviewEvent.create({
          data: { reviewId: cur.id, action: input.decision, actor, approvedBy, approvalRef, idempotencyKey: eventKey, fromStatus: 'OPEN', toStatus: status, reserve, verifiedAmount: verified, releasedToPt: released, note },
        });
        return {
          outcome: 'APPLIED' as const, key, reviewId: cur.id, status, reserve: money(reserve), paidToClient: money(paid), releasedToPt: money(released), shortfall: money(shortfall),
          ...(obligationId ? { obligationId } : {}),
        };
      }),
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await prisma.ptHoldbackReviewEvent.findUnique({ where: { idempotencyKey: eventKey } });
      if (again) return decideHoldbackReview(input);
    }
    throw e;
  }
}

/** Reviews to show an admin: still OPEN, oldest deadline first; `overdue` when the deadline has passed. */
export async function listOpenHoldbackReviews(limit = 100): Promise<Array<{ id: string; transactionId: string; kind: string; reserve: string; reason: string; relatedRef: string | null; reviewBy: string; overdue: boolean; handler: string | null }>> {
  const rows = await prisma.ptHoldbackReview.findMany({ where: { status: 'OPEN' }, orderBy: [{ reviewBy: 'asc' }, { id: 'asc' }], take: limit });
  const now = Date.now();
  return rows.map((r) => ({ id: r.id, transactionId: r.transactionId, kind: r.kind, reserve: money(r.reserve), reason: r.reason, relatedRef: r.relatedRef, reviewBy: r.reviewBy.toISOString(), overdue: r.reviewBy.getTime() < now, handler: r.handler }));
}
