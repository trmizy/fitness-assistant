import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { PLATFORM_ESCROW_ID, PLATFORM_REVENUE_ID } from './wallet.service';

/**
 * The system-wide money invariant.
 *
 *   ESCROW.available = Σ (pending + available) over every non-ESCROW wallet
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
    gymPending: string;
    gymAvailable: string;
    platformRevenuePending: string;
    platformRevenueAvailable: string;
  };
  /** Wallets whose balances have gone negative — always a bug, never expected. */
  negativeWallets: { id: string; ownerType: string; ownerId: string; available: string; pending: string }[];
}

interface SumRow {
  owner_type: string;
  owner_id: string;
  pending: string | null;
  available: string | null;
}

export async function buildReconciliationReport(): Promise<ReconciliationReport> {
  const rows = await prisma.$queryRaw<SumRow[]>`
    SELECT owner_type,
           CASE WHEN owner_type = 'PLATFORM' THEN owner_id ELSE '' END AS owner_id,
           SUM(pending_balance)::text   AS pending,
           SUM(available_balance)::text AS available
    FROM wallets
    GROUP BY owner_type, CASE WHEN owner_type = 'PLATFORM' THEN owner_id ELSE '' END`;

  const zero = new Prisma.Decimal(0);
  const pick = (ownerType: string, ownerId = '') => {
    const r = rows.find((x) => x.owner_type === ownerType && x.owner_id === ownerId);
    return {
      pending: new Prisma.Decimal(r?.pending ?? 0),
      available: new Prisma.Decimal(r?.available ?? 0),
    };
  };

  const client = pick('CLIENT');
  const pt = pick('PT');
  const gym = pick('GYM');
  const revenue = pick('PLATFORM', PLATFORM_REVENUE_ID);
  const escrowRow = pick('PLATFORM', PLATFORM_ESCROW_ID);

  // A client wallet only ever holds refunds, and those are withdrawable, but count both
  // buckets so an accidental pending credit shows up as a claim rather than as drift.
  const claims = zero
    .plus(client.pending).plus(client.available)
    .plus(pt.pending).plus(pt.available)
    .plus(gym.pending).plus(gym.available)
    .plus(revenue.pending).plus(revenue.available);

  const escrow = escrowRow.available;
  const drift = escrow.minus(claims);

  const negativeRows = await prisma.$queryRaw<
    { id: string; owner_type: string; owner_id: string; available_balance: string; pending_balance: string }[]
  >`SELECT id, owner_type, owner_id, available_balance, pending_balance
      FROM wallets
     WHERE available_balance < 0 OR pending_balance < 0`;

  return {
    escrow: escrow.toFixed(2),
    claims: claims.toFixed(2),
    drift: drift.toFixed(2),
    balanced: drift.isZero(),
    breakdown: {
      clientBalances: client.available.plus(client.pending).toFixed(2),
      ptPending: pt.pending.toFixed(2),
      ptAvailable: pt.available.toFixed(2),
      gymPending: gym.pending.toFixed(2),
      gymAvailable: gym.available.toFixed(2),
      platformRevenuePending: revenue.pending.toFixed(2),
      platformRevenueAvailable: revenue.available.toFixed(2),
    },
    negativeWallets: negativeRows.map((r) => ({
      id: r.id,
      ownerType: r.owner_type,
      ownerId: r.owner_id,
      available: r.available_balance,
      pending: r.pending_balance,
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
