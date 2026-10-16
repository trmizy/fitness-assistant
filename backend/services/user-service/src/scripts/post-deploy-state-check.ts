/**
 * POST-DEPLOY STATE CHECK (D57 item 6) - READ ONLY. Run by an operator right after a deploy, and again after the first
 * sweep cycles (about 15 minutes later). It does not fix anything and it never writes: every connection runs inside a
 * `SET TRANSACTION READ ONLY` transaction, so the database itself refuses a write made through it.
 *
 * What it answers:
 *   1. Did the migrations really apply (none failed / half-applied / missing), and do the new objects exist and validate?
 *   2. Do the invariants the F1-F4 / restriction work promised hold in the data?
 *        - escrow == sum of every other wallet's claims, no negative wallet bucket, wallet == its ledger
 *        - no open session on a contract that ended AFTER the deploy (the known legacy leftovers are reported, not failed)
 *        - no PT_NO_SHOW_REPORTED on an ended contract (Decision A turns them into DISPUTED at the ending)
 *        - no settlement row stuck (PROCESSING past the stale limit, FAILED for long, ENDED_UNSETTLED, poison rows that starve the
 *          sweep's batch of 50)
 *        - a restriction record per locked PT, at most one active per PT / per contract
 *        - the user-service <-> payment-service cross check: an ENDED contract has its CONTRACT_TERMINATE operation, an ACTIVE
 *          contract does not (money refunded but the contract still ACTIVE = a crash window), paid contracts are not orphaned
 *        - disputed sessions: count and age (the 14-day SLA)
 *   3. (optional) auth-service: migration status and the lock-command relay (no row stuck).
 *
 * USAGE (run from backend/services/user-service; pnpm is not needed):
 *   USER_DATABASE_URL=postgresql://... PAYMENT_DATABASE_URL=postgresql://... [AUTH_DATABASE_URL=postgresql://...] \
 *     ./node_modules/.bin/tsx src/scripts/post-deploy-state-check.ts \
 *       [--deployed-at 2026-10-16T02:00:00Z]   ended-contract findings NEWER than this are FAIL; older ones are legacy => WARN
 *       [--legacy-open-sessions 157]           tolerated count of open sessions on ended contracts that predate the deploy
 *       [--known-negative-subledgers 7]        tolerated count of negative (wallet, PENDING, transaction) sub-ledgers (legacy)
 *       [--stale-minutes 30]                   a PROCESSING / FAILED settlement older than this is "stuck"
 *       [--json out.json]
 * Exit code: 0 = no FAIL, 1 = at least one FAIL, 2 = could not run.
 * Credentials: pass them through the environment only; the script never prints a connection string.
 *
 * Evidence label of the numbers it prints: whatever database you point it at. Tested only against isolated *_test databases
 * (see _warroom/evidence/AUDIT_D57_5_6_obligations_and_predeploy.md).
 */
import fs from "node:fs";
import { PrismaClient } from "../generated/prisma";

type Level = "PASS" | "WARN" | "FAIL" | "INFO" | "SKIP";
export interface Finding {
  id: string;
  level: Level;
  title: string;
  detail?: string;
}

export interface Options {
  deployedAt: Date | null;
  legacyOpenSessions: number;
  knownNegativeSubledgers: number;
  staleMinutes: number;
  json: string | null;
}

/** The migrations that must be applied and finished. A failed one has finished_at NULL; a rolled-back one has rolled_back_at. */
export const EXPECTED_USER_MIGRATIONS = [
  "20261010120000_contract_payment_due_at",
  "20261010130000_contract_pt_holdback",
  "20261010140000_pt_lock_command_seq",
  "20261010160000_pt_restrictions",
  "20261010170000_client_exit_termination_reason",
  "20261010180000_pt_suspension_notification_types",
  "20261011100000_unresolved_session_settlement_kind",
  "20261011120000_client_exit_acceptance",
  "20261012100000_pt_restriction_contract_scope",
];
export const EXPECTED_AUTH_MIGRATIONS = ["20261010150000_pt_deactivation_call_ordering"];

const ENDED = `('COMPLETED','EXPIRED','CANCELLED','REJECTED')`;
const OPEN_SESSION = `('REQUESTED','CONFIRMED','PENDING_CLIENT_CONFIRMATION','DISPUTED','PT_NO_SHOW_REPORTED')`;

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
const n = (v: unknown) => Number(v ?? 0);
const sample = (rows: any[], key = "id", max = 5) => rows.slice(0, max).map((r) => String(r[key]).slice(0, 8)).join(", ");
const dong = (v: unknown) => `${Math.round(n(v)).toLocaleString("en-US")}`;

