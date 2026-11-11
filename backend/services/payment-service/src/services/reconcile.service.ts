import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { Prisma, type ReconciliationRun } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { PLATFORM_ESCROW_ID, PLATFORM_REVENUE_ID } from './wallet.service';

/**
 * The system-wide money invariant.
 *
 *   ESCROW.available = Σ (pending + available + locked) over every non-ESCROW wallet
 *
 * ESCROW is custodial: it is the single account holding all cash taken in through the
 * gateways and not yet paid out. Every other wallet is a *claim* on that cash — a PT's
 * pending earnings, a gym's withdrawable balance, a client's refund, the platform's own
 * earned revenue. Claims must sum to holdings; any gap means money was created or destroyed
 * somewhere and the ledger can no longer be trusted.
 *
 * NOTE — this differs from the task brief, which listed only PT/GYM wallets plus client
 * wallets on the right-hand side. That version cannot hold: the payment step credits the
 * platform's pending bucket with platformRate × P out of the same P added to ESCROW, so
 * omitting the platform's own claim leaves a permanent shortfall of exactly the commission.
 * REVENUE is included here instead, and stays included until a payout debits both it and
 * ESCROW — the same way a PT withdrawal does.
 *
 * P0 cluster F — locked included: a withdrawal request approval moves money AVAILABLE ->
 * LOCKED (still someone's claim, just reserved for an imminent payout), not out of the
 * platform's custody — only the actual payout (markPaid's escrow debit) does that. Omitting
 * `locked` here would make every approval look like a drift of exactly the approved amount.
 */
export interface ReconciliationReport {
  escrow: string;
  claims: string;
  drift: string;
  balanced: boolean;
  breakdown: {
    clientBalances: string;
    ptPending: string;
    ptAvailable: string;
    ptLocked: string;
    /** FH-9: earned PT money held back per contract (not withdrawable). A claim on ESCROW like AVAILABLE. */
    ptHoldback: string;
    gymPending: string;
    gymAvailable: string;
    gymLocked: string;
    platformRevenuePending: string;
    platformRevenueAvailable: string;
  };
  /** Wallets whose balances have gone negative — always a bug, never expected. */
  negativeWallets: { id: string; ownerType: string; ownerId: string; available: string; pending: string; locked: string; holdback: string }[];
}

interface SumRow {
  owner_type: string;
  owner_id: string;
  pending: string | null;
  available: string | null;
  locked: string | null;
  holdback: string | null;
}

export async function buildReconciliationReport(): Promise<ReconciliationReport> {
  const rows = await prisma.$queryRaw<SumRow[]>`
    SELECT owner_type,
           CASE WHEN owner_type = 'PLATFORM' THEN owner_id ELSE '' END AS owner_id,
           SUM(pending_balance)::text   AS pending,
           SUM(available_balance)::text AS available,
           SUM(locked_balance)::text    AS locked,
           SUM(holdback_balance)::text  AS holdback
    FROM wallets
    GROUP BY owner_type, CASE WHEN owner_type = 'PLATFORM' THEN owner_id ELSE '' END`;

  const zero = new Prisma.Decimal(0);
  const pick = (ownerType: string, ownerId = '') => {
    const r = rows.find((x) => x.owner_type === ownerType && x.owner_id === ownerId);
    return {
      pending: new Prisma.Decimal(r?.pending ?? 0),
      available: new Prisma.Decimal(r?.available ?? 0),
      locked: new Prisma.Decimal(r?.locked ?? 0),
      holdback: new Prisma.Decimal(r?.holdback ?? 0),
    };
  };

  const client = pick('CLIENT');
  const pt = pick('PT');
  const gym = pick('GYM');
  const revenue = pick('PLATFORM', PLATFORM_REVENUE_ID);
  const escrowRow = pick('PLATFORM', PLATFORM_ESCROW_ID);

  // A client wallet only ever holds refunds, and those are withdrawable, but count all three
  // buckets so an accidental pending/locked credit shows up as a claim rather than as drift.
  const claims = zero
    .plus(client.pending).plus(client.available).plus(client.locked).plus(client.holdback)
    .plus(pt.pending).plus(pt.available).plus(pt.locked).plus(pt.holdback)
    .plus(gym.pending).plus(gym.available).plus(gym.locked).plus(gym.holdback)
    .plus(revenue.pending).plus(revenue.available).plus(revenue.locked).plus(revenue.holdback);

  const escrow = escrowRow.available;
  const drift = escrow.minus(claims);

  const negativeRows = await prisma.$queryRaw<
    { id: string; owner_type: string; owner_id: string; available_balance: string; pending_balance: string; locked_balance: string; holdback_balance: string }[]
  >`SELECT id, owner_type, owner_id, available_balance, pending_balance, locked_balance, holdback_balance
      FROM wallets
     WHERE available_balance < 0 OR pending_balance < 0 OR locked_balance < 0 OR holdback_balance < 0`;

  return {
    escrow: escrow.toFixed(2),
    claims: claims.toFixed(2),
    drift: drift.toFixed(2),
    balanced: drift.isZero(),
    breakdown: {
      clientBalances: client.available.plus(client.pending).plus(client.locked).toFixed(2),
      ptPending: pt.pending.toFixed(2),
      ptAvailable: pt.available.toFixed(2),
      ptLocked: pt.locked.toFixed(2),
      ptHoldback: pt.holdback.toFixed(2),
      gymPending: gym.pending.toFixed(2),
      gymAvailable: gym.available.toFixed(2),
      gymLocked: gym.locked.toFixed(2),
      platformRevenuePending: revenue.pending.toFixed(2),
      platformRevenueAvailable: revenue.available.toFixed(2),
    },
    negativeWallets: negativeRows.map((r) => ({
      id: r.id,
      ownerType: r.owner_type,
      ownerId: r.owner_id,
      available: r.available_balance,
      pending: r.pending_balance,
      locked: r.locked_balance,
      holdback: r.holdback_balance,
    })),
  };
}

