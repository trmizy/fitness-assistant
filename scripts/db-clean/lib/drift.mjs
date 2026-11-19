/**
 * db-clean - money safety around the payment database (N13F-01 root cause).
 *
 * Two runs of this tool once deleted wallets that still held money (together with their ledger rows) and never touched ESCROW, which left the
 * payment-service reconciliation (escrow - claims) off by 17,367,806.50 VND for good. Two guards live here, both read-only SQL helpers:
 *
 *   1. walletsWithMoney: a wallet that is NOT a PLATFORM wallet and holds anything in available / pending / locked / holdback must never be deleted.
 *      There is no waiver: the only legitimate way out is an audited ESCROW-debit adjustment made by the payment owner, which this tool does not implement.
 *   2. reconciliation drift (the same invariant as payment-service reconcile.service.ts buildReconciliationReport): escrow = PLATFORM/ESCROW available;
 *      claims = pending+available+locked+holdback of every CLIENT / PT / GYM wallet and of PLATFORM/REVENUE; drift = escrow - claims. The run reads it
 *      before the first DELETE and again just before COMMIT of the payment transaction, and ABORTS (ROLLBACK) when the two differ - a cleanup must leave the
 *      books exactly as it found them, whatever they were.
 */

const BUCKETS = ['available_balance', 'pending_balance', 'locked_balance', 'holdback_balance'];
/** `<alias>.available_balance <> 0 OR ...` (alias optional). */
export const anyBalanceSql = (alias = '') => BUCKETS.map((b) => `${alias ? `${alias}.` : ''}${b} <> 0`).join(' OR ');

/** json object { escrow, claims, drift } as exact numeric text (2 decimals). */
export const DRIFT_SQL = `
  SELECT json_build_object('escrow', e.v::numeric(20,2)::text, 'claims', c.v::numeric(20,2)::text, 'drift', (e.v - c.v)::numeric(20,2)::text)
    FROM (SELECT COALESCE(sum(available_balance), 0) AS v FROM wallets WHERE owner_type::text = 'PLATFORM' AND owner_id = 'ESCROW') e,
         (SELECT COALESCE(sum(pending_balance + available_balance + locked_balance + holdback_balance), 0) AS v
            FROM wallets
           WHERE owner_type::text IN ('CLIENT', 'PT', 'GYM') OR (owner_type::text = 'PLATFORM' AND owner_id = 'REVENUE')) c`;

/** Reads the reconciliation figures from an open payment database connection (a transaction is fine). */
export async function readDrift(db) {
  return db.json(DRIFT_SQL);
}

/** null when the two readings are identical, otherwise one sentence naming both. */
export function driftProblem(before, after) {
  if (!before || !after) return 'the reconciliation drift could not be read';
  if (before.escrow === after.escrow && before.claims === after.claims && before.drift === after.drift) return null;
  return `reconciliation drift changed: before escrow ${before.escrow} / claims ${before.claims} / drift ${before.drift}, after escrow ${after.escrow} / claims ${after.claims} / drift ${after.drift}`;
}

/** Wallets (by id) that are not PLATFORM wallets and hold money. Returns the rows with their exact balances. */
export async function walletsWithMoneyAmong(db, walletIds) {
  if (!walletIds.length) return [];
  return db.json(
    `SELECT COALESCE(json_agg(json_build_object('walletId', id, 'ownerType', owner_type::text, 'ownerId', owner_id,
              'available', available_balance::text, 'pending', pending_balance::text, 'locked', locked_balance::text, 'holdback', holdback_balance::text) ORDER BY id), '[]'::json)
       FROM wallets WHERE id = ANY($1::text[]) AND owner_type::text <> 'PLATFORM' AND (${anyBalanceSql()})`,
    [walletIds],
  );
}

/** Human text of the refusal: every wallet id with its amounts. */
export function describeWalletsWithMoney(wallets) {
  const lines = wallets.map((w) => `${w.walletId} (${w.ownerType} ${w.ownerId}): available ${w.available}, pending ${w.pending}, locked ${w.locked}, holdback ${w.holdback}`);
  return `refusing to delete ${wallets.length} wallet(s) that still hold money (deleting a wallet's claim without debiting ESCROW breaks the reconciliation for good; settle the balance first, or have the payment owner make an audited ESCROW-debit adjustment - this tool does not do that):\n  - ${lines.join('\n  - ')}`;
}
