#!/usr/bin/env node
/**
 * DEV-ONLY one-off: clear the dev reconciliation drift of 17,367,806.50 (docs: DRIFT_REPORT 14/11/2026, decision Q2 of 15/11/2026).
 *
 * WHY: two runs of the old `scripts/db-clean` (25/10 run H, 01/11 run G9) deleted wallets that still held money, together with their
 * ledger rows, and never touched ESCROW. The deleted wallets were claims backed by cash in ESCROW, so ESCROW.available is now higher
 * than the sum of every claim by exactly the deleted balances (3,969,729.35 + 12,287,834.15 + 1,110,243.00 = 17,367,806.50). The
 * invariant is read from wallet columns only (reconcile.service.ts buildReconciliationReport: drift = ESCROW.available - claims).
 *
 * WHAT IT WRITES (one DB transaction, nothing else):
 *   1. payment_transactions  - ONE row, purpose WITHDRAWAL (the only existing "money leaves the platform" purpose; there is no ADJUSTMENT enum
 *                              value and this script does NOT migrate one), status PAID, idempotency_key DEV_DRIFT_ADJUST_20261115,
 *                              metadata {kind, reason, amount}. The key is NOT of the form WITHDRAWAL:<request id>, so no withdrawal-request
 *                              view/sweep ever picks it up.
 *   2. wallet_ledger_entries - ONE DEBIT of the ESCROW AVAILABLE bucket for exactly the amount (balance chain before -> after).
 *                              There is deliberately NO counter-entry: the counter-side of this correction is a claim that no longer exists
 *                              (the deleted wallets). Crediting any wallet (or a "suspense" wallet) would re-create a claim and put the drift
 *                              straight back. The audit pair is therefore: transaction row (what/why/who) + ESCROW debit (the ledger movement).
 *   3. wallets               - ESCROW.available_balance -= amount (same statement-level effect as walletService.debit).
 *   4. ledger_operations     - ONE row, key = the idempotency key, kind DEV_DRIFT_ADJUST (kind is a free string), so a re-run replays and is a no-op.
 *
 * SAFETY:
 *   - Refuses unless the target is the LOCAL DEV Postgres (loopback host, port 5433, database gymcoach_payment) AND --confirm-dev is given.
 *     (--scratch-test additionally lets it run against a loopback `*_test` database on port 55433, used only to test this script itself.)
 *   - DRY RUN is the default: it prints before/after and rolls back. Nothing is written without --apply.
 *   - Compare-and-set: refuses unless the live drift is exactly the expected amount (so it cannot over/under-correct if something moved).
 *   - Never prints the connection string / credentials.
 *   - NOT for production: no such drift exists there; the host/port/db guard makes that impossible anyway.
 *
 * USAGE (DATABASE_URL must point at the dev postgres, e.g. postgresql://user:pw@localhost:5433/gymcoach_payment):
 *   node scripts/money/dev-drift-adjust-20261115.mjs --confirm-dev            # dry run
 *   node scripts/money/dev-drift-adjust-20261115.mjs --confirm-dev --apply    # write
 * Take a pg_dump of gymcoach_payment first.
 */
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';

const KEY = 'DEV_DRIFT_ADJUST_20261115';
const KIND = 'DEV_DRIFT_ADJUST';
const AMOUNT = '17367806.50';
const REASON = 'db-clean H/G9 deleted funded wallets (DRIFT_REPORT 14/11)';
const ESCROW_OWNER = 'ESCROW';

const args = new Set(process.argv.slice(2));
const confirmDev = args.has('--confirm-dev');
const apply = args.has('--apply');
const scratchTest = args.has('--scratch-test');

function fail(msg) {
  console.error(`REFUSED: ${msg}`);
  process.exit(2);
}

function parseTarget(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port || '5432', db: decodeURIComponent(u.pathname.replace(/^\/+/, '')) };
  } catch {
    return null;
  }
}

const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL is not set.');
if (!confirmDev) fail('pass --confirm-dev to confirm the target is the local DEV database.');
const t = parseTarget(url);
if (!t) fail('DATABASE_URL is not a valid URL.');
const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(t.host);
const isDev = loopback && t.port === '5433' && t.db === 'gymcoach_payment';
const isScratch = scratchTest && loopback && t.port === '55433' && /_test$/.test(t.db);
if (!isDev && !isScratch) {
  fail(`target ${t.host}:${t.port}/${t.db} is not the local dev postgres (loopback:5433/gymcoach_payment).`);
}

const DRIFT_SQL = `
  SELECT
    COALESCE(SUM(available_balance) FILTER (WHERE owner_type = 'PLATFORM' AND owner_id = '${ESCROW_OWNER}'), 0)::text AS escrow,
    COALESCE(SUM(pending_balance + available_balance + locked_balance + holdback_balance)
             FILTER (WHERE NOT (owner_type = 'PLATFORM' AND owner_id = '${ESCROW_OWNER}')), 0)::text AS claims,
    (COALESCE(SUM(available_balance) FILTER (WHERE owner_type = 'PLATFORM' AND owner_id = '${ESCROW_OWNER}'), 0)
     - COALESCE(SUM(pending_balance + available_balance + locked_balance + holdback_balance)
                FILTER (WHERE NOT (owner_type = 'PLATFORM' AND owner_id = '${ESCROW_OWNER}')), 0))::text AS drift
  FROM wallets`;

