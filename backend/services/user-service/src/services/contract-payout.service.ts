import { logger } from "@gym-coach/shared";
import { Prisma, ContractStatus, SessionSettlementKind, SessionStatus } from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { settleTracked, settlementAttemptLevel, staleProcessingMs } from "./session-settlement.service";
import { callOffOpenSessions, holdUnansweredNoShowReports, sessionCallOffReasonFor } from "./contract-session-closure";
import { SYSTEM_ACTOR } from "./audit.service";
import {
  withContractLock,
  codedError,
  contractEndingError,
  SESSION_SETTLEMENT_PENDING,
  CONTRACT_ENDING_CONFLICT,
} from "./contract-lock";
import {
  CONFLICT_PREFIX,
  NEEDS_RECONCILIATION_PREFIX,
  isParkedError,
  sessionSettlementRepository,
} from "../repositories/session-settlement.repository";
import { closeContractEpisodeOnContractEnd } from "./pt-restriction.service";

/** Every termination reason ends the contract in exactly one of these two final states. */
function statusFor(reason: string): ContractStatus {
  if (reason === "COMPLETED") return ContractStatus.COMPLETED;
  if (reason === "EXPIRED") return ContractStatus.EXPIRED;
  return ContractStatus.CANCELLED; // CLIENT_CANCELLED, PT_CANCELLED, PT_BANNED, MUTUAL, PT_REPEATED_NO_SHOW, CLIENT_EXIT_DUE_TO_PT_RESTRICTION
}

/**
 * Tells payment-service to move a contract's money when a session's outcome is settled.
 *
 * user-service owns the contract; payment-service owns the ledger. Nothing here computes an
 * amount - it passes the contract's frozen rate table across and records what came back, so
 * there is exactly one implementation of the formulas in the system.
 *
 * ── Phase 0 / D58-D59 shape of every money step ─────────────────────────────────────────────────────────────────────
 *  1. DECIDE (short transaction under the contract lock): the session's status CAS, the contract counters and the
 *     settlement INTENT row (`session_settlements`, key = the key payment-service de-duplicates on) commit together or
 *     not at all. Nothing is written through another connection while that decision can still roll back.
 *  2. EXECUTE (no lock, no transaction): the payment-service call, idempotent on the intent's key.
 *  3. APPLY (short transaction): the row flips to SETTLED and the sub-ledger bookkeeping (releasedTo*,
 *     compensatedSessions) is added in the SAME transaction, behind that flip - exactly once however often step 2
 *     ran. A row is never SETTLED on an unconfirmed answer.
 * A crash anywhere after step 1 leaves a durable intent that the next caller, an ending (which first settles every
 * outstanding step) or the settlement sweep repeats with the same key.
 */

type ContractRow = NonNullable<Awaited<ReturnType<typeof contractRepository.findById>>>;
type Tx = Prisma.TransactionClient;

function ratesOf(c: ContractRow) {
  return {
    platformRate: c.platformRate.toString(),
    ptRate: c.ptRate.toString(),
    gymRate: c.gymRate.toString(),
  };
}

/**
 * The PT holdback rate to send payment-service for this contract - and NOTHING when there is none.
 *
 * The contract's own snapshot (ptHoldbackRate), or 0 once the holdback has been released for
 * inactivity: from then on the contract carries on without one. The key is left off the request
 * entirely at rate 0, not sent as "0", so for every contract that exists today the bodies
 * user-service sends are byte-for-byte what they were before the holdback existed (pinned by
 * contract-holdback.test.ts).
 */
export function holdbackArgOf(c: ContractRow): { ptHoldbackRate?: string } {
  if (c.holdbackReleasedAt || c.ptHoldbackRate == null) return {};
  const rate = new Prisma.Decimal(c.ptHoldbackRate);
  return rate.greaterThan(0) ? { ptHoldbackRate: rate.toString() } : {};
}

function partiesOf(c: ContractRow) {
  return { ptUserId: c.ptUserId, gymId: c.gymId, clientUserId: c.clientUserId };
}

/**
 * A contract only has money to move if it was actually paid for through a gateway.
 *
 * Contracts signed before the direct-payment redesign, and any still awaiting payment, have
 * no transaction to hang ledger entries off. Skipping them is correct rather than a silent
 * failure: there is no escrow balance behind them to release.
 */
function payableOrNull(c: ContractRow | null): ContractRow | null {
  if (!c) return null;
  if (!c.paymentTransactionId) return null;
  if (c.price == null || c.totalSessions <= 0) return null;
  return c;
}

/** How a settlement runner behaves. Live callers take a row over; the sweep never starts a row someone else is running. */
export interface SettleMode {
  takeover?: boolean;
}

// ── sessions left unresolved when a contract ends (slice 4 for the restricted-PT exit; F2 / D45-L3 for EVERY ending) ──

/**
 * Sessions that are NOT called off when a contract ends, for ANY reason: the PT reported them delivered and the
 * client has not answered (PENDING_CLIENT_CONFIRMATION), or the client disputed them (DISPUTED). Their value is
 * neither refunded nor released at termination - payment-service holds it (the existing `unresolvedSessions`
 * mechanism, no second hold) - and it is settled (resolveUnresolvedSessionMoney) when the session is decided by the
 * existing confirm / dispute / auto-confirm / admin-ruling paths, exactly once.
 */
export const UNRESOLVED_SESSION_STATUSES: SessionStatus[] = [
  SessionStatus.PENDING_CLIENT_CONFIRMATION,
  SessionStatus.DISPUTED,
  // Decision A (D52): the client's "the PT never came" report that the PT has not answered. The ending turns it into a
  // DISPUTED session (holdUnansweredNoShowReports) before it counts, so the preview and the real ending agree.
  SessionStatus.PT_NO_SHOW_REPORTED,
];

/**
 * How many sessions of the contract have their money held right now. THE one count: the terminate call
 * (completeContractTermination) and the refund preview both send exactly this, so they cannot drift.
 * A session whose quota was already claimed (`sessionDeducted`) is being confirmed this very moment and is
 * counted as used, not held.
 */
export async function countUnresolvedSessions(contractId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
  return db.session.count({ where: { contractId, status: { in: UNRESOLVED_SESSION_STATUSES }, sessionDeducted: false } });
}

/**
 * An ended contract (design B3 - derived, no marker column). Every session such a contract still has awaiting
 * confirmation / disputed was counted as HELD by the ending (the ending's snapshot is taken while every money step is
 * blocked, see beginContractTermination), so a decision on one is settled against that hold. A contract that ended
 * BEFORE holds existed (legacy) has none: payment-service answers 409 NO_UNRESOLVED_HELD and
 * resolveUnresolvedSessionMoney treats that as "nothing to move" - the ending already settled everything.
 */
export function isContractEnded(c: { status: ContractStatus }): boolean {
  return FINAL_CONTRACT_STATUSES.includes(c.status);
}

/**
 * The terms of one termination: the reason payment-service prices it with and how many sessions' value it must
 * HOLD instead of refunding. THE one place both the real termination (completeContractTermination) and the
 * refund preview (moneyBreakdown, via previewClientExit) get them from, so the preview cannot quote terms the
 * execution would not send.
 */
export interface TerminationTerms {
  reason: TerminationReason;
  unresolvedSessions: number;
}

