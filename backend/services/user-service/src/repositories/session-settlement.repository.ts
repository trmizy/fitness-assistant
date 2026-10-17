import { Prisma, SessionSettlementKind, SessionSettlementStatus } from "../generated/prisma";
import { prisma } from "./profile.repository";

type Db = typeof prisma | Prisma.TransactionClient;

/** lastError prefix of a compensation row that must not be retried: its contract ended before it settled. */
export const ENDED_UNSETTLED_PREFIX = "ENDED_UNSETTLED:";
/**
 * D62-E / Phase 0 unit 5 - the row can never be settled by retrying (the contract / session it belongs to is gone, the
 * session is not in a state that supports this money step, the attempt cap was reached): it is PARKED for a human /
 * the reconciliation report. Rows are never deleted and never reset to PENDING by code; the history stays.
 */
export const NEEDS_RECONCILIATION_PREFIX = "NEEDS_RECONCILIATION:";
/** payment-service answered, but not with what the recorded intent asked for (another reason / other held count). */
export const CONFLICT_PREFIX = "CONFLICT:";

export const PARKED_PREFIXES = [ENDED_UNSETTLED_PREFIX, NEEDS_RECONCILIATION_PREFIX, CONFLICT_PREFIX];

/** D64-A - terminal ORPHAN markers (the contract is gone / was never paid: nothing is owed). Written by the sweep and by scripts/orphan-settlement-rows.ts. */
export const ORPHAN_MARKER_PREFIXES = [`${ENDED_UNSETTLED_PREFIX}CONTRACT_MISSING`, `${ENDED_UNSETTLED_PREFIX}NO_PAYMENT`];

/** How many parked / exhausted rows the attention report reads before it ranks them. */
const ATTENTION_CANDIDATES = 1000;

export function isParkedError(lastError: string | null | undefined): boolean {
  return !!lastError && PARKED_PREFIXES.some((p) => lastError.startsWith(p));
}

/** Rows whose lastError is NOT a parked marker (a null lastError counts as not parked). */
const NOT_PARKED: Prisma.SessionSettlementWhereInput = {
  OR: [{ lastError: null }, { AND: PARKED_PREFIXES.map((p) => ({ NOT: { lastError: { startsWith: p } } })) }],
};

/** The session-level money steps an ending must see finished before it snapshots the contract (everything but the ending itself). */
export const SESSION_MONEY_KINDS: SessionSettlementKind[] = [
  SessionSettlementKind.PT_NO_SHOW_COMPENSATION,
  SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION,
  SessionSettlementKind.SESSION_RELEASE,
];

