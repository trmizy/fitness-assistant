/**
 * In-memory stand-in for the session_settlements TABLE (TEST FIXTURE, no database).
 *
 * The money steps (release / no-show compensation / unresolved-session resolution / contract ending) persist a settlement
 * row before they call payment-service and flip it SETTLED once, with the sub-ledger bookkeeping, after a valid answer
 * (Phase 0 / D58). A unit test that replaces `paymentClient` and the other repositories still runs that real tracking code,
 * which used to write straight into whatever DATABASE_URL pointed at (with throw-away ids) and failed without a database.
 *
 * `stubSessionSettlements()` replaces ONLY the `sessionSettlementRepository` methods, with the same contract:
 *   - upsertPending finds-or-creates by idempotency key (PENDING, attempts 0), never resets an existing row;
 *   - claim is the compare-and-set (PENDING / FAILED / stale PROCESSING; `takeover` also a live PROCESSING; never SETTLED, never parked);
 *   - settleOnce flips to SETTLED and returns true for the FIRST caller only (apply-once);
 *   - markFailed / park never touch a SETTLED row;
 *   - the listing queries answer from the rows held here (nothing else exists in an "empty database").
 * `prisma.$transaction(fn)` runs `fn` with a handle whose raw lock statements are no-ops (single-threaded test), so the
 * apply-callback's repository calls (stubbed here, or by the test) need no real transaction. Rows are exposed (`rows`) so a test can assert on them or pre-seed one.
 * Restores itself when the test file finishes.
 */
import { randomUUID } from "node:crypto";
import { after } from "node:test";
import { prisma } from "../repositories/profile.repository";
import { ENDED_UNSETTLED_PREFIX, PARKED_PREFIXES, SESSION_MONEY_KINDS, sessionSettlementRepository } from "../repositories/session-settlement.repository";

export interface FakeSettlementRow {
  id: string;
  kind: string;
  idempotencyKey: string;
  sessionId: string | null;
  contractId: string;
  reason: string | null;
  status: "PENDING" | "PROCESSING" | "SETTLED" | "FAILED";
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  settledAt: Date | null;
}

export interface SessionSettlementMemoryStub {
  rows: Map<string, FakeSettlementRow>;
  byKey: (idempotencyKey: string) => FakeSettlementRow | undefined;
  restore: () => void;
}

const isParked = (e: string | null | undefined) => !!e && PARKED_PREFIXES.some((p) => e.startsWith(p));