export async function terminationTermsFor(
  contractId: string,
  reason: TerminationReason,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<TerminationTerms> {
  // D45 / L3: EVERY reason holds the value of sessions awaiting confirmation / disputed (it used to be only the
  // restricted-PT exit; every other ending split a disputed session's value between PT / gym / platform / client).
  const counted = await countUnresolvedSessions(contractId, db);
  if (counted === 0) return { reason, unresolvedSessions: 0 };
  // payment-service refuses used + compensated + held > total. Never let a data glitch block a refund: hold at most
  // what the contract can still owe (the surplus session, if any, is then simply not held - and logged).
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { totalSessions: true, usedSessions: true, compensatedSessions: true } });
  const room = c ? Math.max(0, c.totalSessions - c.usedSessions - c.compensatedSessions) : counted;
  if (counted > room) logger.warn(`[ContractPayout] ${contractId}: ${counted} sessions await a decision but only ${room} are still owed - holding ${room}`);
  return { reason, unresolvedSessions: Math.min(counted, room) };
}

/** The request-body fragment for the held sessions: absent (not 0) when there are none. */
export function unresolvedArg(terms: Pick<TerminationTerms, "unresolvedSessions">): { unresolvedSessions?: number } {
  return terms.unresolvedSessions > 0 ? { unresolvedSessions: terms.unresolvedSessions } : {};
}

export type UnresolvedOutcome = "DELIVERED" | "NOT_DELIVERED";

// ── validity of payment-service's answers: a row is SETTLED only on a valid confirmation ─────────────────────────────

const isMoney = (v: unknown) => v !== undefined && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0;

/** What a release answer must look like. An all-zero release is NOT a confirmation: the session's value went somewhere else (or nowhere). */
function invalidRelease(r: any): string | null {
  const rel = r?.released;
  if (!rel) return "payment-service did not report what it released";
  if (![rel.pt, rel.gym, rel.platform].every(isMoney)) return "payment-service reported an invalid released amount";
  if ([rel.pt, rel.gym, rel.platform].every((v) => Number(v) === 0)) {
    return "payment-service released nothing for this session (ESCROW_EMPTY) - the money is not where the contract says it is";
  }
  return null;
}

function invalidCompensation(r: any): string | null {
  if (!r || typeof r !== "object") return "payment-service did not answer with a compensation result";
  if (!isMoney(r.compensation)) return "payment-service did not report the compensation it paid";
  return null;
}

function invalidLateArrival(r: any): string | null {
  if (!r || typeof r !== "object") return "payment-service did not answer with a late-arrival result";
  return null;
}

/** A definite "nothing is held for this session" answer of resolve-unresolved-session (not a failure, nothing to move). */
type ResolveAnswer = { nothingHeld: true } | { nothingHeld?: false; moved?: { pt?: unknown; gym?: unknown; platform?: unknown } };

// ── intents: written by the DECISION, in its own transaction ────────────────────────────────────────────────────────

/**
 * Records the money intent of a session decision INSIDE the decision's contract-locked transaction `tx` (the same one
 * that carries the session's status CAS and the contract counters): the decision and the obligation commit together.
 * A contract that has no money behind it (never paid) records nothing. Idempotent per key.
 */
async function recordIntent(
  tx: Tx,
  contractId: string,
  spec: { kind: SessionSettlementKind; idempotencyKey: string; sessionId: string; reason?: string | null },
): Promise<void> {
  const contract = payableOrNull(await contractRepository.findById(contractId, tx));
  if (!contract) return;
  await sessionSettlementRepository.upsertPending(
    { kind: spec.kind, idempotencyKey: spec.idempotencyKey, sessionId: spec.sessionId, contractId, reason: spec.reason ?? null },
    tx,
  );
}

/** A delivered session: an ordinary release, or - when the contract had already ended - the resolution of the value payment-service HELD. */
export function recordReleaseIntent(tx: Tx, contractId: string, sessionId: string, endedAtClaim?: boolean): Promise<void> {
  return endedAtClaim
    ? recordIntent(tx, contractId, {
        kind: SessionSettlementKind.UNRESOLVED_SESSION_RESOLUTION,
        idempotencyKey: `UNRESOLVED_SESSION:${sessionId}`,
        sessionId,
        reason: "DELIVERED",
      })
    : recordIntent(tx, contractId, { kind: SessionSettlementKind.SESSION_RELEASE, idempotencyKey: `SESSION_RELEASE:${sessionId}`, sessionId });
}

export function recordNoShowIntent(tx: Tx, contractId: string, sessionId: string): Promise<void> {
  return recordIntent(tx, contractId, { kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION, idempotencyKey: `PT_NO_SHOW:${sessionId}`, sessionId });
}

export function recordLateArrivalIntent(tx: Tx, contractId: string, sessionId: string): Promise<void> {
  return recordIntent(tx, contractId, {
    kind: SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION,
    idempotencyKey: `PT_LATE_ARRIVAL:${sessionId}`,
    sessionId,
  });
}

/** A held session of an ended contract was decided. */
export function recordResolutionIntent(tx: Tx, contractId: string, sessionId: string, outcome: UnresolvedOutcome): Promise<void> {
  return recordIntent(tx, contractId, {
    kind: SessionSettlementKind.UNRESOLVED_SESSION_RESOLUTION,
    idempotencyKey: `UNRESOLVED_SESSION:${sessionId}`,
    sessionId,
    reason: outcome,
  });
}

// ── executing a session's money step (no lock, no transaction around the HTTP call) ───────────────────────────────────

/**
 * The session in `UNRESOLVED_SESSION:<sessionId>` was decided: DELIVERED (the client confirmed, auto-confirm
 * fired, or an admin ruled it was delivered) releases its value to PT/gym/platform; NOT_DELIVERED (an admin
 * ruled it was not delivered / the PT did not show) refunds it to the client. Replaces the normal per-session
 * release / no-show compensation for a session of an exit-ended contract.
 *
 * Tracked like every session money step (settleTracked): a failure is recorded and retried by the settlement
 * sweep with the same key, which payment-service de-duplicates. A key already used for the OTHER outcome is
 * refused loudly - a session is never resolved both ways.
 */
