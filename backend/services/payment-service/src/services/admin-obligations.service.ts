/**
 * FH-4 part 2 - READ-ONLY obligations / reconciliation report for the admin reconciliation tab.
 *
 * `GET /admin/payments/obligations` is built here. Everything runs inside ONE `READ ONLY` transaction (repeatable-read
 * snapshot), so the lists and counts agree with each other and a bug in this file cannot write. Lists are capped
 * (`limit`) and say so (`truncated`); counts are always exact. No personal data: partner / owner ids are cut to 8
 * characters, free-text reasons are cut to 120. Full ids are only returned for internal rows an operator needs in order
 * to find the row again (receivable id, obligation id, payment transaction id).
 */
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import {
  findNegativeSubledgers,
  findNegativeWallets,
  findWalletLedgerMismatches,
  type NegativeSubledgerRow,
  type NegativeWalletRow,
  type WalletLedgerMismatchRow,
} from './ledger-state-checks';
import {
  classifyActivatedProductPayments,
  type ActivatedButCancelledRow,
  type ProductPaymentOutcome,
  type TargetStatusLookup,
} from './activated-but-cancelled-target.query';
import { createTargetStatusLookup } from '../clients/target-status.client';

export const OBLIGATIONS_DEFAULT_LIMIT = 50;
export const OBLIGATIONS_MAX_LIMIT = 200;
export const OBLIGATIONS_DEFAULT_STALE_MINUTES = 30;

export interface ReceivableRow {
  id: string;
  partnerType: string;
  partner: string;
  /** ACTIVE = still being collected from the partner's later earnings; SUSPENDED = collection paused. */
  state: 'ACTIVE' | 'SUSPENDED';
  amount: string;
  recovered: string;
  waived: string;
  outstanding: string;
  reason: string;
  transactionId: string | null;
  contract: string | null;
  createdAt: string;
  suspendedAt: string | null;
  suspensionRef: string | null;
}

/** One entry of an obligation's append-only history (who did what, with which approval / evidence). Names are operators, never clients. */
export interface ObligationEventRow {
  at: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  actor: string;
  approvedBy: string | null;
  approvalRef: string;
  note: string;
  /** Payment evidence (PAY_EXTERNALLY legacy, APPROVE_PAYMENT .. VERIFY_PAYMENT); null for other actions. */
  paidAmount: string | null;
  transferReference: string | null;
  paidOn: string | null;
  unpaidAfter: string | null;
  /** Manual payment source (MANUAL_BANK_TRANSFER ...), recipient (party + first 8 characters of the client id), proof pointers, verifier. */
  paymentSource: string | null;
  recipient: string | null;
  evidenceRef: string | null;
  /** First 12 hex characters of the sha256. */
  evidenceHash: string | null;
  bankStatementId: string | null;
  verifiedBy: string | null;
}

/** The ONE payment in flight on an obligation (APPROVED_FOR_PAYMENT or AWAITING_EVIDENCE). */
export interface PendingPaymentRow {
  approvalRef: string;
  /** APPROVED = approved, not yet paid/recorded; EVIDENCE_SUBMITTED = evidence recorded, NOT verified. */
  status: string;
  approvedAmount: string;
  paymentSource: string;
  recipientParty: string;
  recipient: string | null;
  approvedBy: string;
  approvedAt: string;
  recordedBy: string | null;
  recordedAt: string | null;
  recordedAmount: string | null;
  transferReference: string | null;
  paidOn: string | null;
  evidenceRef: string | null;
  evidenceHash: string | null;
  bankStatementId: string | null;
}

export interface UnpaidObligationRow {
  id: string;
  kind: string;
  party: string;
  status: string;
  owed: string;
  paid: string;
  unpaid: string;
  transactionId: string;
  /** First 8 characters of `contractId` (kept for the list's compact column). */
  contract: string | null;
  /** The REAL contract id: the payment transaction's related PT contract (structured), never parsed from the free-text label. null for a non-contract payment. */
  contractId: string | null;
  /** The session the obligation is about (PT no-show / late arrival): taken from the operation key `PT_NO_SHOW:<id>` / `PT_LATE_ARRIVAL:<id>`. null otherwise. */
  sessionId: string | null;
  /** Why the obligation exists, in words (D77 sets it; null on rows FH-1 wrote). Cut to 120 characters. */
  reason: string | null;
  /**
   * LEGACY first-cut figure: recorded as paid outside the ledger WITHOUT verification. Never written any more;
   * old PAID_EXTERNALLY rows keep it and are not upgraded.
   */
  externallyPaid: string;
  /** Paid outside the ledger AND verified by a second person (sum of VERIFIED payments); this is what reduced `unpaid`. */
  verifiedPaid: string;
  /** The payment in flight (APPROVED_FOR_PAYMENT / AWAITING_EVIDENCE), else null. */
  pendingPayment: PendingPaymentRow | null;
  /** Append-only audit trail, oldest first (last 10). */
  history: ObligationEventRow[];
  createdAt: string;
  resolvedAt: string | null;
}

