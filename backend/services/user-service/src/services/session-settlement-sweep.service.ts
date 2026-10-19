import { logger } from "@gym-coach/shared";
import { SessionSettlementKind } from "../generated/prisma";
import {
  ENDED_UNSETTLED_PREFIX,
  NEEDS_RECONCILIATION_PREFIX,
  isParkedRow,
  sessionSettlementRepository,
} from "../repositories/session-settlement.repository";
import { contractRepository } from "../repositories/contract.repository";
import { withContractLock } from "./contract-lock";
import {
  assessSettlementRow,
  isContractEnded,
  runSessionMoneyRow,
  settleContractTermination,
  SettlementInFlightError,
  type TerminationReason,
} from "./contract-payout.service";
import { settlementAttemptLevel, settlementMaxAttempts, staleProcessingMs } from "./session-settlement.service";
import { classifySettlementContract, orphanMarker, parkOrphansEnabled, withPreviousError, type SettlementContractVerdict } from "./settlement-orphan";
import { isShuttingDown, trackJob } from "../lifecycle";

/**
 * Money-flow redesign plan 1.6 - retries whatever `settleTracked` (session-settlement.service.ts)
 * left PENDING, FAILED, or stuck PROCESSING. Mirrors payment-service's reconciliation.service.ts: a module-level `running`
 * guard against overlapping ticks, one failure per row isolated so it cannot stop the rest of the batch, plain interval
 * polling - no message queue needed for this volume.
 *
 * Retrying calls the SAME public functions the original call sites use (compensateNoShowMoney / releaseSessionMoney /
 * settleContractTermination), not some separate "raw" version - each of those re-enters the row by its own idempotency key,
 * and either skips (if something else just settled it) or tries again. There is exactly one implementation of what each
 * kind of settlement does; the sweep is just another caller of it.
 *
 * Phase 0 / D58 (units 1, 3, 5):
 *  - Before a session-level row is run again its PREMISE is checked under the contract lock (assessSettlementRow): a row
 *    whose session the system does not consider delivered / no-show / called off is never paid (the a5 defect of the D57
 *    audit). The lock is held for that check only; the payment-service call is made after it, and the row is claimed with a
 *    compare-and-set (a sweep never starts a row another runner holds).
 *  - Rows are scanned LEAST RECENTLY TRIED FIRST, page by page, with a back-off that grows with the attempt count: a pile of
 *    rows that cannot be processed (orphans of deleted contracts, rows past the attempt cap) can no longer hide the ones that can
 *    (D57-5-1, D62-E). Such rows are PARKED with a reason (never deleted - the history stays) and excluded from the queue;
 *    parked rows still keep an ending refused, because their effect on the ledger is unknown.
 *
 * Phase 0 / D64:
 *  - A: ORPHAN rows are only SKIPPED by default (left exactly as they are, no write); SETTLEMENT_SWEEP_PARK_ORPHANS=true (explicit,
 *    owner-approved per environment) makes the sweep PARK them. What an orphan is is decided in ONE
 *    place, settlement-orphan.ts (shared with scripts/orphan-settlement-rows.ts): the contract no longer exists
 *    (ENDED_UNSETTLED:CONTRACT_MISSING) or was provably never paid (ENDED_UNSETTLED:NO_PAYMENT). The row is kept, never deleted,
 *    never SETTLED, no payment-service call is made for it. A row whose contract EXISTS and has a payment transaction is never an
 *    orphan: one that cannot be priced is NEEDS_RECONCILIATION (visible, an ending stays refused).
 *  - C: thresholds (all env-configurable, see session-settlement.service.ts): an early "[MoneyAttention]" warning from
 *    SETTLEMENT_WARN_ATTEMPTS (8), the cap SETTLEMENT_MAX_ATTEMPTS (12) parks the step NEEDS_RECONCILIATION with an immediate alert.
 *  - Once the process is shutting down no new row is claimed (the one in flight finishes within the grace period).
 */

const INTERVAL_MS = Number(process.env.SESSION_SETTLEMENT_SWEEP_INTERVAL_MS ?? 60 * 1000);
const BATCH_SIZE = 50;
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

