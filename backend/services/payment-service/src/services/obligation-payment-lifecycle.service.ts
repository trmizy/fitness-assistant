/**
 * FH-8 - verified manual payment of an unpaid obligation (owner decision: no automatic goodwill fund, automatic payout limit 0,
 * no automatic use of platform revenue; a payment made OUTSIDE the system is allowed, but an obligation counts as paid ONLY
 * after VERIFIED evidence, and a reference typed in by the same person is never proof).
 *
 *   OPEN / UNDER_REVIEW
 *     --approvePayment-->  APPROVED_FOR_PAYMENT   authorised approver, exact amount <= unpaid, manual source, recipient from the ledger
 *     --submitEvidence-->  AWAITING_EVIDENCE      payment made outside; recorder submits amount / transfer ref / date / proof pointer
 *     --verifyPayment-->   PAID_VERIFIED (unpaid 0)   or back to OPEN with a smaller `unpaid` (partial)
 *                          a DIFFERENT person than the recorder re-types the amount + transfer reference from the real bank record
 *   APPROVED_FOR_PAYMENT / AWAITING_EVIDENCE --cancelApproval--> OPEN   (reason mandatory; unpaid untouched)
 *   OPEN / UNDER_REVIEW --adjustObligation(RESOLVE_OTHER)--> RESOLVED_OTHER   (reason mandatory; see adjustment-operations.service.ts)
 *
 * Guards (asserted by fh8-obligation-payment-lifecycle.integration.test.ts):
 *  - `unpaid` / `verifiedPaid` change ONLY in verifyPayment, in the same transaction as the VERIFIED payment row and the event;
 *  - at most one payment in flight per obligation (status + a partial unique index), so verified payments never exceed what is owed;
 *  - compare-and-set on the unpaid amount and the payment transaction id the operator was shown; row lock on the obligation;
 *  - idempotent per approval reference (`<OP>:<obligationId>:<approvalRef>`): a retry replays, the same reference carrying different
 *    data is refused (APPROVAL_REF_REUSED); a reference is never reusable for a second payment, even after cancellation;
 *  - the recipient is read from the ledger (the obligation's party; for CLIENT the payer of the payment transaction) and re-checked
 *    at verification - there is no recipient input;
 *  - NO wallet / ledger_entries / ledger_operations / partner_receivables row is ever written; every transition appends an event.
 */
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { AdjustmentError, type AdjustmentResult, readObligationForCas, requireText, MAX_FUTURE_PAID_ON_MS } from './adjustment-operations.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal.Value) => D(v).toFixed(2);