export function stubSessionSettlements(): SessionSettlementMemoryStub {
  const rows = new Map<string, FakeSettlementRow>(); // by id
  const byKey = (k: string) => [...rows.values()].find((r) => r.idempotencyKey === k);
  const touch = (r: FakeSettlementRow, patch: Partial<FakeSettlementRow>) => {
    Object.assign(r, patch, { updatedAt: new Date() });
    return r;
  };
  const repo: any = sessionSettlementRepository;
  const db: any = prisma;
  const originals: Record<string, unknown> = {};
  const replace = (name: string, impl: unknown) => {
    originals[name] = repo[name];
    repo[name] = impl;
  };

  replace("upsertPending", async (input: any) => {
    const existing = byKey(input.idempotencyKey);
    if (existing) return existing;
    const now = new Date();
    const row: FakeSettlementRow = {
      id: randomUUID(),
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      sessionId: input.sessionId ?? null,
      contractId: input.contractId,
      reason: input.reason ?? null,
      status: "PENDING",
      attempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      settledAt: null,
    };
    rows.set(row.id, row);
    return row;
  });
  replace("findById", async (id: string) => rows.get(id) ?? null);
  replace("findByKey", async (k: string) => byKey(k) ?? null);
  replace("markProcessing", async (id: string) => {
    const r = rows.get(id)!;
    return touch(r, { status: "PROCESSING", attempts: r.attempts + 1 });
  });
  replace("claim", async (id: string, opts: { staleBefore: Date; takeover?: boolean }) => {
    const r = rows.get(id);
    if (!r || r.status === "SETTLED" || isParked(r.lastError)) return null;
    const claimable = opts.takeover
      ? true
      : r.status === "PENDING" || r.status === "FAILED" || (r.status === "PROCESSING" && r.updatedAt < opts.staleBefore);
    if (!claimable) return null;
    return touch(r, { status: "PROCESSING", attempts: r.attempts + 1 });
  });
  replace("settleOnce", async (id: string) => {
    const r = rows.get(id);
    if (!r || r.status === "SETTLED") return false;
    touch(r, { status: "SETTLED", settledAt: new Date(), lastError: null });
    return true;
  });
  replace("markSettled", async (id: string) => touch(rows.get(id)!, { status: "SETTLED", settledAt: new Date(), lastError: null }));
  replace("markFailed", async (id: string, error: string) => {
    const r = rows.get(id);
    if (!r || r.status === "SETTLED") return { count: 0 };
    touch(r, { status: "FAILED", lastError: error.slice(0, 2000) });
    return { count: 1 };
  });
  replace("park", async (id: string, prefix: string, message: string) => {
    const r = rows.get(id);
    if (!r || r.status === "SETTLED") return { count: 0 };
    touch(r, { status: "FAILED", lastError: `${prefix} ${message}`.slice(0, 2000) });
    return { count: 1 };
  });
  const unsettled = (contractId: string, kinds: string[]) =>
    [...rows.values()]
      .filter((r) => r.contractId === contractId && kinds.includes(r.kind) && r.status !== "SETTLED" && !r.lastError?.startsWith(ENDED_UNSETTLED_PREFIX))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  replace("findUnsettledCompensations", async (contractId: string) => unsettled(contractId, ["PT_NO_SHOW_COMPENSATION", "PT_LATE_ARRIVAL_COMPENSATION"]));
  replace("findUnsettledSessionMoney", async (contractId: string) => unsettled(contractId, SESSION_MONEY_KINDS as string[]));
  replace("findTerminationRow", async (contractId: string) => byKey(`CONTRACT_TERMINATE:${contractId}`) ?? null);
  replace("hasUnconfirmedTermination", async (contractId: string) =>
    [...rows.values()].some((r) => r.contractId === contractId && r.kind === "CONTRACT_TERMINATION" && r.status !== "SETTLED"),
  );
  // The sweep's queues: a unit test does not run the sweep, and an empty database has no retryable / attention rows.
  replace("findRetryable", async () => []);
  replace("findNeedingAttention", async () => []);

  // A transaction handle: the client itself, except that the raw statements (SET LOCAL lock_timeout, pg_advisory_xact_lock) are
  // no-ops - the unit tests are single-threaded, so there is nobody to exclude. Every other delegate still goes to the client
  // (so a test that needs a real row for it must stub that repository, as before).
  const tx: any = new Proxy(db, {
    get: (target, prop) =>
      prop === "$executeRaw" || prop === "$executeRawUnsafe" ? async () => 0 : prop === "$queryRaw" || prop === "$queryRawUnsafe" ? async () => [] : target[prop],
  });
  // The contract / session tables are EMPTY here: reads of them answer like an empty database (the tests use throw-away ids and
  // stub the repositories they care about; whatever they do not stub finds nothing, exactly as it would on a clean _test database).
  const emptyReads: Array<[string, string, unknown]> = [];
  for (const delegate of ["contract", "session"]) {
    for (const [method, answer] of [["findUnique", null], ["findFirst", null], ["findMany", []], ["count", 0]] as const) {
      emptyReads.push([delegate, method, db[delegate][method]]);
      db[delegate][method] = async () => (Array.isArray(answer) ? [] : answer);
    }
  }
  originals["$transaction"] = db.$transaction;
  db.$transaction = async (arg: unknown) => (typeof arg === "function" ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as Promise<unknown>[]));

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const [name, fn] of Object.entries(originals)) {
      if (name === "$transaction") db.$transaction = fn;
      else repo[name] = fn;
    }
    for (const [delegate, method, fn] of emptyReads) db[delegate][method] = fn;
  };
  after(restore);
  return { rows, byKey, restore };
}