export async function resolveUnresolvedSessionMoney(
  contractId: string,
  sessionId: string,
  outcome: UnresolvedOutcome,
  mode: SettleMode = {},
): Promise<void> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return;

  const idempotencyKey = `UNRESOLVED_SESSION:${sessionId}`;
  const existing = await sessionSettlementRepository.findByKey(idempotencyKey);
  if (existing?.reason && existing.reason !== outcome) {
    logger.error(`[ContractPayout] session ${sessionId} was already resolved as ${existing.reason}; refusing to resolve it as ${outcome}`);
    return;
  }
  // The ending that created the hold is not confirmed yet: payment-service would answer "nothing held" and this row would
  // be marked settled for good. The intent row stays PENDING; the settlement sweep runs it once the ending is confirmed.
  if (!isContractEnded(contract) || (await sessionSettlementRepository.hasUnconfirmedTermination(contractId))) {
    await sessionSettlementRepository.upsertPending({
      kind: SessionSettlementKind.UNRESOLVED_SESSION_RESOLUTION,
      idempotencyKey,
      sessionId,
      contractId,
      reason: outcome,
    });
    return;
  }
  await settleTracked<ResolveAnswer>(
    { kind: SessionSettlementKind.UNRESOLVED_SESSION_RESOLUTION, idempotencyKey, contractId, sessionId, reason: outcome },
    async () => {
      try {
        return (await paymentClient.resolveUnresolvedSession({
          transactionId: contract.paymentTransactionId,
          price: contract.price!.toString(),
          totalSessions: contract.totalSessions,
          rates: ratesOf(contract),
          parties: partiesOf(contract),
          label: `Contract ${contract.id} unresolved session ${sessionId}`,
          idempotencyKey,
          outcome,
          ...holdbackArgOf(contract),
        })) as ResolveAnswer;
      } catch (e: any) {
        // A definite answer, not a failure: the ledger holds nothing for this session (the contract ended before
        // holds existed, or every hold it made is already resolved). The ending settled the whole value then, so
        // there is nothing left to move - and retrying forever would help nobody.
        const code = e?.response?.status === 409 ? e?.response?.data?.error?.code : null;
        if (code !== "NO_UNRESOLVED_HELD" && code !== "ALL_UNRESOLVED_RESOLVED") throw e;
        logger.warn(`[ContractPayout] session ${sessionId} of ${contract.id}: ledger answered ${code} - nothing held to resolve as ${outcome}`);
        return { nothingHeld: true };
      }
    },
    undefined,
    {
      takeover: mode.takeover ?? true,
      validate: (r) => {
        if (r?.nothingHeld) return null;
        if (!r || typeof r !== "object" || !r.moved) return "payment-service did not report what it moved";
        return null;
      },
      apply: async (tx, r) => {
        // Same bookkeeping as the ordinary release: what the ledger really released to each party.
        if (outcome === "DELIVERED" && !r?.nothingHeld) {
          const moved = (r as { moved?: { pt?: unknown; gym?: unknown; platform?: unknown } }).moved;
          await contractRepository.addReleased(
            contract.id,
            { pt: (moved?.pt ?? 0) as Prisma.Decimal.Value, gym: (moved?.gym ?? 0) as Prisma.Decimal.Value, platform: (moved?.platform ?? 0) as Prisma.Decimal.Value },
            tx,
          );
        }
      },
    },
  );
}

/**
 * The money step of a session that was just DELIVERED (the client confirmed it, auto-confirm fired, or an
 * admin ruled so). On a contract that has ENDED the session's value is HELD by payment-service and is resolved
 * against that hold; on every other contract it is the ordinary release.
 * The quota claim (deductQuotaOnce) calls this - never releaseSessionMoney directly - so all three paths
 * (confirm, auto-confirm, admin COMPLETED ruling) land in the same place.
 */
export async function releaseOrResolveSessionMoney(contractId: string, sessionId: string, endedAtClaim?: boolean): Promise<void> {
  // `endedAtClaim` is the fact the claim itself read under the contract lock (so it is ordered against the ending);
  // without it (an older caller) the contract is read now.
  const ended = endedAtClaim ?? (await contractRepository.findById(contractId).then((c) => !!c && isContractEnded(c)));
  if (ended) {
    await resolveUnresolvedSessionMoney(contractId, sessionId, "DELIVERED");
    return;
  }
  await releaseSessionMoney(contractId, sessionId);
}

/**
 * A DISPUTED session of an exit-ended contract was ruled NOT delivered (admin: cancelled / PT no-show
 * confirmed): its held value goes back to the client. A no-op (false) for every other contract - there the
 * ruling never moved money and still does not. Tracked and retried like every resolution.
 */
export async function resolveHeldSessionNotDelivered(contractId: string, sessionId: string): Promise<boolean> {
  const contract = await contractRepository.findById(contractId);
  if (!contract || !isContractEnded(contract)) return false;
  await resolveUnresolvedSessionMoney(contractId, sessionId, "NOT_DELIVERED");
  return true;
}

/**
 * One confirmed session's worth of money moves from pending to available for all three
 * parties.
 *
 * Deliberately best-effort: a payment-service outage must not roll back a session the client
 * has already confirmed, because the session genuinely happened. A missed release is
 * self-healing - termination settles each party up to `rate x (P - refund)` regardless of how
 * much was released along the way, so the only lasting effect is that the PT waits longer for
 * money they still receive in full. (And since Phase 0 an ending first settles every outstanding release, so
 * `alreadyReleased` it sends is the ledger's truth.)
 */
export async function releaseSessionMoney(contractId: string, sessionId: string, mode: SettleMode = {}): Promise<void> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return;

  const idempotencyKey = `SESSION_RELEASE:${sessionId}`;
  // Money-flow plan 1.6: tracked so a failed release is retried by the settlement sweep
  // instead of only ever being reconciled whenever the contract eventually terminates.
  await settleTracked(
    { kind: SessionSettlementKind.SESSION_RELEASE, idempotencyKey, contractId, sessionId },
    () =>
      paymentClient.releaseSession({
        transactionId: contract.paymentTransactionId,
        price: contract.price!.toString(),
        totalSessions: contract.totalSessions,
        rates: ratesOf(contract),
        parties: partiesOf(contract),
        label: `Contract ${contract.id} session ${sessionId}`,
        // Money-flow redesign plan 1.1: a retry after payment-service settled but this call
        // failed before returning (or before the caller recorded success) must not release
        // the same session's money twice.
        idempotencyKey,
        // The PT holdback, if this contract carries one: the PT's first earnings are kept back, so
        // `result.released.pt` below can be less than a full session (0 for the first one).
        ...holdbackArgOf(contract),
      }),
    undefined,
    {
      takeover: mode.takeover ?? true,
      validate: invalidRelease,
      // Track what has actually been paid out so termination can top each party up to their
      // final entitlement instead of paying the released part twice. Added in the transaction that
      // flips the row to SETTLED, so it is counted exactly once.
      apply: async (tx, result) => {
        await contractRepository.addReleased(contract.id, result.released, tx);
        logger.info(
          `[ContractPayout] Released session ${sessionId} of ${contract.id}: pt=${result.released.pt} gym=${result.released.gym} platform=${result.released.platform}`,
        );
      },
    },
  );
}

/**
 * The PT did not turn up. The client is compensated one session's value, charged to the three
 * parties in proportion, and the contract's entitlement is consumed by one.
 *
 * Money-flow plan 1.5: `totalSessions` (purchasedSessions) and `price` are immutable once
 * signed - a no-show used to decrement `totalSessions`, which made every subsequent session's
 * unit price (price / totalSessions) drift, and it left a 1-session contract with nothing left
 * to decrement (client kept both the cash AND the right to book the session again).
 * `compensatedSessions` records the same fact - one fewer entitlement owed - without touching
 * the numbers every other formula divides by. See `getRemainingEntitlements` in
 * contract.service.ts for where this is read back.
 *
 * Money-flow plan 1.6: does NOT throw on failure (a previous version did, on the reasoning
 * that swallowing it would silently short-change the client - but the session's NO_SHOW status already committed,
 * and that status guard blocks every retry through the endpoints). `settleTracked` records the failure instead, and the
 * settlement sweep retries it - the client is still short-changed for a while, but not permanently and silently.
 * Since Phase 0 the counter `compensatedSessions` is added in the same transaction as the row's flip to SETTLED, so a
 * failure between "the ledger paid" and "the row was marked" can no longer count the session twice.
 */