export const sessionSettlementRepository = {
  /**
   * Finds the row for this idempotency key, creating a fresh PENDING one if none exists.
   * Deliberately does NOT reset an existing FAILED/PROCESSING row's status here - the caller
   * (session-settlement.service.ts#settleTracked) claims it right after.
   * Returning the existing row as-is lets the caller check `row.status === "SETTLED"` and skip re-running an
   * already-completed operation.
   *
   * `db` = the contract-locked transaction of the decision this intent belongs to (Phase 0 / D58): the row is written in
   * the SAME transaction as the session claim and the counters, so "decided" and "intent recorded" are one fact.
   */
  upsertPending: (
    input: {
      kind: SessionSettlementKind;
      idempotencyKey: string;
      sessionId: string | null;
      contractId: string;
      reason: string | null;
    },
    db: Db = prisma,
  ) =>
    db.sessionSettlement.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: { ...input, status: SessionSettlementStatus.PENDING },
      update: {}, // no-op write - just fetch the existing row
    }),

  findById: (id: string, db: Db = prisma) => db.sessionSettlement.findUnique({ where: { id } }),

  findByKey: (idempotencyKey: string, db: Db = prisma) => db.sessionSettlement.findUnique({ where: { idempotencyKey } }),

  /** Legacy unconditional "I am working on it" (kept for the DI-based unit tests); real code uses {@link claim}. */
  markProcessing: (id: string) =>
    prisma.sessionSettlement.update({
      where: { id },
      data: { status: SessionSettlementStatus.PROCESSING, attempts: { increment: 1 } },
    }),

  /**
   * Compare-and-set claim of a row for ONE runner (Phase 0 unit 3): PENDING / FAILED / PROCESSING-but-stale ->
   * PROCESSING + one more attempt, decided by the affected-row count, so two instances cannot both start the same row.
   * `takeover` additionally lets a LIVE caller (the request that needs the answer, or an ending that must see the money
   * step done) run a row another runner is processing right now: payment-service is idempotent on the row's key and the
   * result is applied once by {@link settleOnce}, so a duplicate call is harmless - it is only refused for a sweep.
   * A SETTLED row and a PARKED row are never claimed. Returns the claimed row, or null.
   */
  claim: async (id: string, opts: { staleBefore: Date; takeover?: boolean }, db: Db = prisma) => {
    const statusCondition: Prisma.SessionSettlementWhereInput = opts.takeover
      ? { status: { not: SessionSettlementStatus.SETTLED } }
      : {
          OR: [
            { status: { in: [SessionSettlementStatus.PENDING, SessionSettlementStatus.FAILED] } },
            { status: SessionSettlementStatus.PROCESSING, updatedAt: { lt: opts.staleBefore } },
          ],
        };
    const { count } = await db.sessionSettlement.updateMany({
      where: { id, AND: [statusCondition, NOT_PARKED] },
      data: { status: SessionSettlementStatus.PROCESSING, attempts: { increment: 1 } },
    });
    if (count !== 1) return null;
    return db.sessionSettlement.findUnique({ where: { id } });
  },

  /**
   * The apply-once gate: flips the row to SETTLED and says whether THIS call did it. Run it in the SAME transaction as
   * the sub-ledger bookkeeping it guards (releasedTo*, compensatedSessions, the contract status), so the bookkeeping is
   * applied exactly once however many runners / retries / crashes there were: whoever loses the flip applies nothing.
   */
  settleOnce: async (id: string, db: Db): Promise<boolean> => {
    const { count } = await db.sessionSettlement.updateMany({
      where: { id, status: { not: SessionSettlementStatus.SETTLED } },
      data: { status: SessionSettlementStatus.SETTLED, settledAt: new Date(), lastError: null },
    });
    return count === 1;
  },

  /** Legacy single-statement "settled" (DI unit tests) - no bookkeeping gate. Real code uses {@link settleOnce}. */
  markSettled: (id: string) =>
    prisma.sessionSettlement.update({
      where: { id },
      data: { status: SessionSettlementStatus.SETTLED, settledAt: new Date(), lastError: null },
    }),

  /** A failure never overwrites a row somebody else already settled. */
  markFailed: (id: string, error: string) =>
    prisma.sessionSettlement.updateMany({
      where: { id, status: { not: SessionSettlementStatus.SETTLED } },
      data: { status: SessionSettlementStatus.FAILED, lastError: error.slice(0, 2000) },
    }),

  /** Park a row (never delete it): FAILED + a marker prefix the retry queries exclude. Never touches a SETTLED row. */
  park: (id: string, prefix: string, message: string, db: Db = prisma) =>
    db.sessionSettlement.updateMany({
      where: { id, status: { not: SessionSettlementStatus.SETTLED } },
      data: { status: SessionSettlementStatus.FAILED, lastError: `${prefix} ${message}`.slice(0, 2000) },
    }),

  /** The unsettled compensation rows of one contract (what the ending must settle first), oldest first. */
  findUnsettledCompensations: (contractId: string, db: Pick<typeof prisma, "sessionSettlement"> = prisma) =>
    db.sessionSettlement.findMany({
      where: {
        contractId,
        kind: { in: [SessionSettlementKind.PT_NO_SHOW_COMPENSATION, SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION] },
        status: { not: SessionSettlementStatus.SETTLED },
        OR: [{ lastError: null }, { NOT: { lastError: { startsWith: ENDED_UNSETTLED_PREFIX } } }],
      },
      orderBy: { createdAt: "asc" },
    }),

  /**
   * Every unsettled session-level money step of a RUNNING contract (release, no-show / late-arrival compensation),
   * oldest first - parked-for-a-human rows included (they still block an ending: their effect on the ledger is unknown).
   * Only ENDED_UNSETTLED rows (the contract already ended) are left out.
   */
  findUnsettledSessionMoney: (contractId: string, db: Db = prisma) =>
    db.sessionSettlement.findMany({
      where: {
        contractId,
        kind: { in: SESSION_MONEY_KINDS },
        status: { not: SessionSettlementStatus.SETTLED },
        OR: [{ lastError: null }, { NOT: { lastError: { startsWith: ENDED_UNSETTLED_PREFIX } } }],
      },
      orderBy: { createdAt: "asc" },
    }),

  /** The recorded ending of a contract (the key is `CONTRACT_TERMINATE:<id>`, one per contract), if any. */
  findTerminationRow: (contractId: string, db: Db = prisma) =>
    db.sessionSettlement.findUnique({ where: { idempotencyKey: `CONTRACT_TERMINATE:${contractId}` } }),

  /** True while a contract's ending was accepted (recorded) but payment-service has not confirmed it yet. */
  hasUnconfirmedTermination: async (contractId: string, db: Db = prisma): Promise<boolean> => {
    const row = await db.sessionSettlement.findFirst({
      where: { contractId, kind: SessionSettlementKind.CONTRACT_TERMINATION, status: { not: SessionSettlementStatus.SETTLED } },
      select: { id: true },
    });
    return !!row;
  },

  /**
   * Batch form of {@link hasUnconfirmedTermination} for read endpoints: one query, the SAME predicate. Returns the subset of
   * `contractIds` whose ending is recorded but not confirmed (D59). Read-only.
   */
  findContractIdsWithUnconfirmedTermination: async (contractIds: string[], db: Db = prisma): Promise<Set<string>> => {
    if (contractIds.length === 0) return new Set();
    const rows = await db.sessionSettlement.findMany({
      where: { contractId: { in: contractIds }, kind: SessionSettlementKind.CONTRACT_TERMINATION, status: { not: SessionSettlementStatus.SETTLED } },
      select: { contractId: true },
    });
    return new Set(rows.map((r) => r.contractId));
  },

  /**
   * One page of rows the sweep may retry, least recently touched first (D57-5-1: ordered by when a row was last tried,
   * not by when it was born, and paged by `offset` so a pile of unprocessable rows at the front cannot hide the
   * processable ones behind them):
   *   - PENDING  - a process crashed between creating the row and claiming it.
   *   - FAILED   - the underlying payment-service call threw.
   *   - PROCESSING, but stuck past `staleAfterMs` - the process that claimed it crashed mid-call.
   * Parked rows (ENDED_UNSETTLED / NEEDS_RECONCILIATION / CONFLICT) are excluded IN the query.
   */
  findRetryable: (limit: number, staleAfterMs: number, offset = 0) =>
    prisma.sessionSettlement.findMany({
      where: {
        AND: [
          {
            OR: [
              { status: { in: [SessionSettlementStatus.PENDING, SessionSettlementStatus.FAILED] } },
              { status: SessionSettlementStatus.PROCESSING, updatedAt: { lt: new Date(Date.now() - staleAfterMs) } },
            ],
          },
          NOT_PARKED,
        ],
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit,
    }),

  /**
   * Parked / exhausted rows a human has to look at (read-only reporting), MOST URGENT FIRST (D64-C):
   *   1. CONFLICT rows (payment-service's answer disagrees with what was recorded - money may have moved the wrong way),
   *   2. the larger amount at stake (a session-level step: the contract's price / its sessions; an ending: the price),
   *   3. the more failed attempts, 4. the longer it has waited.
   * Terminal ORPHAN rows (ENDED_UNSETTLED:CONTRACT_MISSING / :NO_PAYMENT - nothing owed) are not "attention", whatever their
   * attempt count. Candidates are read oldest-first (bounded), then ranked in memory.
   */
  findNeedingAttention: async (minAttempts: number, limit = 200) => {
    const candidates = await prisma.sessionSettlement.findMany({
      where: {
        status: { not: SessionSettlementStatus.SETTLED },
        AND: [{ OR: [{ lastError: null }, { AND: ORPHAN_MARKER_PREFIXES.map((p) => ({ NOT: { lastError: { startsWith: p } } })) }] }],
        OR: [
          { lastError: { startsWith: NEEDS_RECONCILIATION_PREFIX } },
          { lastError: { startsWith: CONFLICT_PREFIX } },
          { attempts: { gte: minAttempts } },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: Math.max(limit, ATTENTION_CANDIDATES),
    });
    if (candidates.length === 0) return [];
    const contracts = await prisma.contract.findMany({
      where: { id: { in: [...new Set(candidates.map((c) => c.contractId))] } },
      select: { id: true, price: true, totalSessions: true },
    });
    const byId = new Map(contracts.map((c) => [c.id, c]));
    const ranked = candidates.map((row) => {
      const c = byId.get(row.contractId);
      const price = c?.price != null ? Number(c.price) : 0;
      const amountAtStake =
        row.kind === SessionSettlementKind.CONTRACT_TERMINATION ? price : c && c.totalSessions > 0 ? Math.round(price / c.totalSessions) : 0;
      return { ...row, amountAtStake, isConflict: !!row.lastError?.startsWith(CONFLICT_PREFIX) };
    });
    ranked.sort(
      (a, b) =>
        Number(b.isConflict) - Number(a.isConflict) ||
        b.amountAtStake - a.amountAtStake ||
        b.attempts - a.attempts ||
        a.updatedAt.getTime() - b.updatedAt.getTime(),
    );
    return ranked.slice(0, limit);
  },
};
