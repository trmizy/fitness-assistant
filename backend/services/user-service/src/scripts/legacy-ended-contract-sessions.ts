/**
 * D55 / Câu D - LEGACY SESSIONS LEFT OPEN ON ENDED CONTRACTS: inventory + guarded cleanup.
 *
 * Before the F1 fix, a contract could end (COMPLETED / EXPIRED / CANCELLED / REJECTED) and leave its sessions
 * open. Those sessions are inert now (every money sink refuses on an ended contract) but they are still rows.
 * This script
 *   1. INVENTORIES them (read-only) and classifies them, and
 *   2. with --apply, closes ONLY the ones that certainly never happened and never touched money.
 *
 * Classes (a session of an ENDED contract whose own status is not final - CANCELLED / NO_SHOW / COMPLETED are final):
 *   A  NOT_STARTED_OPEN      REQUESTED, CONFIRMED          -> the only class --apply may ever touch (see eligibility)
 *   B  PT_REPORTED_AWAITING  PENDING_CLIENT_CONFIRMATION   -> PT reported it delivered, the client never answered.
 *                            (class "awaiting confirmation" is not a different state: it is B, split by whether the
 *                            client's confirm deadline has passed.)
 *   D  DISPUTED_OR_NOSHOW    DISPUTED, PT_NO_SHOW_REPORTED -> needs a ruling / separate reconciliation, NEVER closed
 *                            here (PT_NO_SHOW_REPORTED is being changed to "held" elsewhere - D52 - so it is never
 *                            treated as "not started" by this script).
 * Flags, counted across all classes:
 *   E  money trail           a payment ledger operation keyed by the session (SESSION_RELEASE / PT_NO_SHOW /
 *                            PT_LATE_ARRIVAL / UNRESOLVED_SESSION : <sessionId>), OR a session_settlements row for it
 *                            (any status - a PENDING/FAILED one is money still owed a retry), OR sessionDeducted=true.
 *   F  compensation/refund   F1 session-level compensation (PT_NO_SHOW / PT_LATE_ARRIVAL key or settlement, ptAtFault),
 *                            F2 the contract's termination money already ran (ledger CONTRACT_TERMINATE:<contractId>
 *                            or a SETTLED CONTRACT_TERMINATION settlement) - the session's value was already priced
 *                            into that refund/release, F3 contract.compensatedSessions > 0.
 *
 * AUTO-CLOSE ELIGIBILITY (all must hold, otherwise the session is listed with the reason it was kept and left alone):
 *   status in {REQUESTED, CONFIRMED}; contract ended AND its end is older than --min-age-minutes (default 60, so a
 *   termination that is running right now is never raced); sessionDeducted=false; no completion / confirm-deadline /
 *   dispute / ruling fields; ptAtFault=false; nobody ever entered the room (roomPtJoinedAt / roomClientJoinedAt null);
 *   no session_settlements row for the session; the contract has no PENDING/PROCESSING/FAILED CONTRACT_TERMINATION
 *   settlement (the live sweep will finish it and call the sessions off itself); no ledger operation for the session.
 *
 * What --apply writes: per eligible session, ONE compare-and-swap UPDATE (status CANCELLED, cancelledBy SYSTEM,
 * cancellationReason "[LEGACY_CLEANUP] ...") - the same payload callOffOpenSessions writes - plus one AuditLog row.
 * It does NOT call callOffOpenSessions itself: that function also pings chat-service and runs on the service's
 * global Prisma client; this script must make no network call and use only the DB URLs it is given. It never calls
 * payment-service and never writes the payment database (that connection is read-only), so no ledger movement is
 * possible. It never deletes anything. Every change is journaled BEFORE and AFTER to a JSON-lines file, and
 * `--restore <log>` puts the old values back.
 *
 * USAGE (run from backend/services/user-service; env or flags carry the two URLs, read-only for the payment one):
 *   USER_DATABASE_URL=... PAYMENT_DATABASE_URL=... ./node_modules/.bin/tsx src/scripts/legacy-ended-contract-sessions.ts            # dry-run (default)
 *   ... --markdown out.md --sample 5                                                                                              # + sanitized report file
 *   ... --apply --confirm-db <user db name> [--contract-id a,b] [--limit 50] [--before 2026-10-01] [--log file.jsonl]             # close class A
 *   ... --restore file.jsonl [--contract-id a]                                                                                    # undo from the log
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AuditEntityType, ContractStatus, Prisma, PrismaClient, SessionStatus } from "../generated/prisma";

// ── constants ────────────────────────────────────────────────────────────────

/** Contract states a contract never leaves (mirror of FINAL_CONTRACT_STATUSES in contract-payout.service.ts). */
export const ENDED_CONTRACT_STATUSES: ContractStatus[] = [
  ContractStatus.COMPLETED,
  ContractStatus.EXPIRED,
  ContractStatus.CANCELLED,
  ContractStatus.REJECTED,
];
/** Session states that are settled: nothing is ever written over them. */
export const FINAL_SESSION_STATUSES: SessionStatus[] = [SessionStatus.COMPLETED, SessionStatus.CANCELLED, SessionStatus.NO_SHOW];
/** "Certainly not started" - the ONLY states --apply may close. Deliberately NOT importing contract-session-closure's
 *  list: it also holds PT_NO_SHOW_REPORTED today and is being changed (D52); this script must not follow it. */