export async function compensateNoShowMoney(contractId: string, sessionId: string, mode: SettleMode = {}): Promise<void> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return;

  const idempotencyKey = `PT_NO_SHOW:${sessionId}`;
  await settleTracked(
    { kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION, idempotencyKey, contractId, sessionId },
    () =>
      paymentClient.noShow({
        transactionId: contract.paymentTransactionId,
        price: contract.price!.toString(),
        totalSessions: contract.totalSessions,
        rates: ratesOf(contract),
        parties: partiesOf(contract),
        label: `Contract ${contract.id} no-show ${sessionId}`,
        idempotencyKey,
      }),
    undefined,
    {
      takeover: mode.takeover ?? true,
      validate: invalidCompensation,
      apply: async (tx, result) => {
        const fresh = await tx.contract.findUnique({ where: { id: contract.id }, select: { notes: true } });
        await contractRepository.incrementCompensatedSessions(
          contract.id,
          `${fresh?.notes ? fresh.notes + "\n" : ""}[${new Date().toISOString().slice(0, 10)}] PT vắng buổi ${sessionId}: bồi thường ${result.compensation}đ cho khách.`,
          tx,
        );
        if (Number(result.shortfall) > 0) {
          logger.warn(
            `[ContractPayout] No-show shortfall ${result.shortfall} on ${contractId} - platform fronted it, receivable raised against the PT`,
          );
        }
      },
    },
  );
}

/**
 * Open-room online session - the PT joined the room, but after the grace window past the
 * scheduled start. The client's entitlement is untouched (this is not a no-show - the PT did
 * show up), but they are compensated in cash at half a full no-show's rate. A near-duplicate
 * of compensateNoShowMoney above rather than a shared helper, for the same reason
 * payment-service's compensateLateArrival is its own function: that one is relied on exactly
 * as-is by its existing callers.
 */
export async function compensateLateArrivalMoney(contractId: string, sessionId: string, mode: SettleMode = {}): Promise<void> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return;

  const idempotencyKey = `PT_LATE_ARRIVAL:${sessionId}`;
  await settleTracked(
    { kind: SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION, idempotencyKey, contractId, sessionId },
    () =>
      paymentClient.lateArrival({
        transactionId: contract.paymentTransactionId,
        price: contract.price!.toString(),
        totalSessions: contract.totalSessions,
        rates: ratesOf(contract),
        parties: partiesOf(contract),
        label: `Contract ${contract.id} PT late arrival ${sessionId}`,
        idempotencyKey,
      }),
    undefined,
    {
      takeover: mode.takeover ?? true,
      validate: invalidLateArrival,
      apply: async (_tx, result) => {
        if (Number(result.shortfall) > 0) {
          logger.warn(
            `[ContractPayout] Late-arrival shortfall ${result.shortfall} on ${contractId} - platform fronted it, receivable raised against the PT`,
          );
        }
      },
    },
  );
}

// ── is a recorded money step still something to run? (sweep + the ending's drain) ───────────────────────────────────

export type RowVerdict =
  | { ok: true }
  /** Will never be runnable: parked for a human (never deleted). `ORPHAN` = the contract is gone / has no payment; `STATE` = the session is not in a state that supports this step. */
  | { ok: false; park: string; code: "ORPHAN" | "STATE" }
  /** Not yet - leave it alone. */
  | { ok: false; wait: string };

export interface SettlementRowLike {
  id: string;
  kind: SessionSettlementKind;
  contractId: string;
  sessionId: string | null;
  reason: string | null;
}

/**
 * Before a recorded money step is run again, check that its premise still holds (a5 of the D57 audit: a row whose
 * decision never committed used to be paid by the sweep - "PT paid for a session the system calls pending"):
 *  - the contract still exists and has money behind it;
 *  - the SESSION is in a state that supports this step (a release needs a delivered session, a no-show compensation a
 *    no-show / called-off one, a NOT_DELIVERED resolution a session that was not delivered ...);
 *  - a resolution of a held session waits for the ending that created the hold to be confirmed.
 * `park` = this row will never be runnable (it is parked for a human, never deleted); `wait` = not yet, leave it be.
 */
