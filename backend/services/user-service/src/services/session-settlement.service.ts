import { logger } from "@gym-coach/shared";
import { Prisma, SessionSettlementKind } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import {
  CONFLICT_PREFIX,
  NEEDS_RECONCILIATION_PREFIX,
  isParkedRow,
  sessionSettlementRepository,
} from "../repositories/session-settlement.repository";
import { ledgerRefusalOf } from "./session-settlement-answers";

/**
 * Money-flow redesign plan 1.6 - "trạng thái buổi tập và trạng thái tiền phải tách nhau".
 *
 * A session's business status (NO_SHOW, CANCELLED, COMPLETED, ...) commits independently of
 * whether the money for it has actually moved. `settleTracked` is the one place that gap closes: it
 * records the attempt, runs the actual payment-service call, and on failure records FAILED instead of
 * throwing - the caller's business-status transition is never blocked or rolled back by a money-side
 * failure. `session-settlement-sweep.service.ts` retries PENDING/FAILED/stale-PROCESSING rows later,
 * using the exact same idempotency key payment-service de-duplicates on.
 *
 * Phase 0 / D58 (atomicity + apply-once):
 *  - The INTENT row is normally created by the decision itself, in the decision's own contract-locked transaction
 *    (recordSessionMoneyIntent in contract-payout.service.ts), so "decided" and "money owed" are one fact. This
 *    function then only EXECUTES it, outside any lock.
 *  - The row is CLAIMED with a compare-and-set (PENDING / FAILED / stale PROCESSING -> PROCESSING), so a sweep and
 *    a live request, or two instances, do not both start it. A live caller may take over a row a runner holds
 *    (`takeover`): payment-service is idempotent on the key, so the second call replays.
 *  - The sub-ledger bookkeeping of a result (`apply`: releasedTo*, compensatedSessions) runs in the SAME transaction
 *    that flips the row to SETTLED, behind that flip: it is applied exactly once however many times the ledger call
 *    is repeated, and a crash between "ledger answered" and "bookkeeping" simply repeats the (idempotent) call.
 *  - A row is never SETTLED without a valid payment-service confirmation (`validate`).
 */

export interface SettlementRow {
  id: string;
  status: string;
}

export interface ClaimResult {
  claimed: boolean;
  /** When not claimed: the row's status right now, and whether it is parked for a human. */
  status?: string;
  parked?: boolean;
}

export interface SettlementDeps {
  upsertPending: (input: {
    kind: SessionSettlementKind;
    idempotencyKey: string;
    sessionId: string | null;
    contractId: string;
    reason: string | null;
  }) => Promise<SettlementRow>;
  markProcessing: (id: string) => Promise<unknown>;
  markSettled: (id: string) => Promise<unknown>;
  markFailed: (id: string, error: string) => Promise<unknown>;
  /** Compare-and-set claim (Phase 0). Absent (DI unit tests): markProcessing is used. */
  claim?: (id: string, takeover: boolean) => Promise<ClaimResult>;
  /** Park the row for a person (CONFLICT / NEEDS_HUMAN). Absent (DI unit tests): markFailed is used. */
  park?: (id: string, prefix: string, message: string) => Promise<unknown>;
  /**
   * Flip the row to SETTLED and run `apply` in the same transaction, behind the flip. Absent: markSettled only.
   * `result`, when given, is payment-service's confirmed answer and is stored on the row in that same transaction
   * (PT-fault compensations only: it is what the "was the client refunded in full?" view reads, see session-refund-state.ts).
   */
  settleWith?: (id: string, apply: (tx: Prisma.TransactionClient) => Promise<void>, result?: unknown) => Promise<boolean>;
}

/** A row stuck PROCESSING longer than this almost certainly means the runner crashed mid-call (read at call time). */
export function staleProcessingMs(): number {
  const raw = process.env.SESSION_SETTLEMENT_STALE_PROCESSING_MS;
  // The longest legitimate runner holds a row for one payment-service call (<= 20 s) plus a few queries, so 2 minutes
  // (was 10) is already far past "still in flight" - and an ending is blocked (CONTRACT_ENDING) until it is settled.
  if (raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) && Number(raw) >= 0) return Number(raw);
  return 2 * 60 * 1000;
}