export const CLOSABLE_STATUSES: SessionStatus[] = [SessionStatus.REQUESTED, SessionStatus.CONFIRMED];

export const SYSTEM_ACTOR = "SYSTEM";
export const LEGACY_CLEANUP_REASON_PREFIX = "[LEGACY_CLEANUP]";
export const LEGACY_CLEANUP_REASON =
  `${LEGACY_CLEANUP_REASON_PREFIX} Hợp đồng đã kết thúc trước khi hệ thống tự đóng các buổi chưa diễn ra; buổi này được đóng, không tính vắng và không bị trừ.`;
export const AUDIT_ACTION_CLOSED = "SESSION_CANCELLED_LEGACY_CLEANUP";
export const AUDIT_ACTION_RESTORED = "SESSION_LEGACY_CLEANUP_RESTORED";

export type SessionClass = "A_NOT_STARTED_OPEN" | "B_PT_REPORTED_AWAITING" | "D_DISPUTED_OR_NOSHOW";
export type Exclusion =
  | "LEDGER_OPERATION"
  | "SETTLEMENT_ROW"
  | "SESSION_DEDUCTED"
  | "COMPLETION_OR_DISPUTE_FIELDS"
  | "ROOM_JOINED"
  | "PT_AT_FAULT"
  | "TERMINATION_MONEY_PENDING"
  | "CONTRACT_ENDED_TOO_RECENTLY"
  | "CONTRACT_END_DATE_IN_FUTURE";

const LEDGER_SESSION_PREFIXES = ["SESSION_RELEASE", "PT_NO_SHOW", "PT_LATE_ARRIVAL", "UNRESOLVED_SESSION"] as const;
type LedgerSessionKind = (typeof LEDGER_SESSION_PREFIXES)[number];

// ── options ──────────────────────────────────────────────────────────────────

export interface Scope {
  contractIds?: string[];
  /** Only contracts that ended before this instant (terminatedAt ?? completedAt ?? updatedAt). */
  before?: Date;
  /** Max sessions --apply closes in one run (dry-run shows the same slice as "planned"). */
  limit?: number;
  /** A contract that ended less than this many minutes ago is never auto-closed (a live termination may be running). */
  minAgeMinutes: number;
  now: Date;
}

export interface Databases {
  user: PrismaClient;
  payment: PrismaClient;
  userDbName: string;
  paymentDbName: string;
}

// ── low-level helpers ────────────────────────────────────────────────────────

export function dbNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

export function makeClient(url: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: url, log: [] });
}

/** Runs `fn` inside a READ ONLY transaction: the database itself refuses any write made through it. */
export async function readOnly<T>(client: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return fn(tx);
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const endedAtOf = (c: { terminatedAt: Date | null; completedAt: Date | null; updatedAt: Date }): Date =>
  c.terminatedAt ?? c.completedAt ?? c.updatedAt;

// ── inventory ────────────────────────────────────────────────────────────────

export interface InventoryRow {
  sessionId: string;
  contractId: string;
  cls: SessionClass;
  status: SessionStatus;
  contractStatus: ContractStatus;
  endReason: string; // terminationReason, or "(none)" when the contract carries none
  dataOrigin: string;
  /** price / totalSessions in đồng, the unit the money code uses (unitValue); 0 when the contract has no price. */
  valueVnd: Prisma.Decimal;
  hasPayment: boolean; // contract has a paymentTransactionId and a price (payableOrNull)
  ledgerKinds: LedgerSessionKind[];
  settlementKinds: string[];
  settlementStatuses: string[];
  sessionDeducted: boolean;
  compensationSession: boolean; // F1
  terminationMoneyExecuted: boolean; // F2
  contractCompensated: boolean; // F3
  deadlinePassed: boolean; // class B only
  exclusions: Exclusion[]; // class A: why it may NOT be auto-closed (empty = eligible)
  eligible: boolean;
  scheduledStartAt: Date;
}

export interface Inventory {
  rows: InventoryRow[];
  /** Eligible, in deterministic order, cut to scope.limit. */
  planned: InventoryRow[];
}

function classify(status: SessionStatus): SessionClass | null {
  switch (status) {
    case SessionStatus.REQUESTED:
    case SessionStatus.CONFIRMED:
      return "A_NOT_STARTED_OPEN";
    case SessionStatus.PENDING_CLIENT_CONFIRMATION:
      return "B_PT_REPORTED_AWAITING";
    case SessionStatus.DISPUTED:
    case SessionStatus.PT_NO_SHOW_REPORTED:
      return "D_DISPUTED_OR_NOSHOW";
    default:
      return null; // COMPLETED / CANCELLED / NO_SHOW: final
  }
}

async function ledgerKeysPresent(payment: PrismaClient, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk(keys, 2000)) {
    const rows = await readOnly(payment, (tx) =>
      tx.$queryRawUnsafe<{ key: string }[]>("SELECT key FROM ledger_operations WHERE key = ANY($1::text[])", part),
    );
    for (const r of rows) found.add(r.key);
  }
  return found;
}