// ─────────────────────────────────────────────────────────── migrations (any DB) ───
async function migrationChecks(prefix: string, url: string, expected: string[]): Promise<Finding[]> {
  return readOnly(url, async (q) => {
    const out: Finding[] = [];
    const rows = await q(`SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations`);
    const byName = new Map(rows.map((r: any) => [r.migration_name, r]));
    const missing = expected.filter((m) => !byName.has(m));
    const unfinished = rows.filter((r: any) => !r.finished && !r.rolled_back).map((r: any) => r.migration_name);
    const rolledBack = rows.filter((r: any) => r.rolled_back).map((r: any) => r.migration_name);
    out.push(
      missing.length === 0 && unfinished.length === 0
        ? { id: `${prefix}-01`, level: "PASS", title: `migrations: all ${expected.length} expected are applied; none failed/unfinished (${rows.length} in history)` }
        : { id: `${prefix}-01`, level: "FAIL", title: "migrations missing or failed", detail: `missing=[${missing.join(", ")}] unfinished=[${unfinished.join(", ")}] (a failed migration blocks every later start with P3009 until 'prisma migrate resolve')` },
    );
    if (rolledBack.length) out.push({ id: `${prefix}-01b`, level: "WARN", title: `migrations marked rolled back: ${rolledBack.join(", ")}` });
    const bad = await q(`SELECT (SELECT count(*)::int FROM pg_constraint WHERE NOT convalidated) AS c, (SELECT count(*)::int FROM pg_index WHERE NOT indisvalid) AS i`);
    out.push(
      n(bad[0].c) === 0 && n(bad[0].i) === 0
        ? { id: `${prefix}-02`, level: "PASS", title: "no unvalidated constraint and no invalid index" }
        : { id: `${prefix}-02`, level: "FAIL", title: `unvalidated constraints=${bad[0].c}, invalid indexes=${bad[0].i}` },
    );
    return out;
  });
}