// ── attempt thresholds (D64-C) ──────────────────────────────────────────────────────────────────────────────────────
// Starting values, all read at call time from the environment (an invalid / missing value falls back to the default):
//   SETTLEMENT_WARN_ATTEMPTS  default 8   early warning "[MoneyAttention] ... early warning" from this failed attempt on, BEFORE the cap
//   SETTLEMENT_MAX_ATTEMPTS   default 12  the cap: a session-level step is parked NEEDS_RECONCILIATION (a human) with an immediate
//                                         "[MoneyAttention] ... needs a human" alert; an ending keeps being retried (idempotent) but
//                                         alerts on every attempt from here on
// The warning is always strictly below the cap (and absent when the cap is 1). With the default 60 s tick and the 60 s -> 1 h
// back-off (session-settlement-sweep.service.ts), the 8th failed attempt comes about 20 minutes after the first and the 12th about
// 3 hours after it - a person is told roughly 2.5 hours before the step is parked.
function intFromEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

export const settlementMaxAttempts = (): number => intFromEnv("SETTLEMENT_MAX_ATTEMPTS", 12, 1);
export const settlementWarnAttempts = (): number => {
  const cap = settlementMaxAttempts();
  return Math.min(intFromEnv("SETTLEMENT_WARN_ATTEMPTS", 8, 1), cap - 1);
};

/** Where a row with `attempts` failed attempts stands: nothing yet / early warning / at or past the cap. */
export function settlementAttemptLevel(attempts: number): "OK" | "WARN" | "CAP" {
  if (attempts >= settlementMaxAttempts()) return "CAP";
  const warn = settlementWarnAttempts();
  return warn >= 1 && attempts >= warn ? "WARN" : "OK";
}

const defaultSettlementDeps: SettlementDeps = {
  upsertPending: (input) => sessionSettlementRepository.upsertPending(input),
  markProcessing: (id) => sessionSettlementRepository.markProcessing(id),
  markSettled: (id) => sessionSettlementRepository.markSettled(id),
  markFailed: (id, error) => sessionSettlementRepository.markFailed(id, error),
  claim: async (id, takeover) => {
    const row = await sessionSettlementRepository.claim(id, { staleBefore: new Date(Date.now() - staleProcessingMs()), takeover });
    if (row) return { claimed: true };
    const cur = await sessionSettlementRepository.findById(id);
    return { claimed: false, status: cur?.status, parked: !!cur && isParkedRow(cur) };
  },
  park: (id, prefix, message) => sessionSettlementRepository.park(id, prefix, message),
  settleWith: (id, apply, result) =>
    prisma.$transaction(async (tx) => {
      const flipped = await sessionSettlementRepository.settleOnce(id, tx);
      if (!flipped) return false; // somebody else settled (and applied) it first
      await apply(tx);
      if (result !== undefined && result !== null && typeof result === "object") {
        await tx.sessionSettlement.update({ where: { id }, data: { result: result as Prisma.InputJsonValue, appliedAt: new Date() } });
      }
      return true;
    }),
};

/** The session-level steps that pay the client for a PT fault: their answer carries owed / paid / unpaid. */
const PT_FAULT_KINDS: SessionSettlementKind[] = [SessionSettlementKind.PT_NO_SHOW_COMPENSATION, SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION];

export interface SettleTrackedParams {
  kind: SessionSettlementKind;
  idempotencyKey: string;
  contractId: string;
  sessionId?: string | null;
  reason?: string | null;
}

export interface SettleTrackedOptions<R> {
  /** payment-service's answer -> an error text when it is NOT a valid confirmation (the row then stays FAILED, nothing is applied). */
  validate?: (result: R) => string | null;
  /**
   * FH-3: a MALFORMED answer (the figures contradict each other, e.g. paid > owed). Unlike `validate` it is not retried - a replay
   * of the same operation returns the same stored answer - and nothing is applied: the row is parked NEEDS_HUMAN with an alert.
   */
  validateFatal?: (result: R) => string | null;
  /** The sub-ledger bookkeeping of the answer; runs in the transaction that flips the row to SETTLED (apply-once). */
  apply?: (tx: Prisma.TransactionClient, result: R) => Promise<void>;
  /** A live caller may run a row another runner is processing (default true). The settlement sweep passes false. */
  takeover?: boolean;
}

export type SettleOutcome<R> =
  /** `applied` is false when another runner flipped the row (and applied the bookkeeping) first. */
  | { state: "SETTLED"; applied: boolean; result: R }
  | { state: "ALREADY_SETTLED" }
  /** Another runner holds the row right now (only a sweep, or a caller that chose not to take over, sees this). */
  | { state: "IN_FLIGHT" }
  /**
   * The row is parked for a human (NEEDS_RECONCILIATION / CONFLICT / ENDED_UNSETTLED). `cause` is set when THIS call parked it:
   * LEDGER_REFUSAL = payment-service refused it (409 IDEMPOTENCY_KEY_CONFLICT / 422 REQUEST_DOES_NOT_MATCH_TRANSACTION, CONFLICT),
   * MALFORMED_ANSWER = it answered with figures that contradict each other (NEEDS_HUMAN). Nothing was applied.
   */
  | { state: "PARKED"; cause?: "LEDGER_REFUSAL" | "MALFORMED_ANSWER" }
  | { state: "FAILED"; error: string };