export async function buildInventory(db: Databases, scope: Scope): Promise<Inventory> {
  const rows: InventoryRow[] = [];
  const minAgeCutoff = new Date(scope.now.getTime() - scope.minAgeMinutes * 60_000);
  let cursor: string | undefined;

  for (;;) {
    const sessions = await readOnly(db.user, (tx) =>
      tx.session.findMany({
        where: {
          status: { notIn: FINAL_SESSION_STATUSES },
          contract: { status: { in: ENDED_CONTRACT_STATUSES }, ...(scope.contractIds?.length ? { id: { in: scope.contractIds } } : {}) },
        },
        orderBy: { id: "asc" },
        take: 1000,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          contractId: true,
          status: true,
          sessionDeducted: true,
          completedAt: true,
          clientConfirmDeadline: true,
          disputedAt: true,
          disputeReason: true,
          disputeType: true,
          resolvedAt: true,
          resolvedBy: true,
          ptAtFault: true,
          roomPtJoinedAt: true,
          roomClientJoinedAt: true,
          scheduledStartAt: true,
          contract: {
            select: {
              id: true,
              status: true,
              terminationReason: true,
              terminatedAt: true,
              completedAt: true,
              updatedAt: true,
              price: true,
              totalSessions: true,
              compensatedSessions: true,
              paymentTransactionId: true,
              dataOrigin: true,
            },
          },
        },
      }),
    );
    if (sessions.length === 0) break;
    cursor = sessions[sessions.length - 1].id;

    // Money trail lookups for this batch: payment ledger (separate DB) + the local settlement outbox.
    const sessionIds = sessions.map((s) => s.id);
    const contractIds = [...new Set(sessions.map((s) => s.contractId))];
    const keys = [
      ...sessionIds.flatMap((id) => LEDGER_SESSION_PREFIXES.map((p) => `${p}:${id}`)),
      ...contractIds.map((id) => `CONTRACT_TERMINATE:${id}`),
    ];
    const ledger = await ledgerKeysPresent(db.payment, keys);
    const settlements = await readOnly(db.user, (tx) =>
      tx.sessionSettlement.findMany({
        where: { OR: [{ sessionId: { in: sessionIds } }, { contractId: { in: contractIds }, kind: "CONTRACT_TERMINATION" }] },
        select: { sessionId: true, contractId: true, kind: true, status: true },
      }),
    );
    const bySession = new Map<string, { kind: string; status: string }[]>();
    const termByContract = new Map<string, string[]>();
    for (const st of settlements) {
      if (st.sessionId) bySession.set(st.sessionId, [...(bySession.get(st.sessionId) ?? []), { kind: st.kind, status: st.status }]);
      if (st.kind === "CONTRACT_TERMINATION") termByContract.set(st.contractId, [...(termByContract.get(st.contractId) ?? []), st.status]);
    }

    for (const s of sessions) {
      const cls = classify(s.status);
      if (!cls) continue;
      const c = s.contract;
      const endedAt = endedAtOf(c);
      if (scope.before && !(endedAt < scope.before)) continue;

      const price = c.price;
      const hasPayment = !!c.paymentTransactionId && price != null && c.totalSessions > 0;
      const valueVnd = price != null && c.totalSessions > 0 ? new Prisma.Decimal(price).div(c.totalSessions) : new Prisma.Decimal(0);
      const ledgerKinds = LEDGER_SESSION_PREFIXES.filter((p) => ledger.has(`${p}:${s.id}`));
      const sRows = bySession.get(s.id) ?? [];
      const termStatuses = termByContract.get(s.contractId) ?? [];
      const compensationSession =
        s.ptAtFault ||
        ledgerKinds.includes("PT_NO_SHOW") ||
        ledgerKinds.includes("PT_LATE_ARRIVAL") ||
        sRows.some((r) => r.kind === "PT_NO_SHOW_COMPENSATION" || r.kind === "PT_LATE_ARRIVAL_COMPENSATION");
      const terminationMoneyExecuted = ledger.has(`CONTRACT_TERMINATE:${s.contractId}`) || termStatuses.includes("SETTLED");

      const exclusions: Exclusion[] = [];
      if (cls === "A_NOT_STARTED_OPEN") {
        if (ledgerKinds.length > 0) exclusions.push("LEDGER_OPERATION");
        if (sRows.length > 0) exclusions.push("SETTLEMENT_ROW");
        if (s.sessionDeducted) exclusions.push("SESSION_DEDUCTED");
        if (s.completedAt || s.clientConfirmDeadline || s.disputedAt || s.disputeReason || s.disputeType || s.resolvedAt || s.resolvedBy) {
          exclusions.push("COMPLETION_OR_DISPUTE_FIELDS");
        }
        if (s.roomPtJoinedAt || s.roomClientJoinedAt) exclusions.push("ROOM_JOINED");
        if (s.ptAtFault) exclusions.push("PT_AT_FAULT");
        if (termStatuses.some((t) => t !== "SETTLED")) exclusions.push("TERMINATION_MONEY_PENDING");
        if (endedAt > scope.now) exclusions.push("CONTRACT_END_DATE_IN_FUTURE");
        else if (!(endedAt < minAgeCutoff)) exclusions.push("CONTRACT_ENDED_TOO_RECENTLY");
      }

      rows.push({
        sessionId: s.id,
        contractId: s.contractId,
        cls,
        status: s.status,
        contractStatus: c.status,
        endReason: c.terminationReason ?? "(none)",
        dataOrigin: c.dataOrigin,
        valueVnd,
        hasPayment,
        ledgerKinds,
        settlementKinds: sRows.map((r) => r.kind),
        settlementStatuses: sRows.map((r) => r.status),
        sessionDeducted: s.sessionDeducted,
        compensationSession,
        terminationMoneyExecuted,
        contractCompensated: c.compensatedSessions > 0,
        deadlinePassed: !!s.clientConfirmDeadline && s.clientConfirmDeadline < scope.now,
        exclusions,
        eligible: cls === "A_NOT_STARTED_OPEN" && exclusions.length === 0,
        scheduledStartAt: s.scheduledStartAt,
      });
    }
  }

  const eligible = rows
    .filter((r) => r.eligible)
    .sort((a, b) => (a.contractId === b.contractId ? a.scheduledStartAt.getTime() - b.scheduledStartAt.getTime() : a.contractId < b.contractId ? -1 : 1) || (a.sessionId < b.sessionId ? -1 : 1));
  return { rows, planned: scope.limit != null ? eligible.slice(0, scope.limit) : eligible };
}