/** Manual sources only. Anything that would move money inside the system (wallet, ledger, revenue, escrow, goodwill fund) is NOT here. */
export const PAYMENT_SOURCES = ['MANUAL_BANK_TRANSFER', 'MANUAL_E_WALLET_TRANSFER', 'MANUAL_CASH'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

type Db = Prisma.TransactionClient;

export interface ObligationCas {
  obligationId: string;
  /** CAS: the `unpaid` amount shown to the operator (unchanged while a payment is pending). */
  expectedUnpaid: string;
  /** CAS: the payment transaction id of the obligation. */
  expectedTransactionId: string;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

function parseMoney(name: string, raw: string): Prisma.Decimal {
  let v: Prisma.Decimal;
  try {
    v = D(raw);
  } catch {
    throw new AdjustmentError('INVALID_INPUT', `${name} is not a number.`);
  }
  if (v.lessThanOrEqualTo(0)) throw new AdjustmentError('INVALID_INPUT', `${name} must be greater than 0.`);
  if (v.decimalPlaces() > 2) throw new AdjustmentError('INVALID_INPUT', `${name} has more than 2 decimals.`);
  return v;
}

function parsePaidOn(raw: string, now: Date): Date {
  const t = (raw ?? '').trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T00:00:00.000Z`) : new Date(t);
  if (!t || Number.isNaN(d.getTime())) throw new AdjustmentError('INVALID_INPUT', 'paidOn is not a valid date (use YYYY-MM-DD).');
  if (d.getTime() > now.getTime() + MAX_FUTURE_PAID_ON_MS) throw new AdjustmentError('INVALID_INPUT', 'paidOn is in the future.');
  return d;
}

const recipientText = (party: string, id: string | null) => (id ? `${party}:${id}` : party);

/** Everything the lifecycle reads about an obligation, inside the caller's (locked) transaction. */
async function loadContext(db: Db, input: ObligationCas, approvalRef: string | null) {
  const o = await readObligationForCas(db, input.obligationId, input.expectedUnpaid, input.expectedTransactionId);
  const txn = await db.paymentTransaction.findUnique({ where: { id: o.transactionId }, select: { payerId: true } });
  const recipientId = o.party === 'CLIENT' ? (txn?.payerId ?? null) : null;
  const payment = approvalRef
    ? await db.contractUnpaidObligationPayment.findUnique({ where: { obligationId_approvalRef: { obligationId: o.id, approvalRef } } })
    : null;
  return { o, recipientId, payment };
}

interface Step<P> {
  key: string;
  obligationId: string;
  dryRun: boolean;
  /** Existing event of this key -> REPLAYED (throws APPROVAL_REF_REUSED when it carries different data). */
  replay: (db: Db) => Promise<AdjustmentResult | null>;
  /** Pure checks + the figures the write would use. Runs on the live row (dry-run) or the locked row (apply). */
  plan: (db: Db) => Promise<P>;
  describe: (p: P) => { before: Record<string, unknown>; after: Record<string, unknown> };
  /** Writes (obligation CAS update, payment row, event) and returns the event id. */
  write: (tx: Db, p: P) => Promise<string>;
}

async function run<P>(step: Step<P>): Promise<AdjustmentResult> {
  if (step.dryRun) {
    const done = await step.replay(prisma);
    if (done) return done;
    const p = await step.plan(prisma);
    return { outcome: 'DRY_RUN', key: step.key, ...step.describe(p) };
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM contract_unpaid_obligations WHERE id = ${step.obligationId} FOR UPDATE`;
        const done = await step.replay(tx);
        if (done) return done;
        const p = await step.plan(tx);
        const eventId = await step.write(tx, p);
        return { outcome: 'APPLIED' as const, key: step.key, ...step.describe(p), eventId };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const done = await step.replay(prisma);
      if (done) return done;
      throw new AdjustmentError('PAYMENT_PENDING', 'Another payment is already in flight for this obligation. Nothing changed.');
    }
    throw e;
  }
}

async function replayFromEvent(db: Db, key: string): Promise<{ result: AdjustmentResult; ev: Awaited<ReturnType<Db['contractUnpaidObligationEvent']['findUniqueOrThrow']>> } | null> {
  const ev = await db.contractUnpaidObligationEvent.findUnique({ where: { idempotencyKey: key } });
  if (!ev) return null;
  return {
    ev,
    result: {
      outcome: 'REPLAYED',
      key,
      before: { status: ev.fromStatus, unpaid: money(ev.unpaid) },
      after: { status: ev.toStatus, unpaid: money(ev.unpaidAfter ?? ev.unpaid) },
      eventId: ev.id,
    },
  };
}

const snapshot = (o: { status: string; unpaid: Prisma.Decimal.Value; verifiedPaid: Prisma.Decimal.Value }) => ({
  status: o.status,
  unpaid: money(o.unpaid),
  verifiedPaid: money(o.verifiedPaid),
});

/** Moves the obligation `from` -> `to` only if nobody changed it meanwhile (status, unpaid, verifiedPaid). */
async function casMove(
  tx: Db,
  o: { id: string; status: string; unpaid: Prisma.Decimal.Value; verifiedPaid: Prisma.Decimal.Value },
  data: Prisma.ContractUnpaidObligationUpdateManyMutationInput,
): Promise<void> {
  const moved = await tx.contractUnpaidObligation.updateMany({
    where: { id: o.id, status: o.status as never, unpaid: D(o.unpaid), verifiedPaid: D(o.verifiedPaid) },
    data,
  });
  if (moved.count !== 1) throw new AdjustmentError('CONCURRENT_CHANGE', 'The obligation changed while adjusting. Nothing changed.');
}

// ───────────────────────────────────────────────────────────────────────── 1. approve ──