// ─────────────────────────────────────────────────────────── user-service ───
async function userChecks(url: string, o: Options): Promise<Finding[]> {
  return readOnly(url, async (q) => {
    const out: Finding[] = [];
    const deployed = o.deployedAt ? o.deployedAt.toISOString() : null;

    // U-03 objects the new code needs
    const objs = await q(`
      SELECT
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='pt_restrictions') AS t1,
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='pt_restriction_contract_extensions') AS t2,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='client_exit_accepted_at') AS c1,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='payment_due_at') AS c2,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='pt_holdback_rate') AS c3,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='pt_lock_seq') AS c4,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='pt_restrictions' AND column_name='scope') AS c5,
        EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='SessionSettlementKind' AND enumlabel='UNRESOLVED_SESSION_RESOLUTION') AS e1,
        EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='TerminationReason' AND enumlabel='CLIENT_EXIT_DUE_TO_PT_RESTRICTION') AS e2,
        EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='pt_restrictions_one_active_account_per_pt') AS i1,
        EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='pt_restrictions_one_active_per_contract') AS i2`);
    const missingObjs = Object.entries(objs[0]).filter(([, v]) => v !== true).map(([k]) => k);
    out.push(
      missingObjs.length === 0
        ? { id: "U-03", level: "PASS", title: "new tables / columns / enum labels / partial unique indexes exist" }
        : { id: "U-03", level: "FAIL", title: "schema objects missing", detail: missingObjs.join(", ") },
    );

    if (missingObjs.length > 0) {
      out.push({ id: "U-00", level: "SKIP", title: "the data checks that read the new tables/columns were NOT run because the schema is incomplete (fix U-01/U-03 first)" });
      return out;
    }

    // U-04 restriction invariants
    const r1 = await q(`SELECT pt_user_id AS id, count(*)::int AS c FROM pt_restrictions WHERE ended_at IS NULL AND scope='ACCOUNT' GROUP BY 1 HAVING count(*)>1`);
    const r2 = await q(`SELECT contract_id AS id, count(*)::int AS c FROM pt_restrictions WHERE ended_at IS NULL AND scope='CONTRACT' GROUP BY 1 HAVING count(*)>1`);
    const r3 = await q(`SELECT p."userId" AS id FROM user_profiles p WHERE p.pt_suspended AND NOT EXISTS (SELECT 1 FROM pt_restrictions r WHERE r.pt_user_id=p."userId" AND r.ended_at IS NULL AND r.scope='ACCOUNT')`);
    const r4 = await q(`SELECT r.pt_user_id AS id FROM pt_restrictions r JOIN user_profiles p ON p."userId"=r.pt_user_id WHERE r.ended_at IS NULL AND r.scope='ACCOUNT' AND NOT p.pt_suspended`);
    const r5 = await q(`SELECT r.id FROM pt_restrictions r JOIN contracts c ON c.id=r.contract_id WHERE r.ended_at IS NULL AND r.scope='CONTRACT' AND c.status IN ${ENDED}`);
    out.push(
      r1.length + r2.length === 0
        ? { id: "U-04a", level: "PASS", title: "at most one active account restriction per PT and one active contract restriction per contract" }
        : { id: "U-04a", level: "FAIL", title: "duplicate active restriction", detail: `accounts=[${sample(r1)}] contracts=[${sample(r2)}]` },
    );
    out.push(
      r3.length + r4.length === 0
        ? { id: "U-04b", level: "PASS", title: "pt_suspended mirror agrees with the active account restriction for every PT" }
        : { id: "U-04b", level: "FAIL", title: "pt_suspended flag and restriction record disagree", detail: `flag-without-record=${r3.length} [${sample(r3)}] record-without-flag=${r4.length} [${sample(r4)}]` },
    );
    out.push(r5.length === 0 ? { id: "U-04c", level: "PASS", title: "no active contract-scope restriction on an ended contract" } : { id: "U-04c", level: "WARN", title: `${r5.length} active contract-scope restriction(s) on an ended contract`, detail: sample(r5) });

    // U-05 open sessions on ended contracts
    const open = await q(`
      SELECT s.id, s.status::text AS status, c.status::text AS cstatus,
             (coalesce(c.terminated_at, c.updated_at) > $1::timestamp) AS after_deploy
        FROM sessions s JOIN contracts c ON c.id=s.contract_id
       WHERE c.status IN ${ENDED} AND s.status IN ${OPEN_SESSION}`, deployed ?? "1970-01-01");
    const openNew = open.filter((r: any) => deployed && r.after_deploy);
    const openLegacy = open.length - openNew.length;
    out.push(
      openNew.length === 0
        ? { id: "U-05", level: open.length === 0 ? "PASS" : openLegacy > o.legacyOpenSessions ? "FAIL" : "WARN", title: `open sessions on ended contracts: ${open.length} (${deployed ? `0 after ${deployed}` : "no --deployed-at given, all counted as legacy"}; tolerated legacy ${o.legacyOpenSessions})`, detail: open.length ? `by status: ${JSON.stringify(countBy(open, "status"))}` : undefined }
        : { id: "U-05", level: "FAIL", title: `${openNew.length} open session(s) on contracts that ended AFTER the deploy (F1 should call them off)`, detail: `by status: ${JSON.stringify(countBy(openNew, "status"))} e.g. ${sample(openNew)}` },
    );

    // U-06 PT_NO_SHOW_REPORTED on ended contracts (Decision A)
    const nsr = open.filter((r: any) => r.status === "PT_NO_SHOW_REPORTED");
    const nsrNew = nsr.filter((r: any) => deployed && r.after_deploy);
    out.push(
      nsr.length === 0
        ? { id: "U-06", level: "PASS", title: "no PT_NO_SHOW_REPORTED on an ended contract" }
        : { id: "U-06", level: nsrNew.length ? "FAIL" : "WARN", title: `${nsr.length} PT_NO_SHOW_REPORTED session(s) on ended contracts (${nsrNew.length} after the deploy; Decision A turns them into DISPUTED at the ending)`, detail: sample(nsr) },
    );

    // U-07 settlement rows
    const st = await q(`SELECT kind::text AS kind, status::text AS status, count(*)::int AS c, min(updated_at) AS oldest FROM session_settlements WHERE status <> 'SETTLED' GROUP BY 1,2 ORDER BY 1,2`);
    // rows whose contract no longer exists are "orphans": reported by U-07c (they can never be settled), not counted as stuck here
    const stuck = await q(`SELECT s.id FROM session_settlements s JOIN contracts c ON c.id=s.contract_id
                            WHERE (s.status='PROCESSING' AND s.updated_at < now() - ($1 || ' minutes')::interval)
                               OR (s.status='FAILED' AND s.updated_at < now() - ($1 || ' minutes')::interval AND coalesce(s.last_error,'') NOT LIKE 'ENDED_UNSETTLED:%')`, String(o.staleMinutes));
    const endedUnsettled = await q(`SELECT id FROM session_settlements WHERE last_error LIKE 'ENDED_UNSETTLED:%'`);
    out.push(
      stuck.length === 0
        ? { id: "U-07a", level: "PASS", title: `no settlement row stuck (PROCESSING/FAILED older than ${o.staleMinutes} min); non-settled now: ${JSON.stringify(st.map((r: any) => `${r.kind}/${r.status}=${r.c}`))}` }
        : { id: "U-07a", level: "FAIL", title: `${stuck.length} settlement row(s) stuck longer than ${o.staleMinutes} min`, detail: `e.g. ${sample(stuck)}; by kind/status: ${JSON.stringify(st.map((r: any) => `${r.kind}/${r.status}=${r.c}`))}` },
    );
    out.push(endedUnsettled.length === 0 ? { id: "U-07b", level: "PASS", title: "no ENDED_UNSETTLED compensation row (a compensation that could not be paid because its contract ended)" } : { id: "U-07b", level: "WARN", title: `${endedUnsettled.length} ENDED_UNSETTLED compensation row(s) need a human decision (owed money, not paid)`, detail: sample(endedUnsettled) });
    // poison rows: retryable rows whose contract no longer exists or is not payable => the sweep's oldest-first batch of 50 keeps re-selecting them
    const poison = await q(`
      SELECT s.id FROM session_settlements s LEFT JOIN contracts c ON c.id=s.contract_id
       WHERE s.status IN ('PENDING','FAILED') AND coalesce(s.last_error,'') NOT LIKE 'ENDED_UNSETTLED:%'
         AND (c.id IS NULL OR c.payment_transaction_id IS NULL OR c.price IS NULL OR c.total_sessions IS NULL OR c.total_sessions <= 0)`);
    out.push(
      poison.length === 0
        ? { id: "U-07c", level: "PASS", title: "no retryable settlement row without a payable contract (no poison row for the sweep's batch of 50)" }
        : { id: "U-07c", level: poison.length >= 50 ? "FAIL" : "WARN", title: `${poison.length} retryable settlement row(s) whose contract is missing/unpayable: the sweep re-selects them every tick and never changes them (batch size 50, oldest first${poison.length >= 50 ? " => rows behind them are NEVER retried" : ""})`, detail: sample(poison) },
    );

    // U-08 disputed / reported sessions + SLA
    const disp = await q(`SELECT s.status::text AS status, count(*)::int AS c, min(coalesce(s.disputed_at, s.updated_at)) AS oldest,
                                  count(*) FILTER (WHERE coalesce(s.disputed_at, s.updated_at) < now() - interval '14 days')::int AS over14
                             FROM sessions s WHERE s.status IN ('DISPUTED','PT_NO_SHOW_REPORTED') GROUP BY 1`);
    const over14 = disp.reduce((a: number, r: any) => a + n(r.over14), 0);
    out.push({ id: "U-08", level: over14 > 0 ? "WARN" : "INFO", title: `unadjudicated sessions: ${JSON.stringify(disp.map((r: any) => ({ status: r.status, count: r.c, oldest: r.oldest && new Date(r.oldest).toISOString().slice(0, 10), over14d: r.over14 })))}${over14 ? " - 14-day SLA exceeded" : ""}` });

    // U-09 timers that look dead
    const t1 = await q(`SELECT id FROM contracts WHERE status='ACTIVE' AND end_date < now() - interval '1 day'`);
    const t2 = await q(`SELECT id FROM contracts WHERE status='PENDING_PAYMENT' AND payment_due_at IS NOT NULL AND payment_due_at < now() - interval '1 hour'`);
    const t3 = await q(`SELECT id FROM sessions WHERE status='PENDING_CLIENT_CONFIRMATION' AND client_confirm_deadline < now() - interval '1 day'`);
    const t4 = await q(`SELECT id FROM contracts WHERE client_exit_accepted_at IS NOT NULL AND status='ACTIVE' AND client_exit_accepted_at < now() - interval '24 hours'`);
    out.push(t1.length ? { id: "U-09a", level: "WARN", title: `${t1.length} ACTIVE contract(s) past their end date by more than a day (expiry sweep not running or failing)`, detail: sample(t1) } : { id: "U-09a", level: "PASS", title: "no ACTIVE contract overdue by more than a day" });
    out.push(t2.length ? { id: "U-09b", level: "WARN", title: `${t2.length} PENDING_PAYMENT contract(s) past the payment deadline by more than an hour (deadline sweep)`, detail: sample(t2) } : { id: "U-09b", level: "PASS", title: "no payment deadline overdue by more than an hour" });
    out.push(t3.length ? { id: "U-09c", level: "WARN", title: `${t3.length} session(s) awaiting client confirmation past the auto-confirm deadline by more than a day`, detail: sample(t3) } : { id: "U-09c", level: "PASS", title: "no auto-confirm overdue" });
    out.push(t4.length ? { id: "U-09d", level: "FAIL", title: `${t4.length} accepted client exit(s) not finished after 24 h (acceptance expired but the contract is still ACTIVE)`, detail: sample(t4) } : { id: "U-09d", level: "PASS", title: "no accepted client exit left unfinished" });
    return out;
  });
}