// ── report ───────────────────────────────────────────────────────────────────

export interface Report {
  generatedAt: string;
  mode: "DRY_RUN" | "APPLY";
  target: { userDb: string; paymentDb: string };
  scope: { contractIds: string[] | null; before: string | null; limit: number | null; minAgeMinutes: number };
  totalOpenOnEndedContracts: number;
  byClassStatusReason: { cls: SessionClass; status: string; endReason: string; contractStatus: string; count: number; valueVnd: string }[];
  byDataOrigin: Record<string, number>;
  flags: Record<
    string,
    {
      sessions: number;
      ledgerOperation: number;
      settlementRow: number;
      sessionDeducted: number;
      compensationSession: number;
      terminationMoneyExecuted: number;
      contractCompensated: number;
      withoutPayment: number;
      deadlinePassed: number;
      valueVnd: string;
      paidValueVnd: string;
    }
  >;
  autoClose: {
    classASessions: number;
    eligible: number;
    eligibleValueVnd: string;
    eligibleWithTerminationMoneyExecuted: number;
    eligibleWithoutPayment: number;
    plannedThisRun: number;
    keptReasons: Record<string, number>;
  };
  samples: Record<string, string[]>;
}

const money = (d: Prisma.Decimal) => d.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toString();

export function buildReport(inv: Inventory, db: Databases, scope: Scope, mode: "DRY_RUN" | "APPLY", sampleSize: number): Report {
  const groups = new Map<string, Report["byClassStatusReason"][number] & { v: Prisma.Decimal }>();
  const flags: Report["flags"] = {};
  const byDataOrigin: Record<string, number> = {};
  const flagValue = new Map<string, Prisma.Decimal>();
  const paidValue = new Map<string, Prisma.Decimal>();
  const samples: Record<string, string[]> = {};
  const keptReasons: Record<string, number> = {};

  for (const r of inv.rows) {
    const k = `${r.cls}|${r.status}|${r.endReason}|${r.contractStatus}`;
    const g = groups.get(k) ?? { cls: r.cls, status: r.status, endReason: r.endReason, contractStatus: r.contractStatus, count: 0, valueVnd: "0", v: new Prisma.Decimal(0) };
    g.count++;
    g.v = g.v.add(r.valueVnd);
    groups.set(k, g);

    byDataOrigin[r.dataOrigin] = (byDataOrigin[r.dataOrigin] ?? 0) + 1;

    const f =
      flags[r.cls] ??
      (flags[r.cls] = {
        sessions: 0, ledgerOperation: 0, settlementRow: 0, sessionDeducted: 0, compensationSession: 0,
        terminationMoneyExecuted: 0, contractCompensated: 0, withoutPayment: 0, deadlinePassed: 0, valueVnd: "0", paidValueVnd: "0",
      });
    f.sessions++;
    if (r.ledgerKinds.length) f.ledgerOperation++;
    if (r.settlementKinds.length) f.settlementRow++;
    if (r.sessionDeducted) f.sessionDeducted++;
    if (r.compensationSession) f.compensationSession++;
    if (r.terminationMoneyExecuted) f.terminationMoneyExecuted++;
    if (r.contractCompensated) f.contractCompensated++;
    if (!r.hasPayment) f.withoutPayment++;
    if (r.deadlinePassed) f.deadlinePassed++;
    flagValue.set(r.cls, (flagValue.get(r.cls) ?? new Prisma.Decimal(0)).add(r.valueVnd));
    if (r.hasPayment) paidValue.set(r.cls, (paidValue.get(r.cls) ?? new Prisma.Decimal(0)).add(r.valueVnd));

    const sampleKey = `${r.cls}/${r.status}`;
    (samples[sampleKey] ??= []).length < sampleSize && samples[sampleKey].push(r.sessionId);
    if (r.cls === "A_NOT_STARTED_OPEN") for (const e of r.exclusions) keptReasons[e] = (keptReasons[e] ?? 0) + 1;
  }
  for (const [cls, v] of flagValue) flags[cls].valueVnd = money(v);
  for (const [cls, v] of paidValue) flags[cls].paidValueVnd = money(v);

  const classA = inv.rows.filter((r) => r.cls === "A_NOT_STARTED_OPEN");
  const eligible = classA.filter((r) => r.eligible);
  const eligibleValue = eligible.reduce((s, r) => s.add(r.valueVnd), new Prisma.Decimal(0));
  return {
    generatedAt: scope.now.toISOString(),
    mode,
    target: { userDb: db.userDbName, paymentDb: db.paymentDbName },
    scope: {
      contractIds: scope.contractIds?.length ? scope.contractIds : null,
      before: scope.before?.toISOString() ?? null,
      limit: scope.limit ?? null,
      minAgeMinutes: scope.minAgeMinutes,
    },
    totalOpenOnEndedContracts: inv.rows.length,
    byClassStatusReason: [...groups.values()]
      .map(({ v, ...g }) => ({ ...g, valueVnd: money(v) }))
      .sort((a, b) => (a.cls + a.status + a.endReason).localeCompare(b.cls + b.status + b.endReason)),
    byDataOrigin,
    flags,
    autoClose: {
      classASessions: classA.length,
      eligible: eligible.length,
      eligibleValueVnd: money(eligibleValue),
      eligibleWithTerminationMoneyExecuted: eligible.filter((r) => r.terminationMoneyExecuted).length,
      eligibleWithoutPayment: eligible.filter((r) => !r.hasPayment).length,
      plannedThisRun: inv.planned.length,
      keptReasons,
    },
    samples: { ...samples, "AUTO_CLOSE_PLANNED": inv.planned.slice(0, sampleSize).map((r) => r.sessionId) },
  };
}