/** The first attempts are retried on every tick; after that the wait doubles (from BACKOFF_BASE_MS) up to BACKOFF_MAX_MS. */
const BACKOFF_FREE_ATTEMPTS = 3;
const backoffBaseMs = () => Number(process.env.SETTLEMENT_BACKOFF_BASE_MS ?? 60_000);
const backoffMaxMs = () => Number(process.env.SETTLEMENT_BACKOFF_MAX_MS ?? 60 * 60_000);

export function settlementBackoffMs(attempts: number): number {
  if (attempts <= BACKOFF_FREE_ATTEMPTS) return 0;
  return Math.min(backoffBaseMs() * 2 ** (attempts - BACKOFF_FREE_ATTEMPTS - 1), backoffMaxMs());
}

let running = false;

export function startSessionSettlementSweepJob(): () => void {
  logger.info(`Session settlement sweep started (interval: ${Math.round(INTERVAL_MS / 1000)} s)`);
  const timer = setInterval(() => {
    void trackJob(runSettlementSweep());
  }, INTERVAL_MS);
  return () => clearInterval(timer);
}

interface SweepRow {
  id: string;
  kind: SessionSettlementKind;
  contractId: string;
  sessionId: string | null;
  reason: string | null;
  status?: string;
  attempts?: number;
  updatedAt?: Date;
  lastError?: string | null;
}

/**
 * Rows the sweep may run now: scanned least-recently-tried first, page by page, skipping rows still in their back-off. The
 * scan is bounded (MAX_PAGES x PAGE_SIZE rows), but the BATCH limit applies to the rows actually ATTEMPTED, not to the ones
 * scanned - a pile of rows that turn out to be unprocessable at the front of the queue must not use up the batch.
 */