function countBy(rows: any[], key: string) {
  const m: Record<string, number> = {};
  for (const r of rows) m[r[key]] = (m[r[key]] ?? 0) + 1;
  return m;
}

// ─────────────────────────────────────────────────────────── payment-service ledger ───
interface PayTxn {
  id: string;
  contract_id: string | null;
  status: string;
  amount: string;
  terminated: boolean;
  pt_pending: string;
  rev_pending: string;
  gym_pending: string;
}
async function paymentChecks(url: string, o: Options): Promise<{ findings: Finding[]; txns: PayTxn[]; opKeys: Set<string> }> {
  return readOnly(url, async (q) => {
    const out: Finding[] = [];
    const inv = await q(`
      SELECT (SELECT coalesce(sum(available_balance),0)::text FROM wallets WHERE owner_type='PLATFORM' AND owner_id='ESCROW') AS escrow,
             (SELECT coalesce(sum(available_balance+pending_balance+locked_balance),0)::text FROM wallets WHERE NOT (owner_type='PLATFORM' AND owner_id='ESCROW')) AS claims`);
    const drift = Math.round((n(inv[0].escrow) - n(inv[0].claims)) * 100) / 100;
    out.push(drift === 0 ? { id: "P-01", level: "PASS", title: `escrow == sum of claims (${dong(inv[0].escrow)} d)` } : { id: "P-01", level: "FAIL", title: `ESCROW DRIFT ${dong(drift)} d (escrow ${dong(inv[0].escrow)} vs claims ${dong(inv[0].claims)})` });

    const neg = await q(`SELECT owner_type::text AS t, left(owner_id,8) AS id, available_balance::text AS a, pending_balance::text AS p, locked_balance::text AS l FROM wallets WHERE available_balance<0 OR pending_balance<0 OR locked_balance<0`);
    out.push(neg.length === 0 ? { id: "P-02", level: "PASS", title: "no negative wallet bucket" } : { id: "P-02", level: "FAIL", title: `${neg.length} wallet(s) with a negative bucket`, detail: neg.slice(0, 5).map((r: any) => `${r.t}:${r.id} a=${r.a} p=${r.p} l=${r.l}`).join("; ") });

    const mism = await q(`
      WITH l AS (SELECT wallet_id, bucket::text AS bucket, sum(CASE WHEN entry_type='CREDIT' THEN amount ELSE -amount END) AS net FROM wallet_ledger_entries GROUP BY 1,2)
      SELECT w.owner_type::text AS t, left(w.owner_id,8) AS id, b.bucket, coalesce(l.net,0)::text AS ledger,
             (CASE b.bucket WHEN 'AVAILABLE' THEN w.available_balance WHEN 'PENDING' THEN w.pending_balance ELSE w.locked_balance END)::text AS wallet
        FROM wallets w CROSS JOIN (VALUES ('AVAILABLE'),('PENDING'),('LOCKED')) b(bucket)
        LEFT JOIN l ON l.wallet_id=w.id AND l.bucket=b.bucket
       WHERE coalesce(l.net,0) <> (CASE b.bucket WHEN 'AVAILABLE' THEN w.available_balance WHEN 'PENDING' THEN w.pending_balance ELSE w.locked_balance END)`);
    const mismEscrow = mism.filter((r: any) => r.t === "PLATFORM" && r.id === "ESCROW");
    const mismOther = mism.filter((r: any) => !(r.t === "PLATFORM" && r.id === "ESCROW"));
    out.push(mismOther.length === 0 ? { id: "P-03a", level: "PASS", title: "every non-escrow wallet bucket equals the sum of its ledger entries" } : { id: "P-03a", level: "FAIL", title: `${mismOther.length} wallet bucket(s) differ from their ledger`, detail: mismOther.slice(0, 5).map((r: any) => `${r.t}:${r.id}/${r.bucket} ledger=${r.ledger} wallet=${r.wallet}`).join("; ") });
    out.push(mismEscrow.length === 0 ? { id: "P-03b", level: "PASS", title: "escrow wallet equals its ledger" } : { id: "P-03b", level: "INFO", title: `escrow wallet differs from its own ledger entries by ${dong(n(mismEscrow[0].wallet) - n(mismEscrow[0].ledger))} d (ledger ${dong(mismEscrow[0].ledger)} vs wallet ${dong(mismEscrow[0].wallet)}): the escrow side is not fully ledgered (expected only in seeded/dev data)` });

    const sub = await q(`
      SELECT w.owner_type::text AS t, left(w.owner_id,8) AS owner, left(e.transaction_id,8) AS txn, sum(CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END)::text AS net
        FROM wallet_ledger_entries e JOIN wallets w ON w.id=e.wallet_id
       WHERE e.bucket='PENDING' AND NOT (w.owner_type='PLATFORM' AND w.owner_id='ESCROW')
       GROUP BY w.owner_type, w.owner_id, e.transaction_id HAVING sum(CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) < 0`);
    const unbacked = sub.reduce((a: number, r: any) => a + Math.abs(n(r.net)), 0);
    out.push(
      sub.length === 0
        ? { id: "P-04", level: "PASS", title: "no negative PENDING sub-ledger (no contract's escrow share was spent beyond what it was credited)" }
        : { id: "P-04", level: sub.length > o.knownNegativeSubledgers ? "FAIL" : "WARN", title: `${sub.length} negative PENDING sub-ledger(s) (tolerated legacy ${o.knownNegativeSubledgers}); unbacked pending claims of other contracts = ${dong(unbacked)} d`, detail: sub.slice(0, 7).map((r: any) => `${r.t}:${r.owner}/txn ${r.txn}=${r.net}`).join("; ") },
    );

    const rec = await q(`SELECT partner_type::text AS t, count(*)::int AS c, coalesce(sum(amount-recovered),0)::text AS outstanding FROM partner_receivables WHERE settled_at IS NULL GROUP BY 1`);
    out.push(rec.length === 0 ? { id: "P-05", level: "PASS", title: "no outstanding partner receivable (nobody owes the platform; N7: no PT debt)" } : { id: "P-05", level: "WARN", title: `outstanding partner receivables: ${JSON.stringify(rec.map((r: any) => ({ type: r.t, rows: r.c, dong: dong(r.outstanding) })))} (N7: no PT debt - needs the owner's decision)` });

    const act = await q(`SELECT id FROM payment_transactions WHERE status='PAID' AND purpose='PT_CONTRACT' AND activation_status IN ('PENDING','ACTIVATION_FAILED') AND paid_at < now() - ($1 || ' minutes')::interval`, String(o.staleMinutes));
    out.push(act.length === 0 ? { id: "P-06", level: "PASS", title: "no PAID PT-contract payment left un-activated" } : { id: "P-06", level: "FAIL", title: `${act.length} PAID PT-contract payment(s) not activated for more than ${o.staleMinutes} min (client paid, contract not ACTIVE; the reconciliation job should refund or activate)`, detail: sample(act) });

    const dupOps = await q(`SELECT key FROM ledger_operations GROUP BY key HAVING count(*)>1`);
    out.push(dupOps.length === 0 ? { id: "P-07", level: "PASS", title: "every idempotency key appears once" } : { id: "P-07", level: "FAIL", title: `${dupOps.length} duplicate idempotency key(s)` });

    const txns = (await q(`
      SELECT t.id, t.pt_contract_id AS contract_id, t.status::text AS status, t.amount::text AS amount,
             EXISTS(SELECT 1 FROM ledger_operations o WHERE o.key = 'CONTRACT_TERMINATE:' || t.pt_contract_id) AS terminated,
             coalesce((SELECT sum(CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) FROM wallet_ledger_entries e JOIN wallets w ON w.id=e.wallet_id WHERE e.transaction_id=t.id AND w.owner_type='PT' AND e.bucket='PENDING'),0)::text AS pt_pending,
             coalesce((SELECT sum(CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) FROM wallet_ledger_entries e JOIN wallets w ON w.id=e.wallet_id WHERE e.transaction_id=t.id AND w.owner_type='PLATFORM' AND w.owner_id='REVENUE' AND e.bucket='PENDING'),0)::text AS rev_pending,
             coalesce((SELECT sum(CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) FROM wallet_ledger_entries e JOIN wallets w ON w.id=e.wallet_id WHERE e.transaction_id=t.id AND w.owner_type='GYM' AND e.bucket='PENDING'),0)::text AS gym_pending
        FROM payment_transactions t WHERE t.purpose='PT_CONTRACT' AND t.status='PAID' AND t.pt_contract_id IS NOT NULL`)) as PayTxn[];
    const opKeys = new Set<string>((await q(`SELECT key FROM ledger_operations WHERE key LIKE 'SESSION_RELEASE:%' OR key LIKE 'PT_NO_SHOW:%' OR key LIKE 'PT_LATE_ARRIVAL:%' OR key LIKE 'UNRESOLVED_SESSION:%'`)).map((r: any) => r.key));
    return { findings: out, txns, opKeys };
  });
}

