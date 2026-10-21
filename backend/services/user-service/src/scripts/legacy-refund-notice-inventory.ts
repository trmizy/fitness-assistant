/**
 * LEGACY REFUND-NOTICE INVENTORY - READ ONLY, aggregates only.
 *
 * Question: between 25/05/2026 (dc884c31) and 20/10/2026 (50754688) customers were sent notices that promised "hoàn tiền" /
 * "bồi thường" and that the session was "không bị trừ" (the text is frozen in `notifications.text`). For those notices, what really
 * happened to the session, to the money, and to the obligation? A notice proves a PROMISE, not a payment, so this joins:
 *
 *   notifications (user DB)
 *     -> sessions   (LEFT JOIN: a deleted session is REPORTED, not dropped)
 *     -> contracts  (LEFT JOIN: a deleted contract is REPORTED, not dropped)
 *     -> session_settlements by KEY (PT_NO_SHOW:<id> / PT_LATE_ARRIVAL:<id>), never by `contracts.compensated_sessions`
 *        (that counter is per contract and says nothing about one session)
 *   ledger_operations (payment DB) by the same key  - BOTH result shapes:
 *        new rows  { paid, owed, unpaid, [obligationId, recordedOnly] }
 *        old rows  { compensation | refund, shortfall }   (shortfall = the part the platform FRONTED under the legacy ledger, not an
 *                                                          amount the client is owed: the client was credited `compensation` in full)
 *   contract_unpaid_obligations (payment DB) by key -> OPEN / UNDER_REVIEW / PAID_EXTERNALLY / WAIVED / RESOLVED
 *
 * Promise kinds (from the notice text, the owner's Q1 predicate `không bị trừ` AND (`hoàn tiền` OR `bồi thường`)):
 *   LATE          `bồi thường` + `muộn`/`trễ`  -> expects a PT_LATE_ARRIVAL settlement (key PT_LATE_ARRIVAL:<session>)
 *   REFUND        `hoàn tiền`                   -> expects a PT_NO_SHOW settlement      (key PT_NO_SHOW:<session>)
 *   COMPENSATION  any other `bồi thường`        -> expects either of the two
 * Notices on a CONTRACT (not a session) are counted and joined to the contract and its CONTRACT_TERMINATION settlement only.
 *
 * SAFETY (all enforced in code, see the test):
 *   - refuses to run unless `--confirm-read-only` is given; prints the two DATABASE NAMES (never the URLs) before any query;
 *   - every statement runs inside `SET TRANSACTION READ ONLY` (Postgres itself refuses a write);
 *   - prints ONLY aggregates: no user id, email, name, notification text, session / contract id or idempotency key is ever printed
 *     or written to --json; small counts are not suppressed because ids are never shown;
 *   - never calls any service, never writes, never sends a corrective notice.
 *
 * USAGE (from backend/services/user-service; two connection strings from the environment, never on the command line):
 *   USER_DATABASE_URL=postgresql://... PAYMENT_DATABASE_URL=postgresql://... \
 *     ./node_modules/.bin/tsx src/scripts/legacy-refund-notice-inventory.ts --confirm-read-only [--json out.json]
 * Exit code: 0 = ran, 2 = refused / could not run.
 *
 * Reading the result: `promiseDiffers` counts sessions whose notice promised money but where the settlement is missing / not settled,
 * the ledger has no operation, the client was paid less than owed and the obligation is still open or was waived, or the session
 * (or its contract) no longer exists so nothing can be verified. "PAID_IN_FULL" and "PAID_EXTERNALLY" are the outcomes that match the promise.
 */
import fs from "node:fs";
import { PrismaClient } from "../generated/prisma";

type Q = (sql: string, ...v: unknown[]) => Promise<any[]>;

export type PromiseKind = "LATE" | "REFUND" | "COMPENSATION";

