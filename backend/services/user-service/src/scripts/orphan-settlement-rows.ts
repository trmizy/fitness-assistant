/**
 * ORPHAN SETTLEMENT ROWS (D62 item E, aligned with the sweep by D64-A) - dry-run by default, READ ONLY.
 *
 * Problem: `findRetryable` hands the settlement sweep the oldest PENDING / FAILED rows. A row whose contract no longer
 * exists (or that was never paid) can never be settled, so it used to be selected again on every tick and, from 50 of them
 * on, no newer row was ever retried. The sweep now skips them without writing to them (starvation-safe) and can PARK them itself, but ONLY when
 * SETTLEMENT_SWEEP_PARK_ORPHANS=true is set explicitly (OFF by default - owner decision D65).
 *
 * THIS SCRIPT USES THE SWEEP'S OWN RULE: it imports `classifySettlementContract` from src/services/settlement-orphan.ts, the one
 * function the sweep decides with, and writes the same markers, so the dry-run lists exactly the rows the sweep WOULD park if SETTLEMENT_SWEEP_PARK_ORPHANS=true:
 *   CONTRACT_MISSING   the contract row is gone                       -> last_error "ENDED_UNSETTLED:CONTRACT_MISSING <reason>"
 *   NO_PAYMENT         the contract exists, no payment transaction    -> last_error "ENDED_UNSETTLED:NO_PAYMENT <reason>"
 *   UNPAYABLE_TERMS    the contract HAS a payment transaction but no price / no sessions: money may sit in the ledger
 *                      -> NOT an orphan: last_error "NEEDS_RECONCILIATION: UNPAYABLE_TERMS ..." (visible, an ending stays refused)
 * The row is kept (never deleted), its status stays FAILED (never SETTLED / paid), the previous error is appended, no
 * payment-service call is made. Rows the sweep would NOT touch (contract alive and payable) are LIVE_RETRYABLE; with
 * PAYMENT_DATABASE_URL a live row whose transaction payment-service does not know is flagged PAYMENT_TXN_UNKNOWN (informational:
 * the sweep retries it and the attempt cap parks it for a human).
 *
 * Extra safety that only this script can give (the sweep has no access to payment-service's database): with PAYMENT_DATABASE_URL a
 * CONTRACT_MISSING row for which payment-service holds a transaction or a ledger operation is reported as MONEY_EXISTS_ESCALATE and
 * is NOT written by --apply (a human looks first). The sweep would still park it (ENDED_UNSETTLED:CONTRACT_MISSING - the row is not
 * lost, only taken out of the retry queue): on a database where this section is not empty, review it BEFORE
 * SETTLEMENT_SWEEP_PARK_ORPHANS=true is ever set there (parking is OFF unless that variable is explicitly "true").
 *
 * READ ONLY by default: every connection runs inside `SET TRANSACTION READ ONLY`, the database itself refuses a write.
 * --apply writes, and is refused unless the database name ends with "_test" (isolated test database). It is meant to be
 * proven on a copy, never on dev / staging / production. A real run on real data needs a backup + the owner's approval first.
 *
 * USAGE (from backend/services/user-service):
 *   USER_DATABASE_URL=postgresql://... [PAYMENT_DATABASE_URL=postgresql://...] \
 *     ./node_modules/.bin/tsx src/scripts/orphan-settlement-rows.ts [--json out.json] [--stale-minutes 2] [--sample 8]
 *   ... --apply [--expect-rows 62]       (test databases only)
 * Exit code: 0 = ran, 1 = --apply refused or --expect-rows mismatch, 2 = could not run.
 * Ids are cut to 8 characters; connection strings are never printed.
 */
import fs from "node:fs";
import { PrismaClient } from "../generated/prisma";
import { classifySettlementContract, orphanMarker, withPreviousError } from "../services/settlement-orphan";