/** Throws unless the invariant holds exactly — for use in tests after each scenario. */
export async function assertInvariant(context = ''): Promise<ReconciliationReport> {
  const report = await buildReconciliationReport();
  if (!report.balanced) {
    throw new Error(
      `Money invariant violated${context ? ` (${context})` : ''}: escrow=${report.escrow} claims=${report.claims} drift=${report.drift}`,
    );
  }
  if (report.negativeWallets.length > 0) {
    throw new Error(
      `Negative wallet balance${context ? ` (${context})` : ''}: ${JSON.stringify(report.negativeWallets)}`,
    );
  }
  return report;
}

// ---------------------------------------------------------------------------------------------------------------------
// G-06 - run history. An append-only record of balance checks: one row when an admin presses "Chạy đối soát và lưu"
// (POST /admin/payments/reconciliation/runs) and one row when the 5-minute job sees something NEW. A plain
// GET /admin/payments/reconciliation is read-only and writes nothing. The history is evidence only: nothing reads
// it back to change a balance.
// ---------------------------------------------------------------------------------------------------------------------

export type ReconciliationTrigger = 'ADMIN' | 'JOB';
export type ReconciliationRunStatus = 'BALANCED' | 'DRIFT' | 'ERROR';

/** Same admin cannot record two runs closer than this. */
export const ADMIN_RUN_MIN_INTERVAL_MS = 30_000;
/** The job always records at least one run per this window, even when nothing changed (a heartbeat). */
export const JOB_HEARTBEAT_MS = 60 * 60_000;

/** What a stored run's `summary` holds: figures already in the report (decimal strings) plus a count. No wallet or owner ids. */
export function buildRunSummary(report: ReconciliationReport): Prisma.InputJsonObject {
  return { breakdown: { ...report.breakdown }, negativeWalletCount: report.negativeWallets.length };
}

export interface ReconciliationRunDto {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  triggeredBy: string | null;
  status: string;
  escrowBalance: string | null;
  claimsTotal: string | null;
  drift: string | null;
  summary: unknown;
  errorCode: string | null;
}

type RunRow = ReconciliationRun;

export function toRunDto(r: RunRow): ReconciliationRunDto {
  return {
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    trigger: r.trigger,
    triggeredBy: r.triggeredBy,
    status: r.status,
    escrowBalance: r.escrowBalance ? r.escrowBalance.toFixed(2) : null,
    claimsTotal: r.claimsTotal ? r.claimsTotal.toFixed(2) : null,
    drift: r.drift ? r.drift.toFixed(2) : null,
    summary: r.summary,
    errorCode: r.errorCode,
  };
}

async function persistReportRun(report: ReconciliationReport, startedAt: Date, trigger: ReconciliationTrigger, triggeredBy: string | null): Promise<RunRow> {
  return prisma.reconciliationRun.create({
    data: {
      startedAt,
      finishedAt: new Date(),
      trigger,
      triggeredBy,
      status: report.balanced ? 'BALANCED' : 'DRIFT',
      escrowBalance: new Prisma.Decimal(report.escrow),
      claimsTotal: new Prisma.Decimal(report.claims),
      drift: new Prisma.Decimal(report.drift),
      summary: buildRunSummary(report),
    },
  });
}

async function persistErrorRun(startedAt: Date, trigger: ReconciliationTrigger, triggeredBy: string | null): Promise<void> {
  try {
    await prisma.reconciliationRun.create({
      data: { startedAt, finishedAt: new Date(), trigger, triggeredBy, status: 'ERROR', summary: {}, errorCode: 'REPORT_FAILED' },
    });
  } catch (recErr) {
    logger.error({ err: (recErr as Error).message }, '[payment-service] reconciliation ERROR run could not be recorded');
  }
}