export function renderMarkdown(rep: Report): string {
  const L: string[] = [];
  L.push(`# Legacy sessions on ended contracts - ${rep.mode}`);
  L.push("");
  L.push(`- Generated: ${rep.generatedAt}`);
  L.push(`- Source: user DB \`${rep.target.userDb}\`, payment ledger DB \`${rep.target.paymentDb}\` (READ ONLY transactions)`);
  L.push(`- Scope: ${JSON.stringify(rep.scope)}`);
  L.push(`- Open (non-final) sessions on ended contracts: **${rep.totalOpenOnEndedContracts}**`);
  L.push(`- By contract data origin: ${JSON.stringify(rep.byDataOrigin)}`);
  L.push("");
  L.push("## Class x session status x contract end reason");
  L.push("");
  L.push("| Class | Session status | End reason | Contract status | Sessions | Value at stake (dong) |");
  L.push("|---|---|---|---|---:|---:|");
  for (const g of rep.byClassStatusReason) L.push(`| ${g.cls} | ${g.status} | ${g.endReason} | ${g.contractStatus} | ${g.count} | ${g.valueVnd} |`);
  if (rep.byClassStatusReason.length === 0) L.push("| (none) | | | | 0 | 0 |");
  L.push("");
  L.push("## Flags per class");
  L.push("");
  L.push("| Class | Sessions | E ledger op | E settlement row | E sessionDeducted | F1 compensation (session) | F2 termination money ran | F3 contract compensatedSessions>0 | no payment | B deadline passed | Value (dong) | of which on paid contracts (dong) |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [cls, f] of Object.entries(rep.flags)) {
    L.push(`| ${cls} | ${f.sessions} | ${f.ledgerOperation} | ${f.settlementRow} | ${f.sessionDeducted} | ${f.compensationSession} | ${f.terminationMoneyExecuted} | ${f.contractCompensated} | ${f.withoutPayment} | ${f.deadlinePassed} | ${f.valueVnd} | ${f.paidValueVnd} |`);
  }
  L.push("");
  L.push("## Auto-close (class A only)");
  L.push("");
  const a = rep.autoClose;
  L.push(`- Class A sessions: ${a.classASessions}`);
  L.push(`- Certainly-not-started and eligible: **${a.eligible}** (value ${a.eligibleValueVnd} dong, no money moves when they are closed)`);
  L.push(`  - of which on a contract whose termination money already ran: ${a.eligibleWithTerminationMoneyExecuted}; on a contract with no payment: ${a.eligibleWithoutPayment}`);
  L.push(`- Planned in this run (after --limit): ${a.plannedThisRun}`);
  L.push(`- Kept (class A, not eligible), by reason (a session can have several): ${JSON.stringify(a.keptReasons)}`);
  L.push("");
  L.push("## Sample session ids (no personal data)");
  L.push("");
  for (const [k, ids] of Object.entries(rep.samples)) L.push(`- ${k}: ${ids.length ? ids.join(", ") : "(none)"}`);
  L.push("");
  return L.join("\n");
}