export interface ApprovePaymentInput extends ObligationCas {
  /** The exact amount approved for payment (0 < amount <= unpaid). */
  approvedAmount: string;
  /** One of PAYMENT_SOURCES. */
  paymentSource: string;
  approvedBy: string;
  /** Approval / minute number; the idempotency key of the payment. Never reusable. */
  approvalRef: string;
  note: string;
  /** When given, `approvedBy` must be one of these (case-insensitive). The CLI fills it from FH8_PAYOUT_APPROVERS. */
  authorisedApprovers?: string[];
  dryRun: boolean;
}

export async function approveObligationPayment(input: ApprovePaymentInput, now: Date = new Date()): Promise<AdjustmentResult> {
  const note = requireText('note', input.note, 5);
  const approvedBy = requireText('approvedBy', input.approvedBy, 2);
  const approvalRef = requireText('approvalRef', input.approvalRef, 2);
  const amount = parseMoney('approvedAmount', input.approvedAmount);
  const source = (input.paymentSource ?? '').trim().toUpperCase();
  if (!(PAYMENT_SOURCES as readonly string[]).includes(source)) {
    throw new AdjustmentError('INVALID_SOURCE', `paymentSource must be one of ${PAYMENT_SOURCES.join(', ')} (no wallet / ledger / platform-revenue source).`);
  }
  if (input.authorisedApprovers && !input.authorisedApprovers.map(norm).includes(norm(approvedBy))) {
    throw new AdjustmentError('NOT_AUTHORISED', `${approvedBy} is not an authorised payout approver. Nothing changed.`);
  }
  const key = `OBLIGATION_APPROVE_PAYMENT:${input.obligationId}:${approvalRef}`;

  return run({
    key,
    obligationId: input.obligationId,
    dryRun: input.dryRun,
    replay: async (db) => {
      const r = await replayFromEvent(db, key);
      if (!r) return null;
      if (!r.ev.paidAmount || !D(r.ev.paidAmount).equals(amount) || r.ev.paymentSource !== source) {
        throw new AdjustmentError('APPROVAL_REF_REUSED', 'This approval reference was already used for a different payment. Nothing changed.');
      }
      const pay = r.ev.paymentId ? await db.contractUnpaidObligationPayment.findUnique({ where: { id: r.ev.paymentId } }) : null;
      if (pay?.status === 'CANCELLED') {
        throw new AdjustmentError('APPROVAL_REF_REUSED', 'This approval was cancelled; use a new approval reference. Nothing changed.');
      }
      return r.result;
    },
    plan: async (db) => {
      const { o, recipientId } = await loadContext(db, input, null);
      if (o.status === 'APPROVED_FOR_PAYMENT' || o.status === 'AWAITING_EVIDENCE') {
        throw new AdjustmentError('PAYMENT_PENDING', `A payment is already ${o.status} for this obligation; verify or cancel it first. Nothing changed.`);
      }
      if (o.status !== 'OPEN' && o.status !== 'UNDER_REVIEW') {
        throw new AdjustmentError('NOT_OPEN', `Obligation is ${o.status}; only OPEN or UNDER_REVIEW can be approved for payment. Nothing to do.`);
      }
      if (o.party !== 'CLIENT') {
        throw new AdjustmentError('PARTY_NOT_PAYABLE', `This obligation is owed by/to ${o.party}, not to a client; it cannot be paid out through this flow.`);
      }
      if (!recipientId) throw new AdjustmentError('NO_RECIPIENT', 'The ledger has no payer for this obligation\'s payment transaction. Nothing changed.');
      const unpaid = D(o.unpaid);
      if (amount.greaterThan(unpaid)) {
        throw new AdjustmentError('AMOUNT_EXCEEDS_UNPAID', `Approved amount ${money(amount)} exceeds the unpaid ${money(unpaid)}. Nothing changed.`);
      }
      return { o, recipientId };
    },
    describe: (p) => ({
      before: snapshot(p.o),
      after: {
        ...snapshot({ ...p.o, status: 'APPROVED_FOR_PAYMENT' }),
        approvedAmount: money(amount),
        paymentSource: source,
        recipient: recipientText(p.o.party, p.recipientId),
      },
    }),
    write: async (tx, p) => {
      await casMove(tx, p.o, { status: 'APPROVED_FOR_PAYMENT' });
      const pay = await tx.contractUnpaidObligationPayment.create({
        data: {
          obligationId: p.o.id,
          approvalRef,
          amount,
          paymentSource: source,
          recipientParty: p.o.party,
          recipientId: p.recipientId,
          approvedBy,
          approvedAt: now,
        },
      });
      const ev = await tx.contractUnpaidObligationEvent.create({
        data: {
          obligationId: p.o.id,
          action: 'APPROVE_PAYMENT',
          note,
          actor: approvedBy,
          approvalRef,
          idempotencyKey: key,
          fromStatus: p.o.status,
          toStatus: 'APPROVED_FOR_PAYMENT',
          unpaid: p.o.unpaid,
          unpaidAfter: p.o.unpaid,
          paidAmount: amount,
          approvedBy,
          paymentId: pay.id,
          paymentSource: source,
          recipient: recipientText(p.o.party, p.recipientId),
        },
      });
      return ev.id;
    },
  });
}

