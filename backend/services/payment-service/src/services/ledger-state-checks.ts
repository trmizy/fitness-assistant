/**
 * Shared, READ-ONLY ledger-state checks (FH-4 part 2).
 *
 * These are the payment-database queries that `post-deploy-state-check` (user-service/src/scripts) runs as
 * P-02 (negative wallet bucket), P-03 (wallet bucket != its own ledger) and P-04 (negative PENDING sub-ledger:
 * a contract whose escrow share was spent beyond what it was credited). They live here, as plain parameter-free SQL
 * text, so the admin reconciliation endpoint and the FH-8 inventory script run the SAME statements instead of a copy.
 * (The user-service script still holds its own copy of the text; it reads the payment DB through a raw `pg` client
 * and cannot import this package. Keep the three statements below as the reference when that script is next touched.)
 *
 * Ids are shortened to 8 characters: this is for human reading, never a key to act on.
 * Every statement only SELECTs; callers run them inside a READ ONLY transaction.
 */
import { Prisma } from '../generated/prisma';

/** Anything with `$queryRawUnsafe`: the PrismaClient or an interactive-transaction client. */
export interface RawQueryable {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

const SIGNED = `CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END`;

/** P-02. */
export const P02_NEGATIVE_WALLETS_SQL = `
  SELECT owner_type::text AS t, left(owner_id,8) AS owner, available_balance::text AS a, pending_balance::text AS p,
         locked_balance::text AS l, holdback_balance::text AS h, count(*) OVER ()::int AS total
    FROM wallets
   WHERE available_balance<0 OR pending_balance<0 OR locked_balance<0 OR holdback_balance<0
   ORDER BY owner_type, owner_id
   LIMIT $1`;

/** P-03 (a: every wallet except ESCROW, b: ESCROW). One statement; callers split on the escrow row. */
export const P03_WALLET_VS_LEDGER_SQL = `
  WITH l AS (SELECT wallet_id, bucket::text AS bucket, sum(CASE WHEN entry_type='CREDIT' THEN amount ELSE -amount END) AS net
               FROM wallet_ledger_entries GROUP BY 1,2)
  SELECT w.owner_type::text AS t, left(w.owner_id,8) AS owner, (w.owner_type='PLATFORM' AND w.owner_id='ESCROW') AS is_escrow,
         b.bucket, coalesce(l.net,0)::text AS ledger,
         (CASE b.bucket WHEN 'AVAILABLE' THEN w.available_balance WHEN 'PENDING' THEN w.pending_balance WHEN 'HOLDBACK' THEN w.holdback_balance ELSE w.locked_balance END)::text AS wallet
    FROM wallets w CROSS JOIN (VALUES ('AVAILABLE'),('PENDING'),('LOCKED'),('HOLDBACK')) b(bucket)
    LEFT JOIN l ON l.wallet_id=w.id AND l.bucket=b.bucket
   WHERE coalesce(l.net,0) <> (CASE b.bucket WHEN 'AVAILABLE' THEN w.available_balance WHEN 'PENDING' THEN w.pending_balance WHEN 'HOLDBACK' THEN w.holdback_balance ELSE w.locked_balance END)
   ORDER BY is_escrow, w.owner_type, w.owner_id, b.bucket`;

/** P-04. `txn_full` is the payment transaction id (an internal id, needed to look the row up; not personal data). */
export const P04_NEGATIVE_SUBLEDGERS_SQL = `
  SELECT w.owner_type::text AS t, left(w.owner_id,8) AS owner, e.transaction_id AS txn_full, left(e.transaction_id,8) AS txn,
         sum(${SIGNED})::text AS net, count(*)::int AS entries,
         min(e.created_at) AS first_entry, max(e.created_at) AS last_entry
    FROM wallet_ledger_entries e JOIN wallets w ON w.id=e.wallet_id
   WHERE e.bucket='PENDING' AND NOT (w.owner_type='PLATFORM' AND w.owner_id='ESCROW')
   GROUP BY w.owner_type, w.owner_id, e.transaction_id
  HAVING sum(${SIGNED}) < 0
   ORDER BY sum(${SIGNED}) ASC, w.owner_type, w.owner_id, e.transaction_id`;

export interface NegativeWalletRow {
  ownerType: string;
  owner: string;
  available: string;
  pending: string;
  locked: string;
  holdback: string;
}
export interface WalletLedgerMismatchRow {
  ownerType: string;
  owner: string;
  bucket: string;
  ledger: string;
  wallet: string;
  /** wallet - ledger */
  difference: string;
  isEscrow: boolean;
}
export interface NegativeSubledgerRow {
  ownerType: string;
  owner: string;
  transactionId: string;
  transactionShortId: string;
  net: string;
  entries: number;
  firstEntry: string | null;
  lastEntry: string | null;
}

const D = (v: unknown) => new Prisma.Decimal(String(v ?? 0));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export async function findNegativeWallets(q: RawQueryable, limit: number): Promise<{ total: number; rows: NegativeWalletRow[] }> {
  const rows = await q.$queryRawUnsafe<any[]>(P02_NEGATIVE_WALLETS_SQL, limit);
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => ({ ownerType: r.t, owner: r.owner, available: r.a, pending: r.p, locked: r.l, holdback: r.h ?? '0.00' })),
  };
}

/** Non-escrow mismatches are a defect (P-03a). The escrow row is informational (P-03b: seeded data is not fully ledgered). */
export async function findWalletLedgerMismatches(q: RawQueryable, limit: number): Promise<{ total: number; nonEscrowTotal: number; rows: WalletLedgerMismatchRow[] }> {
  const all = await q.$queryRawUnsafe<any[]>(P03_WALLET_VS_LEDGER_SQL);
  const mapped = all.map((r) => ({
    ownerType: r.t as string,
    owner: r.owner as string,
    bucket: r.bucket as string,
    ledger: D(r.ledger).toFixed(2),
    wallet: D(r.wallet).toFixed(2),
    difference: D(r.wallet).minus(D(r.ledger)).toFixed(2),
    isEscrow: Boolean(r.is_escrow),
  }));
  return { total: mapped.length, nonEscrowTotal: mapped.filter((r) => !r.isEscrow).length, rows: mapped.slice(0, limit) };
}

export async function findNegativeSubledgers(
  q: RawQueryable,
  limit: number,
): Promise<{ total: number; unbackedTotal: string; rows: NegativeSubledgerRow[] }> {
  const all = await q.$queryRawUnsafe<any[]>(P04_NEGATIVE_SUBLEDGERS_SQL);
  const unbacked = all.reduce((a, r) => a.plus(D(r.net).abs()), new Prisma.Decimal(0));
  return {
    total: all.length,
    unbackedTotal: unbacked.toFixed(2),
    rows: all.slice(0, limit).map((r) => ({
      ownerType: r.t,
      owner: r.owner,
      transactionId: r.txn_full,
      transactionShortId: r.txn,
      net: D(r.net).toFixed(2),
      entries: Number(r.entries),
      firstEntry: iso(r.first_entry),
      lastEntry: iso(r.last_entry),
    })),
  };
}