// ── apply ────────────────────────────────────────────────────────────────────

export interface LogLine {
  ts: string;
  runId: string;
  phase: "before" | "after" | "skip" | "restore-before" | "restore-after" | "restore-skip";
  sessionId: string;
  contractId?: string;
  oldStatus?: string;
  newStatus?: string;
  oldCancelledBy?: string | null;
  oldCancellationReason?: string | null;
  oldUpdatedAt?: string;
  applied?: boolean;
  reason?: string;
}

function appendLog(file: string, line: LogLine): void {
  fs.appendFileSync(file, JSON.stringify(line) + "\n");
}

export interface ApplyResult {
  runId: string;
  logFile: string;
  considered: number;
  closed: number;
  skipped: { sessionId: string; reason: string }[];
}

/** The CAS "this session is still certainly-not-started" condition, shared by apply's UPDATE. */
function notStartedWhere(id: string, status: SessionStatus): Prisma.SessionWhereInput {
  return {
    id,
    status,
    sessionDeducted: false,
    completedAt: null,
    clientConfirmDeadline: null,
    disputedAt: null,
    disputeReason: null,
    disputeType: null,
    resolvedAt: null,
    resolvedBy: null,
    ptAtFault: false,
    roomPtJoinedAt: null,
    roomClientJoinedAt: null,
    contract: { status: { in: ENDED_CONTRACT_STATUSES } },
  };
}

export async function applyPlan(db: Databases, inv: Inventory, logFile: string): Promise<ApplyResult> {
  const runId = randomUUID();
  const result: ApplyResult = { runId, logFile, considered: inv.planned.length, closed: 0, skipped: [] };
  fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });

  for (const plan of inv.planned) {
    const skip = (reason: string) => {
      result.skipped.push({ sessionId: plan.sessionId, reason });
      appendLog(logFile, { ts: new Date().toISOString(), runId, phase: "skip", sessionId: plan.sessionId, contractId: plan.contractId, reason });
    };

    // Last look at the ledger for THIS session right before touching it (the inventory may be minutes old).
    const ledger = await ledgerKeysPresent(db.payment, LEDGER_SESSION_PREFIXES.map((p) => `${p}:${plan.sessionId}`));
    if (ledger.size > 0) {
      skip("LEDGER_OPERATION_APPEARED");
      continue;
    }
    const settlementRows = await readOnly(db.user, (tx) => tx.sessionSettlement.count({ where: { sessionId: plan.sessionId } }));
    if (settlementRows > 0) {
      skip("SETTLEMENT_ROW_APPEARED");
      continue;
    }

    const old = await db.user.session.findUnique({
      where: { id: plan.sessionId },
      select: { id: true, status: true, cancelledBy: true, cancellationReason: true, updatedAt: true },
    });
    if (!old || !CLOSABLE_STATUSES.includes(old.status)) {
      skip(`STATE_CHANGED:${old?.status ?? "GONE"}`);
      continue;
    }

    // Journal the intent BEFORE the write, so a crash between UPDATE and the "after" line still leaves restore evidence.
    appendLog(logFile, {
      ts: new Date().toISOString(),
      runId,
      phase: "before",
      sessionId: old.id,
      contractId: plan.contractId,
      oldStatus: old.status,
      newStatus: SessionStatus.CANCELLED,
      oldCancelledBy: old.cancelledBy,
      oldCancellationReason: old.cancellationReason,
      oldUpdatedAt: old.updatedAt.toISOString(),
    });

    const won = await db.user.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: notStartedWhere(old.id, old.status),
        data: { status: SessionStatus.CANCELLED, cancelledBy: SYSTEM_ACTOR, cancellationReason: LEGACY_CLEANUP_REASON },
      });
      if (count !== 1) return false;
      await tx.auditLog.create({
        data: {
          actorUserId: SYSTEM_ACTOR,
          action: AUDIT_ACTION_CLOSED,
          entityType: AuditEntityType.SESSION,
          entityId: old.id,
          metadata: {
            runId,
            contractId: plan.contractId,
            statusBefore: old.status,
            legacyCleanup: true,
            contractEndReason: plan.endReason,
            reasonText: LEGACY_CLEANUP_REASON,
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    });

    appendLog(logFile, { ts: new Date().toISOString(), runId, phase: "after", sessionId: old.id, contractId: plan.contractId, newStatus: won ? SessionStatus.CANCELLED : old.status, applied: won, reason: won ? undefined : "CAS_LOST" });
    if (won) result.closed++;
    else result.skipped.push({ sessionId: old.id, reason: "CAS_LOST" });
  }
  return result;
}