// ───────────────────────────────────────────────────────────────────── 2. submit evidence ──

export interface SubmitEvidenceInput extends ObligationCas {
  approvalRef: string;
  /** What the evidence says was paid. Recorded as is; verification refuses it unless it equals the approved amount. */
  paidAmount: string;
  transferReference: string;
  /** The day it was paid (YYYY-MM-DD), not in the future. */
  paidOn: string;
  /** At least ONE pointer to the proof is required: evidence file reference, its sha256, or the bank statement line id. */
  evidenceRef?: string;
  evidenceHash?: string;
  bankStatementId?: string;
  /** Who typed the evidence in. The verifier must be someone else. */
  recordedBy: string;
  note: string;
  dryRun: boolean;
}

export async function submitObligationEvidence(input: SubmitEvidenceInput, now: Date = new Date()): Promise<AdjustmentResult> {
  const note = requireText('note', input.note, 5);
  const approvalRef = requireText('approvalRef', input.approvalRef, 2);
  const recordedBy = requireText('recordedBy', input.recordedBy, 2);
  const transferReference = requireText('transferReference', input.transferReference, 4);
  if (transferReference.length > 80) throw new AdjustmentError('INVALID_INPUT', 'transferReference is too long (max 80 characters).');
  const paidAmount = parseMoney('paidAmount', input.paidAmount);
  const paidOn = parsePaidOn(input.paidOn, now);
  const evidenceRef = (input.evidenceRef ?? '').trim() || null;
  const evidenceHash = (input.evidenceHash ?? '').trim().toLowerCase() || null;
  const bankStatementId = (input.bankStatementId ?? '').trim() || null;
  if (!evidenceRef && !evidenceHash && !bankStatementId) {
    throw new AdjustmentError('EVIDENCE_REQUIRED', 'Evidence is required: give an evidence file reference, its sha256, or the bank statement id. A transfer reference alone is not proof.');
  }
  if (evidenceRef && (evidenceRef.length < 4 || evidenceRef.length > 200)) throw new AdjustmentError('INVALID_INPUT', 'evidenceRef must be 4-200 characters.');
  if (evidenceHash && !/^[0-9a-f]{64}$/.test(evidenceHash)) throw new AdjustmentError('INVALID_INPUT', 'evidenceHash must be a sha256 (64 hex characters).');
  if (bankStatementId && (bankStatementId.length < 4 || bankStatementId.length > 80)) throw new AdjustmentError('INVALID_INPUT', 'bankStatementId must be 4-80 characters.');
  const key = `OBLIGATION_SUBMIT_EVIDENCE:${input.obligationId}:${approvalRef}`;

  return run({
    key,
    obligationId: input.obligationId,
    dryRun: input.dryRun,
    replay: async (db) => {
      const r = await replayFromEvent(db, key);
      if (!r) return null;
      const e = r.ev;
      const same =
        e.paidAmount && D(e.paidAmount).equals(paidAmount) && e.transferReference === transferReference &&
        (e.evidenceRef ?? null) === evidenceRef && (e.evidenceHash ?? null) === evidenceHash && (e.bankStatementId ?? null) === bankStatementId &&
        norm(e.actor) === norm(recordedBy);
      if (!same) throw new AdjustmentError('APPROVAL_REF_REUSED', 'Evidence was already submitted for this approval with different data. Nothing changed.');
      return r.result;
    },
    plan: async (db) => {
      const { o, payment } = await loadContext(db, input, approvalRef);
      if (!payment) throw new AdjustmentError('NO_SUCH_APPROVAL', 'No payment was approved with this approval reference on this obligation.');
      if (o.status !== 'APPROVED_FOR_PAYMENT' || payment.status !== 'APPROVED') {
        throw new AdjustmentError('NOT_APPROVED', `Obligation is ${o.status} / payment ${payment.status}; evidence can only be submitted for an APPROVED_FOR_PAYMENT payment. Nothing to do.`);
      }
      const seenBefore = await db.contractUnpaidObligationPayment.count({ where: { transferReference, NOT: { id: payment.id } } });
      return { o, payment, seenBefore };
    },
    describe: (p) => ({
      before: snapshot(p.o),
      after: {
        ...snapshot({ ...p.o, status: 'AWAITING_EVIDENCE' }),
        approvedAmount: money(p.payment.amount),
        recordedAmount: money(paidAmount),
        ...(p.seenBefore > 0 ? { warning: `transfer reference already recorded on ${p.seenBefore} other payment(s)` } : {}),
      },
    }),
    write: async (tx, p) => {
      const upd = await tx.contractUnpaidObligationPayment.updateMany({
        where: { id: p.payment.id, status: 'APPROVED' },
        data: { status: 'EVIDENCE_SUBMITTED', paidAmount, transferReference, paidOn, evidenceRef, evidenceHash, bankStatementId, recordedBy, recordedAt: now },
      });
      if (upd.count !== 1) throw new AdjustmentError('CONCURRENT_CHANGE', 'The payment changed while adjusting. Nothing changed.');
      await casMove(tx, p.o, { status: 'AWAITING_EVIDENCE' });
      const ev = await tx.contractUnpaidObligationEvent.create({
        data: {
          obligationId: p.o.id,
          action: 'SUBMIT_EVIDENCE',
          note,
          actor: recordedBy,
          approvalRef,
          idempotencyKey: key,
          fromStatus: 'APPROVED_FOR_PAYMENT',
          toStatus: 'AWAITING_EVIDENCE',
          unpaid: p.o.unpaid,
          unpaidAfter: p.o.unpaid,
          paidAmount,
          transferReference,
          paidOn,
          approvedBy: p.payment.approvedBy,
          paymentId: p.payment.id,
          paymentSource: p.payment.paymentSource,
          recipient: recipientText(p.payment.recipientParty, p.payment.recipientId),
          evidenceRef,
          evidenceHash,
          bankStatementId,
        },
      });
      return ev.id;
    },
  });
}