// ─────────────────────────────────────────────────────────── cross check (user DB x payment DB) ───
async function crossChecks(userUrl: string, txns: PayTxn[], opKeys: Set<string>, o: Options): Promise<Finding[]> {
  const out: Finding[] = [];
  const ids = txns.map((t) => t.contract_id!).filter(Boolean);
  const rows = await readOnly(userUrl, async (q) =>
    q(`SELECT id, status::text AS status, payment_transaction_id AS txn, (coalesce(terminated_at, updated_at) > $2::timestamp) AS after_deploy FROM contracts WHERE id = ANY($1::text[])`, ids, o.deployedAt ? o.deployedAt.toISOString() : "1970-01-01"),
  );
  const byId = new Map<string, any>(rows.map((r: any) => [r.id, r]));
  const ended = new Set(["COMPLETED", "EXPIRED", "CANCELLED", "REJECTED"]);

  const windowed = txns.filter((t) => t.terminated && byId.get(t.contract_id!)?.status === "ACTIVE");
  out.push(windowed.length === 0 ? { id: "X-01", level: "PASS", title: "no ACTIVE contract whose escrow was already terminated in the ledger (no crash window left open)" } : { id: "X-01", level: "FAIL", title: `${windowed.length} contract(s) are ACTIVE in user-service but CONTRACT_TERMINATE already ran in the ledger (money refunded, contract not ended: a crash window; a client retry or the expiry sweep finishes it)`, detail: windowed.slice(0, 5).map((t) => t.contract_id!.slice(0, 8)).join(", ") });

  const noOp = txns.filter((t) => !t.terminated && byId.get(t.contract_id!) && ended.has(byId.get(t.contract_id!).status) && byId.get(t.contract_id!).txn === t.id);
  const noOpNew = noOp.filter((t) => o.deployedAt && byId.get(t.contract_id!).after_deploy);
  out.push(noOp.length === 0 ? { id: "X-02", level: "PASS", title: "every ended paid contract has its CONTRACT_TERMINATE operation in the ledger" } : { id: "X-02", level: noOpNew.length ? "FAIL" : "WARN", title: `${noOp.length} ended paid contract(s) without a CONTRACT_TERMINATE operation (${noOpNew.length} after the deploy): the settlement row should retry it`, detail: noOp.slice(0, 5).map((t) => t.contract_id!.slice(0, 8)).join(", ") });

  const stranded = txns.filter((t) => {
    const c = byId.get(t.contract_id!);
    const heldDong = n(t.pt_pending) + n(t.rev_pending) + n(t.gym_pending);
    if (heldDong <= 0) return false;
    return !c || c.txn !== t.id || ended.has(c.status);
  });
  const strandedDong = stranded.reduce((a, t) => a + n(t.pt_pending) + n(t.rev_pending) + n(t.gym_pending), 0);
  out.push(stranded.length === 0 ? { id: "X-03", level: "PASS", title: "no client money held in PENDING for a contract that is missing, unlinked or ended" } : { id: "X-03", level: "WARN", title: `${stranded.length} paid contract(s) still hold ${dong(strandedDong)} d in PENDING although the contract is missing / not linked to its payment / ended (client money stranded; needs a refund decision)`, detail: stranded.slice(0, 5).map((t) => `${t.contract_id!.slice(0, 8)}:${byId.get(t.contract_id!)?.status ?? "MISSING"}:${dong(n(t.pt_pending) + n(t.rev_pending) + n(t.gym_pending))}`).join("; ") });

  // X-04 / X-05: the user-service settlement row and the payment ledger operation of the SAME idempotency key must agree.
  const srows = await readOnly(userUrl, async (q) =>
    q(`SELECT s.idempotency_key AS key, s.status::text AS status, (c.id IS NOT NULL) AS contract_exists, (c.payment_transaction_id IS NOT NULL) AS paid
         FROM session_settlements s LEFT JOIN contracts c ON c.id = s.contract_id
        WHERE s.kind <> 'CONTRACT_TERMINATION'`),
  );
  const ghost = srows.filter((r: any) => r.status === "SETTLED" && !opKeys.has(r.key));
  const ghostLive = ghost.filter((r: any) => r.contract_exists && r.paid);
  out.push(
    ghost.length === 0
      ? { id: "X-04", level: "PASS", title: `every SETTLED session settlement row has its ledger operation (${srows.filter((r: any) => r.status === "SETTLED").length} checked)` }
      : { id: "X-04", level: ghostLive.length ? "FAIL" : "WARN", title: `${ghost.length} settlement row(s) say SETTLED but the ledger has no operation for their key (${ghostLive.length} on a live paid contract; ${ghost.length - ghostLive.length} on a missing/unpaid contract = the payment database was reset or the row predates the ledger)`, detail: ghost.slice(0, 3).map((r: any) => String(r.key).slice(0, 30)).join("; ") },
  );
  const rowKeys = new Map<string, string>(srows.map((r: any) => [r.key, r.status]));
  const moved = [...opKeys].filter((k) => rowKeys.has(k) && rowKeys.get(k) !== "SETTLED");
  const movedNoRow = [...opKeys].filter((k) => !rowKeys.has(k));
  out.push(
    moved.length === 0
      ? { id: "X-05", level: "PASS", title: "no ledger operation whose user-service row is still PENDING/PROCESSING/FAILED" }
      : { id: "X-05", level: "WARN", title: `${moved.length} ledger operation(s) already moved money while their user-service settlement row is not SETTLED (the sweep's replay will mark them; a retry is idempotent)`, detail: moved.slice(0, 3).join("; ") },
  );
  if (movedNoRow.length) out.push({ id: "X-05b", level: "INFO", title: `${movedNoRow.length} ledger operation(s) have no settlement row in user-service (rows deleted with their contract, or an operation made outside settleTracked)` });
  return out;
}