type Row = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  created_at: Date;
  updated_at: Date;
  contract_id: string;
  session_id: string | null;
  last_error: string | null;
  contract_exists: boolean;
  contract_status: string | null;
  payment_transaction_id: string | null;
  price: unknown;
  total_sessions: number | null;
  idempotency_key: string;
};

export type Reason = "CONTRACT_MISSING" | "NO_PAYMENT" | "UNPAYABLE_TERMS" | "PAYMENT_TXN_UNKNOWN" | "MONEY_EXISTS_ESCALATE" | "AWAITING_PAYMENT" | "LIVE_RETRYABLE";

export interface Classified extends Row {
  reason: Reason;
  /**
   * MARK_ORPHAN            terminal ENDED_UNSETTLED:<reason> (sweep parks it the same way)
   * MARK_RECONCILIATION    NEEDS_RECONCILIATION (sweep parks it the same way)
   * ESCALATE_TO_HUMAN      an orphan the sweep would park, but the ledger holds money for it: --apply does not write it
   * LEAVE_TO_SWEEP         not touched
   */
  proposal: "MARK_ORPHAN" | "MARK_RECONCILIATION" | "ESCALATE_TO_HUMAN" | "LEAVE_TO_SWEEP";
  /** The exact last_error the sweep writes for this row (null when the row is left alone). */
  newLastError: string | null;
}


function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const has = (name: string) => process.argv.includes(name);
const short = (s: string | null | undefined) => (s ?? "-").slice(0, 8);

type Tx = { $queryRawUnsafe: <T = any>(sql: string, ...v: any[]) => Promise<T>; $executeRawUnsafe: (sql: string, ...v: any[]) => Promise<number> };