export type Outcome =
  | "SUBJECT_MISSING" // the session (or its contract) no longer exists: cannot be verified from the user DB
  | "NO_SETTLEMENT_ROW" // session exists, no settlement row for the promised kind
  | "SETTLEMENT_NOT_SETTLED" // row exists but is PENDING / FAILED / CONFLICT / NEEDS_HUMAN / ...
  | "SETTLED_NO_LEDGER_OP" // user DB says SETTLED but the payment DB holds no operation for the key
  | "LEDGER_RESULT_UNREADABLE" // an operation exists but its result has neither shape
  | "PAID_IN_FULL" // the client was credited what was owed (new rows: unpaid = 0; old rows: compensation > 0)
  | "PAID_NOTHING_RECORDED_ONLY" // recorded as an obligation only, nothing credited
  | "PAID_SHORT_OPEN" // credited less than owed, the obligation is OPEN / UNDER_REVIEW
  | "PAID_SHORT_PAID_EXTERNALLY" // credited less than owed, the rest was paid outside the ledger with evidence
  | "PAID_SHORT_WAIVED" // credited less than owed, the owner decided not to pursue the rest
  | "PAID_SHORT_LEGACY_RESOLVED" // credited less than owed, closed as legacy "handled elsewhere" without evidence
  | "PAID_SHORT_NO_OBLIGATION"; // credited less than owed but no obligation row exists

/** Outcomes where what the notice promised is NOT what happened (or cannot be shown to have happened). */
export const PROMISE_DIFFERS: ReadonlySet<Outcome> = new Set<Outcome>([
  "SUBJECT_MISSING",
  "NO_SETTLEMENT_ROW",
  "SETTLEMENT_NOT_SETTLED",
  "SETTLED_NO_LEDGER_OP",
  "LEDGER_RESULT_UNREADABLE",
  "PAID_NOTHING_RECORDED_ONLY",
  "PAID_SHORT_OPEN",
  "PAID_SHORT_WAIVED",
  "PAID_SHORT_LEGACY_RESOLVED",
  "PAID_SHORT_NO_OBLIGATION",
]);

export const OUTCOMES: Outcome[] = [
  "SUBJECT_MISSING",
  "NO_SETTLEMENT_ROW",
  "SETTLEMENT_NOT_SETTLED",
  "SETTLED_NO_LEDGER_OP",
  "LEDGER_RESULT_UNREADABLE",
  "PAID_IN_FULL",
  "PAID_NOTHING_RECORDED_ONLY",
  "PAID_SHORT_OPEN",
  "PAID_SHORT_PAID_EXTERNALLY",
  "PAID_SHORT_WAIVED",
  "PAID_SHORT_LEGACY_RESOLVED",
  "PAID_SHORT_NO_OBLIGATION",
];

const NO_SHOW_KEY = (id: string) => `PT_NO_SHOW:${id}`;
const LATE_KEY = (id: string) => `PT_LATE_ARRIVAL:${id}`;
const KEYS_FOR: Record<PromiseKind, (id: string) => string[]> = {
  LATE: (id) => [LATE_KEY(id)],
  REFUND: (id) => [NO_SHOW_KEY(id)],
  COMPENSATION: (id) => [NO_SHOW_KEY(id), LATE_KEY(id)],
};