// ─────────────────────────────────────────────────────────── auth-service (optional) ───
async function authChecks(url: string, o: Options): Promise<Finding[]> {
  const out = await migrationChecks("A", url, EXPECTED_AUTH_MIGRATIONS);
  const more = await readOnly(url, async (q) => {
    const f: Finding[] = [];
    const dup = await q(`SELECT seq FROM pt_deactivation_calls GROUP BY seq HAVING count(*)>1`);
    f.push(dup.length === 0 ? { id: "A-03", level: "PASS", title: "lock-command numbers (seq) are unique" } : { id: "A-03", level: "FAIL", title: `${dup.length} duplicated seq` });
    const stuck = await q(`SELECT id FROM pt_deactivation_calls WHERE status IN ('PENDING','FAILED') AND updated_at < now() - ($1 || ' minutes')::interval`, String(o.staleMinutes));
    f.push(stuck.length === 0 ? { id: "A-04", level: "PASS", title: "no PT lock/unlock command stuck PENDING/FAILED (relay sweep is draining)" } : { id: "A-04", level: "FAIL", title: `${stuck.length} PT lock/unlock command(s) not delivered after ${o.staleMinutes} min (a PT may be locked in auth but their contracts still ACTIVE in user-service)`, detail: sample(stuck) });
    return f;
  });
  return [...out, ...more];
}