// ───────────────────────────────────────────────────────────────────────── 3. verify ──

export interface VerifyPaymentInput extends ObligationCas {
  approvalRef: string;
  /** Must be a DIFFERENT person than the one who recorded the evidence. */
  verifiedBy: string;
  /** What the verifier READ on the real bank record, typed independently: both must match what was approved and recorded. */
  observedAmount: string;
  observedTransferReference: string;
  note: string;
  dryRun: boolean;
}

export async function verifyObligationPayment(input: VerifyPaymentInput, now: Date = new Date()): Promise<AdjustmentResult> {
  const note = requireText('note', input.note, 5);
  const approvalRef = requireText('approvalRef', input.approvalRef, 2);
  const verifiedBy = requireText('verifiedBy', input.verifiedBy, 2);
  const observedAmount = parseMoney('observedAmount', input.observedAmount);
  const observedRef = requireText('observedTransferReference', input.observedTransferReference, 4);
  const key = `OBLIGATION_VERIFY_PAYMENT:${input.obligationId}:${approvalRef}`;

  return run({
    key,
    obligationId: input.obligationId,
    dryRun: input.dryRun,
    replay: async (db) => {
      const r = await replayFromEvent(db, key);
      if (!r) return null;
      if (norm(r.ev.verifiedBy) !== norm(verifiedBy) || !r.ev.paidAmount || !D(r.ev.paidAmount).equals(observedAmount)) {
        throw new AdjustmentError('ALREADY_VERIFIED', 'This payment was already verified (by someone else or with a different amount). Nothing changed.');
      }
      return r.result;
    },
    plan: async (db) => {
      const { o, payment, recipientId } = await loadContext(db, input, approvalRef);
      if (!payment) throw new AdjustmentError('NO_SUCH_APPROVAL', 'No payment was approved with this approval reference on this obligation.');
      if (o.status !== 'AWAITING_EVIDENCE' || payment.status !== 'EVIDENCE_SUBMITTED') {
        throw new AdjustmentError('NOT_AWAITING_EVIDENCE', `Obligation is ${o.status} / payment ${payment.status}; only an AWAITING_EVIDENCE payment can be verified. Nothing to do.`);
      }
      if (norm(payment.recordedBy) === norm(verifiedBy)) {
        throw new AdjustmentError('SAME_PERSON', 'Four-eyes rule: the person who recorded the evidence cannot verify it. Nothing changed.');
      }
      if (!payment.paidAmount || !payment.paidOn || !payment.transferReference) {
        throw new AdjustmentError('EVIDENCE_INCOMPLETE', 'The recorded evidence is incomplete. Nothing changed.');
      }
      if (!D(payment.paidAmount).equals(D(payment.amount))) {
        throw new AdjustmentError('AMOUNT_MISMATCH', `Recorded amount ${money(payment.paidAmount)} differs from the approved ${money(payment.amount)}; cancel the approval and start again. Nothing changed.`);
      }
      if (!observedAmount.equals(D(payment.amount))) {
        throw new AdjustmentError('AMOUNT_MISMATCH', `Observed amount ${money(observedAmount)} differs from the approved ${money(payment.amount)}. Nothing changed.`);
      }
      if (observedRef !== payment.transferReference) {
        throw new AdjustmentError('REFERENCE_MISMATCH', 'Observed transfer reference differs from the recorded one. Nothing changed.');
      }
      if (payment.paidOn.getTime() > now.getTime() + MAX_FUTURE_PAID_ON_MS) {
        throw new AdjustmentError('INVALID_INPUT', 'The recorded payment date is in the future. Nothing changed.');
      }
      if (payment.recipientParty !== o.party || (payment.recipientId ?? null) !== recipientId) {
        throw new AdjustmentError('RECIPIENT_CHANGED', 'The recipient in the ledger differs from the one approved. Nothing changed.');
      }
      const unpaid = D(o.unpaid);
      if (D(payment.amount).greaterThan(unpaid)) {
        throw new AdjustmentError('AMOUNT_EXCEEDS_UNPAID', `Payment ${money(payment.amount)} exceeds the unpaid ${money(unpaid)}. Nothing changed.`);
      }
      const unpaidAfter = unpaid.minus(D(payment.amount));
      const full = unpaidAfter.isZero();
      return { o, payment, unpaidAfter, full, toStatus: full ? ('PAID_VERIFIED' as const) : ('OPEN' as const) };
    },
    describe: (p) => ({
      before: snapshot(p.o),
      after: {
        status: p.toStatus,
        unpaid: money(p.unpaidAfter),
        verifiedPaid: money(D(p.o.verifiedPaid).plus(D(p.payment.amount))),
        paidAmount: money(p.payment.amount),
        partial: !p.full,
      },
    }),
    write: async (tx, p) => {
      const upd = await tx.contractUnpaidObligationPayment.updateMany({
        where: { id: p.payment.id, status: 'EVIDENCE_SUBMITTED' },
        data: { status: 'VERIFIED', verifiedBy, verifiedAt: now },
      });
      if (upd.count !== 1) throw new AdjustmentError('CONCURRENT_CHANGE', 'The payment changed while adjusting. Nothing changed.');
      await casMove(tx, p.o, {
        unpaid: p.unpaidAfter,
        verifiedPaid: D(p.o.verifiedPaid).plus(D(p.payment.amount)),
        status: p.toStatus,
        ...(p.full ? { resolvedAt: now, resolvedBy: verifiedBy, resolvedNote: note } : {}),
      });
      const ev = await tx.contractUnpaidObligationEvent.create({
        data: {
          obligationId: p.o.id,
          action: 'VERIFY_PAYMENT',
          note,
          actor: verifiedBy,
          approvalRef,
          idempotencyKey: key,
          fromStatus: 'AWAITING_EVIDENCE',
          toStatus: p.toStatus,
          unpaid: p.o.unpaid,
          unpaidAfter: p.unpaidAfter,
          paidAmount: p.payment.amount,
          transferReference: p.payment.transferReference,
          paidOn: p.payment.paidOn,
          approvedBy: p.payment.approvedBy,
          paymentId: p.payment.id,
          paymentSource: p.payment.paymentSource,
          recipient: recipientText(p.payment.recipientParty, p.payment.recipientId),
          evidenceRef: p.payment.evidenceRef,
          evidenceHash: p.payment.evidenceHash,
          bankStatementId: p.payment.bankStatementId,
          verifiedBy,
        },
      });
      return ev.id;
    },
  });
}

