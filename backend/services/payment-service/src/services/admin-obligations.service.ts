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
import { findActivatedButCancelledTargets } from './activated-but-cancelled-target.query';

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

export interface ActivatedButCancelledCandidate {
  transactionId: string;
  targetType: string;
  amount: string;
  partnerPendingRemaining: string;
}

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
      resolved: { count: number };
      waived: { count: number };
    };
    paidNotActivated: number;
    activatedButCancelled: { status: 'NEEDS_TARGET_LOOKUP'; candidates: number };
  };
  negativeWallets: NegativeWalletRow[];
  negativeSubledgers: NegativeSubledgerRow[];
  walletMismatches: WalletLedgerMismatchRow[];
  receivables: ReceivableRow[];
  unpaidObligations: UnpaidObligationRow[];
  paidNotActivated: PaidNotActivatedRow[];
  /**
   * Candidate rows only: PAID + ACTIVATED product payments whose money is still sitting in partners' PENDING and that
   * the client was never refunded for. payment-service owns no order / membership status, so whether the target is
   * really CANCELLED is NOT checked here ("needs target lookup", FH-8 / V2).
   */
  activatedButCancelled: { status: 'NEEDS_TARGET_LOOKUP'; candidates: ActivatedButCancelledCandidate[] };
  truncated: {
    negativeWallets: boolean;
    negativeSubledgers: boolean;
    walletMismatches: boolean;
    receivables: boolean;
    unpaidObligations: boolean;
    paidNotActivated: boolean;
    activatedButCancelled: boolean;
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
const cut = (v: string | null | undefined, n = 120) => (v ? (v.length > n ? `${v.slice(0, n)}...` : v) : '');
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export async function buildObligationsReport(
  opts: { limit?: number; staleMinutes?: number } = {},
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

      const obSummary = await tx.$queryRawUnsafe<{ status: string; c: number; unpaid: string }[]>(
        `SELECT status::text AS status, count(*)::int AS c, coalesce(sum(unpaid),0)::text AS unpaid
           FROM contract_unpaid_obligations GROUP BY 1`,
      );
      const obRows = await tx.$queryRawUnsafe<any[]>(
        `SELECT o.id, o.key, o.kind::text AS kind, o.party, o.status::text AS status, o.owed::text AS owed, o.paid::text AS paid,
                o.unpaid::text AS unpaid, o.transaction_id, o.reason, o.created_at, o.resolved_at,
                CASE WHEN t.related_entity_type::text = 'PT_CONTRACT' THEN t.related_entity_id END AS contract_id
           FROM contract_unpaid_obligations o
           LEFT JOIN payment_transactions t ON t.id = o.transaction_id
          WHERE o.status = 'OPEN'
          ORDER BY o.created_at ASC, o.id LIMIT $1`,
        limit,
      );

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

      return { negWallets, negSub, mism, recSummary, recRows, obSummary, obRows, staleCount, staleRows };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000, maxWait: 10_000 },
  );

  // Candidates only: the target's status belongs to other services and is not looked up here. SELECTs only.
  const candidatesAll = await findActivatedButCancelledTargets(async () => 'CANCELLED', { limit: 500 });
  const candidates: ActivatedButCancelledCandidate[] = candidatesAll.slice(0, limit).map((c) => ({
    transactionId: c.transactionId,
    targetType: c.relatedEntityType,
    amount: c.amount,
    partnerPendingRemaining: c.partnerPendingRemaining,
  }));

  const rec = (state: string) => core.recSummary.find((r) => r.state === state);
  const ob = (status: string) => core.obSummary.find((r) => r.status === status);
  const recCount = (rec('ACTIVE')?.c ?? 0) + (rec('SUSPENDED')?.c ?? 0);
  const obOpen = ob('OPEN')?.c ?? 0;

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
        resolved: { count: ob('RESOLVED')?.c ?? 0 },
        waived: { count: ob('WAIVED')?.c ?? 0 },
      },
      paidNotActivated: core.staleCount,
      activatedButCancelled: { status: 'NEEDS_TARGET_LOOKUP', candidates: candidatesAll.length },
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
    unpaidObligations: core.obRows.map((r) => ({
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
      createdAt: iso(r.created_at) as string,
      resolvedAt: iso(r.resolved_at),
    })),
    paidNotActivated: core.staleRows.map((r) => ({
      transactionId: r.id,
      purpose: r.purpose,
      activationStatus: r.activation_status,
      amount: money(r.amount),
      paidAt: iso(r.paid_at),
      ageMinutes: r.paid_at ? Math.max(0, Math.floor((now.getTime() - new Date(r.paid_at).getTime()) / 60000)) : 0,
      retryCount: Number(r.activation_retry_count ?? 0),
    })),
    activatedButCancelled: { status: 'NEEDS_TARGET_LOOKUP', candidates },
    truncated: {
      negativeWallets: core.negWallets.total > core.negWallets.rows.length,
      negativeSubledgers: core.negSub.total > core.negSub.rows.length,
      walletMismatches: core.mism.total > core.mism.rows.length,
      receivables: recCount > core.recRows.length,
      unpaidObligations: obOpen > core.obRows.length,
      paidNotActivated: core.staleCount > core.staleRows.length,
      activatedButCancelled: candidatesAll.length > candidates.length,
    },
  };
}