const client = new pg.Client({ connectionString: url });
await client.connect();
const where = `${t.host}:${t.port}/${t.db}`;
console.log(`[${KEY}] target ${where} mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

let exitCode = 0;
try {
  await client.query('BEGIN');
  // Lock the ESCROW wallet first: serialises with any concurrent money movement and a concurrent run of this script.
  const w = await client.query(
    `SELECT id, status, available_balance::text AS available FROM wallets WHERE owner_type = 'PLATFORM' AND owner_id = $1 FOR UPDATE`,
    [ESCROW_OWNER],
  );
  if (w.rowCount !== 1) throw new Error('ESCROW wallet not found');
  const escrow = w.rows[0];
  if (escrow.status !== 'ACTIVE') throw new Error(`ESCROW wallet is ${escrow.status}, not ACTIVE`);

  const before = (await client.query(DRIFT_SQL)).rows[0];
  console.log(`before: escrow=${before.escrow} claims=${before.claims} drift=${before.drift} balanced=${Number(before.drift) === 0}`);

  const prior = await client.query('SELECT id, transaction_id, created_at FROM ledger_operations WHERE key = $1', [KEY]);
  const priorTxn = await client.query('SELECT id FROM payment_transactions WHERE idempotency_key = $1', [KEY]);
  if (prior.rowCount > 0) {
    console.log(`NO-OP: idempotency key ${KEY} already applied (ledger_operation ${prior.rows[0].id}, transaction ${prior.rows[0].transaction_id}).`);
    await client.query('ROLLBACK');
    await client.end();
    process.exit(0);
  }
  if (priorTxn.rowCount > 0) throw new Error(`payment_transactions row with key ${KEY} exists without its ledger_operations marker - inspect manually`);

  const cas = await client.query('SELECT $1::numeric = $2::numeric AS same', [before.drift, AMOUNT]);
  if (!cas.rows[0].same) {
    throw new Error(`live drift ${before.drift} is not the expected ${AMOUNT}; refusing to adjust (compare-and-set)`);
  }
  if (Number(escrow.available) < Number(AMOUNT)) throw new Error('ESCROW.available is smaller than the adjustment');

  const txnId = randomUUID();
  const after = {
    escrowBefore: escrow.available,
    escrowAfter: (await client.query('SELECT ($1::numeric - $2::numeric)::text AS v', [escrow.available, AMOUNT])).rows[0].v,
  };
  const metadata = { kind: KIND, reason: REASON, amount: 17367806.5 };

  await client.query(
    `INSERT INTO payment_transactions
       (id, payer_id, purpose, amount, status, idempotency_key, paid_at, metadata, payer_wallet_id, initiated_by, source_service, updated_at)
     VALUES ($1, $2, 'WITHDRAWAL', $3::numeric, 'PAID', $4, now(), $5::jsonb, $6, $7, 'dev-drift-adjust-script', now())`,
    [txnId, ESCROW_OWNER, AMOUNT, KEY, JSON.stringify(metadata), escrow.id, KEY],
  );
  await client.query(`UPDATE wallets SET available_balance = available_balance - $2::numeric, updated_at = now() WHERE id = $1`, [escrow.id, AMOUNT]);
  await client.query(
    `INSERT INTO wallet_ledger_entries (id, wallet_id, transaction_id, entry_type, bucket, amount, balance_before, balance_after, description)
     VALUES ($1, $2, $3, 'DEBIT', 'AVAILABLE', $4::numeric, $5::numeric, $6::numeric, $7)`,
    [
      randomUUID(),
      escrow.id,
      txnId,
      AMOUNT,
      after.escrowBefore,
      after.escrowAfter,
      `${KEY} - ESCROW debited to remove drift left by deleted funded wallets (db-clean H/G9, DRIFT_REPORT 14/11)`,
    ],
  );
  const fingerprint = createHash('sha256').update(JSON.stringify({ KEY, KIND, AMOUNT, ESCROW_OWNER })).digest('hex');
  await client.query(
    `INSERT INTO ledger_operations (id, key, result, request_fingerprint, transaction_id, kind)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
    [randomUUID(), KEY, JSON.stringify({ transactionId: txnId, amount: AMOUNT, escrowBefore: after.escrowBefore, escrowAfter: after.escrowAfter, reason: REASON }), fingerprint, txnId, KIND],
  );

  const post = (await client.query(DRIFT_SQL)).rows[0];
  console.log(`after:  escrow=${post.escrow} claims=${post.claims} drift=${post.drift} balanced=${Number(post.drift) === 0}`);
  if (Number(post.drift) !== 0) throw new Error(`drift after adjustment is ${post.drift}, expected 0.00 - rolled back`);
  const neg = await client.query(
    `SELECT count(*)::int AS n FROM wallets WHERE available_balance < 0 OR pending_balance < 0 OR locked_balance < 0 OR holdback_balance < 0`,
  );
  console.log(`negative wallets after: ${neg.rows[0].n}`);

  if (apply) {
    await client.query('COMMIT');
    console.log(`APPLIED: transaction ${txnId}, ESCROW ${after.escrowBefore} -> ${after.escrowAfter}.`);
  } else {
    await client.query('ROLLBACK');
    console.log('DRY-RUN: rolled back, nothing written. Re-run with --apply to write.');
  }
} catch (e) {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* ignore */
  }
  console.error(`ERROR: ${e.message}`);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
