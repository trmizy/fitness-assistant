import { Prisma, SessionSettlementKind, SessionSettlementStatus } from "../generated/prisma";
import { prisma } from "./profile.repository";

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * FH-3a - the parked states are REAL statuses now (NEEDS_HUMAN, CONFLICT), no longer a text prefix of last_error that every query
 * had to `startsWith`. The prefix is STILL WRITTEN to last_error (operators / scripts / logs read it, and it carries the message),
 * but no code decides anything from it, with ONE exception that is deliberate: ENDED_UNSETTLED, the terminal orphan label, is kept
 * exactly as it was (status FAILED + prefix) - an orphan is "nothing owed", not a state of the money step, and
 * scripts/orphan-settlement-rows.ts writes it with raw SQL.
 */

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

/**
 * Statuses a row is never claimed / retried in by code: parked for a person (NEEDS_HUMAN), payment-service disagreed (CONFLICT),
 * and UNCONFIRMED (FH-3c / D65-B: payment-service was asked and never performed the step; the ending HOLDS the session's value and
 * only the admin path - resolveUnconfirmedSessionMoney - decides it). They still count as
 * "not SETTLED", so they keep an ending refused exactly as the old FAILED + prefix rows did.
 */
export const PARKED_STATUSES: SessionSettlementStatus[] = [
  SessionSettlementStatus.NEEDS_HUMAN,
  SessionSettlementStatus.CONFLICT,
  SessionSettlementStatus.UNCONFIRMED,
];

/** The status a park() with this prefix puts the row in. ENDED_UNSETTLED (terminal orphan label) stays FAILED + prefix. */
export function parkedStatusFor(prefix: string): SessionSettlementStatus {
  if (prefix === NEEDS_RECONCILIATION_PREFIX) return SessionSettlementStatus.NEEDS_HUMAN;
  if (prefix === CONFLICT_PREFIX) return SessionSettlementStatus.CONFLICT;
  return SessionSettlementStatus.FAILED;
}

/** D64-A - terminal ORPHAN markers (the contract is gone / was never paid: nothing is owed). Written by the sweep and by scripts/orphan-settlement-rows.ts. */
export const ORPHAN_MARKER_PREFIXES = [
  `${ENDED_UNSETTLED_PREFIX}CONTRACT_MISSING`,
  `${ENDED_UNSETTLED_PREFIX}NO_PAYMENT`,
  // FH-3c (D65-B): the row's premise is void - see VOID_PREMISE_PREFIX.
  `${ENDED_UNSETTLED_PREFIX}PREMISE_VOID`,
];

/**
 * FH-3c (D65-B) - terminal label of a row whose PREMISE IS VOID: the session it was recorded for was never delivered / charged /
 * no-show'd (or no longer exists), so nothing is owed. Like every ENDED_UNSETTLED row it is excluded from the retry queries, from
 * the ending's "outstanding" test and from the attention report - and, unlike the others, it GIVES UP its idempotency key (see
 * `sessionSettlementRepository.voidRow`), so a delivery that really happens later can record and pay a fresh row.
 */
export const VOID_PREMISE_PREFIX = `${ENDED_UNSETTLED_PREFIX}PREMISE_VOID:`;

/** How many parked / exhausted rows the attention report reads before it ranks them. */
const ATTENTION_CANDIDATES = 1000;

/** True when the row must not be claimed / retried: a parked status, or the terminal ENDED_UNSETTLED orphan label. */
export function isParkedRow(row: { status?: string | null; lastError?: string | null }): boolean {
  if (row.status && (PARKED_STATUSES as string[]).includes(row.status)) return true;
  return !!row.lastError && row.lastError.startsWith(ENDED_UNSETTLED_PREFIX);
}

/** Rows that are NOT parked: not in a parked status and not carrying the ENDED_UNSETTLED label (a null lastError counts as not parked). */
const NOT_PARKED: Prisma.SessionSettlementWhereInput = {
  status: { notIn: PARKED_STATUSES },
  OR: [{ lastError: null }, { NOT: { lastError: { startsWith: ENDED_UNSETTLED_PREFIX } } }],
};

/** Common fields of an intent row (what upsertPending takes). */
export interface SettlementIntentInput {
  kind: SessionSettlementKind;
  idempotencyKey: string;
  sessionId: string | null;
  contractId: string;
  reason: string | null;
}