// ── restore ──────────────────────────────────────────────────────────────────

export interface RestoreResult {
  runId: string;
  logFile: string;
  candidates: number;
  restored: number;
  skipped: { sessionId: string; reason: string }[];
}

/**
 * Puts back, from a journal written by --apply, every session this script closed: status, cancelledBy,
 * cancellationReason and updatedAt return to the logged "before" values. Compare-and-swap: a session is restored only
 * if it is still exactly as this script left it (CANCELLED by SYSTEM with the [LEGACY_CLEANUP] reason) - one that moved
 * on since is reported and left. Re-running is a no-op. The audit rows of the closing are kept; a restore adds its own.
 */
export async function restoreFromLog(db: Databases, logFile: string, contractIds?: string[]): Promise<RestoreResult> {
  const lines: LogLine[] = fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const runId = randomUUID();
  const outFile = `${logFile}.restore-${runId}.jsonl`;
  // One "before" per session is the first journal entry for it (a later run on a restored session logs a new "before").
  const first = new Map<string, LogLine>();
  for (const l of lines) if (l.phase === "before" && !first.has(l.sessionId)) first.set(l.sessionId, l);
  const targets = [...first.values()].filter((l) => !contractIds?.length || (l.contractId && contractIds.includes(l.contractId)));
  const result: RestoreResult = { runId, logFile: outFile, candidates: targets.length, restored: 0, skipped: [] };

  for (const t of targets) {
    const skip = (reason: string) => {
      result.skipped.push({ sessionId: t.sessionId, reason });
      appendLog(outFile, { ts: new Date().toISOString(), runId, phase: "restore-skip", sessionId: t.sessionId, reason });
    };
    const cur = await db.user.session.findUnique({ where: { id: t.sessionId }, select: { status: true, cancelledBy: true, cancellationReason: true } });
    if (!cur) { skip("GONE"); continue; }
    if (cur.status !== SessionStatus.CANCELLED || cur.cancelledBy !== SYSTEM_ACTOR || !cur.cancellationReason?.startsWith(LEGACY_CLEANUP_REASON_PREFIX)) {
      skip(`NOT_IN_CLEANUP_STATE:${cur.status}`);
      continue;
    }
    appendLog(outFile, { ts: new Date().toISOString(), runId, phase: "restore-before", sessionId: t.sessionId, contractId: t.contractId, oldStatus: cur.status, newStatus: t.oldStatus });
    const won = await db.user.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { id: t.sessionId, status: SessionStatus.CANCELLED, cancelledBy: SYSTEM_ACTOR, cancellationReason: { startsWith: LEGACY_CLEANUP_REASON_PREFIX } },
        data: {
          status: t.oldStatus as SessionStatus,
          cancelledBy: t.oldCancelledBy ?? null,
          cancellationReason: t.oldCancellationReason ?? null,
          updatedAt: t.oldUpdatedAt ? new Date(t.oldUpdatedAt) : undefined,
        },
      });
      if (count !== 1) return false;
      await tx.auditLog.create({
        data: {
          actorUserId: SYSTEM_ACTOR,
          action: AUDIT_ACTION_RESTORED,
          entityType: AuditEntityType.SESSION,
          entityId: t.sessionId,
          metadata: { runId, restoredFromRun: t.runId, statusRestored: t.oldStatus } as Prisma.InputJsonValue,
        },
      });
      return true;
    });
    appendLog(outFile, { ts: new Date().toISOString(), runId, phase: "restore-after", sessionId: t.sessionId, newStatus: t.oldStatus, applied: won });
    if (won) result.restored++;
    else result.skipped.push({ sessionId: t.sessionId, reason: "CAS_LOST" });
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