async function collectDueRows(now: number, deadlineAt?: number): Promise<SweepRow[]> {
  const stale = staleProcessingMs();
  const due: SweepRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    if (deadlineAt && Date.now() >= deadlineAt) break;
    const rows = (await sessionSettlementRepository.findRetryable(PAGE_SIZE, stale, page * PAGE_SIZE)) as SweepRow[];
    for (const row of rows) {
      if (isParkedRow(row)) continue;
      const waited = row.updatedAt ? now - row.updatedAt.getTime() : Number.POSITIVE_INFINITY;
      if (waited < settlementBackoffMs(row.attempts ?? 0)) continue;
      due.push(row);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return due;
}

export async function runSettlementSweep(opts: { deadlineAt?: number } = {}): Promise<{ scanned: number; retried: number }> {
  if (running) {
    logger.info("[SettlementSweep] Previous run still in progress - skipping tick");
    return { scanned: 0, retried: 0 };
  }
  running = true;

  let scanned = 0;
  let retried = 0;
  let skipped = 0;
  let parked = 0;
  try {
    const rows = await collectDueRows(Date.now(), opts.deadlineAt);
    scanned = rows.length;
    if (scanned === 0) return { scanned, retried };

    logger.info(`[SettlementSweep] ${scanned} settlement row(s) to retry`);

    let attempted = 0;
    for (const row of rows) {
      if (attempted >= BATCH_SIZE) break; // the rest waits for the next tick
      if (isShuttingDown()) {
        logger.info("[SettlementSweep] shutting down - no new row is claimed; the rest is left for the next instance");
        break;
      }
      if (opts.deadlineAt && Date.now() >= opts.deadlineAt) {
        logger.warn("[SettlementSweep] deadline reached - the rest is left for the next run");
        break;
      }
      try {
        const verdict = await dispatch(row);
        if (verdict === "RETRIED") {
          retried++;
          attempted++;
        } else if (verdict === "PARKED") parked++;
        else skipped++;
      } catch (err) {
        // Each of the underlying functions is itself best-effort (settleTracked swallows), so reaching here means
        // something OUTSIDE the tracked operation broke - still must not stop the rest of the batch.
        logger.error({
          error: "Settlement retry threw unexpectedly",
          settlementId: row.id,
          kind: row.kind,
          message: (err as Error).message,
        });
      }
    }

    logger.info(`[SettlementSweep] Retried ${retried}/${scanned} row(s)${skipped ? `, left ${skipped}` : ""}${parked ? `, parked ${parked}` : ""}`);
    return { scanned, retried };
  } catch (err) {
    logger.error({ error: "Settlement sweep failed", message: (err as Error).message });
    return { scanned, retried };
  } finally {
    running = false;
  }
}

type Verdict = "RETRIED" | "SKIPPED" | "PARKED";

async function dispatch(row: SweepRow): Promise<Verdict> {
  if (row.kind === SessionSettlementKind.CONTRACT_TERMINATION) return dispatchTermination(row);
  return dispatchSessionRow(row);
}

/** A contract's ending that is recorded but not confirmed: carry it through with the SAME recorded reason, never a recomputed one. */
async function dispatchTermination(row: SweepRow): Promise<Verdict> {
  const contract = await contractRepository.findById(row.contractId);
  const premise = classifySettlementContract(row.contractId, contract);
  if (premise.kind !== "LIVE") return handlePremise(row, premise, row.lastError);
  const reason = (row.reason ?? contract?.terminationReason ?? "COMPLETED") as TerminationReason;
  try {
    await settleContractTermination(row.contractId, reason, undefined, undefined, { takeover: false });
    return "RETRIED";
  } catch (e) {
    if (e instanceof SettlementInFlightError) return "SKIPPED"; // another runner has it
    // CONTRACT_ENDING (payment-service still unreachable) is already logged and recorded on the row by the ending itself.
    if ((e as { code?: string }).code === "CONTRACT_ENDING") return "RETRIED";
    throw e;
  }
}

/** The session-level kinds. The premise is re-checked under the contract lock; the payment-service call is made after it. */
async function dispatchSessionRow(row: SweepRow): Promise<Verdict> {
  const decision = await withContractLock(row.contractId, async (tx) => {
    const fresh = await sessionSettlementRepository.findById(row.id, tx);
    if (!fresh || fresh.status === "SETTLED" || isParkedRow(fresh)) return { kind: "SKIP" as const };

    const contract = await contractRepository.findById(row.contractId, tx);
    // D64-A: orphan / unpriceable / waiting is decided from the contract's facts, under the lock, before anything else.
    const premise = classifySettlementContract(row.contractId, contract);
    if (premise.kind !== "LIVE") return { kind: "PREMISE" as const, verdict: await handlePremise(row, premise, fresh.lastError, tx) };

    if (contract && isContractEnded(contract)) {
      // The row was read BEFORE the lock was won: the ending may have settled it meanwhile (it settles outstanding steps first).
      const isCompensation =
        row.kind === SessionSettlementKind.PT_NO_SHOW_COMPENSATION || row.kind === SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION;
      if (isCompensation) {
        // F4: a compensation still unsettled when its contract ended is NOT paid (the ending priced the session as unused; a
        // late cash compensation would be drawn from the PT's pooled available balance = other contracts' money). It is marked
        // ENDED_UNSETTLED (excluded from retries, visible to a human / the reconciliation report).
        logger.error(`${ENDED_UNSETTLED_PREFIX} contract ${row.contractId} is ${contract.status}; ${row.kind} for session ${row.sessionId} not paid - needs a human`);
        await sessionSettlementRepository.park(row.id, ENDED_UNSETTLED_PREFIX, `contract ${row.contractId} is ${contract.status}; ${row.kind} for session ${row.sessionId} not paid - needs a human`, tx);
        return { kind: "PARKED" as const };
      }
      if (row.kind === SessionSettlementKind.SESSION_RELEASE) {
        // The ending's top-up entitles the PT to every counted session regardless of what was released one by one, and a
        // release called AFTER the ending would move nothing: the step is superseded by the confirmed ending.
        if (!(await sessionSettlementRepository.hasUnconfirmedTermination(row.contractId, tx))) {
          await sessionSettlementRepository.settleOnce(row.id, tx);
          logger.info(`[SettlementSweep] release ${row.id} of ended contract ${row.contractId} closed: superseded by the confirmed ending`);
          return { kind: "SUPERSEDED" as const };
        }
      }
    }

    const verdict = await assessSettlementRow({ ...row, contractId: row.contractId }, tx);
    if (verdict.ok) return { kind: "RUN" as const };
    if ("wait" in verdict) return { kind: "SKIP" as const };
    // (a contract-level orphan is already handled above; any other "never runnable" verdict is parked for a human, not terminal)
    await sessionSettlementRepository.park(row.id, NEEDS_RECONCILIATION_PREFIX, verdict.park, tx);
    logger.error(`[SettlementSweep] ${row.kind} row ${row.id} parked: ${verdict.park}`);
    return { kind: "PARKED" as const };
  });

  switch (decision.kind) {
    case "SKIP":
      return "SKIPPED";
    case "SUPERSEDED":
      return "RETRIED";
    case "PARKED":
      return "PARKED";
    case "PREMISE":
      return decision.verdict;
    case "RUN":
      break;
  }

  // The payment-service call: no lock, no transaction around it; the row is claimed by compare-and-set inside.
  await runSessionMoneyRow(row, { takeover: false });

  // Attempt cap: a step that keeps failing is parked for a human instead of being retried for ever.
  const after = await sessionSettlementRepository.findById(row.id);
  if (after && after.status === "FAILED" && !isParkedRow(after)) {
    const level = settlementAttemptLevel(after.attempts);
    if (level === "CAP") {
      await sessionSettlementRepository.park(
        row.id,
        NEEDS_RECONCILIATION_PREFIX,
        `${after.attempts} failed attempts (cap ${settlementMaxAttempts()}); last error: ${after.lastError ?? "none"}`,
      );
      // The alert is immediate: the step needs a human now (findNeedingAttention lists it, largest amount first).
      logger.error(
        `[MoneyAttention] settlement ${row.id} (${row.kind}, contract ${row.contractId}) needs a human: parked NEEDS_RECONCILIATION after ${after.attempts} failed attempts (cap ${settlementMaxAttempts()}); last error: ${after.lastError ?? "none"}`,
      );
      return "PARKED";
    }
    if (level === "WARN") {
      logger.warn(
        `[MoneyAttention] early warning: settlement ${row.id} (${row.kind}, contract ${row.contractId}) has failed ${after.attempts} times; it will be parked for a human at ${settlementMaxAttempts()}; last error: ${after.lastError ?? "none"}`,
      );
    }
  }
  return "RETRIED";
}

/**
 * D64-A - acts on a contract-level verdict of settlement-orphan.ts for one row. Never deletes, never marks SETTLED, never calls
 * payment-service:
 *   ORPHAN (contract missing / never paid)   -> terminal ENDED_UNSETTLED:<CODE>, the reason and the previous error kept in last_error
 *                                               (only when SETTLEMENT_SWEEP_PARK_ORPHANS=true; by default the row is only skipped, untouched)
 *   NEEDS_RECONCILIATION (paid, unpriceable) -> NEEDS_RECONCILIATION: with the reason; stays visible and keeps an ending refused
 *   WAIT                                     -> left exactly as it is
 * `db` = the contract-locked transaction when the caller has one, so the verdict and the marking are one fact.
 */
async function handlePremise(
  row: SweepRow,
  premise: Exclude<SettlementContractVerdict, { kind: "LIVE" }>,
  previousError: string | null | undefined,
  db?: Parameters<typeof sessionSettlementRepository.park>[3],
): Promise<Verdict> {
  const detailOf = (d: string) => withPreviousError(d, previousError);
  if (premise.kind === "WAIT") return "SKIPPED";
  if (premise.kind === "NEEDS_RECONCILIATION") {
    await sessionSettlementRepository.park(row.id, NEEDS_RECONCILIATION_PREFIX, detailOf(premise.detail), db);
    logger.error(`[MoneyAttention] ${row.kind} row ${row.id} parked NEEDS_RECONCILIATION: ${premise.detail}`);
    return "PARKED";
  }
  if (!parkOrphansEnabled()) return "SKIPPED";
  await sessionSettlementRepository.park(row.id, orphanMarker(premise.code), detailOf(premise.detail), db);
  logger.warn(`[SettlementSweep] ${row.kind} row ${row.id} parked as orphan (${premise.code}): ${premise.detail}`);
  return "PARKED";
}