/**
 * FH-3a - the immutable request recorded together with the intent: what the money step was decided for, in the system's own
 * terms (never a number a caller supplies). `facts` is whatever the caller knows at the moment it decides (the contract's money
 * state). Only written on CREATE - a retry or a replay never rewrites it.
 */
function buildRequestSnapshot(input: SettlementIntentInput, facts?: Prisma.InputJsonObject): Prisma.InputJsonObject {
  return {
    v: 1,
    kind: input.kind,
    idempotencyKey: input.idempotencyKey,
    sessionId: input.sessionId,
    contractId: input.contractId,
    reason: input.reason,
    recordedAt: new Date().toISOString(),
    ...(facts ? { facts } : {}),
  };
}

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
    input: SettlementIntentInput & {
      /** FH-3a: the money facts known at decision time, stored inside `request_snapshot` (create only). */
      snapshotFacts?: Prisma.InputJsonObject;
    },
    db: Db = prisma,
  ) => {
    const { snapshotFacts, ...row } = input;
    return db.sessionSettlement.upsert({
      where: { idempotencyKey: row.idempotencyKey },
      create: { ...row, status: SessionSettlementStatus.PENDING, requestSnapshot: buildRequestSnapshot(row, snapshotFacts) },
      update: {}, // no-op write - just fetch the existing row
    });
  },

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
   * A SETTLED row and a PARKED row (NEEDS_HUMAN / CONFLICT / UNCONFIRMED status, or the ENDED_UNSETTLED label) are never claimed.
   * Returns the claimed row, or null.
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

  /** A failure never overwrites a row somebody else already settled, nor one that was handed to a person (NEEDS_HUMAN / CONFLICT). */
  markFailed: (id: string, error: string) =>
    prisma.sessionSettlement.updateMany({
      where: { id, status: { notIn: [SessionSettlementStatus.SETTLED, SessionSettlementStatus.NEEDS_HUMAN, SessionSettlementStatus.CONFLICT] } },
      data: { status: SessionSettlementStatus.FAILED, lastError: error.slice(0, 2000) },
    }),

  /**
   * Park a row (never delete it): NEEDS_HUMAN for NEEDS_RECONCILIATION, CONFLICT for CONFLICT (its note in conflict_note too),
   * FAILED + the ENDED_UNSETTLED label for an orphan - and the prefix text is written to last_error in every case. The retry
   * queries exclude the row by status (or the orphan label). Never touches a SETTLED row.
   */
  park: (id: string, prefix: string, message: string, db: Db = prisma) => {
    const lastError = `${prefix} ${message}`.slice(0, 2000);
    const status = parkedStatusFor(prefix);
    return db.sessionSettlement.updateMany({
      where: { id, status: { not: SessionSettlementStatus.SETTLED } },
      data: { status, lastError, ...(status === SessionSettlementStatus.CONFLICT ? { conflictNote: lastError } : {}) },
    });
  },

  /**
   * FH-3c (D65-B) - the row's PREMISE IS VOID (its session was never delivered / charged / no-show'd, or is gone): nothing is owed.
   * The row is KEPT as history in the terminal `ENDED_UNSETTLED:PREMISE_VOID:` state (excluded from every retry / outstanding /
   * attention query) and GIVES UP its idempotency key by renaming it, so the key is free again: a session that IS delivered later
   * records a fresh row and is paid, instead of being silently parked behind this one (the D64-B "key poisoning" gap). The new key
   * carries the row id, so it stays unique. Never touches a SETTLED row. Returns whether this call voided it.
   */
  voidRow: async (id: string, message: string, db: Db = prisma): Promise<boolean> => {
    const row = await db.sessionSettlement.findUnique({ where: { id } });
    if (!row || row.status === SessionSettlementStatus.SETTLED || row.idempotencyKey.includes("#VOID:")) return false;
    const { count } = await db.sessionSettlement.updateMany({
      where: { id, idempotencyKey: row.idempotencyKey, status: { not: SessionSettlementStatus.SETTLED } },
      data: {
        status: SessionSettlementStatus.FAILED,
        idempotencyKey: `${row.idempotencyKey}#VOID:${row.id}`,
        lastError: `${VOID_PREMISE_PREFIX} ${message}`.slice(0, 2000),
      },
    });
    return count === 1;
  },

  /**
   * FH-3c (D65-B) - the HOLD decision: UNCONFIRMED = "payment-service was asked and has NOT performed this step; the ending holds the
   * session's value instead". A compare-and-set on the status the decision was taken for - never PROCESSING (a runner has the row
   * and may be executing it right now), never SETTLED / CONFLICT. Runs in the same transaction that records the ending, so
   * "an UNCONFIRMED row exists" implies "an ending is recorded". Returns whether the row is now UNCONFIRMED.
   */
  holdUnconfirmed: async (id: string, note: string, db: Db): Promise<boolean> => {
    const { count } = await db.sessionSettlement.updateMany({
      where: {
        id,
        status: {
          in: [
            SessionSettlementStatus.PENDING,
            SessionSettlementStatus.FAILED,
            SessionSettlementStatus.NEEDS_HUMAN,
            SessionSettlementStatus.UNCONFIRMED,
          ],
        },
      },
      data: { status: SessionSettlementStatus.UNCONFIRMED, lastError: `UNCONFIRMED: ${note}`.slice(0, 2000) },
    });
    return count === 1;
  },

  /** FH-3c: the UNCONFIRMED (held) session rows of a contract, oldest first. */
  findHeldSessionRows: (contractId: string, db: Db = prisma) =>
    db.sessionSettlement.findMany({
      where: { contractId, kind: { in: SESSION_MONEY_KINDS }, status: SessionSettlementStatus.UNCONFIRMED },
      orderBy: { createdAt: "asc" },
    }),

  /**
   * D77: late-arrival rows an earlier ending parked UNCONFIRMED (they hold no session value and, before the record-only obligation
   * existed, were simply left there). The settlement sweep turns each into an OPEN obligation (or applies its stored result).
   */
  findHeldLateArrivalRows: (limit = 20, db: Db = prisma) =>
    db.sessionSettlement.findMany({
      where: { kind: SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION, status: SessionSettlementStatus.UNCONFIRMED },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.max(1, Math.floor(limit)),
    }),

  /**
   * Compensation rows an earlier build parked as ENDED_UNSETTLED ("contract X is COMPLETED; ... not paid - needs a human") because their
   * contract had ended before they settled. They are NOT orphans (the contract exists and is paid): the sweep turns each into an OPEN
   * obligation, or applies its stored result. The orphan markers (CONTRACT_MISSING / NO_PAYMENT / PREMISE_VOID) have no space after the colon.
   */
  findEndedUnsettledCompensations: (limit = 20, db: Db = prisma) =>
    db.sessionSettlement.findMany({
      where: {
        kind: { in: [SessionSettlementKind.PT_NO_SHOW_COMPENSATION, SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION] },
        status: SessionSettlementStatus.FAILED,
        lastError: { startsWith: `${ENDED_UNSETTLED_PREFIX} contract ` },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.max(1, Math.floor(limit)),
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
  findUnsettledSessionMoney: (contractId: string, db: Db = prisma, opts: { excludeHeld?: boolean } = {}) =>
    db.sessionSettlement.findMany({
      where: {
        contractId,
        kind: { in: SESSION_MONEY_KINDS },
        // FH-3c: with D65-B on, an UNCONFIRMED row is a session whose value the ending HOLDS (the ledger was asked and had not done
        // it): it no longer keeps the ending refused. With the flag off (old behaviour) it blocks like any parked row.
        status: opts.excludeHeld
          ? { notIn: [SessionSettlementStatus.SETTLED, SessionSettlementStatus.UNCONFIRMED] }
          : { not: SessionSettlementStatus.SETTLED },
        OR: [{ lastError: null }, { NOT: { lastError: { startsWith: ENDED_UNSETTLED_PREFIX } } }],
      },
      orderBy: { createdAt: "asc" },
    }),

  /** The recorded ending of a contract (the key is `CONTRACT_TERMINATE:<id>`, one per contract), if any. */
  findTerminationRow: (contractId: string, db: Db = prisma) =>
    db.sessionSettlement.findUnique({ where: { idempotencyKey: `CONTRACT_TERMINATE:${contractId}` } }),

  /**
   * FH-3b (DQ-8) - the detection query for the future admin / reconciliation report (no route yet): every PAID contract that
   * has ENDED (COMPLETED / EXPIRED / CANCELLED) and whose CONTRACT_TERMINATION row is missing or not SETTLED. A contract status
   * of COMPLETED is NOT proof that the money moved - only a SETTLED termination row (written in the transaction that applies
   * payment-service's confirmed answer) is. `hasIntent` = false is the old crash window (status written, intent never
   * recorded); true = the sweep is still carrying it (look at `settlementStatus` / `attempts`). `minAgeMs` leaves out the
   * endings that were written a moment ago and are simply in flight. Read-only; oldest first.
   */
  findEndedPaidWithoutSettledTermination: async (opts: { minAgeMs?: number; limit?: number } = {}, db: Db = prisma) => {
    const rows = await db.$queryRaw<
      Array<{
        contract_id: string;
        contract_status: string;
        termination_reason: string | null;
        ended_at: Date;
        settlement_id: string | null;
        settlement_status: string | null;
        attempts: number | null;
        last_error: string | null;
      }>
    >`
      SELECT c.id AS contract_id, c.status::text AS contract_status, c.termination_reason::text AS termination_reason,
             c.updated_at AS ended_at, s.id AS settlement_id, s.status::text AS settlement_status, s.attempts, s.last_error
        FROM contracts c
        LEFT JOIN session_settlements s ON s.idempotency_key = 'CONTRACT_TERMINATE:' || c.id
       WHERE c.status IN ('COMPLETED', 'EXPIRED', 'CANCELLED')
         AND c.payment_transaction_id IS NOT NULL AND c.price IS NOT NULL AND c.total_sessions > 0
         AND (s.id IS NULL OR s.status <> 'SETTLED')
         AND c.updated_at <= now() - (${Math.max(0, Math.floor(opts.minAgeMs ?? 0))} * interval '1 millisecond')
       ORDER BY c.updated_at ASC, c.id ASC
       LIMIT ${Math.max(1, Math.floor(opts.limit ?? 200))}`;
    return rows.map((r) => ({
      contractId: r.contract_id,
      contractStatus: r.contract_status,
      terminationReason: r.termination_reason,
      endedAt: r.ended_at,
      hasIntent: r.settlement_id !== null,
      settlementStatus: r.settlement_status,
      attempts: r.attempts,
      lastError: r.last_error,
    }));
  },

  /**
   * FH-4 (read-only report): CONTRACT_TERMINATION rows recorded at least `minAgeMs` ago that are still not SETTLED - the ending
   * was accepted but payment-service's answer was never applied. Terminal ORPHAN rows (nothing owed) are left out. Oldest first.
   */
  findUnconfirmedTerminations: (opts: { minAgeMs?: number; limit?: number } = {}, db: Db = prisma) =>
    db.sessionSettlement.findMany({
      where: {
        kind: SessionSettlementKind.CONTRACT_TERMINATION,
        status: { not: SessionSettlementStatus.SETTLED },
        createdAt: { lte: new Date(Date.now() - Math.max(0, Math.floor(opts.minAgeMs ?? 0))) },
        AND: [{ OR: [{ lastError: null }, { AND: ORPHAN_MARKER_PREFIXES.map((p) => ({ NOT: { lastError: { startsWith: p } } })) }] }],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.max(1, Math.floor(opts.limit ?? 200)),
    }),

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
   * Parked rows (NEEDS_HUMAN / CONFLICT / UNCONFIRMED status, the ENDED_UNSETTLED label) are excluded IN the query.
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
  findNeedingAttention: async (minAttempts: number, limit = 200, opts: { stuckProcessingBefore?: Date } = {}) => {
    const candidates = await prisma.sessionSettlement.findMany({
      where: {
        status: { not: SessionSettlementStatus.SETTLED },
        AND: [{ OR: [{ lastError: null }, { AND: ORPHAN_MARKER_PREFIXES.map((p) => ({ NOT: { lastError: { startsWith: p } } })) }] }],
        OR: [
          { status: { in: [SessionSettlementStatus.NEEDS_HUMAN, SessionSettlementStatus.CONFLICT, SessionSettlementStatus.UNCONFIRMED] } },
          { attempts: { gte: minAttempts } },
          // FH-4: a row a runner claimed and never finished (only the admin report passes this; the retry paths do not).
          ...(opts.stuckProcessingBefore
            ? [{ status: SessionSettlementStatus.PROCESSING, updatedAt: { lt: opts.stuckProcessingBefore } } as Prisma.SessionSettlementWhereInput]
            : []),
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
      return { ...row, amountAtStake, isConflict: row.status === SessionSettlementStatus.CONFLICT };
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