export interface PaidNotActivatedRow {
  transactionId: string;
  purpose: string;
  activationStatus: string;
  amount: string;
  paidAt: string | null;
  ageMinutes: number;
  retryCount: number;
}

export interface TargetUnverifiedCandidate {
  transactionId: string;
  targetType: string;
  amount: string;
  partnerPendingRemaining: string;
}

/**
 * A product payment (gym membership / personalized order) whose owning service CONFIRMED the target is cancelled
 * (warning or refund outcome). No payer id, no names.
 */
export interface ProductPaymentRow {
  transactionId: string;
  targetType: string;
  targetId: string;
  /** What the owning service reported (CANCELLED / REFUNDED). */
  targetStatus: string;
  outcome: ProductPaymentOutcome;
  amount: string;
  partnerPendingRemaining: string;
  refundedToClient: string;
  ownerRefundedAmount: string | null;
  refundShortBy: string;
  openObligationUnpaid: string;
}

/** NOT_CHECKED: no lookup configured. OK: every candidate answered. PARTIAL: some did not. UNAVAILABLE: none did. */
export type ProductLookupState = 'OK' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CHECKED';

export interface ObligationsReport {
  generatedAt: string;
  params: { limit: number; staleMinutes: number };
  summary: {
    negativeWallets: number;
    negativeSubledgers: { count: number; unbackedTotal: string };
    walletMismatches: { count: number; nonEscrowCount: number };
    receivables: {
      active: { count: number; outstanding: string };
      suspended: { count: number; outstanding: string };
    };
    unpaidObligations: {
      open: { count: number; unpaid: string };
      /** Someone is looking at it (still unpaid). */
      underReview: { count: number; unpaid: string };
      /** Approved for payment (amount agreed, nothing recorded as paid yet). `unpaid` is still owed. */
      approvedForPayment: { count: number; unpaid: string };
      /** Paid outside and evidence recorded, waiting for a DIFFERENT person to verify it. `unpaid` is still owed until verified. */
      awaitingEvidence: { count: number; unpaid: string };
      /** Fully paid and VERIFIED. `amount` = everything verified so far, incl. partial verified payments on rows back to OPEN. */
      paidVerified: { count: number; amount: string };
      /**
       * LEGACY: evidence recorded WITHOUT verification (first cut). NOT proof of payment; never upgraded. `amount` = everything
       * recorded that way, incl. partial recordings on rows still open.
       */
      paidExternally: { count: number; amount: string };
      /** Settled by another method (reason on the event). Not "paid". */
      resolvedOther: { count: number };
      /** The owner decided not to pursue it; `unpaid` is what was forgiven. The client was NOT paid. */
      waived: { count: number; unpaid: string };
      /** LEGACY "handled elsewhere" without evidence. */
      resolved: { count: number };
    };
    paidNotActivated: number;
    /** Neutral, NOT a warning and not counted as needing attention: see `targetUnverified`. */
    targetUnverified: { status: 'TARGET_STATUS_UNVERIFIED'; candidates: number };
    /**
     * FH-4: what the owning services said about every PAID + ACTIVATED product payment.
     * activeValid = confirmed alive (never a problem); cancelledPaid = confirmed cancelled, money held, not refunded (warning);
     * pendingVerification = could not be verified (neutral); refundCompleted / refundShort = confirmed cancelled and refunded.
     */
    productPayments: {
      lookup: ProductLookupState;
      activeValid: number;
      cancelledPaid: number;
      pendingVerification: number;
      refundCompleted: number;
      refundShort: number;
    };
  };
  negativeWallets: NegativeWalletRow[];
  negativeSubledgers: NegativeSubledgerRow[];
  walletMismatches: WalletLedgerMismatchRow[];
  receivables: ReceivableRow[];
  /** Still to be paid: OPEN and UNDER_REVIEW rows (a partially paid row stays here with its reduced `unpaid`). */
  unpaidObligations: UnpaidObligationRow[];
  /** A payment is in flight: APPROVED_FOR_PAYMENT / AWAITING_EVIDENCE (still unpaid until verified), each with its pending payment and history. */
  inFlightObligations: UnpaidObligationRow[];
  /** Closed ones, newest first: PAID_VERIFIED / PAID_EXTERNALLY (legacy, unverified) / WAIVED / RESOLVED_OTHER / RESOLVED (legacy), each with its history. */
  closedObligations: UnpaidObligationRow[];
  paidNotActivated: PaidNotActivatedRow[];
  /**
   * "Chưa xác minh trạng thái": PAID + ACTIVATED product payments (gym membership / personalized-service order) whose
   * money is still in partners' PENDING and that the client was never refunded for. For a normal ACTIVE membership or
   * order that is EXACTLY the expected state, so this group is NEVER a cancellation warning: payment-service owns no
   * order / membership status, so CANCELLED is not (and must not be) inferred from the ledger. Since FH-4 the owning
   * services are asked (read-only status routes); rows land here only when that lookup failed / timed out / the owner
   * has no such row ("pending verification"). Confirmed-alive rows are only counted (`summary.productPayments.activeValid`).
   */
  targetUnverified: { status: 'TARGET_STATUS_UNVERIFIED'; candidates: TargetUnverifiedCandidate[] };
  /** Confirmed cancelled by the owning service, money still held, client not refunded. */
  cancelledPaid: ProductPaymentRow[];
  /** Confirmed cancelled and refunded: `outcome` is REFUND_COMPLETED or REFUND_SHORT. */
  refundOutcomes: ProductPaymentRow[];
  truncated: {
    negativeWallets: boolean;
    negativeSubledgers: boolean;
    walletMismatches: boolean;
    receivables: boolean;
    unpaidObligations: boolean;
    inFlightObligations: boolean;
    closedObligations: boolean;
    paidNotActivated: boolean;
    targetUnverified: boolean;
    cancelledPaid: boolean;
    refundOutcomes: boolean;
  };
}