export async function assessSettlementRow(row: SettlementRowLike, db: Tx | typeof prisma = prisma): Promise<RowVerdict> {
  const contract = await contractRepository.findById(row.contractId, db);
  if (!contract) return { ok: false, park: `contract ${row.contractId} no longer exists`, code: "ORPHAN" };
  if (!payableOrNull(contract)) return { ok: false, park: `contract ${row.contractId} has no payment behind it (nothing to move)`, code: "ORPHAN" };
  if (row.kind === SessionSettlementKind.CONTRACT_TERMINATION) return { ok: true };

  if (!row.sessionId) return { ok: false, park: `${row.kind} row has no session`, code: "STATE" };
  const session = await db.session.findUnique({
    where: { id: row.sessionId },
    select: { status: true, sessionDeducted: true, contractId: true },
  });
  if (!session) return { ok: false, park: `session ${row.sessionId} no longer exists`, code: "STATE" };
  if (session.contractId !== row.contractId) return { ok: false, park: `session ${row.sessionId} belongs to another contract`, code: "STATE" };

  const notYetDecided = session.status === SessionStatus.REQUESTED || session.status === SessionStatus.CONFIRMED;
  switch (row.kind) {
    case SessionSettlementKind.SESSION_RELEASE:
      // A release is owed only for a session the system counted as delivered / charged (sessionDeducted).
      if (!session.sessionDeducted) {
        return { ok: false, park: `session ${row.sessionId} is ${session.status} and was not delivered / charged - no release is due`, code: "STATE" };
      }
      return { ok: true };
    case SessionSettlementKind.PT_NO_SHOW_COMPENSATION:
      if (session.status !== SessionStatus.NO_SHOW && session.status !== SessionStatus.CANCELLED) {
        return { ok: false, park: `session ${row.sessionId} is ${session.status}, not a PT no-show / called-off session - no compensation is due`, code: "STATE" };
      }
      return { ok: true };
    case SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION:
      if (notYetDecided) {
        return { ok: false, park: `session ${row.sessionId} is ${session.status}: the PT's late arrival was never decided`, code: "STATE" };
      }
      return { ok: true };
    case SessionSettlementKind.UNRESOLVED_SESSION_RESOLUTION: {
      if (!isContractEnded(contract)) return { ok: false, wait: "the contract has not ended - nothing is held" };
      if (await sessionSettlementRepository.hasUnconfirmedTermination(row.contractId, db)) {
        return { ok: false, wait: "the ending that created the hold is not confirmed yet" };
      }
      if (row.reason === "DELIVERED" && !session.sessionDeducted) {
        return { ok: false, park: `session ${row.sessionId} is ${session.status} and was not delivered - a DELIVERED resolution is not due`, code: "STATE" };
      }
      if (row.reason === "NOT_DELIVERED" && session.status !== SessionStatus.CANCELLED && session.status !== SessionStatus.NO_SHOW) {
        return { ok: false, park: `session ${row.sessionId} is ${session.status} - a NOT_DELIVERED resolution is not due`, code: "STATE" };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/** Runs one recorded session-level money step by kind (the sweep and the ending's drain both call it). */
export async function runSessionMoneyRow(row: SettlementRowLike, mode: SettleMode = {}): Promise<void> {
  if (!row.sessionId) return;
  switch (row.kind) {
    case SessionSettlementKind.SESSION_RELEASE:
      await releaseSessionMoney(row.contractId, row.sessionId, mode);
      return;
    case SessionSettlementKind.PT_NO_SHOW_COMPENSATION:
      await compensateNoShowMoney(row.contractId, row.sessionId, mode);
      return;
    case SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION:
      await compensateLateArrivalMoney(row.contractId, row.sessionId, mode);
      return;
    case SessionSettlementKind.UNRESOLVED_SESSION_RESOLUTION:
      if (row.reason === "DELIVERED" || row.reason === "NOT_DELIVERED") {
        await resolveUnresolvedSessionMoney(row.contractId, row.sessionId, row.reason, mode);
      }
      return;
    default:
      return;
  }
}

// ── termination ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type TerminationReason =
  | "CLIENT_CANCELLED"
  | "PT_BANNED"
  | "PT_CANCELLED"
  | "MUTUAL"
  | "EXPIRED"
  | "COMPLETED"
  // Vòng 4 / Phase E2 - the client's own right to terminate after a 3rd PT no-show
  // (ptAtFault), not an admin/system decision. Same 100%-refund-of-remaining formula as
  // PT_BANNED/MUTUAL (contract-money.ts) - the PT is at fault here too, just via a pattern of
  // no-shows rather than a single administrative ban.
  | "PT_REPEATED_NO_SHOW"
  // PT-suspension slice 4 - the client leaves a contract whose PT is suspended/banned. Full refund of the
  // unused value, no fee, and NOT a PT-fault reason (payment-service pays no compensation for it). Never
  // sent by a caller: client-exit.service.ts substitutes it after checking the restriction itself.
  | "CLIENT_EXIT_DUE_TO_PT_RESTRICTION";

const TERMINATION_REASONS: TerminationReason[] = [
  "CLIENT_CANCELLED",
  "PT_BANNED",
  "PT_CANCELLED",
  "MUTUAL",
  "EXPIRED",
  "COMPLETED",
  "PT_REPEATED_NO_SHOW",
  "CLIENT_EXIT_DUE_TO_PT_RESTRICTION",
];

function asTerminationReason(v: string | null | undefined): TerminationReason | null {
  return v && (TERMINATION_REASONS as string[]).includes(v) ? (v as TerminationReason) : null;
}

/** States a contract never leaves. */
export const FINAL_CONTRACT_STATUSES: ContractStatus[] = [
  ContractStatus.COMPLETED,
  ContractStatus.EXPIRED,
  ContractStatus.CANCELLED,
  ContractStatus.REJECTED,
];

/** Optional extra columns written together with the status (the client-facing "who/why" text). */
export interface TerminationStatusExtra {
  cancelledBy?: string;
  cancellationReason?: string;
}

/** Work that must commit in the SAME transaction as the guarded status write (e.g. the notice rows). */
export interface TerminationHooks {
  inStatusWrite?: (tx: Prisma.TransactionClient, info: { contract: ContractRow; terms: TerminationTerms }) => Promise<void>;
  /** Runs once, after the transaction that wrote the status committed (push nudges); the ending is already written when it runs. */
  afterCommit?: () => void | Promise<void>;
}

/**
 * Hooks of an ending by its recorded reason, for the callers that did not start it: a sweep or a retry that completes an
 * ending the original request could not (the request's own closure is gone) must still commit the same notices with the
 * status write. The module that owns a reason's side effects registers a factory at load time.
 */
const terminationHookRegistry = new Map<string, () => TerminationHooks>();
export function registerTerminationHooks(reason: TerminationReason, factory: () => TerminationHooks): void {
  terminationHookRegistry.set(reason, factory);
}

export interface ContractTerminationResult {
  /** The reason the ending carries: the one RECORDED with it (D59) - which is not the requested one when an earlier ending was resumed. */
  reason: TerminationReason;
  /** What payment-service answered; null when the contract had no money to move. */
  result: any;
  /** True only for the call whose guarded UPDATE actually moved the contract into its final state. */
  statusWritten: boolean;
  /**
   * The row as it was read when the ending was recorded (its status is the status BEFORE the write) when this call wrote
   * the status; the CURRENT row when somebody else had already ended the contract.
   */
  contract: NonNullable<Awaited<ReturnType<typeof contractRepository.findById>>>;
  /** How many sessions' value was left HELD with payment-service. */
  unresolvedSessions: number;
}

/** How many unsettled session-money steps an ending settles inline before it gives up (each is one payment-service call, <= 15 s). */
export const SETTLEMENT_DRAIN_LIMIT = 3;

/** A row recorded this moment is about to be started by the request that decided it (it claims within milliseconds). */
const PENDING_GRACE_MS = () => Math.max(0, Number(process.env.SETTLEMENT_PENDING_GRACE_MS ?? 5_000));

/** A runner owns this row right now: PROCESSING and not stale, or PENDING and so fresh that its own request has not started it yet. */
function isLiveRow(row: { status: string; updatedAt: Date }): boolean {
  const age = Date.now() - row.updatedAt.getTime();
  if (row.status === "PROCESSING") return age < staleProcessingMs();
  if (row.status === "PENDING") return age < PENDING_GRACE_MS();
  return false;
}

const INFLIGHT_WAIT_MS = () => Math.max(0, Number(process.env.SETTLEMENT_INFLIGHT_WAIT_MS ?? 25_000));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function settlementPendingError(count: number) {
  return codedError(
    `${count} khoản tiền theo buổi tập của hợp đồng này chưa được xác nhận xong - chưa thể kết thúc hợp đồng, vui lòng thử lại sau.`,
    409,
    SESSION_SETTLEMENT_PENDING,
  );
}

/**
 * Settles every outstanding session-level money step of a RUNNING contract (release, no-show / late-arrival
 * compensation) BEFORE the ending is recorded - OUTSIDE any lock. The ending's snapshot {usedSessions, compensatedSessions,
 * alreadyReleased} and its refund formula assume every counted session was really paid; an unsettled one would be priced
 * again by the ending and paid a second time (D57 a1/a2). Idempotent: each row is re-run with its own key, which
 * payment-service de-duplicates, and its bookkeeping is applied once. A row a live request is processing right now is
 * WAITED for (not duplicated) up to SETTLEMENT_INFLIGHT_WAIT_MS. What cannot be settled leaves the ending refused
 * (409 SESSION_SETTLEMENT_PENDING), loudly, retried by the caller.
 */
export async function settleUnsettledSessionMoneyFirst(contractId: string): Promise<void> {
  // A contract that has already ended is only being healed / replayed: a compensation is never paid on top of a settled ending.
  const current = await contractRepository.findById(contractId);
  if (!current || isContractEnded(current)) return;

  for (let round = 0; round < 2; round++) {
    const rows = await sessionSettlementRepository.findUnsettledSessionMoney(contractId);
    if (rows.length === 0) return;
    for (const row of rows.slice(0, SETTLEMENT_DRAIN_LIMIT)) {
      if (isParkedError(row.lastError)) continue; // needs a human; it will keep the ending refused below
      let cur = row;
      if (isLiveRow(cur)) {
        // Another runner is on it right now (or the request that just recorded it is about to start it) - wait for it
        // instead of repeating its payment-service call.
        const until = Date.now() + INFLIGHT_WAIT_MS();
        while (Date.now() < until) {
          await sleep(100);
          const again = await sessionSettlementRepository.findById(cur.id);
          if (!again) break;
          cur = again;
          if (!isLiveRow(cur)) break;
        }
        if (cur.status === "SETTLED") continue;
      }
      const verdict = await assessSettlementRow(cur);
      if (!verdict.ok) {
        if ("park" in verdict) await sessionSettlementRepository.park(cur.id, NEEDS_RECONCILIATION_PREFIX, verdict.park);
        continue;
      }
      await runSessionMoneyRow(cur);
    }
  }
  const left = await sessionSettlementRepository.findUnsettledSessionMoney(contractId);
  if (left.length > 0) throw settlementPendingError(left.length);
}

/** An ending that is recorded and being carried through. */
export interface TerminationIntent {
  contractId: string;
  /** The reason RECORDED with the ending (D59: a retry never recomputes it). */
  reason: TerminationReason;
  /** What this caller asked for (differs from `reason` when it resumed an ending somebody else had already recorded). */
  requestedReason: TerminationReason;
  extra?: TerminationStatusExtra;
  /** The CONTRACT_TERMINATION row; null for a contract with no money behind it. */
  rowId: string | null;
  /** An earlier recorded ending was found and reused. */
  resumed: boolean;
  /** The contract as read when the ending was recorded. */
  contract: ContractRow;
}

const MAX_BEGIN_ROUNDS = 4;

/**
 * STEP 1 of an ending - RECORD it (D58/D59). Under the contract lock, for milliseconds and with no network call inside:
 * nothing outstanding may remain (see settleUnsettledSessionMoneyFirst), then the accepted ending - reason, who/why
 * text - is written durably as the contract's CONTRACT_TERMINATION intent row. From the moment this commits the
 * contract is ENDING: every money-changing action on it answers 409 CONTRACT_ENDING, so its counters and released
 * amounts are frozen, and any retry, sweep or other caller carries on with THIS ending (same reason, same key
 * `CONTRACT_TERMINATE:<id>`) - nothing is recomputed. Returns null when the contract does not exist.
 *
 * `drain: false` = the caller (client-exit, which holds the PT lock) already settled outstanding steps outside its lock;
 * finding one anyway refuses the ending (409 SESSION_SETTLEMENT_PENDING) instead of waiting on the network under that lock.
 */
export async function beginContractTermination(
  contractId: string,
  reason: TerminationReason,
  extra?: TerminationStatusExtra,
  opts: { drain?: boolean } = {},
): Promise<TerminationIntent | null> {
  const drain = opts.drain ?? true;
  for (let round = 1; round <= MAX_BEGIN_ROUNDS; round++) {
    if (drain) await settleUnsettledSessionMoneyFirst(contractId);

    const outcome = await withContractLock(contractId, async (tx) => {
      const raw = await contractRepository.findById(contractId, tx);
      if (!raw) return { kind: "NOT_FOUND" as const };
      const ended = isContractEnded(raw);
      if (!ended) {
        const outstanding = await sessionSettlementRepository.findUnsettledSessionMoney(contractId, tx);
        if (outstanding.length > 0) return { kind: "OUTSTANDING" as const, count: outstanding.length };
      }

      const payable = payableOrNull(raw);
      if (!payable) return { kind: "UNPAID" as const, raw };

      const existing = await sessionSettlementRepository.findTerminationRow(contractId, tx);
      if (existing) {
        const recorded = asTerminationReason(existing.reason) ?? (ended ? asTerminationReason(raw.terminationReason) : null) ?? reason;
        return { kind: "INTENT" as const, raw, rowId: existing.id, reason: recorded, resumed: existing.status !== "SETTLED" };
      }

      // A new ending. The client-facing who/why text is written with it (the final status write repeats it), so a sweep
      // that completes this ending later still reports who ended it and why.
      const recorded = ended ? (asTerminationReason(raw.terminationReason) ?? reason) : reason;
      if (!ended && extra && (extra.cancelledBy !== undefined || extra.cancellationReason !== undefined)) {
        await tx.contract.updateMany({
          where: { id: raw.id, status: raw.status },
          data: {
            ...(extra.cancelledBy !== undefined ? { cancelledBy: extra.cancelledBy } : {}),
            ...(extra.cancellationReason !== undefined ? { cancellationReason: extra.cancellationReason } : {}),
          },
        });
      }
      const row = await sessionSettlementRepository.upsertPending(
        {
          kind: SessionSettlementKind.CONTRACT_TERMINATION,
          idempotencyKey: `CONTRACT_TERMINATE:${contractId}`,
          sessionId: null,
          contractId,
          reason: recorded,
        },
        tx,
      );
      return { kind: "INTENT" as const, raw, rowId: row.id, reason: recorded, resumed: false };
    });

    if (outcome.kind === "NOT_FOUND") return null;
    if (outcome.kind === "OUTSTANDING") {
      if (!drain || round === MAX_BEGIN_ROUNDS) throw settlementPendingError(outcome.count);
      continue; // a money step was decided between the drain and the lock: settle it, then try again
    }
    const effectiveReason = outcome.kind === "UNPAID" ? reason : outcome.reason;
    return {
      contractId,
      reason: effectiveReason,
      requestedReason: reason,
      extra,
      rowId: outcome.kind === "INTENT" ? outcome.rowId : null,
      resumed: outcome.kind === "INTENT" ? outcome.resumed : false,
      contract: outcome.raw,
    };
  }
  throw settlementPendingError(0);
}

/**
 * Makes sure a contract whose status was already written (natural completion) has its CONTRACT_TERMINATION row recorded as
 * FAILED, so the settlement sweep finds the money step even when the attempt died before it could record the row itself
 * (e.g. the ending was refused because an earlier release is still outstanding). Never touches a SETTLED / parked row.
 */
export async function recordTerminationAttemptFailed(contractId: string, reason: TerminationReason, message: string): Promise<void> {
  const row = await sessionSettlementRepository.upsertPending({
    kind: SessionSettlementKind.CONTRACT_TERMINATION,
    idempotencyKey: `CONTRACT_TERMINATE:${contractId}`,
    sessionId: null,
    contractId,
    reason,
  });
  if (row.status !== "SETTLED" && !isParkedError(row.lastError)) await sessionSettlementRepository.markFailed(row.id, message);
}

/** The settlement sweep found the ending's row held by another runner. Not an error. */
export class SettlementInFlightError extends Error {
  constructor(public readonly rowId: string) {
    super(`settlement ${rowId} is being processed by another runner`);
  }
}

class StatusWriteRetry extends Error {}

/** Failures of one ending after which a human is told (the ending keeps being retried, with back-off, regardless). */
/** @deprecated D64-C: superseded by SETTLEMENT_MAX_ATTEMPTS (default 12) via settlementAttemptLevel(); kept so existing imports compile. */
export const TERMINATION_ATTENTION_ATTEMPTS = Number(process.env.TERMINATION_ATTENTION_ATTEMPTS ?? 12);

/**
 * STEPS 2-3 of an ending - CARRY IT THROUGH, outside every lock and every transaction (D58):
 *   a. call off the sessions that have not started and hold the unanswered no-show reports (idempotent, by state - D45/L1, D52);
 *   b. the terminate call to payment-service with the RECORDED reason and the frozen counters, idempotent on
 *      `CONTRACT_TERMINATE:<id>`. Its answer is checked against what was recorded - another reason or another held
 *      count is a CONFLICT, parked for a human, never written over;
 *   c. in ONE short transaction: the row flips to SETTLED and the contract's final status is written (guarded on the
 *      status that was read) together with whatever the caller needs to commit with it (notices).
 * A payment-service failure leaves the ending recorded and UNCONFIRMED: this throws 409 CONTRACT_ENDING (never "ended"),
 * the row is FAILED with the error, and the caller's retry or the sweep repeats it. After TERMINATION_ATTENTION_ATTEMPTS
 * failed attempts the row is reported loudly for a human (it keeps being retried with back-off).
 */
export async function completeContractTermination(
  intent: TerminationIntent,
  callerHooks?: TerminationHooks,
  mode: SettleMode = {},
): Promise<ContractTerminationResult> {
  const { contractId } = intent;
  const hooks = callerHooks ?? terminationHookRegistry.get(intent.reason)?.();
  // The who/why text recorded with the ending (an ending resumed from the row has no `extra` in memory).
  const extra: TerminationStatusExtra | undefined =
    intent.extra ??
    (intent.contract.cancelledBy || intent.contract.cancellationReason
      ? {
          ...(intent.contract.cancelledBy ? { cancelledBy: intent.contract.cancelledBy } : {}),
          ...(intent.contract.cancellationReason ? { cancellationReason: intent.contract.cancellationReason } : {}),
        }
      : undefined);

  // a. Sessions, by state. Done before the money and status steps on purpose: if anything below fails the contract is
  // still open (ENDING) and the retry finds it; and it is repeated on every call - a replay heals leftovers. Idempotent
  // and CAS-guarded per session, so it is safe next to any concurrent session action.
  await callOffOpenSessions(contractId, sessionCallOffReasonFor(intent.reason, extra?.cancellationReason), {
    actorUserId: extra?.cancelledBy ?? SYSTEM_ACTOR,
    auditExtra: { terminationReason: intent.reason },
  });
  // Decision A (D52): the client's unanswered "the PT never came" report is HELD with the disputed sessions (it becomes
  // a DISPUTED session of type PT_NO_SHOW_CLAIM in the admin queue), not cancelled and refunded at the ending's rate.
  await holdUnansweredNoShowReports(contractId, { actorUserId: extra?.cancelledBy ?? SYSTEM_ACTOR, terminationReason: intent.reason });

  const fresh = await contractRepository.findById(contractId);
  if (!fresh) throw new Error(`Contract ${contractId} no longer exists`);
  const contract = payableOrNull(fresh);
  // Counters are frozen while the ending is recorded (every money step is refused), so the terms are the same on every attempt.
  const terms: TerminationTerms = contract ? await terminationTermsFor(contract.id, intent.reason) : { reason: intent.reason, unresolvedSessions: 0 };

  // b. The money.
  let result: any = null;
  if (contract && intent.rowId) {
    // A REPLAY (the ending is already confirmed: the contract is final, or its row is SETTLED) only reports the stored answer.
    // That answer carries the counts of the day the ending ran - the held sessions have usually been decided since - so it is
    // not compared with today's. Only an ending that is still being confirmed is checked against what was recorded.
    const replay = isContractEnded(fresh) || (await sessionSettlementRepository.findById(intent.rowId))?.status === "SETTLED";
    const claimed = await sessionSettlementRepository.claim(intent.rowId, {
      staleBefore: new Date(Date.now() - staleProcessingMs()),
      takeover: mode.takeover ?? true,
    });
    if (!claimed) {
      const cur = await sessionSettlementRepository.findById(intent.rowId);
      if (cur && isParkedError(cur.lastError)) {
        throw codedError(`Việc kết thúc hợp đồng cần được kiểm tra thủ công: ${cur.lastError}`, 409, CONTRACT_ENDING_CONFLICT);
      }
      // Held by another runner right now: the sweep leaves it alone; a live caller was allowed to take over (not reached).
      if (cur && cur.status !== "SETTLED" && (mode.takeover ?? true) === false) throw new SettlementInFlightError(intent.rowId);
      // SETTLED already: the call below only replays the stored answer (idempotent), to report it.
    }
    try {
      result = await paymentClient.terminate({
        transactionId: contract.paymentTransactionId,
        price: contract.price!.toString(),
        totalSessions: contract.totalSessions,
        usedSessions: contract.usedSessions,
        // Money-flow plan 1.5 / P0 cluster A1: without this, payment-service's remainingValue()
        // does not know a no-show session was already compensated in cash, and counts it as
        // still-unused entitlement on top of the cash payout the client already received -
        // paying the same session's value twice.
        compensatedSessions: contract.compensatedSessions,
        rates: ratesOf(contract),
        reason: terms.reason,
        alreadyReleased: {
          pt: contract.releasedToPt.toString(),
          gym: contract.releasedToGym.toString(),
          platform: contract.releasedToPlatform.toString(),
        },
        parties: partiesOf(contract),
        label: `Contract ${contract.id} termination`,
        // Money-flow redesign plan 1.1: a contract only ever terminates once, regardless of
        // which reason triggers it - this key is stable across retries of the SAME termination.
        idempotencyKey: `CONTRACT_TERMINATE:${contract.id}`,
        // The PT holdback: returned to the PT on a normal ending, partly paid to the client as
        // compensation on a PT-fault one - payment-service decides, from its own ledger.
        ...holdbackArgOf(contract),
        ...unresolvedArg(terms),
      });
    } catch (e) {
      const message = (e as Error).message;
      await sessionSettlementRepository.markFailed(intent.rowId, message);
      const row = await sessionSettlementRepository.findById(intent.rowId);
      const attempts = row?.attempts ?? 0;
      // D64-C: the SAME thresholds as the session-level steps (early warning at SETTLEMENT_WARN_ATTEMPTS, alert at the cap
      // SETTLEMENT_MAX_ATTEMPTS and on every attempt after it). An ending is NOT parked at the cap - it is idempotent and keeps
      // being retried with back-off, because parking would stop it from finishing on its own once payment-service is back.
      const level = settlementAttemptLevel(attempts);
      logger.error({
        error: level === "CAP"
          ? "[MoneyAttention] Contract ending is still not confirmed by payment-service - needs a human"
          : level === "WARN"
            ? "[MoneyAttention] early warning: contract ending is still not confirmed by payment-service"
            : "Contract ending recorded but payment-service did not confirm it - will be retried",
        contractId,
        reason: intent.reason,
        attempts,
        message,
      });
      throw Object.assign(contractEndingError(), { cause: e });
    }

    const conflict = replay ? null : invalidTerminationAnswer(result, intent.reason, terms.unresolvedSessions);
    if (conflict) {
      await sessionSettlementRepository.park(intent.rowId, CONFLICT_PREFIX, conflict);
      logger.error({ error: "[MoneyAttention] payment-service's termination answer disagrees with the recorded ending", contractId, conflict });
      throw codedError(`Việc kết thúc hợp đồng cần được kiểm tra thủ công: ${conflict}`, 409, CONTRACT_ENDING_CONFLICT);
    }
  }

  // c. Confirmed: flip the row and write the final status together.
  const target = statusFor(intent.reason);
  const seen: { written: ContractRow | null; current: ContractRow | null } = { written: null, current: null };
  try {
    await prisma.$transaction(async (tx) => {
      if (intent.rowId) await sessionSettlementRepository.settleOnce(intent.rowId, tx);
      const cur = await tx.contract.findUnique({ where: { id: contractId } });
      if (!cur) return;
      seen.current = cur;
      const isFinal = FINAL_CONTRACT_STATUSES.includes(cur.status);
      // Replaying the SAME ending (natural completion -> settle sweep, a retried unwind) is fine and writes nothing new;
      // a final contract is only ever completed with the reason it was left without.
      const writable = !isFinal || (cur.status === target && cur.terminationReason == null);
      if (!writable) {
        if (cur.terminationReason !== intent.reason) {
          logger.warn(
            `[ContractPayout] ${contractId} already ${cur.status}/${cur.terminationReason ?? "no reason"} - money step ran for ${intent.reason}, status left as it was`,
          );
        }
        return;
      }
      const where = { id: cur.id, status: cur.status, paymentTransactionId: cur.paymentTransactionId };
      const data = { terminationReason: intent.reason as any, terminatedAt: new Date(), status: target, ...extra };
      const count = (await tx.contract.updateMany({ where, data })).count;
      if (count === 0) throw new StatusWriteRetry();
      if (hooks?.inStatusWrite) await hooks.inStatusWrite(tx, { contract: cur, terms });
      seen.written = cur;
    });
  } catch (e) {
    if (e instanceof StatusWriteRetry) throw e;
    // The money is confirmed but the final write failed: the row is still unsettled, so the ending stays ENDING and is repeated.
    if (intent.rowId) await sessionSettlementRepository.markFailed(intent.rowId, `status write failed: ${(e as Error).message}`);
    throw Object.assign(contractEndingError(), { cause: e });
  }

  if (seen.written) {
    // A restriction on just this contract has nothing left to restrict now that it ended (best-effort).
    await closeContractEpisodeOnContractEnd(contractId).catch((e) =>
      logger.warn(`[ContractPayout] ${contractId} ended but its contract-scope restriction could not be closed: ${(e as Error).message}`),
    );
    // Only now, after the status and its notices committed: the realtime / phone nudge. A failure here loses the nudge, never
    // the notice (it is already stored) and never the ending (it is already written) - it reaches the caller, as it always did.
    if (hooks?.afterCommit) await hooks.afterCommit();
    return { reason: intent.reason, result, statusWritten: true, contract: seen.written, unresolvedSessions: terms.unresolvedSessions };
  }
  const after = (await contractRepository.findById(contractId)) ?? seen.current ?? fresh;
  return { reason: intent.reason, result, statusWritten: false, contract: after, unresolvedSessions: terms.unresolvedSessions };
}

/** payment-service's answer must be the ending that was recorded: same reason, same number of held sessions. */
function invalidTerminationAnswer(result: any, reason: TerminationReason, held: number): string | null {
  if (!result || typeof result !== "object") return "payment-service did not answer with a termination result";
  if (result.reason !== undefined && result.reason !== reason) {
    return `the ledger already settled this contract as ${result.reason}, but the recorded ending is ${reason}`;
  }
  const heldAnswered = Number(result.unresolved?.sessions ?? 0);
  if (heldAnswered !== held) {
    return `the ledger holds ${heldAnswered} unresolved session(s) for this contract, the recorded ending expects ${held}`;
  }
  return null;
}

/** The race loop re-reads and retries when the guarded write loses; this many times, then it throws. */
const MAX_TERMINATION_ATTEMPTS = 3;

/**
 * Settle a contract's money for good: refund the client per the reason's formula and bring
 * every party to their final entitlement.
 */
export async function terminateContractMoney(
  contractId: string,
  reason: TerminationReason,
  extra?: TerminationStatusExtra,
): Promise<any> {
  return (await settleContractTermination(contractId, reason, extra))?.result ?? null;
}

/**
 * terminateContractMoney with the facts a caller that must report per-contract outcomes needs
 * (the PT-lock unwind): was the status written by THIS call, and from which row.
 *
 * Returns null when the contract does not exist.
 *
 * The status transition is the one thing that must ALWAYS land once the contract is confirmed to exist (2026-09-06
 * fix): without it the contract stays in its current status forever and a client could keep booking against a contract
 * with nothing behind it. Only the money call is conditional on the contract being payable. It is ONE guarded
 * `UPDATE ... WHERE status = <the status read> AND payment_transaction_id = <the one read>`: a payment that activates
 * a PENDING_PAYMENT contract between the read and the write makes the write match zero rows instead of stamping CANCELLED
 * over a contract with money in escrow, and the loop below re-reads, sees an ACTIVE paid contract, records and settles
 * it through the ledger. A contract that already reached a final state is not rewritten into a different one; the money
 * call is still made - idempotent on `CONTRACT_TERMINATE:<id>` - and is exactly what repairs a paid contract that was
 * left CANCELLED without a refund.
 *
 * Phase 0 / D58-D59: beginContractTermination records the ending (milliseconds, under the lock), completeContractTermination
 * carries it through with no lock held - see their comments. `mode.takeover = false` is the sweep.
 */
export async function settleContractTermination(
  contractId: string,
  reason: TerminationReason,
  extra?: TerminationStatusExtra,
  hooks?: TerminationHooks,
  mode: SettleMode = {},
): Promise<ContractTerminationResult | null> {
  for (let attempt = 1; attempt <= MAX_TERMINATION_ATTEMPTS; attempt++) {
    const intent = await beginContractTermination(contractId, reason, extra);
    if (!intent) return null;
    try {
      return await completeContractTermination(intent, hooks, mode);
    } catch (e) {
      if (e instanceof StatusWriteRetry) {
        logger.warn(
          `[ContractPayout] ${contractId} changed between read and write while terminating (${reason}), attempt ${attempt}/${MAX_TERMINATION_ATTEMPTS} - re-reading`,
        );
        continue;
      }
      throw e;
    }
  }
  throw new Error(`Contract ${contractId} kept changing while terminating (${reason}) - retry later`);
}

/**
 * The contract has had no session for PT_HOLDBACK_IDLE_DAYS: hand the PT the amount held back on
 * it. Called by the idle-release sweep (contractService.releaseIdleHoldbacks), which has already
 * decided the contract qualifies.
 *
 * Returns what payment-service really moved to the PT's available balance (it reads the amount
 * from its own ledger - nothing here computes or sends one). Idempotent on payment-service's side
 * (`HOLDBACK_RELEASE:<contractId>`), so a retry after a crash replays instead of paying twice.
 * Throws on failure, unlike the best-effort session release: the sweep leaves the contract
 * un-marked and tries again on its next tick.
 */
export async function releaseHoldbackMoney(contractId: string): Promise<{ released: string } | null> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return null;
  return paymentClient.releaseHoldback({
    transactionId: contract.paymentTransactionId,
    parties: partiesOf(contract),
    label: `Contract ${contract.id} holdback`,
    idempotencyKey: `HOLDBACK_RELEASE:${contract.id}`,
  });
}

/** What the client would get back if they cancelled right now, and where the money stands. */
export async function moneyBreakdown(
  contractId: string,
  /** The terms of the termination being previewed (from terminationTermsFor) - omitted: payment-service's own default. */
  terms?: TerminationTerms,
): Promise<any> {
  const contract = await contractRepository.findById(contractId);
  if (!contract || contract.price == null || contract.totalSessions <= 0) return null;

  const breakdown = await paymentClient.moneyBreakdown({
    price: contract.price.toString(),
    totalSessions: contract.totalSessions,
    usedSessions: contract.usedSessions,
    // Same reason as the terminate call above - a preview of "what would I get back right
    // now" must also exclude compensated sessions from the still-pending pool it quotes.
    compensatedSessions: contract.compensatedSessions,
    rates: ratesOf(contract),
    ...(terms ? { reason: terms.reason, ...unresolvedArg(terms) } : {}),
  });

  return {
    ...breakdown,
    contractId: contract.id,
    paid: Boolean(contract.paymentTransactionId),
    // What the ledger has actually moved, as opposed to what the formula says it should have.
    actuallyReleased: {
      pt: contract.releasedToPt.toFixed(2),
      gym: contract.releasedToGym.toFixed(2),
      platform: contract.releasedToPlatform.toFixed(2),
    },
  };
}