async function readOnly<T>(url: string, fn: (q: (sql: string, ...v: any[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const client = new PrismaClient({ datasourceUrl: url, log: [] });
  try {
    return await client.$transaction(
      async (tx: Tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return fn((sql, ...v) => tx.$queryRawUnsafe<any[]>(sql, ...v));
      },
      { timeout: 120_000, maxWait: 15_000, isolationLevel: "RepeatableRead" as any },
    );
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

/** Pure classification: the sweep's rule (settlement-orphan.ts) plus the payment-database overlay this script alone can add. */
export function classify(
  r: Row,
  payment: { txnKnown: (id: string) => boolean; contractHasMoney: (contractId: string) => boolean; opExists: (key: string) => boolean } | null,
): Classified {
  const v = classifySettlementContract(
    r.contract_id,
    r.contract_exists
      ? { paymentTransactionId: r.payment_transaction_id, price: r.price, totalSessions: r.total_sessions ?? 0, status: r.contract_status ?? undefined }
      : null,
  );
  if (v.kind === "ORPHAN") {
    const newLastError = `${orphanMarker(v.code)} ${withPreviousError(v.detail, r.last_error)}`.slice(0, 2000);
    // The contract is gone. The sweep parks it regardless; the script additionally says when payment-service holds money for it.
    if (v.code === "CONTRACT_MISSING" && payment && (payment.contractHasMoney(r.contract_id) || payment.opExists(r.idempotency_key))) {
      return { ...r, reason: "MONEY_EXISTS_ESCALATE", proposal: "ESCALATE_TO_HUMAN", newLastError };
    }
    return { ...r, reason: v.code, proposal: "MARK_ORPHAN", newLastError };
  }
  if (v.kind === "NEEDS_RECONCILIATION") {
    return { ...r, reason: v.code, proposal: "MARK_RECONCILIATION", newLastError: `NEEDS_RECONCILIATION: ${withPreviousError(v.detail, r.last_error)}`.slice(0, 2000) };
  }
  if (v.kind === "WAIT") return { ...r, reason: "AWAITING_PAYMENT", proposal: "LEAVE_TO_SWEEP", newLastError: null };
  if (payment && r.payment_transaction_id && !payment.txnKnown(r.payment_transaction_id)) {
    return { ...r, reason: "PAYMENT_TXN_UNKNOWN", proposal: "LEAVE_TO_SWEEP", newLastError: null };
  }
  return { ...r, reason: "LIVE_RETRYABLE", proposal: "LEAVE_TO_SWEEP", newLastError: null };
}

function dbNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

async function main(): Promise<number> {
  const userUrl = process.env.USER_DATABASE_URL;
  const paymentUrl = process.env.PAYMENT_DATABASE_URL ?? null;
  if (!userUrl) {
    console.error("USER_DATABASE_URL is required");
    return 2;
  }
  const apply = has("--apply");
  const staleMinutes = Number(arg("--stale-minutes") ?? 2); // the sweep's SESSION_SETTLEMENT_STALE_PROCESSING_MS default
  const sampleMax = Number(arg("--sample") ?? 8);
  const expectRows = arg("--expect-rows") != null ? Number(arg("--expect-rows")) : null;
  const jsonOut = arg("--json");

  if (apply) {
    const name = dbNameOf(userUrl);
    if (!/_test$/.test(name)) {
      console.error(`--apply REFUSED: database "${name || "?"}" does not end with _test. This script only writes to an isolated test copy.`);
      return 1;
    }
    if (paymentUrl && !/_test$/.test(dbNameOf(paymentUrl))) {
      console.error("--apply REFUSED: PAYMENT_DATABASE_URL does not point at a *_test database either (a copy is required so the safety check is meaningful).");
      return 1;
    }
  }

  // ── 1. candidate rows: what the sweep re-selects every tick ───────────────────────────────
  const rows: Row[] = await readOnly(userUrl, (q) =>
    q(
      `SELECT s.id, s.kind::text AS kind, s.status::text AS status, s.attempts, s.created_at, s.updated_at, s.contract_id, s.session_id,
              s.last_error, s.idempotency_key, (c.id IS NOT NULL) AS contract_exists, c.status::text AS contract_status,
              c.payment_transaction_id, c.price, c.total_sessions
         FROM session_settlements s LEFT JOIN contracts c ON c.id = s.contract_id
        WHERE ( ( s.status IN ('PENDING','FAILED') OR ( s.status = 'PROCESSING' AND s.updated_at < now() - ($1 || ' minutes')::interval ) )
                AND coalesce(s.last_error,'') NOT LIKE 'ENDED_UNSETTLED:%' AND coalesce(s.last_error,'') NOT LIKE 'NEEDS_RECONCILIATION:%'
                AND coalesce(s.last_error,'') NOT LIKE 'CONFLICT:%' )
        ORDER BY s.updated_at ASC, s.id ASC`,
      String(staleMinutes),
    ),
  );

  // ── 2. payment-service facts (optional) ───────────────────────────────────────────────────
  let payment: Parameters<typeof classify>[1] = null;
  let paymentNote = "PAYMENT_DATABASE_URL not given: money checks skipped (the CONTRACT_MISSING group is UNVERIFIED against the ledger).";
  if (paymentUrl) {
    const contractIds = [...new Set(rows.filter((r) => !r.contract_exists).map((r) => r.contract_id))];
    const txnIds = [...new Set(rows.map((r) => r.payment_transaction_id).filter((x): x is string => !!x))];
    const keys = rows.map((r) => r.idempotency_key);
    const facts = await readOnly(paymentUrl, async (q) => {
      const moneyContracts = contractIds.length ? await q(`SELECT DISTINCT pt_contract_id AS c FROM payment_transactions WHERE pt_contract_id = ANY($1::text[])`, contractIds) : [];
      const knownTxns = txnIds.length ? await q(`SELECT id FROM payment_transactions WHERE id = ANY($1::text[])`, txnIds) : [];
      const ops = keys.length ? await q(`SELECT key FROM ledger_operations WHERE key = ANY($1::text[])`, keys) : [];
      return { moneyContracts: new Set(moneyContracts.map((r: any) => r.c)), knownTxns: new Set(knownTxns.map((r: any) => r.id)), ops: new Set(ops.map((r: any) => r.key)) };
    });
    payment = {
      txnKnown: (id) => facts.knownTxns.has(id),
      contractHasMoney: (id) => facts.moneyContracts.has(id),
      opExists: (k) => facts.ops.has(k),
    };
    paymentNote = "payment-service database consulted (read only): transactions by contract id, transactions by id, ledger operations by key.";
  }

  const classified = rows.map((r) => classify(r, payment));
  const orphans = classified.filter((c) => c.proposal === "MARK_ORPHAN");
  const reconcile = classified.filter((c) => c.proposal === "MARK_RECONCILIATION");
  const marked = [...orphans, ...reconcile]; // what --apply writes
  const escalate = classified.filter((c) => c.proposal === "ESCALATE_TO_HUMAN");
  const live = classified.filter((c) => c.proposal === "LEAVE_TO_SWEEP");
  const sweepWouldPark = marked.length + escalate.length; // the sweep parks all of these (escalate ones as ENDED_UNSETTLED:CONTRACT_MISSING)

  // ── report ────────────────────────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const db = dbNameOf(userUrl);
  console.log(`ORPHAN SETTLEMENT ROWS - ${apply ? "APPLY (test database)" : "DRY RUN (read only)"} - ${now} - user database "${db}"`);
  console.log(paymentNote);
  console.log(`retryable rows the sweep scans (PENDING/FAILED not yet parked by ENDED_UNSETTLED/NEEDS_RECONCILIATION/CONFLICT, or PROCESSING older than ${staleMinutes} min): ${rows.length}`);
  console.log(`rows the sweep would PARK (orphans + unpriceable): ${sweepWouldPark}; rows it leaves alone: ${live.length}`);
  console.log(`before the sweep parked them, 50 or more of these in front of the queue starved it: ${sweepWouldPark >= 50 ? "that condition is MET here" : "below 50, not met"}`);
  console.log("");
  const table = new Map<string, number>();
  for (const c of classified) {
    const k = `${c.reason.padEnd(24)} ${c.kind.padEnd(30)} ${c.status.padEnd(10)} -> ${c.proposal}`;
    table.set(k, (table.get(k) ?? 0) + 1);
  }
  console.log("reason                   kind                           status     -> proposal                         rows");
  for (const [k, v] of [...table.entries()].sort()) console.log(`${k}  ${v}`);
  console.log("");
  if (classified.length) {
    const oldest = classified[0];
    const newest = classified[classified.length - 1];
    console.log(`row ages: oldest created ${oldest.created_at.toISOString()}, newest created ${newest.created_at.toISOString()}; attempts: ${[...new Set(classified.map((c) => c.attempts))].sort().join(",")}`);
  }
  console.log(`\nsample (first ${sampleMax} of the ${marked.length} rows the sweep would park and --apply would write; ids cut to 8 characters):`);
  for (const c of marked.slice(0, sampleMax)) {
    console.log(`  ${short(c.id)} ${c.kind} ${c.status} attempts=${c.attempts} created=${c.created_at.toISOString().slice(0, 10)} contract=${short(c.contract_id)} ${c.reason}`);
  }
  if (escalate.length) {
    console.log(`\nMONEY_EXISTS_ESCALATE (NOT written by --apply - payment-service has money or the operation for these; the sweep WOULD still park them as ENDED_UNSETTLED:CONTRACT_MISSING, keeping the row):`);
    for (const c of escalate.slice(0, sampleMax)) console.log(`  ${short(c.id)} ${c.kind} contract=${short(c.contract_id)}`);
  }

  // ── section F (informational): SETTLED rows that payment-service has no operation for ─────
  let sectionF: unknown = null;
  if (paymentUrl) {
    const settled: any[] = await readOnly(userUrl, (q) =>
      q(`SELECT s.idempotency_key AS k, (c.id IS NOT NULL) AS contract_exists FROM session_settlements s LEFT JOIN contracts c ON c.id=s.contract_id
          WHERE s.status='SETTLED' AND s.kind::text IN ('SESSION_RELEASE','PT_NO_SHOW_COMPENSATION','PT_LATE_ARRIVAL_COMPENSATION','UNRESOLVED_SESSION_RESOLUTION')`),
    );
    const ops = await readOnly(paymentUrl, (q) => q(`SELECT key FROM ledger_operations WHERE key = ANY($1::text[])`, settled.map((s) => s.k)));
    const have = new Set(ops.map((o: any) => o.key));
    const without = settled.filter((s) => !have.has(s.k));
    sectionF = {
      settledRows: settled.length,
      withoutLedgerOperation: without.length,
      ofWhichContractMissing: without.filter((s) => !s.contract_exists).length,
      ofWhichContractAlive: without.filter((s) => s.contract_exists).length,
    };
    console.log(`\nSECTION F (informational, never modified): ${JSON.stringify(sectionF)}`);
    console.log("  ofWhichContractAlive > 0 on a staging/production copy = high-priority reconciliation (D62-F); on dev the rows belong to deleted test contracts.");
  }

  console.log(`\nPROPOSED MARKING (identical to what the sweep writes): ${orphans.length} orphan row(s) -> "ENDED_UNSETTLED:<CONTRACT_MISSING|NO_PAYMENT> <reason>; previous error: ...", ${reconcile.length} unpriceable row(s) -> "NEEDS_RECONCILIATION: UNPAYABLE_TERMS ...".`);
  console.log(`  effect: the rows keep their status FAILED and their history, are taken out of the retry queue, are never SETTLED, no payment-service call is made, nothing is deleted.`);
  console.log(`  note: post-deploy-state-check U-07b counts ENDED_UNSETTLED rows as WARN; NEEDS_RECONCILIATION rows are listed by findNeedingAttention (largest amount first).`);

  const result = { generatedAt: now, database: db, mode: apply ? "apply" : "dry-run", counts: { candidates: rows.length, sweepWouldPark, orphans: orphans.length, needsReconciliation: reconcile.length, escalate: escalate.length, leftToSweep: live.length }, sectionF, preImage: marked.map((c) => ({ id: c.id, status: c.status, attempts: c.attempts, lastError: c.last_error, reason: c.reason, proposal: c.proposal })) };

  if (!apply) {
    console.log("\nDRY RUN ONLY - nothing was written. (--apply works only on a *_test database.)");
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
    return 0;
  }

  // ── --apply (test database only) ──────────────────────────────────────────────────────────
  if (expectRows != null && expectRows !== marked.length) {
    console.error(`--expect-rows ${expectRows} but ${marked.length} row(s) qualify: refusing to write.`);
    return 1;
  }
  const client = new PrismaClient({ datasourceUrl: userUrl, log: [] });
  try {
    const changed = await client.$transaction(async (tx: Tx) => {
      let n = 0;
      for (const c of marked) {
        n += await tx.$executeRawUnsafe(
          `UPDATE session_settlements
              SET status = 'FAILED'::"SessionSettlementStatus", last_error = $2, updated_at = now()
            WHERE id = $1
              AND ( status IN ('PENDING','FAILED') OR ( status = 'PROCESSING' AND updated_at < now() - ($3 || ' minutes')::interval ) )
              AND coalesce(last_error,'') NOT LIKE 'ENDED_UNSETTLED:%' AND coalesce(last_error,'') NOT LIKE 'NEEDS_RECONCILIATION:%'
              AND coalesce(last_error,'') NOT LIKE 'CONFLICT:%'`,
          c.id,
          c.newLastError,
          String(staleMinutes),
        );
      }
      return n;
    });
    console.log(`\nAPPLIED on test database "${db}": ${changed} row(s) marked (re-run: expect 0). Pre-image ${jsonOut ? "written to " + jsonOut : "not saved (pass --json)"}.`);
  } finally {
    await client.$disconnect().catch(() => {});
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
  return 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error("orphan-settlement-rows failed:", (e as Error).message);
      process.exit(2);
    },
  );
}