/** `PT_NO_SHOW:<sessionId>` / `PT_LATE_ARRIVAL:<sessionId>` (an OVER_RELEASED row appends `#...`): the session the step was about. */
export function sessionIdOfKey(key: string | null | undefined): string | null {
  const m = /^(?:PT_NO_SHOW|PT_LATE_ARRIVAL):([^#]+)/.exec(key ?? '');
  return m ? m[1] : null;
}

export function clampLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return OBLIGATIONS_DEFAULT_LIMIT;
  return Math.min(n, OBLIGATIONS_MAX_LIMIT);
}

export function clampStaleMinutes(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return OBLIGATIONS_DEFAULT_STALE_MINUTES;
  return Math.min(n, 60 * 24 * 30);
}

const money = (v: unknown) => new Prisma.Decimal(String(v ?? 0)).toFixed(2);
const short = (v: string | null | undefined) => (v ? v.slice(0, 8) : null);
const hash12 = (v: string | null | undefined) => (v ? v.slice(0, 12) : null);
const cut = (v: string | null | undefined, n = 120) => (v ? (v.length > n ? `${v.slice(0, n)}...` : v) : '');
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

const toProductRow = (c: ActivatedButCancelledRow): ProductPaymentRow => ({
  transactionId: c.transactionId,
  targetType: c.relatedEntityType,
  targetId: c.relatedEntityId,
  targetStatus: c.targetStatus,
  outcome: c.outcome,
  amount: c.amount,
  partnerPendingRemaining: c.partnerPendingRemaining,
  refundedToClient: c.clientRefundCredited,
  ownerRefundedAmount: c.ownerRefundedAmount,
  refundShortBy: c.refundShortBy,
  openObligationUnpaid: c.openObligationUnpaid,
});

export async function buildObligationsReport(
  opts: { limit?: number; staleMinutes?: number; lookupTargetStatus?: TargetStatusLookup | null } = {},
): Promise<ObligationsReport> {
  const limit = opts.limit ?? OBLIGATIONS_DEFAULT_LIMIT;
  const staleMinutes = opts.staleMinutes ?? OBLIGATIONS_DEFAULT_STALE_MINUTES;
  const now = new Date();

  const core = await prisma.$transaction(
    async (tx) => {
      // Must run before any other statement of the transaction (only Prisma's own isolation-level SET precedes it).
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');

      const negWallets = await findNegativeWallets(tx, limit);
      const negSub = await findNegativeSubledgers(tx, limit);
      const mism = await findWalletLedgerMismatches(tx, limit);

      const recSummary = await tx.$queryRawUnsafe<{ state: string; c: number; outstanding: string }[]>(
        `SELECT CASE WHEN suspended_at IS NULL THEN 'ACTIVE' ELSE 'SUSPENDED' END AS state, count(*)::int AS c,
                coalesce(sum(amount-recovered-waived),0)::text AS outstanding
           FROM partner_receivables WHERE settled_at IS NULL GROUP BY 1`,
      );
      const recRows = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, partner_type::text AS partner_type, left(partner_id,8) AS partner,
                CASE WHEN suspended_at IS NULL THEN 'ACTIVE' ELSE 'SUSPENDED' END AS state,
                amount::text AS amount, recovered::text AS recovered, waived::text AS waived,
                (amount-recovered-waived)::text AS outstanding,
                reason, transaction_id, contract_id, created_at, suspended_at, suspension_ref
           FROM partner_receivables WHERE settled_at IS NULL
          ORDER BY (suspended_at IS NOT NULL), (amount-recovered-waived) DESC, created_at ASC, id
          LIMIT $1`,
        limit,
      );

      const obSummary = await tx.$queryRawUnsafe<{ status: string; c: number; unpaid: string; ext: string; ver: string }[]>(
        `SELECT status::text AS status, count(*)::int AS c, coalesce(sum(unpaid),0)::text AS unpaid,
                coalesce(sum(externally_paid),0)::text AS ext, coalesce(sum(verified_paid),0)::text AS ver
           FROM contract_unpaid_obligations GROUP BY 1`,
      );
      const OB_COLS = `o.id, o.key, o.kind::text AS kind, o.party, o.status::text AS status, o.owed::text AS owed, o.paid::text AS paid,
                o.unpaid::text AS unpaid, o.externally_paid::text AS externally_paid, o.verified_paid::text AS verified_paid, o.transaction_id, o.reason, o.created_at, o.resolved_at,
                CASE WHEN t.related_entity_type::text = 'PT_CONTRACT' THEN t.related_entity_id END AS contract_id`;
      const obRows = await tx.$queryRawUnsafe<any[]>(
        `SELECT ${OB_COLS}
           FROM contract_unpaid_obligations o
           LEFT JOIN payment_transactions t ON t.id = o.transaction_id
          WHERE o.status IN ('OPEN','UNDER_REVIEW')
          ORDER BY o.created_at ASC, o.id LIMIT $1`,
        limit,
      );
      const inFlightRows = await tx.$queryRawUnsafe<any[]>(
        `SELECT ${OB_COLS}
           FROM contract_unpaid_obligations o
           LEFT JOIN payment_transactions t ON t.id = o.transaction_id
          WHERE o.status IN ('APPROVED_FOR_PAYMENT','AWAITING_EVIDENCE')
          ORDER BY o.created_at ASC, o.id LIMIT $1`,
        limit,
      );
      const closedRows = await tx.$queryRawUnsafe<any[]>(
        `SELECT ${OB_COLS}
           FROM contract_unpaid_obligations o
           LEFT JOIN payment_transactions t ON t.id = o.transaction_id
          WHERE o.status IN ('PAID_VERIFIED','PAID_EXTERNALLY','WAIVED','RESOLVED','RESOLVED_OTHER')
          ORDER BY o.resolved_at DESC NULLS LAST, o.id LIMIT $1`,
        limit,
      );
      const obIds = [...obRows, ...inFlightRows, ...closedRows].map((r) => r.id as string);
      const pendingRows = inFlightRows.length
        ? await tx.$queryRawUnsafe<any[]>(
            `SELECT obligation_id, approval_ref, status::text AS status, amount::text AS amount, payment_source, recipient_party, recipient_id,
                    approved_by, approved_at, recorded_by, recorded_at, paid_amount::text AS paid_amount, transfer_reference, paid_on,
                    evidence_ref, evidence_hash, bank_statement_id
               FROM contract_unpaid_obligation_payments
              WHERE status IN ('APPROVED','EVIDENCE_SUBMITTED') AND obligation_id = ANY($1::text[])`,
            inFlightRows.map((r) => r.id as string),
          )
        : [];
      const eventRows = obIds.length
        ? await tx.$queryRawUnsafe<any[]>(
            `SELECT obligation_id, created_at, action::text AS action, from_status::text AS from_status, to_status::text AS to_status,
                    actor, approved_by, approval_ref, note, paid_amount::text AS paid_amount, transfer_reference, paid_on,
                    unpaid_after::text AS unpaid_after, payment_source, recipient, evidence_ref, evidence_hash, bank_statement_id, verified_by
               FROM contract_unpaid_obligation_events WHERE obligation_id = ANY($1::text[])
              ORDER BY created_at ASC, id`,
            obIds,
          )
        : [];

      const staleCount =
        (
          await tx.$queryRawUnsafe<{ c: number }[]>(
            `SELECT count(*)::int AS c FROM payment_transactions
              WHERE status='PAID' AND activation_status IN ('PENDING','ACTIVATION_FAILED')
                AND paid_at < now() - ($1::int * interval '1 minute')`,
            staleMinutes,
          )
        )[0]?.c ?? 0;
      const staleRows = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, purpose::text AS purpose, activation_status::text AS activation_status, amount::text AS amount,
                paid_at, activation_retry_count
           FROM payment_transactions
          WHERE status='PAID' AND activation_status IN ('PENDING','ACTIVATION_FAILED')
            AND paid_at < now() - ($1::int * interval '1 minute')
          ORDER BY paid_at ASC, id LIMIT $2`,
        staleMinutes,
        limit,
      );

      return { negWallets, negSub, mism, recSummary, recRows, obSummary, obRows, inFlightRows, pendingRows, closedRows, eventRows, staleCount, staleRows };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000, maxWait: 10_000 },
  );

  // The owning services (gym-service / ai-service) answer read-only status questions (target-status.client.ts). A lookup that
  // fails or times out leaves its rows in "pending verification"; CANCELLED is never inferred from money still in PENDING.
  // `opts.lookupTargetStatus === null` skips the lookup entirely (every row is then unverified / NOT_CHECKED). SELECTs only.
  const lookup = opts.lookupTargetStatus === undefined ? createTargetStatusLookup() : opts.lookupTargetStatus;
  const cls = await classifyActivatedProductPayments(lookup, { limit: 500 });
  const candidatesAll = cls.unverified;
  const candidates: TargetUnverifiedCandidate[] = candidatesAll.slice(0, limit).map((c) => ({
    transactionId: c.transactionId,
    targetType: c.relatedEntityType,
    amount: c.amount,
    partnerPendingRemaining: c.partnerPendingRemaining,
  }));
  const cancelledAll = cls.cancelled.map(toProductRow);
  const refundsAll = [...cls.refundShort, ...cls.refundCompleted].map(toProductRow);
  const resolved = cls.activeValid + cls.cancelled.length + cls.refundCompleted.length + cls.refundShort.length;
  // `unverified` omits rows that need no attention (e.g. nothing held), so this state is a best signal, not a count of failures.
  const lookupState: ProductLookupState = !lookup
    ? 'NOT_CHECKED'
    : candidatesAll.length === 0
      ? 'OK'
      : resolved === 0
        ? 'UNAVAILABLE'
        : 'PARTIAL';

  const rec = (state: string) => core.recSummary.find((r) => r.state === state);
  const ob = (status: string) => core.obSummary.find((r) => r.status === status);
  const recCount = (rec('ACTIVE')?.c ?? 0) + (rec('SUSPENDED')?.c ?? 0);
  const obOpen = ob('OPEN')?.c ?? 0;
  const obClosedCount =
    (ob('PAID_VERIFIED')?.c ?? 0) + (ob('PAID_EXTERNALLY')?.c ?? 0) + (ob('WAIVED')?.c ?? 0) + (ob('RESOLVED')?.c ?? 0) + (ob('RESOLVED_OTHER')?.c ?? 0);
  const obOpenListCount = obOpen + (ob('UNDER_REVIEW')?.c ?? 0);
  const obInFlightCount = (ob('APPROVED_FOR_PAYMENT')?.c ?? 0) + (ob('AWAITING_EVIDENCE')?.c ?? 0);
  const totalExternallyPaid = core.obSummary.reduce((a, r) => a.plus(new Prisma.Decimal(r.ext ?? 0)), new Prisma.Decimal(0));
  const totalVerifiedPaid = core.obSummary.reduce((a, r) => a.plus(new Prisma.Decimal(r.ver ?? 0)), new Prisma.Decimal(0));
  const pendingByObligation = new Map<string, PendingPaymentRow>();
  for (const p of core.pendingRows) {
    pendingByObligation.set(p.obligation_id, {
      approvalRef: cut(p.approval_ref, 40),
      status: p.status,
      approvedAmount: money(p.amount),
      paymentSource: p.payment_source,
      recipientParty: p.recipient_party,
      recipient: short(p.recipient_id),
      approvedBy: cut(p.approved_by, 40),
      approvedAt: iso(p.approved_at) as string,
      recordedBy: p.recorded_by ? cut(p.recorded_by, 40) : null,
      recordedAt: iso(p.recorded_at),
      recordedAmount: p.paid_amount === null || p.paid_amount === undefined ? null : money(p.paid_amount),
      transferReference: p.transfer_reference ? cut(p.transfer_reference, 80) : null,
      paidOn: iso(p.paid_on),
      evidenceRef: p.evidence_ref ? cut(p.evidence_ref, 120) : null,
      evidenceHash: hash12(p.evidence_hash),
      bankStatementId: p.bank_statement_id ? cut(p.bank_statement_id, 80) : null,
    });
  }
  /** `CLIENT:<id>` -> `CLIENT:<first 8 characters>`: the report never carries a full personal id. */
  const shortRecipient = (v: unknown): string | null => {
    if (!v) return null;
    const [party, id] = String(v).split(':');
    return id ? `${party}:${short(id)}` : party;
  };
  const historyByObligation = new Map<string, ObligationEventRow[]>();
  for (const e of core.eventRows) {
    const list = historyByObligation.get(e.obligation_id) ?? [];
    list.push({
      at: iso(e.created_at) as string,
      action: e.action,
      fromStatus: e.from_status,
      toStatus: e.to_status,
      actor: cut(e.actor, 40),
      approvedBy: e.approved_by ? cut(e.approved_by, 40) : null,
      approvalRef: cut(e.approval_ref, 40),
      note: cut(e.note),
      paidAmount: e.paid_amount === null || e.paid_amount === undefined ? null : money(e.paid_amount),
      transferReference: e.transfer_reference ? cut(e.transfer_reference, 80) : null,
      paidOn: iso(e.paid_on),
      unpaidAfter: e.unpaid_after === null || e.unpaid_after === undefined ? null : money(e.unpaid_after),
      paymentSource: e.payment_source ?? null,
      recipient: shortRecipient(e.recipient),
      evidenceRef: e.evidence_ref ? cut(e.evidence_ref, 120) : null,
      evidenceHash: hash12(e.evidence_hash),
      bankStatementId: e.bank_statement_id ? cut(e.bank_statement_id, 80) : null,
      verifiedBy: e.verified_by ? cut(e.verified_by, 40) : null,
    });
    historyByObligation.set(e.obligation_id, list);
  }
  const toObligation = (r: any): UnpaidObligationRow => ({
    id: r.id,
    kind: r.kind,
    party: r.party,
    status: r.status,
    owed: money(r.owed),
    paid: money(r.paid),
    unpaid: money(r.unpaid),
    transactionId: r.transaction_id,
    contract: short(r.contract_id),
    contractId: r.contract_id ?? null,
    sessionId: sessionIdOfKey(r.key),
    reason: r.reason ? cut(r.reason) : null,
    externallyPaid: money(r.externally_paid),
    verifiedPaid: money(r.verified_paid),
    pendingPayment: pendingByObligation.get(r.id) ?? null,
    history: (historyByObligation.get(r.id) ?? []).slice(-10),
    createdAt: iso(r.created_at) as string,
    resolvedAt: iso(r.resolved_at),
  });

  return {
    generatedAt: now.toISOString(),
    params: { limit, staleMinutes },
    summary: {
      negativeWallets: core.negWallets.total,
      negativeSubledgers: { count: core.negSub.total, unbackedTotal: core.negSub.unbackedTotal },
      walletMismatches: { count: core.mism.total, nonEscrowCount: core.mism.nonEscrowTotal },
      receivables: {
        active: { count: rec('ACTIVE')?.c ?? 0, outstanding: money(rec('ACTIVE')?.outstanding) },
        suspended: { count: rec('SUSPENDED')?.c ?? 0, outstanding: money(rec('SUSPENDED')?.outstanding) },
      },
      unpaidObligations: {
        open: { count: obOpen, unpaid: money(ob('OPEN')?.unpaid) },
        underReview: { count: ob('UNDER_REVIEW')?.c ?? 0, unpaid: money(ob('UNDER_REVIEW')?.unpaid) },
        approvedForPayment: { count: ob('APPROVED_FOR_PAYMENT')?.c ?? 0, unpaid: money(ob('APPROVED_FOR_PAYMENT')?.unpaid) },
        awaitingEvidence: { count: ob('AWAITING_EVIDENCE')?.c ?? 0, unpaid: money(ob('AWAITING_EVIDENCE')?.unpaid) },
        paidVerified: { count: ob('PAID_VERIFIED')?.c ?? 0, amount: totalVerifiedPaid.toFixed(2) },
        paidExternally: { count: ob('PAID_EXTERNALLY')?.c ?? 0, amount: totalExternallyPaid.toFixed(2) },
        resolvedOther: { count: ob('RESOLVED_OTHER')?.c ?? 0 },
        waived: { count: ob('WAIVED')?.c ?? 0, unpaid: money(ob('WAIVED')?.unpaid) },
        resolved: { count: ob('RESOLVED')?.c ?? 0 },
      },
      paidNotActivated: core.staleCount,
      targetUnverified: { status: 'TARGET_STATUS_UNVERIFIED', candidates: candidatesAll.length },
      productPayments: {
        lookup: lookupState,
        activeValid: cls.activeValid,
        cancelledPaid: cancelledAll.length,
        pendingVerification: candidatesAll.length,
        refundCompleted: cls.refundCompleted.length,
        refundShort: cls.refundShort.length,
      },
    },
    negativeWallets: core.negWallets.rows,
    negativeSubledgers: core.negSub.rows,
    walletMismatches: core.mism.rows,
    receivables: core.recRows.map((r) => ({
      id: r.id,
      partnerType: r.partner_type,
      partner: r.partner,
      state: r.state,
      amount: money(r.amount),
      recovered: money(r.recovered),
      waived: money(r.waived),
      outstanding: money(r.outstanding),
      reason: cut(r.reason),
      transactionId: r.transaction_id ?? null,
      contract: short(r.contract_id),
      createdAt: iso(r.created_at) as string,
      suspendedAt: iso(r.suspended_at),
      suspensionRef: r.suspension_ref ?? null,
    })),
    unpaidObligations: core.obRows.map(toObligation),
    inFlightObligations: core.inFlightRows.map(toObligation),
    closedObligations: core.closedRows.map(toObligation),
    paidNotActivated: core.staleRows.map((r) => ({
      transactionId: r.id,
      purpose: r.purpose,
      activationStatus: r.activation_status,
      amount: money(r.amount),
      paidAt: iso(r.paid_at),
      ageMinutes: r.paid_at ? Math.max(0, Math.floor((now.getTime() - new Date(r.paid_at).getTime()) / 60000)) : 0,
      retryCount: Number(r.activation_retry_count ?? 0),
    })),
    targetUnverified: { status: 'TARGET_STATUS_UNVERIFIED', candidates },
    cancelledPaid: cancelledAll.slice(0, limit),
    refundOutcomes: refundsAll.slice(0, limit),
    truncated: {
      negativeWallets: core.negWallets.total > core.negWallets.rows.length,
      negativeSubledgers: core.negSub.total > core.negSub.rows.length,
      walletMismatches: core.mism.total > core.mism.rows.length,
      receivables: recCount > core.recRows.length,
      unpaidObligations: obOpenListCount > core.obRows.length,
      inFlightObligations: obInFlightCount > core.inFlightRows.length,
      closedObligations: obClosedCount > core.closedRows.length,
      paidNotActivated: core.staleCount > core.staleRows.length,
      targetUnverified: candidatesAll.length > candidates.length,
      cancelledPaid: cancelledAll.length > limit,
      refundOutcomes: refundsAll.length > limit,
    },
  };
}