// ───────────────────────────────────────────────────────────── ledger result shapes ──
export interface ParsedLedgerResult {
  version: "NEW" | "LEGACY" | "UNKNOWN";
  paid: number;
  owed: number | null;
  unpaid: number;
  /** Legacy `shortfall`: what the platform fronted, NOT an amount owed to the client. */
  legacyFronted: number;
  recordedOnly: boolean;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Reads BOTH result shapes: new `paid/owed/unpaid` and old `compensation|refund` + `shortfall`. */
export function parseLedgerResult(result: unknown): ParsedLedgerResult {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const paid = num(r.paid);
  const owed = num(r.owed);
  const unpaid = num(r.unpaid);
  if (paid !== null && owed !== null && unpaid !== null) {
    return { version: "NEW", paid, owed, unpaid, legacyFronted: 0, recordedOnly: r.recordedOnly === true };
  }
  const credited = num(r.compensation) ?? num(r.refund);
  if (credited !== null || num(r.shortfall) !== null) {
    return { version: "LEGACY", paid: credited ?? 0, owed: null, unpaid: 0, legacyFronted: num(r.shortfall) ?? 0, recordedOnly: false };
  }
  return { version: "UNKNOWN", paid: 0, owed: null, unpaid: 0, legacyFronted: 0, recordedOnly: false };
}

// ───────────────────────────────────────────────────────────── pure outcome rule ──
export interface SubjectFacts {
  sessionExists: boolean;
  contractExists: boolean;
  /** settlement rows found under the promised key(s): their statuses */
  settlementStatuses: string[];
  /** payment-service operation found under the promised key(s) */
  op: ParsedLedgerResult | null;
  /** status of the obligation stored under the same key, if any */
  obligationStatus: string | null;
}

/** One distinct session -> one outcome. Pure, so the rule is tested without a database. */
export function classifyOutcome(f: SubjectFacts): Outcome {
  if (!f.sessionExists || !f.contractExists) {
    // The session is gone, but a ledger operation under its key still proves what was paid; only call it unverifiable when there is nothing.
    if (!f.op) return "SUBJECT_MISSING";
  }
  if (f.settlementStatuses.length === 0 && !f.op) return "NO_SETTLEMENT_ROW";
  if (f.op) {
    if (f.op.version === "UNKNOWN") return "LEDGER_RESULT_UNREADABLE";
    if (f.op.recordedOnly || (f.op.version === "NEW" && f.op.paid <= 0 && f.op.unpaid > 0)) return "PAID_NOTHING_RECORDED_ONLY";
    if (f.op.unpaid > 0) {
      switch (f.obligationStatus) {
        case "OPEN":
        case "UNDER_REVIEW":
          return "PAID_SHORT_OPEN";
        case "PAID_EXTERNALLY":
          return "PAID_SHORT_PAID_EXTERNALLY";
        case "WAIVED":
          return "PAID_SHORT_WAIVED";
        case "RESOLVED":
          return "PAID_SHORT_LEGACY_RESOLVED";
        default:
          return "PAID_SHORT_NO_OBLIGATION";
      }
    }
    return f.op.paid > 0 ? "PAID_IN_FULL" : "PAID_NOTHING_RECORDED_ONLY";
  }
  // no operation in the payment DB
  if (f.settlementStatuses.includes("SETTLED")) return "SETTLED_NO_LEDGER_OP";
  return "SETTLEMENT_NOT_SETTLED";
}

// ───────────────────────────────────────────────────────────── the inventory ──
export interface Inventory {
  generatedAt: string;
  noticesSent: number;
  distinctRecipients: number;
  noticesByPromise: Record<PromiseKind, number>;
  noticesByEntity: { SESSION: number; CONTRACT: number; OTHER: number };
  sessions: {
    distinct: number;
    existing: number;
    missing: number;
    existingButContractMissing: number;
    deducted: number;
    notDeducted: number;
  };
  settlementRows: { none: number; notSettled: number; settled: number };
  ledger: { operationsFound: number; newShape: number; legacyShape: number; unreadable: number };
  money: {
    creditedToClients: string;
    unpaidStillOwedOpen: string;
    paidExternally: string;
    waivedUnpaid: string;
    legacyFrontedByPlatform: string;
  };
  outcomes: Record<Outcome, { sessions: number; notices: number }>;
  promiseDiffers: { sessions: number; notices: number };
  contractNotices: { distinct: number; contractsMissing: number; terminationSettlement: Record<string, number> };
}

const ZERO_OUTCOMES = () => Object.fromEntries(OUTCOMES.map((o) => [o, { sessions: 0, notices: 0 }])) as Inventory["outcomes"];
const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const chunk = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

const NOTICE_SQL = `
SELECT n.user_id AS uid, n.entity_type::text AS etype, n.entity_id AS eid,
       CASE WHEN n.text ILIKE '%bồi thường%' AND (n.text ILIKE '%muộn%' OR n.text ILIKE '%trễ%') THEN 'LATE'
            WHEN n.text ILIKE '%hoàn tiền%' THEN 'REFUND'
            ELSE 'COMPENSATION' END AS promise,
       s.id AS sid, s.session_deducted AS deducted,
       c.id AS cid
  FROM notifications n
  LEFT JOIN sessions s ON n.entity_type::text = 'SESSION' AND s.id = n.entity_id
  LEFT JOIN contracts c ON c.id = (CASE WHEN n.entity_type::text = 'SESSION' THEN s.contract_id
                                        WHEN n.entity_type::text = 'CONTRACT' THEN n.entity_id END)
 WHERE n.text ILIKE '%không bị trừ%' AND (n.text ILIKE '%hoàn tiền%' OR n.text ILIKE '%bồi thường%')`;

/** Runs the whole inventory. `userQ` / `paymentQ` must each run inside a READ ONLY transaction (see readOnly()). */
export async function buildInventory(userQ: Q, paymentQ: Q): Promise<Inventory> {
  // 1. notices -> sessions -> contracts (LEFT JOINs: missing rows are kept and counted)
  const notices = await userQ(NOTICE_SQL);
  const sessionNotices = notices.filter((n) => n.etype === "SESSION");
  const contractNotices = notices.filter((n) => n.etype === "CONTRACT");

  // per distinct session: promises, existence, deduction, notice count
  const subjects = new Map<string, { promises: Set<PromiseKind>; notices: number; sessionExists: boolean; contractExists: boolean; deducted: boolean }>();
  for (const n of sessionNotices) {
    const s = subjects.get(n.eid) ?? { promises: new Set<PromiseKind>(), notices: 0, sessionExists: false, contractExists: false, deducted: false };
    s.promises.add(n.promise as PromiseKind);
    s.notices += 1;
    s.sessionExists = n.sid !== null && n.sid !== undefined;
    s.contractExists = n.cid !== null && n.cid !== undefined;
    s.deducted = n.deducted === true;
    subjects.set(n.eid, s);
  }

  // 2. settlement rows by KEY (also finds the rows of sessions that were deleted afterwards)
  const keysBySubject = new Map<string, string[]>();
  const allKeys = new Set<string>();
  for (const [sid, s] of subjects) {
    const keys = [...new Set([...s.promises].flatMap((p) => KEYS_FOR[p](sid)))];
    keysBySubject.set(sid, keys);
    keys.forEach((k) => allKeys.add(k));
  }
  const settlementByKey = new Map<string, string>();
  for (const part of chunk([...allKeys], 5000)) {
    for (const r of await userQ(`SELECT idempotency_key AS k, status::text AS status FROM session_settlements WHERE idempotency_key = ANY($1::text[])`, part)) {
      settlementByKey.set(r.k, r.status);
    }
  }
  const termination: Record<string, number> = {};
  const contractIds = [...new Set(contractNotices.map((n) => n.eid))];
  const terminationByContract = new Map<string, string>();
  for (const part of chunk(contractIds, 5000)) {
    for (const r of await userQ(`SELECT contract_id AS c, status::text AS status FROM session_settlements WHERE kind::text = 'CONTRACT_TERMINATION' AND contract_id = ANY($1::text[])`, part)) {
      terminationByContract.set(r.c, r.status);
    }
  }

  // 3. payment DB: operations and obligations by the same key
  const opByKey = new Map<string, ParsedLedgerResult>();
  const obByKey = new Map<string, { status: string; unpaid: number; externally: number }>();
  const hasExternal = ((await paymentQ(`SELECT 1 FROM information_schema.columns WHERE table_name = 'contract_unpaid_obligations' AND column_name = 'externally_paid' LIMIT 1`)).length) > 0;
  for (const part of chunk([...allKeys], 5000)) {
    for (const r of await paymentQ(`SELECT key, result FROM ledger_operations WHERE key = ANY($1::text[])`, part)) opByKey.set(r.key, parseLedgerResult(r.result));
    for (const r of await paymentQ(
      `SELECT key, status::text AS status, unpaid::text AS unpaid, ${hasExternal ? "externally_paid::text" : "'0'"} AS externally FROM contract_unpaid_obligations WHERE key = ANY($1::text[])`,
      part,
    )) {
      obByKey.set(r.key, { status: r.status, unpaid: num(r.unpaid) ?? 0, externally: num(r.externally) ?? 0 });
    }
  }

  // 4. aggregate
  const outcomes = ZERO_OUTCOMES();
  const money = { credited: 0, unpaidOpen: 0, external: 0, waived: 0, fronted: 0 };
  const settlementRows = { none: 0, notSettled: 0, settled: 0 };
  const ledger = { operationsFound: 0, newShape: 0, legacyShape: 0, unreadable: 0 };
  let existing = 0;
  let missing = 0;
  let contractMissing = 0;
  let deducted = 0;
  let notDeducted = 0;
  for (const [sid, s] of subjects) {
    if (s.sessionExists) {
      existing += 1;
      if (!s.contractExists) contractMissing += 1;
      if (s.deducted) deducted += 1;
      else notDeducted += 1;
    } else missing += 1;

    const keys = keysBySubject.get(sid) ?? [];
    const settlementStatuses = keys.map((k) => settlementByKey.get(k)).filter((x): x is string => !!x);
    const opKey = keys.find((k) => opByKey.has(k)) ?? null;
    const op = opKey ? (opByKey.get(opKey) as ParsedLedgerResult) : null;
    const ob = opKey ? obByKey.get(opKey) ?? null : null;

    if (settlementStatuses.length === 0) settlementRows.none += 1;
    else if (settlementStatuses.includes("SETTLED")) settlementRows.settled += 1;
    else settlementRows.notSettled += 1;

    if (op) {
      ledger.operationsFound += 1;
      if (op.version === "NEW") ledger.newShape += 1;
      else if (op.version === "LEGACY") ledger.legacyShape += 1;
      else ledger.unreadable += 1;
      money.credited += op.paid;
      money.fronted += op.legacyFronted;
      if (ob) {
        if (ob.status === "OPEN" || ob.status === "UNDER_REVIEW") money.unpaidOpen += ob.unpaid;
        if (ob.status === "WAIVED") money.waived += ob.unpaid;
        money.external += ob.externally;
      }
    }

    const outcome = classifyOutcome({
      sessionExists: s.sessionExists,
      contractExists: s.contractExists,
      settlementStatuses,
      op,
      obligationStatus: ob?.status ?? null,
    });
    outcomes[outcome].sessions += 1;
    outcomes[outcome].notices += s.notices;
  }
  for (const c of contractIds) {
    const st = terminationByContract.get(c) ?? "NO_ROW";
    termination[st] = (termination[st] ?? 0) + 1;
  }
  const contractsMissing = contractNotices.filter((n) => n.cid === null || n.cid === undefined);

  const differs = OUTCOMES.filter((o) => PROMISE_DIFFERS.has(o)).reduce(
    (a, o) => ({ sessions: a.sessions + outcomes[o].sessions, notices: a.notices + outcomes[o].notices }),
    { sessions: 0, notices: 0 },
  );
  const byPromise: Record<PromiseKind, number> = { LATE: 0, REFUND: 0, COMPENSATION: 0 };
  for (const n of notices) byPromise[n.promise as PromiseKind] += 1;

  return {
    generatedAt: new Date().toISOString(),
    noticesSent: notices.length,
    distinctRecipients: new Set(notices.map((n) => n.uid)).size,
    noticesByPromise: byPromise,
    noticesByEntity: { SESSION: sessionNotices.length, CONTRACT: contractNotices.length, OTHER: notices.length - sessionNotices.length - contractNotices.length },
    sessions: { distinct: subjects.size, existing, missing, existingButContractMissing: contractMissing, deducted, notDeducted },
    settlementRows,
    ledger,
    money: {
      creditedToClients: fmt(money.credited),
      unpaidStillOwedOpen: fmt(money.unpaidOpen),
      paidExternally: fmt(money.external),
      waivedUnpaid: fmt(money.waived),
      legacyFrontedByPlatform: fmt(money.fronted),
    },
    outcomes,
    promiseDiffers: differs,
    contractNotices: { distinct: contractIds.length, contractsMissing: new Set(contractsMissing.map((n) => n.eid)).size, terminationSettlement: termination },
  };
}

// ───────────────────────────────────────────────────────────── plumbing ──
export function dbNameOf(url: string | undefined): string {
  try {
    return decodeURIComponent(new URL(url ?? "").pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

export function makeClient(url: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: url, log: [] });
}

/** Runs `fn` with a query function bound to ONE `READ ONLY` transaction: the database itself refuses any write. */
export async function readOnly<T>(client: PrismaClient, fn: (q: Q) => Promise<T>): Promise<T> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return fn((sql, ...v) => tx.$queryRawUnsafe<any[]>(sql, ...v));
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

export function formatInventory(inv: Inventory, names: { user: string; payment: string }): string[] {
  const L: string[] = [];
  L.push(`LEGACY REFUND-NOTICE INVENTORY - READ ONLY - ${inv.generatedAt}`);
  L.push(`user database "${names.user}", payment database "${names.payment}" (aggregates only; no ids, texts or names are printed)`);
  L.push("");
  L.push(`notices sent: ${inv.noticesSent} to ${inv.distinctRecipients} distinct recipients`);
  L.push(`  by promise: REFUND(hoàn tiền) ${inv.noticesByPromise.REFUND}, LATE(bồi thường, đến muộn) ${inv.noticesByPromise.LATE}, COMPENSATION(bồi thường khác) ${inv.noticesByPromise.COMPENSATION}`);
  L.push(`  by subject: session ${inv.noticesByEntity.SESSION}, contract ${inv.noticesByEntity.CONTRACT}, other ${inv.noticesByEntity.OTHER}`);
  L.push("");
  L.push(`sessions the notices point at: ${inv.sessions.distinct} distinct`);
  L.push(`  still existing ${inv.sessions.existing} (of which contract gone: ${inv.sessions.existingButContractMissing}), missing ${inv.sessions.missing}`);
  L.push(`  actually deducted (sessions.session_deducted): ${inv.sessions.deducted}; not deducted: ${inv.sessions.notDeducted}  [per session, never contracts.compensated_sessions]`);
  L.push(`settlement rows under the promised key: none ${inv.settlementRows.none}, not settled ${inv.settlementRows.notSettled}, settled ${inv.settlementRows.settled}`);
  L.push(`ledger operations found in the payment DB: ${inv.ledger.operationsFound} (new paid/owed/unpaid ${inv.ledger.newShape}, old compensation/shortfall ${inv.ledger.legacyShape}, unreadable ${inv.ledger.unreadable})`);
  L.push("");
  L.push("money (VND, from the ledger - a notice is a promise, not a payment):");
  L.push(`  credited to clients ${inv.money.creditedToClients}; still owed on OPEN/UNDER_REVIEW obligations ${inv.money.unpaidStillOwedOpen}`);
  L.push(`  paid outside the ledger with evidence ${inv.money.paidExternally}; waived (client NOT paid) ${inv.money.waivedUnpaid}; legacy fronted by the platform ${inv.money.legacyFrontedByPlatform}`);
  L.push("");
  L.push("outcome per session (sessions / notices):");
  for (const o of OUTCOMES) L.push(`  ${PROMISE_DIFFERS.has(o) ? "!" : " "} ${o.padEnd(28)} ${String(inv.outcomes[o].sessions).padStart(6)} / ${String(inv.outcomes[o].notices).padStart(6)}`);
  L.push(`  (! = the promise differs from, or cannot be shown to match, the outcome)`);
  L.push(`PROMISE DIFFERS FROM OUTCOME: ${inv.promiseDiffers.sessions} sessions / ${inv.promiseDiffers.notices} notices`);
  L.push("");
  L.push(`notices on a contract: ${inv.contractNotices.distinct} contracts (gone: ${inv.contractNotices.contractsMissing}); CONTRACT_TERMINATION settlement: ${JSON.stringify(inv.contractNotices.terminationSettlement)}`);
  L.push("");
  L.push("Nothing was written, no notice was sent, no money or session count was changed. The owner decides each group from these numbers.");
  return L;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, log: (line: string) => void): Promise<number> {
  const userUrl = env.USER_DATABASE_URL;
  const paymentUrl = env.PAYMENT_DATABASE_URL;
  if (!argv.includes("--confirm-read-only")) {
    log("REFUSED: pass --confirm-read-only to confirm you want a read-only inventory. Nothing was connected to.");
    log("usage: USER_DATABASE_URL=... PAYMENT_DATABASE_URL=... tsx src/scripts/legacy-refund-notice-inventory.ts --confirm-read-only [--json out.json]");
    return 2;
  }
  if (!userUrl || !paymentUrl) {
    log("REFUSED: USER_DATABASE_URL and PAYMENT_DATABASE_URL are both required (set them in the environment). Nothing was connected to.");
    return 2;
  }
  const names = { user: dbNameOf(userUrl), payment: dbNameOf(paymentUrl) };
  if (!names.user || !names.payment) {
    log("REFUSED: a connection string could not be parsed. Nothing was connected to.");
    return 2;
  }
  log(`connecting READ ONLY to user database "${names.user}" and payment database "${names.payment}"`);
  const jsonIdx = argv.indexOf("--json");
  const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : null;

  const user = makeClient(userUrl);
  const payment = makeClient(paymentUrl);
  try {
    // The notice/session/settlement reads and the payment reads each run in one READ ONLY transaction; the join happens in memory.
    const inv = await readOnly(user, (uq) => readOnly(payment, (pq) => buildInventory(uq, pq)));
    for (const line of formatInventory(inv, names)) log(line);
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ databases: names, ...inv }, null, 2));
    return 0;
  } finally {
    await user.$disconnect().catch(() => {});
    await payment.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  main(process.argv.slice(2), process.env, (l) => console.log(l)).then(
    (code) => process.exit(code),
    (e) => {
      console.error("legacy-refund-notice-inventory failed:", (e as Error).message);
      process.exit(2);
    },
  );
}