// ─────────────────────────────────────────────────────────── main ───
export function parseArgs(argv: string[]): Options {
  const get = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    deployedAt: get("--deployed-at") ? new Date(get("--deployed-at")!) : null,
    legacyOpenSessions: Number(get("--legacy-open-sessions") ?? 0),
    knownNegativeSubledgers: Number(get("--known-negative-subledgers") ?? 0),
    staleMinutes: Number(get("--stale-minutes") ?? 30),
    json: get("--json") ?? null,
  };
}

export async function runChecks(env: NodeJS.ProcessEnv, o: Options): Promise<Finding[]> {
  const userUrl = env.USER_DATABASE_URL;
  const payUrl = env.PAYMENT_DATABASE_URL;
  const authUrl = env.AUTH_DATABASE_URL;
  if (!userUrl) throw new Error("USER_DATABASE_URL is required");
  const all: Finding[] = [];
  all.push(...(await migrationChecks("U", userUrl, EXPECTED_USER_MIGRATIONS)));
  all.push(...(await userChecks(userUrl, o)));
  if (payUrl) {
    const { findings, txns, opKeys } = await paymentChecks(payUrl, o);
    all.push(...findings);
    all.push(...(await crossChecks(userUrl, txns, opKeys, o)));
  } else all.push({ id: "P-00", level: "SKIP", title: "PAYMENT_DATABASE_URL not given: ledger invariants and the cross check were NOT run" });
  if (authUrl) all.push(...(await authChecks(authUrl, o)));
  else all.push({ id: "A-00", level: "SKIP", title: "AUTH_DATABASE_URL not given: auth-service checks were NOT run" });
  return all;
}

async function main(argv: string[]) {
  const o = parseArgs(argv);
  const findings = await runChecks(process.env, o);
  for (const f of findings) console.log(`[${f.level.padEnd(4)}] ${f.id.padEnd(5)} ${f.title}${f.detail ? `\n         ${f.detail}` : ""}`);
  const count = (l: Level) => findings.filter((f) => f.level === l).length;
  console.log(`\nSUMMARY: ${count("PASS")} pass, ${count("WARN")} warn, ${count("FAIL")} fail, ${count("INFO")} info, ${count("SKIP")} skipped`);
  if (o.json) fs.writeFileSync(o.json, JSON.stringify({ generatedAt: new Date().toISOString(), options: o, findings }, null, 2));
  return count("FAIL") > 0 ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`post-deploy-state-check could not run: ${(e as Error).message}`);
      process.exit(2);
    },
  );
}