// ───────────────────────────────────────────────────────────────────────── 4. cancel ──

export interface CancelApprovalInput extends ObligationCas {
  approvalRef: string;
  cancelledBy: string;
  /** Why the approved / unverified payment is withdrawn (mandatory). */
  reason: string;
  dryRun: boolean;
}

/** APPROVED_FOR_PAYMENT / AWAITING_EVIDENCE -> OPEN. `unpaid` is untouched; the approval reference stays burned. */
export async function cancelObligationApproval(input: CancelApprovalInput, now: Date = new Date()): Promise<AdjustmentResult> {
  const reason = requireText('reason', input.reason, 10);
  const approvalRef = requireText('approvalRef', input.approvalRef, 2);
  const cancelledBy = requireText('cancelledBy', input.cancelledBy, 2);
  const key = `OBLIGATION_CANCEL_APPROVAL:${input.obligationId}:${approvalRef}`;

  return run({
    key,
    obligationId: input.obligationId,
    dryRun: input.dryRun,
    replay: async (db) => (await replayFromEvent(db, key))?.result ?? null,
    plan: async (db) => {
      const { o, payment } = await loadContext(db, input, approvalRef);
      if (!payment) throw new AdjustmentError('NO_SUCH_APPROVAL', 'No payment was approved with this approval reference on this obligation.');
      if ((o.status !== 'APPROVED_FOR_PAYMENT' && o.status !== 'AWAITING_EVIDENCE') || (payment.status !== 'APPROVED' && payment.status !== 'EVIDENCE_SUBMITTED')) {
        throw new AdjustmentError('NOT_PENDING', `Obligation is ${o.status} / payment ${payment.status}; only a pending payment can be cancelled. Nothing to do.`);
      }
      return { o, payment };
    },
    describe: (p) => ({ before: snapshot(p.o), after: { ...snapshot({ ...p.o, status: 'OPEN' }), cancelledApproval: approvalRef } }),
    write: async (tx, p) => {
      const upd = await tx.contractUnpaidObligationPayment.updateMany({
        where: { id: p.payment.id, status: p.payment.status },
        data: { status: 'CANCELLED', cancelledBy, cancelledAt: now, cancelReason: reason },
      });
      if (upd.count !== 1) throw new AdjustmentError('CONCURRENT_CHANGE', 'The payment changed while adjusting. Nothing changed.');
      await casMove(tx, p.o, { status: 'OPEN' });
      const ev = await tx.contractUnpaidObligationEvent.create({
        data: {
          obligationId: p.o.id,
          action: 'CANCEL_APPROVAL',
          note: reason,
          actor: cancelledBy,
          approvalRef,
          idempotencyKey: key,
          fromStatus: p.o.status,
          toStatus: 'OPEN',
          unpaid: p.o.unpaid,
          unpaidAfter: p.o.unpaid,
          paidAmount: p.payment.amount,
          approvedBy: p.payment.approvedBy,
          paymentId: p.payment.id,
          paymentSource: p.payment.paymentSource,
          recipient: recipientText(p.payment.recipientParty, p.payment.recipientId),
        },
      });
      return ev.id;
    },
  });
}