/**
 * Runs `run` under retry tracking. Never throws - a failure is recorded on the row (visible to the sweep and to anyone
 * querying `session_settlements`) rather than propagated, because by the time most callers reach this point their own
 * business-status change has already committed and cannot be meaningfully rolled back by surfacing an error here.
 */
export async function settleTracked<R = void>(
  params: SettleTrackedParams,
  run: () => Promise<R>,
  deps: SettlementDeps = defaultSettlementDeps,
  opts: SettleTrackedOptions<R> = {},
): Promise<SettleOutcome<R>> {
  const row = await deps.upsertPending({
    kind: params.kind,
    idempotencyKey: params.idempotencyKey,
    sessionId: params.sessionId ?? null,
    contractId: params.contractId,
    reason: params.reason ?? null,
  });

  // Already done - a caller re-entering the same high-level operation (a retried HTTP
  // request, or the sweep picking up a row a live caller just finished) must not run it again.
  if (row.status === "SETTLED") return { state: "ALREADY_SETTLED" };

  if (deps.claim) {
    const claim = await deps.claim(row.id, opts.takeover ?? true);
    if (!claim.claimed) {
      if (claim.status === "SETTLED") return { state: "ALREADY_SETTLED" };
      return claim.parked ? { state: "PARKED" } : { state: "IN_FLIGHT" };
    }
  } else {
    await deps.markProcessing(row.id);
  }

  try {
    const result = await run();
    const invalid = opts.validate?.(result) ?? null;
    if (invalid) throw new Error(`UNCONFIRMED: ${invalid}`);
    const malformed = opts.validateFatal?.(result) ?? null;
    if (malformed) {
      await parkRow(deps, row.id, NEEDS_RECONCILIATION_PREFIX, `malformed payment-service answer: ${malformed}`);
      logger.error({
        error: "[MoneyAttention] payment-service answered with figures that contradict each other - parked for a human, nothing applied",
        kind: params.kind,
        idempotencyKey: params.idempotencyKey,
        contractId: params.contractId,
        sessionId: params.sessionId,
        malformed,
      });
      return { state: "PARKED", cause: "MALFORMED_ANSWER" };
    }
    let applied = true;
    if (deps.settleWith) {
      applied = await deps.settleWith(
        row.id,
        async (tx) => {
          if (opts.apply) await opts.apply(tx, result);
        },
        // The answer of a PT-fault compensation is kept with the row (the refund-state view reads it); a release's answer is not.
        PT_FAULT_KINDS.includes(params.kind) ? result : undefined,
      );
    } else {
      await deps.markSettled(row.id);
    }
    return { state: "SETTLED", applied, result };
  } catch (e) {
    const refusal = ledgerRefusalOf(e);
    if (refusal) {
      // FH-2b: payment-service refused BEFORE writing anything (the key was used for a different request / the request does not
      // match the payment transaction). Retrying produces the same refusal: park CONFLICT for a human, never retry.
      await parkRow(deps, row.id, CONFLICT_PREFIX, `payment-service refused this request (${refusal.code}): ${refusal.message}`);
      logger.error({
        error: `[MoneyAttention] payment-service refused the request (${refusal.code}) - parked CONFLICT, will not be retried`,
        kind: params.kind,
        idempotencyKey: params.idempotencyKey,
        contractId: params.contractId,
        sessionId: params.sessionId,
        message: refusal.message,
      });
      return { state: "PARKED", cause: "LEDGER_REFUSAL" };
    }
    const message = (e as Error).message;
    await deps.markFailed(row.id, message);
    logger.error({
      error: "Financial settlement failed - recorded for retry",
      kind: params.kind,
      idempotencyKey: params.idempotencyKey,
      contractId: params.contractId,
      sessionId: params.sessionId,
      message,
    });
    return { state: "FAILED", error: message };
  }
}

/** Parks through the dependency when it has one; the DI unit-test deps fall back to a recorded failure. */
async function parkRow(deps: SettlementDeps, id: string, prefix: string, message: string): Promise<void> {
  if (deps.park) await deps.park(id, prefix, message);
  else await deps.markFailed(id, `${prefix} ${message}`);
}