interface Cli {
  apply: boolean;
  restore?: string;
  confirmDb?: string;
  contractIds?: string[];
  limit?: number;
  before?: Date;
  minAgeMinutes: number;
  log?: string;
  markdown?: string;
  json: boolean;
  sample: number;
  userUrl?: string;
  paymentUrl?: string;
}

export function parseArgs(argv: string[]): Cli {
  const cli: Cli = { apply: false, minAgeMinutes: 60, json: false, sample: 5 };
  const need = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--apply": cli.apply = true; break;
      case "--json": cli.json = true; break;
      case "--restore": cli.restore = need(i, a); i++; break;
      case "--confirm-db": cli.confirmDb = need(i, a); i++; break;
      case "--contract-id": cli.contractIds = [...(cli.contractIds ?? []), ...need(i, a).split(",").filter(Boolean)]; i++; break;
      case "--limit": {
        const n = Number(need(i, a));
        if (!Number.isInteger(n) || n < 0) throw new Error("--limit must be a non-negative integer");
        cli.limit = n; i++; break;
      }
      case "--before": {
        const d = new Date(need(i, a));
        if (Number.isNaN(d.getTime())) throw new Error("--before must be a date, e.g. 2026-10-01");
        cli.before = d; i++; break;
      }
      case "--min-age-minutes": {
        const n = Number(need(i, a));
        if (!Number.isFinite(n) || n < 0) throw new Error("--min-age-minutes must be >= 0");
        cli.minAgeMinutes = n; i++; break;
      }
      case "--log": cli.log = need(i, a); i++; break;
      case "--markdown": cli.markdown = need(i, a); i++; break;
      case "--sample": cli.sample = Math.max(0, Number(need(i, a)) || 0); i++; break;
      case "--user-url": cli.userUrl = need(i, a); i++; break;
      case "--payment-url": cli.paymentUrl = need(i, a); i++; break;
      default: throw new Error(`unknown argument ${a}`);
    }
  }
  return cli;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, out: (s: string) => void = console.log): Promise<number> {
  const cli = parseArgs(argv);
  const userUrl = cli.userUrl ?? env.USER_DATABASE_URL;
  const paymentUrl = cli.paymentUrl ?? env.PAYMENT_DATABASE_URL;
  if (!userUrl || !paymentUrl) {
    out("USER_DATABASE_URL and PAYMENT_DATABASE_URL are both required (the payment ledger decides what may be closed).");
    return 2;
  }
  const db: Databases = { user: makeClient(userUrl), payment: makeClient(paymentUrl), userDbName: dbNameOf(userUrl), paymentDbName: dbNameOf(paymentUrl) };
  try {
    if (cli.restore) {
      if (!cli.confirmDb || cli.confirmDb !== db.userDbName) {
        out(`--restore writes to the user DB: pass --confirm-db ${db.userDbName} to confirm the target.`);
        return 2;
      }
      const r = await restoreFromLog(db, cli.restore, cli.contractIds);
      out(JSON.stringify({ mode: "RESTORE", target: db.userDbName, ...r, skipped: r.skipped.slice(0, 20) }, null, 2));
      return 0;
    }

    const now = new Date();
    const scope: Scope = { contractIds: cli.contractIds, before: cli.before, limit: cli.limit, minAgeMinutes: cli.minAgeMinutes, now };
    if (cli.apply && cli.confirmDb !== db.userDbName) {
      out(`--apply refused: pass --confirm-db ${db.userDbName} (the exact user DB name this run will write to).`);
      return 2;
    }
    const inv = await buildInventory(db, scope);
    const report = buildReport(inv, db, scope, cli.apply ? "APPLY" : "DRY_RUN", cli.sample);
    if (cli.markdown) {
      fs.mkdirSync(path.dirname(path.resolve(cli.markdown)), { recursive: true });
      fs.writeFileSync(cli.markdown, renderMarkdown(report));
    }
    out(cli.json ? JSON.stringify(report, null, 2) : renderMarkdown(report));
    if (!cli.apply) {
      out(`DRY RUN: nothing was written. Re-run with --apply --confirm-db ${db.userDbName} to close the ${report.autoClose.plannedThisRun} planned class-A session(s).`);
      return 0;
    }
    const logFile = cli.log ?? path.resolve(`legacy-sessions-cleanup-${now.toISOString().replace(/[:.]/g, "-")}.jsonl`);
    const res = await applyPlan(db, inv, logFile);
    out(JSON.stringify({ mode: "APPLY", target: db.userDbName, runId: res.runId, log: res.logFile, considered: res.considered, closed: res.closed, skipped: res.skipped.slice(0, 20) }, null, 2));
    return 0;
  } finally {
    await db.user.$disconnect();
    await db.payment.$disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