export class ReconciliationTooSoonError extends Error {
  constructor() {
    super('RECONCILIATION_RUN_TOO_SOON');
  }
}

/**
 * Admin "run and save". Throttled per admin: a run by the same admin less than ADMIN_RUN_MIN_INTERVAL_MS ago throws
 * ReconciliationTooSoonError (nothing is run). A report failure records an ERROR run (best effort) and rethrows; a failure to
 * write the run also throws (this call exists to record).
 */
export async function runAndRecordAdminReconciliation(adminId: string, now: Date = new Date()): Promise<ReconciliationRunDto> {
  const last = await prisma.reconciliationRun.findFirst({
    where: { trigger: 'ADMIN', triggeredBy: adminId },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
  if (last && now.getTime() - last.startedAt.getTime() < ADMIN_RUN_MIN_INTERVAL_MS) throw new ReconciliationTooSoonError();
  const startedAt = new Date();
  let report: ReconciliationReport;
  try {
    report = await buildReconciliationReport();
  } catch (err) {
    await persistErrorRun(startedAt, 'ADMIN', adminId);
    throw err;
  }
  return toRunDto(await persistReportRun(report, startedAt, 'ADMIN', adminId));
}

/** The figures the job compares between two passes. */
export interface RunFingerprint {
  status: string;
  /** Decimal string with 2 decimals, or null (ERROR). */
  drift: string | null;
}

/**
 * Job dedupe rule (pure): record when there is no previous run, when the status or the drift differs from the LATEST run of any
 * trigger, or when the latest JOB run is older than JOB_HEARTBEAT_MS (or there is none).
 */
export function shouldRecordJobRun(
  current: RunFingerprint,
  latestAny: RunFingerprint | null,
  latestJobStartedAt: Date | null,
  now: Date,
): { record: boolean; reason: 'FIRST' | 'CHANGED' | 'HEARTBEAT' | 'UNCHANGED' } {
  if (!latestAny) return { record: true, reason: 'FIRST' };
  if (latestAny.status !== current.status || latestAny.drift !== current.drift) return { record: true, reason: 'CHANGED' };
  if (!latestJobStartedAt || now.getTime() - latestJobStartedAt.getTime() > JOB_HEARTBEAT_MS) return { record: true, reason: 'HEARTBEAT' };
  return { record: false, reason: 'UNCHANGED' };
}

/** One pass of the job: checks the ledger and records a JOB run only when it has something new (see shouldRecordJobRun). */
export async function recordJobRunIfChanged(now: Date = new Date()): Promise<{ recorded: boolean; reason: string; runId: string | null }> {
  const startedAt = new Date();
  let report: ReconciliationReport | null = null;
  let current: RunFingerprint;
  try {
    report = await buildReconciliationReport();
    current = { status: report.balanced ? 'BALANCED' : 'DRIFT', drift: report.drift };
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[payment-service] reconciliation job report failed');
    current = { status: 'ERROR', drift: null };
  }
  const [latestAny, latestJob] = await Promise.all([
    prisma.reconciliationRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { status: true, drift: true } }),
    prisma.reconciliationRun.findFirst({ where: { trigger: 'JOB' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
  ]);
  const decision = shouldRecordJobRun(
    current,
    latestAny ? { status: latestAny.status, drift: latestAny.drift ? latestAny.drift.toFixed(2) : null } : null,
    latestJob?.startedAt ?? null,
    now,
  );
  if (!decision.record) return { recorded: false, reason: decision.reason, runId: null };
  if (!report) {
    await persistErrorRun(startedAt, 'JOB', null);
    return { recorded: true, reason: decision.reason, runId: null };
  }
  const row = await persistReportRun(report, startedAt, 'JOB', null);
  return { recorded: true, reason: decision.reason, runId: row.id };
}

const intParam = (min: number, max: number, fallback: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform((s) => Number(s))
    .refine((n) => Number.isSafeInteger(n) && n >= min && n <= max)
    .optional()
    .transform((n) => n ?? fallback);

export const reconciliationRunsQuerySchema = z
  .object({
    limit: intParam(1, 100, 20),
    offset: intParam(0, 100000, 0),
    status: z.enum(['BALANCED', 'DRIFT', 'ERROR']).optional(),
  })
  .strict();

export async function listReconciliationRuns(q: z.output<typeof reconciliationRunsQuerySchema>) {
  const where: Prisma.ReconciliationRunWhereInput = q.status ? { status: q.status } : {};
  const [total, rows] = await Promise.all([
    prisma.reconciliationRun.count({ where }),
    prisma.reconciliationRun.findMany({ where, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }], skip: q.offset, take: q.limit }),
  ]);
  const items = rows.map(toRunDto);
  return { total, limit: q.limit, offset: q.offset, hasMore: q.offset + items.length < total, items };
}
