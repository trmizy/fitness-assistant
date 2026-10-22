import { logger } from "@gym-coach/shared";
import { Prisma, ContractStatus, SessionSettlementKind, SessionStatus } from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient, type LedgerOperationRecord } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { settleTracked, settlementAttemptLevel, staleProcessingMs, type SettleOutcome } from "./session-settlement.service";
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
  ENDED_UNSETTLED_PREFIX,
  NEEDS_RECONCILIATION_PREFIX,
  isParkedRow,
  sessionSettlementRepository,
} from "../repositories/session-settlement.repository";
import { invalidMoneyFigures, ledgerRefusalOf, settlingD65bEnabled } from "./session-settlement-answers";
import { closeContractEpisodeOnContractEnd } from "./pt-restriction.service";

/** Every termination reason ends the contract in exactly one of these two final states. */
function statusFor(reason: string): ContractStatus {
  if (reason === "COMPLETED") return ContractStatus.COMPLETED;
  if (reason === "EXPIRED") return ContractStatus.EXPIRED;
  return ContractStatus.CANCELLED; // CLIENT_CANCELLED, PT_CANCELLED, PT_BANNED, MUTUAL, PT_REPEATED_NO_SHOW, CLIENT_EXIT_DUE_TO_PT_RESTRICTION, SERVICE_DISCONTINUED_BY_PLATFORM
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
 * The contract's own snapshot (ptHoldbackRate), and only when it was snapshotted under a known policy (ptHoldbackPolicyVersion > 0): a
 * row with a rate but no policy version is not an FH-9 contract and never starts holding money (non-retroactive). The key is left off
 * the request entirely at rate 0, not sent as "0", so for every contract that exists today the bodies user-service sends are
 * byte-for-byte what they were before the holdback existed (pinned by contract-holdback.test.ts).
 *
 * Deliberately NOT conditional on the feature flag (it only decides the snapshot of NEW contracts) and NOT on holdbackReleasedAt: the
 * ledger itself knows what is held for the contract, so the rules and the money follow the snapshot whatever the flag says later.
 */
export function holdbackArgOf(c: ContractRow): { ptHoldbackRate?: string } {
  if (c.ptHoldbackRate == null || !((c as { ptHoldbackPolicyVersion?: number }).ptHoldbackPolicyVersion ?? 0)) return {};
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
  /**
   * FH-3c (D65-B): of `unresolvedSessions`, how many are DELIVERED sessions - already counted in the contract's `usedSessions` - whose
   * release payment-service never performed (UNCONFIRMED rows). Their value is HELD like any unresolved session, so the terminate
   * call (and the preview) sends `usedSessions - heldDelivered`: the session is counted once, as held, not also as used.
   */
  heldDelivered?: number;
}

/** FH-3c: what the contract's UNCONFIRMED (held) session rows stand for. A late-arrival row holds no session value. */
export async function heldUnconfirmedCounts(
  contractId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ delivered: number; noShow: number }> {
  if (!settlingD65bEnabled()) return { delivered: 0, noShow: 0 };
  const rows = await sessionSettlementRepository.findHeldSessionRows(contractId, db);
  return {
    delivered: rows.filter((r) => r.kind === SessionSettlementKind.SESSION_RELEASE).length,
    noShow: rows.filter((r) => r.kind === SessionSettlementKind.PT_NO_SHOW_COMPENSATION).length,
  };
}

export async function terminationTermsFor(
  contractId: string,
  reason: TerminationReason,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<TerminationTerms> {
  // D45 / L3: EVERY reason holds the value of sessions awaiting confirmation / disputed (it used to be only the
  // restricted-PT exit; every other ending split a disputed session's value between PT / gym / platform / client).
  const countedAwaiting = await countUnresolvedSessions(contractId, db);
  const held = await heldUnconfirmedCounts(contractId, db);
  const counted = countedAwaiting + held.delivered + held.noShow;
  if (counted === 0) return { reason, unresolvedSessions: 0 };
  // payment-service refuses used + compensated + held > total. Never let a data glitch block a refund: hold at most
  // what the contract can still owe (the surplus session, if any, is then simply not held - and logged).
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { totalSessions: true, usedSessions: true, compensatedSessions: true } });
  // A delivered session held by FH-3c is counted ONCE: as held, not also as used (see TerminationTerms.heldDelivered).
  const used = c ? Math.max(0, c.usedSessions - held.delivered) : 0;
  const room = c ? Math.max(0, c.totalSessions - used - c.compensatedSessions) : counted;
  if (counted > room) logger.warn(`[ContractPayout] ${contractId}: ${counted} sessions await a decision but only ${room} are still owed - holding ${room}`);
  const unresolvedSessions = Math.min(counted, room);
  return { reason, unresolvedSessions, ...(held.delivered > 0 ? { heldDelivered: Math.min(held.delivered, unresolvedSessions) } : {}) };
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
 * FH-3a - the contract's money state at the moment an intent is recorded, stored in the row's `request_snapshot` (create only):
 * a fixed, readable record of what the step was decided against, independent of whatever the contract looks like later.
 * Decimals are strings (JSON has no decimal); never read back to compute money - the live contract stays the source.
 */
function contractMoneyFacts(c: ContractRow): Prisma.InputJsonObject {
  // Best-effort record: it must never be the reason a money step cannot be recorded, so every read is null-tolerant.
  const str = (v: { toString(): string } | null | undefined) => v?.toString() ?? null;
  return {
    contractStatus: c.status ?? null,
    paymentTransactionId: c.paymentTransactionId ?? null,
    price: str(c.price),
    totalSessions: c.totalSessions ?? null,
    usedSessions: c.usedSessions ?? null,
    compensatedSessions: c.compensatedSessions ?? null,
    releasedToPt: str(c.releasedToPt),
    releasedToGym: str(c.releasedToGym),
    releasedToPlatform: str(c.releasedToPlatform),
    rates: { platformRate: str(c.platformRate), ptRate: str(c.ptRate), gymRate: str(c.gymRate) },
  };
}

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
    {
      kind: spec.kind,
      idempotencyKey: spec.idempotencyKey,
      sessionId: spec.sessionId,
      contractId,
      reason: spec.reason ?? null,
      snapshotFacts: contractMoneyFacts(contract),
    },
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
  /** FH-3c: the UNCONFIRMED (held) session row this resolution settles - flipped to SETTLED in the resolution's own transaction. */
  opts: { closeHeldRowId?: string } = {},
): Promise<SettleOutcome<ResolveAnswer> | undefined> {
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
  return settleTracked<ResolveAnswer>(
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
      validateFatal: (r) => (r?.nothingHeld ? null : invalidMoneyFigures(r)),
      validate: (r) => {
        if (r?.nothingHeld) return null;
        if (!r || typeof r !== "object" || !r.moved) return "payment-service did not report what it moved";
        return null;
      },
      apply: async (tx, r) => {
        if (opts.closeHeldRowId) await sessionSettlementRepository.settleOnce(opts.closeHeldRowId, tx);
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
 * FH-3c (D65-B) - the LATER RESOLUTION of a session the ending HELD because payment-service had never performed its step (its row is
 * UNCONFIRMED). Goes through the existing `UNRESOLVED_SESSION:<sessionId>` path: DELIVERED releases the held value to PT / gym /
 * platform, NOT_DELIVERED refunds the client from the held amount (the contract's own money - no pooled balance is touched). The
 * UNCONFIRMED row turns SETTLED in the same transaction as the resolution, so the decision is applied exactly once. For
 * NOT_DELIVERED the caller (the admin ruling) has already put the session in a not-delivered state (CANCELLED / NO_SHOW).
 * Nothing calls this on its own: a person decides, from the reconciliation report.
 */
export async function resolveUnconfirmedSessionMoney(
  contractId: string,
  sessionId: string,
  outcome: UnresolvedOutcome,
): Promise<{ state: "NOT_HELD" | "WAITING" | SettleOutcome<ResolveAnswer>["state"] }> {
  const held = (await sessionSettlementRepository.findHeldSessionRows(contractId)).find(
    (r) => r.sessionId === sessionId && r.kind !== SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION,
  );
  if (!held) return { state: "NOT_HELD" };
  const answer = await resolveUnresolvedSessionMoney(contractId, sessionId, outcome, {}, { closeHeldRowId: held.id });
  if (!answer) return { state: "WAITING" }; // the ending is not confirmed yet - the resolution row waits for it
  // A resolution somebody else already settled: close the held row too (idempotent).
  if (answer.state === "ALREADY_SETTLED" || (answer.state === "SETTLED" && !answer.applied)) await sessionSettlementRepository.settleOnce(held.id, prisma);
  return { state: answer.state };
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
async function applyReleaseBookkeeping(tx: Tx, contractId: string, sessionId: string, result: any): Promise<void> {
  await contractRepository.addReleased(contractId, result.released, tx);
  logger.info(
    `[ContractPayout] Released session ${sessionId} of ${contractId}: pt=${result.released.pt} gym=${result.released.gym} platform=${result.released.platform}`,
  );
}

async function applyNoShowBookkeeping(tx: Tx, contractId: string, sessionId: string, result: any): Promise<void> {
  const fresh = await tx.contract.findUnique({ where: { id: contractId }, select: { notes: true } });
  await contractRepository.incrementCompensatedSessions(
    contractId,
    `${fresh?.notes ? fresh.notes + "\n" : ""}[${new Date().toISOString().slice(0, 10)}] PT vắng buổi ${sessionId}: bồi thường ${result.compensation}đ cho khách.`,
    tx,
  );
  if (Number(result.shortfall) > 0) {
    logger.warn(`[ContractPayout] No-show shortfall ${result.shortfall} on ${contractId} - the unpaid part is an open obligation to the client`);
  }
}

async function applyLateArrivalBookkeeping(_tx: Tx, contractId: string, _sessionId: string, result: any): Promise<void> {
  if (Number(result.shortfall) > 0) {
    logger.warn(`[ContractPayout] Late-arrival shortfall ${result.shortfall} on ${contractId} - the unpaid part is an open obligation to the client`);
  }
}

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
      apply: (tx, result) => applyReleaseBookkeeping(tx, contract.id, sessionId, result),
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
export async function compensateNoShowMoney(contractId: string, sessionId: string, mode: SettleMode = {}): Promise<SettleOutcome<any> | undefined> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return;

  const idempotencyKey = `PT_NO_SHOW:${sessionId}`;
  return settleTracked(
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
      validateFatal: invalidMoneyFigures,
      apply: (tx, result) => applyNoShowBookkeeping(tx, contract.id, sessionId, result),
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
export async function compensateLateArrivalMoney(contractId: string, sessionId: string, mode: SettleMode = {}): Promise<SettleOutcome<any> | undefined> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return;

  const idempotencyKey = `PT_LATE_ARRIVAL:${sessionId}`;
  return settleTracked(
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
      validateFatal: invalidMoneyFigures,
      apply: (tx, result) => applyLateArrivalBookkeeping(tx, contract.id, sessionId, result),
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
  | "CLIENT_EXIT_DUE_TO_PT_RESTRICTION"
  // D49 - the platform itself ends the service (e.g. a permanent PT ban). Full refund of the unused value, no fee, NOT PT fault: the PT's
  // held-back money goes back to the PT. It replaces PT_BANNED for every new ending (PT_BANNED stays only so an old ending can be replayed).
  | "SERVICE_DISCONTINUED_BY_PLATFORM";

const TERMINATION_REASONS: TerminationReason[] = [
  "CLIENT_CANCELLED",
  "PT_BANNED",
  "PT_CANCELLED",
  "MUTUAL",
  "EXPIRED",
  "COMPLETED",
  "PT_REPEATED_NO_SHOW",
  "CLIENT_EXIT_DUE_TO_PT_RESTRICTION",
  "SERVICE_DISCONTINUED_BY_PLATFORM",
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
 * FH-3c (D65-B) - what the ending decided about the session rows it could not settle: the rows whose value it HOLDS. The decision
 * is taken outside every lock (it needs the ledger lookup); the rows are flipped to UNCONFIRMED later, under the contract lock, in
 * the very transaction that records the ending.
 */
export interface SessionMoneyPlan {
  hold: Array<{ id: string; kind: SessionSettlementKind; sessionId: string | null }>;
}
const NO_PLAN: SessionMoneyPlan = { hold: [] };

/** The ledger operation kind payment-service files each session-level row under (LedgerOperationRecord.kind). */
const LEDGER_KIND_OF: Partial<Record<SessionSettlementKind, string>> = {
  [SessionSettlementKind.SESSION_RELEASE]: "RELEASE_SESSION",
  [SessionSettlementKind.PT_NO_SHOW_COMPENSATION]: "NO_SHOW",
  [SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION]: "LATE_ARRIVAL",
};

type UnsettledRow = Awaited<ReturnType<typeof sessionSettlementRepository.findUnsettledSessionMoney>>[number];

/**
 * FH-3c (a) - payment-service has ALREADY performed this row's operation (the lookup found its stored result): apply that result
 * locally, exactly once, in the SAME transaction that flips the row to SETTLED (releasedTo* / compensatedSessions), as if the
 * original answer had arrived. A record that does not belong to this row (another transaction, another operation kind) or is not
 * a valid confirmation is NEVER applied: the row is parked (CONFLICT / NEEDS_HUMAN) and the ending stays refused.
 */
async function applyStoredLedgerResult(
  row: { id: string; kind: SessionSettlementKind; contractId: string; sessionId: string | null },
  contract: ContractRow,
  record: LedgerOperationRecord,
): Promise<"APPLIED" | "BLOCKED"> {
  const expectedKind = LEDGER_KIND_OF[row.kind];
  if ((record.transactionId && record.transactionId !== contract.paymentTransactionId) || (record.kind && expectedKind && record.kind !== expectedKind)) {
    const note = `ledger operation ${record.key} belongs to transaction ${record.transactionId ?? "?"} / kind ${record.kind ?? "?"}, not to ${contract.paymentTransactionId} / ${expectedKind}`;
    await sessionSettlementRepository.park(row.id, CONFLICT_PREFIX, note);
    logger.error({ error: "[MoneyAttention] stored ledger operation does not match the settlement row - parked CONFLICT, nothing applied", contractId: row.contractId, note });
    return "BLOCKED";
  }
  const result = record.result as any;
  let invalid: string | null;
  switch (row.kind) {
    case SessionSettlementKind.SESSION_RELEASE:
      invalid = invalidRelease(result);
      break;
    case SessionSettlementKind.PT_NO_SHOW_COMPENSATION:
      invalid = invalidCompensation(result) ?? invalidMoneyFigures(result);
      break;
    case SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION:
      invalid = invalidLateArrival(result) ?? invalidMoneyFigures(result);
      break;
    default:
      invalid = `no stored-result bookkeeping for ${row.kind}`;
  }
  if (invalid) {
    await sessionSettlementRepository.park(row.id, NEEDS_RECONCILIATION_PREFIX, `the stored ledger result is not a valid confirmation: ${invalid}`);
    logger.error({ error: "[MoneyAttention] stored ledger result is not a valid confirmation - parked for a human, nothing applied", contractId: row.contractId, key: record.key, invalid });
    return "BLOCKED";
  }
  const sessionId = row.sessionId ?? "";
  await prisma.$transaction(async (tx) => {
    if (!(await sessionSettlementRepository.settleOnce(row.id, tx))) return; // somebody else applied it first
    if (row.kind === SessionSettlementKind.SESSION_RELEASE) await applyReleaseBookkeeping(tx, contract.id, sessionId, result);
    // A stored RECORD-ONLY answer (recordedOnly: an OPEN obligation, nothing paid) compensated nothing: the counter is not touched.
    else if (row.kind === SessionSettlementKind.PT_NO_SHOW_COMPENSATION) {
      if (result?.recordedOnly !== true) await applyNoShowBookkeeping(tx, contract.id, sessionId, result);
    }
    else await applyLateArrivalBookkeeping(tx, contract.id, sessionId, result);
    await tx.sessionSettlement.update({ where: { id: row.id }, data: { result: record.result as Prisma.InputJsonValue, appliedAt: new Date() } });
  });
  logger.info(`[ContractPayout] ${row.kind} ${row.id} of ${contract.id}: payment-service had already performed ${record.key} - stored result applied, row SETTLED`);
  return "APPLIED";
}

// ── D77: a client compensation the ledger never performed becomes an OPEN obligation, not a lost row ──────────────────────

/** The words stored with the obligation (payment-service cuts them to 120 characters in the admin report). */
function compensationObligationReason(kind: SessionSettlementKind, sessionId: string): string {
  return kind === SessionSettlementKind.PT_NO_SHOW_COMPENSATION
    ? `PT vắng mặt (buổi ${sessionId.slice(0, 8)}): khoản hoàn tiền chưa được thực hiện trước khi hợp đồng kết thúc; chưa chi tiền, chờ xử lý`
    : `PT vào muộn (buổi ${sessionId.slice(0, 8)}): khoản bồi thường chưa được thực hiện trước khi hợp đồng kết thúc; chưa chi tiền, chờ xử lý`;
}
const COMPENSATION_KINDS: SessionSettlementKind[] = [SessionSettlementKind.PT_NO_SHOW_COMPENSATION, SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION];

/**
 * D77 (owner decision, final) - the PT joined late, the contract is ending and payment-service has NEVER performed this session's
 * `PT_LATE_ARRIVAL:<sessionId>` compensation (its ledger lookup found no record). The row used to be parked UNCONFIRMED and held
 * nothing: the client's compensation lived only in a local status. Now payment-service writes it down - durably, under the very
 * same key - as an OPEN unpaid obligation to the client (kind LATE_ARRIVAL, owed = the late-arrival formula, paid = 0, a reason),
 * and this row turns terminal (SETTLED) with the answer stored in `result`, which names the obligationId.
 *
 *   - NO MONEY MOVES: not from this contract's pending, not from any pooled balance, nothing is fronted. A person who decides the
 *     client must still be paid does that outside the ledger and resolves / waives the obligation with the FH-8 CLI (audited).
 *   - Idempotent end to end: the ledger operation is keyed (retries and concurrent endings replay one obligation), the local flip
 *     is the apply-once gate (settleOnce).
 *   - If the ledger turns out to have performed the compensation after all (the answer carries no `recordedOnly: true`), its stored
 *     real result is applied exactly as applyStoredLedgerResult does.
 *   - An answer that cannot be trusted is parked (CONFLICT / NEEDS_HUMAN) and the ending stays refused; an unreachable payment-service
 *     leaves the row as it is and the ending stays refused too - the obligation must be durable BEFORE the ending is recorded.
 */
async function recordUnperformedCompensation(
  row: { id: string; kind: SessionSettlementKind; contractId: string; sessionId: string | null; idempotencyKey: string },
  contract: ContractRow,
): Promise<"RECORDED" | "APPLIED" | "BLOCKED"> {
  const sessionId = row.sessionId ?? "";
  const isNoShow = row.kind === SessionSettlementKind.PT_NO_SHOW_COMPENSATION;
  const what = isNoShow ? "no-show" : "late-arrival";
  let answer: any;
  try {
    answer = await (isNoShow ? paymentClient.recordNoShowObligation : paymentClient.recordLateArrivalObligation).call(paymentClient, {
      transactionId: contract.paymentTransactionId,
      price: contract.price!.toString(),
      totalSessions: contract.totalSessions,
      rates: ratesOf(contract),
      parties: partiesOf(contract),
      label: `Contract ${contract.id} ${isNoShow ? "no-show" : "PT late arrival"} ${sessionId}`,
      idempotencyKey: row.idempotencyKey,
      reason: compensationObligationReason(row.kind, sessionId),
    });
  } catch (e) {
    const refusal = ledgerRefusalOf(e);
    if (refusal) {
      await sessionSettlementRepository.park(row.id, CONFLICT_PREFIX, `payment-service refused to record the ${what} obligation (${refusal.code}): ${refusal.message}`);
      logger.error({ error: `[MoneyAttention] payment-service refused the ${what} obligation (${refusal.code}) - parked CONFLICT`, contractId: row.contractId, sessionId });
    } else {
      logger.warn(`[ContractPayout] ${row.contractId}: recording the ${what} obligation of ${sessionId} failed (${(e as Error).message}) - the ending stays refused, will be retried`);
    }
    return "BLOCKED";
  }
  const recordedOnly = answer?.recordedOnly === true;
  const invalid =
    (isNoShow ? invalidCompensation(answer) : invalidLateArrival(answer)) ??
    invalidMoneyFigures(answer) ??
    (recordedOnly && Number(answer.owed) > 0 && typeof answer.obligationId !== "string" ? "payment-service recorded no obligation for a compensation that is owed" : null) ??
    (recordedOnly && Number(answer.paid) !== 0 ? "payment-service reported a record-only answer that paid money" : null);
  if (invalid) {
    await sessionSettlementRepository.park(row.id, NEEDS_RECONCILIATION_PREFIX, `the ${what} obligation answer is not valid: ${invalid}`);
    logger.error({ error: `[MoneyAttention] ${what} obligation answer is not valid - parked for a human, nothing applied`, contractId: row.contractId, sessionId, invalid });
    return "BLOCKED";
  }
  await prisma.$transaction(async (tx) => {
    if (!(await sessionSettlementRepository.settleOnce(row.id, tx))) return; // a concurrent ending already closed it
    // A record-only answer compensated nothing, so the NO_SHOW counter (compensatedSessions) is NOT touched; a real one is applied as always.
    if (isNoShow) {
      if (!recordedOnly) await applyNoShowBookkeeping(tx, contract.id, sessionId, answer);
    } else await applyLateArrivalBookkeeping(tx, contract.id, sessionId, answer);
    await tx.sessionSettlement.update({ where: { id: row.id }, data: { result: answer as Prisma.InputJsonValue, appliedAt: new Date() } });
  });
  logger.info(
    recordedOnly
      ? `[ContractPayout] ${contract.id}: ${what} compensation of ${sessionId} was never performed - recorded as OPEN obligation ${answer.obligationId ?? "(owed 0)"} (owed ${answer.owed}, paid 0); row ${row.id} SETTLED, no money moved`
      : `[ContractPayout] ${contract.id}: ${what} compensation of ${sessionId} had been performed after all - stored result applied, row ${row.id} SETTLED`,
  );
  return recordedOnly ? "RECORDED" : "APPLIED";
}

/** A row an earlier build parked because its contract had ended before it settled ("ENDED_UNSETTLED: contract X is COMPLETED ..."): not an orphan marker. */
const isEndedUnsettledCompensation = (row: { status: string; lastError?: string | null }) =>
  row.status === "FAILED" && !!row.lastError && row.lastError.startsWith(`${ENDED_UNSETTLED_PREFIX} contract `);

/**
 * One client-compensation settlement row (PT no-show / PT late arrival) that is not SETTLED and whose contract has ENDED (or whose row an
 * earlier build left UNCONFIRMED / parked ENDED_UNSETTLED): ask the ledger, read-only; performed -> apply its stored result, not
 * performed -> record the OBLIGATION (owner rule: an obligation is never lost after the contract ends). Used by the settlement sweep
 * (natural completion never drains rows first). No money moves. SKIPPED = nothing to do (already settled, a live runner has it, the
 * premise is not met, no payment behind the contract).
 */
export async function settleEndedCompensationRow(rowId: string): Promise<"RECORDED" | "APPLIED" | "BLOCKED" | "SKIPPED"> {
  const row = await sessionSettlementRepository.findById(rowId);
  if (!row || !COMPENSATION_KINDS.includes(row.kind) || row.status === "SETTLED" || !row.sessionId) return "SKIPPED";
  if (row.status !== "UNCONFIRMED" && !isEndedUnsettledCompensation(row) && (isParkedRow(row) || isLiveRow(row))) return "SKIPPED";
  const contract = payableOrNull(await contractRepository.findById(row.contractId));
  if (!contract) return "SKIPPED";
  if (!(await assessSettlementRow(row)).ok) return "SKIPPED";
  let record: LedgerOperationRecord | null;
  try {
    record = await paymentClient.lookupLedgerOperation(row.idempotencyKey);
  } catch (e) {
    logger.warn(`[ContractPayout] ledger lookup for compensation row ${row.id} failed (${(e as Error).message}) - left as it is`);
    return "BLOCKED";
  }
  if (record) return (await applyStoredLedgerResult(row, contract, record)) === "APPLIED" ? "APPLIED" : "BLOCKED";
  return recordUnperformedCompensation(row, contract);
}

/**
 * Heals the compensation rows an EARLIER build left behind: late-arrival rows parked UNCONFIRMED (they hold nothing) and compensation rows
 * parked ENDED_UNSETTLED ("not paid - needs a human"). Each becomes an OPEN obligation or has its stored result applied. Bounded per tick.
 */
export async function healHeldLateArrivalRows(limit = 20): Promise<{ recorded: number; applied: number; blocked: number }> {
  const out = { recorded: 0, applied: 0, blocked: 0 };
  if (!settlingD65bEnabled()) return out;
  const rows = [
    ...(await sessionSettlementRepository.findHeldLateArrivalRows(limit)),
    ...(await sessionSettlementRepository.findEndedUnsettledCompensations(limit)),
  ];
  for (const row of rows) {
    const verdict = await settleEndedCompensationRow(row.id);
    if (verdict === "RECORDED") out.recorded++;
    else if (verdict === "APPLIED") out.applied++;
    else if (verdict === "BLOCKED") out.blocked++;
  }
  return out;
}

/**
 * FH-3c - what to do with the session rows an ending could neither run nor wait for (FAILED after a retry, parked NEEDS_HUMAN):
 * ask payment-service, read-only, whether it ever performed the operation under the row's key.
 *   - PERFORMED     -> the stored result is applied here ({@link applyStoredLedgerResult}); the row is SETTLED and the ending goes on.
 *   - NOT PERFORMED -> the session is treated like any unresolved session (D45-L3 / D52): the certain unused part is refunded now and
 *                      the session's value is HELD in the contract's own pending (the row becomes UNCONFIRMED in the ending's
 *                      transaction). A row whose session was never delivered / charged has a void premise instead: terminal,
 *                      and its key is released. A LATE-ARRIVAL row holds no session value: payment-service records it as an OPEN
 *                      obligation to the client (D77, recordUnperformedCompensation) and the row is terminal at once.
 *   - cannot tell   -> (payment-service unreachable, a conflicting record, a record that is not a valid confirmation, a live runner)
 *                      the row stays a blocker: the caller refuses the ending exactly as before.
 * A step that the ledger DID perform but the system no longer considers due is never voided - that is a human's decision.
 */
async function reconcileUnverifiedSessionMoney(contractId: string, left: UnsettledRow[]): Promise<{ plan: SessionMoneyPlan; blocked: number }> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return { plan: NO_PLAN, blocked: left.length };

  const candidates = left.filter((r) => r.status !== "CONFLICT" && !isLiveRow(r)).slice(0, 100);
  let blocked = left.length - candidates.length;
  const found = new Map<string, LedgerOperationRecord>();
  let lookupOk = candidates.length === 0;
  if (candidates.length > 0) {
    try {
      const answer = await paymentClient.lookupLedgerOperations(candidates.map((r) => r.idempotencyKey));
      for (const op of answer.operations) found.set(op.key, op);
      lookupOk = true;
    } catch (e) {
      logger.warn(`[ContractPayout] ${contractId}: ledger lookup failed (${(e as Error).message}) - the unverified session step(s) keep the ending refused`);
    }
  }
  if (!lookupOk) return { plan: NO_PLAN, blocked: left.length };

  const plan: SessionMoneyPlan = { hold: [] };
  for (const row of candidates) {
    const record = found.get(row.idempotencyKey);
    const verdict = await assessSettlementRow(row);
    const premiseVoid = !verdict.ok && "park" in verdict && verdict.code === "STATE";
    if (record) {
      if (!verdict.ok) {
        blocked++; // the ledger moved money for a step the system does not consider due: a human decides
        continue;
      }
      if ((await applyStoredLedgerResult(row, contract, record)) === "BLOCKED") blocked++;
      continue;
    }
    if (verdict.ok) {
      if (row.kind === SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION) {
        // D77: not held (it holds no session value) - written down as an OPEN obligation before the ending is recorded.
        if ((await recordUnperformedCompensation(row, contract)) === "BLOCKED") blocked++;
        continue;
      }
      plan.hold.push({ id: row.id, kind: row.kind, sessionId: row.sessionId });
    } else if (premiseVoid && (await sessionSettlementRepository.voidRow(row.id, (verdict as { park: string }).park))) {
      logger.warn(`[ContractPayout] ${row.kind} row ${row.id} of ${contractId}: premise void (${(verdict as { park: string }).park}) and the ledger never performed it - closed, key released`);
    } else {
      blocked++;
    }
  }
  return { plan, blocked };
}

/**
 * Settles every outstanding session-level money step of a RUNNING contract (release, no-show / late-arrival
 * compensation) BEFORE the ending is recorded - OUTSIDE any lock. The ending's snapshot {usedSessions, compensatedSessions,
 * alreadyReleased} and its refund formula assume every counted session was really paid; an unsettled one would be priced
 * again by the ending and paid a second time (D57 a1/a2). Idempotent: each row is re-run with its own key, which
 * payment-service de-duplicates, and its bookkeeping is applied once. A row a live request is processing right now is
 * WAITED for (not duplicated) up to SETTLEMENT_INFLIGHT_WAIT_MS.
 *
 * What still cannot be settled (FH-3c, SETTLING_D65B on): the ledger is asked read-only whether it performed the step
 * ({@link reconcileUnverifiedSessionMoney}) - performed: applied; not performed: HELD by the ending (returned in the plan, flipped
 * in the ending's transaction). Only a step whose state cannot be established (payment-service unreachable, a conflicting record,
 * a live runner) leaves the ending refused (409 SESSION_SETTLEMENT_PENDING), loudly, retried by the caller. With SETTLING_D65B=false
 * every unsettled step refuses the ending, as before.
 */
export async function settleUnsettledSessionMoneyFirst(contractId: string): Promise<SessionMoneyPlan> {
  // A contract that has already ended is only being healed / replayed: a compensation is never paid on top of a settled ending.
  const current = await contractRepository.findById(contractId);
  if (!current || isContractEnded(current)) return NO_PLAN;
  const d65b = settlingD65bEnabled();

  for (let round = 0; round < 2; round++) {
    const rows = await sessionSettlementRepository.findUnsettledSessionMoney(contractId, prisma, { excludeHeld: d65b });
    if (rows.length === 0) return NO_PLAN;
    for (const row of rows.slice(0, SETTLEMENT_DRAIN_LIMIT)) {
      if (isParkedRow(row)) continue; // needs a human (or, with D65-B, the ledger lookup below); it would keep the ending refused
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
        // D65-B: a "never due" verdict is decided together with the ledger lookup below (void only if the ledger never did it).
        if ("park" in verdict && !(d65b && verdict.code === "STATE")) {
          await sessionSettlementRepository.park(cur.id, NEEDS_RECONCILIATION_PREFIX, verdict.park);
        }
        continue;
      }
      await runSessionMoneyRow(cur);
    }
  }
  const left = await sessionSettlementRepository.findUnsettledSessionMoney(contractId, prisma, { excludeHeld: d65b });
  if (left.length === 0) return NO_PLAN;
  if (!d65b) throw settlementPendingError(left.length);

  const { plan, blocked } = await reconcileUnverifiedSessionMoney(contractId, left);
  if (blocked > 0) throw settlementPendingError(blocked);
  const after = await sessionSettlementRepository.findUnsettledSessionMoney(contractId, prisma, { excludeHeld: true });
  const planned = new Set(plan.hold.map((h) => h.id));
  const unplanned = after.filter((r) => !planned.has(r.id));
  if (unplanned.length > 0) throw settlementPendingError(unplanned.length);
  return plan;
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

/** A planned hold could not be flipped (a runner took the row meanwhile): the transaction is rolled back and the ending tries again. */
class HoldRaceError extends Error {}

/**
 * STEP 1 of an ending - RECORD it (D58/D59). Under the contract lock, for milliseconds and with no network call inside:
 * nothing outstanding may remain (see settleUnsettledSessionMoneyFirst), then the accepted ending - reason, who/why
 * text - is written durably as the contract's CONTRACT_TERMINATION intent row. From the moment this commits the
 * contract is ENDING: every money-changing action on it answers 409 CONTRACT_ENDING, so its counters and released
 * amounts are frozen, and any retry, sweep or other caller carries on with THIS ending (same reason, same key
 * `CONTRACT_TERMINATE:<id>`) - nothing is recomputed. Returns null when the contract does not exist.
 *
 * FH-3c: the session rows the drain decided to HOLD (`plan`) are the only outstanding rows allowed; they are flipped to UNCONFIRMED in
 * this same transaction (compare-and-set, so a runner that took one meanwhile makes the attempt start over), which is what makes
 * "an UNCONFIRMED row exists" imply "an ending is recorded". Only a NEW ending holds rows: a resumed one keeps refusing.
 *
 * `drain: false` = the caller (client-exit, which holds the PT lock) already settled outstanding steps outside its lock and passes
 * the resulting `plan`; finding any other outstanding step refuses the ending (409 SESSION_SETTLEMENT_PENDING) instead of waiting
 * on the network under that lock.
 */
export async function beginContractTermination(
  contractId: string,
  reason: TerminationReason,
  extra?: TerminationStatusExtra,
  opts: { drain?: boolean; plan?: SessionMoneyPlan } = {},
): Promise<TerminationIntent | null> {
  const drain = opts.drain ?? true;
  const d65b = settlingD65bEnabled();
  let plan = opts.plan ?? NO_PLAN;
  for (let round = 1; round <= MAX_BEGIN_ROUNDS; round++) {
    if (drain) plan = await settleUnsettledSessionMoneyFirst(contractId);

    let outcome;
    try {
      outcome = await withContractLock(contractId, async (tx) => {
        const raw = await contractRepository.findById(contractId, tx);
        if (!raw) return { kind: "NOT_FOUND" as const };
        const ended = isContractEnded(raw);
        let holds: UnsettledRow[] = [];
        if (!ended) {
          const outstanding = await sessionSettlementRepository.findUnsettledSessionMoney(contractId, tx, { excludeHeld: d65b });
          if (outstanding.length > 0) {
            const planned = new Set(plan.hold.map((h) => h.id));
            const resumedEnding = d65b ? await sessionSettlementRepository.findTerminationRow(contractId, tx) : null;
            if (!d65b || resumedEnding || outstanding.some((r) => !planned.has(r.id))) return { kind: "OUTSTANDING" as const, count: outstanding.length };
            holds = outstanding;
          }
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
            snapshotFacts: contractMoneyFacts(raw),
          },
          tx,
        );
        // FH-3c: the held rows, in the SAME transaction as the intent. If any of them was taken by a runner meanwhile, nothing is kept.
        for (const h of holds) {
          const held = await sessionSettlementRepository.holdUnconfirmed(
            h.id,
            `payment-service never performed ${h.idempotencyKey}; the ending HOLDS this session's value (SETTLING_D65B) - an admin decides it (resolve as DELIVERED / NOT_DELIVERED)`,
            tx,
          );
          if (!held) throw new HoldRaceError();
        }
        return { kind: "INTENT" as const, raw, rowId: row.id, reason: recorded, resumed: false };
      });
    } catch (e) {
      if (e instanceof HoldRaceError) {
        if (!drain || round === MAX_BEGIN_ROUNDS) throw settlementPendingError(plan.hold.length);
        continue; // a runner took a row we meant to hold: settle / decide again
      }
      throw e;
    }

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
  if (row.status !== "SETTLED" && !isParkedRow(row)) await sessionSettlementRepository.markFailed(row.id, message);
}

/**
 * FH-3b (DQ-8) - NATURAL COMPLETION, atomically: the contract goes ACTIVE -> COMPLETED and its CONTRACT_TERMINATION intent
 * (reason COMPLETED, key `CONTRACT_TERMINATE:<id>`, the same row beginContractTermination records for every other ending) is
 * written in ONE transaction. Before, the status was written first and the intent afterwards (contract.service.ts), so a crash
 * between the two left a COMPLETED contract with no intent: the settlement sweep never saw it, and the PT / gym were never
 * paid out of the contract's pending money.
 *
 * The status flip is the same guarded UPDATE as before (only an ACTIVE contract; null = it ended another way meanwhile and that
 * ending owns the contract and its money). A contract with no money behind it (never paid / unpriced) records no intent, exactly
 * as every other ending. COMPLETED does NOT mean the money moved: that is the row turning SETTLED, in the transaction that applies
 * payment-service's confirmed answer (completeContractTermination) - see findEndedPaidWithoutSettledTermination.
 *
 * Takes no contract lock on purpose: the guarded UPDATE is the compare-and-set, the intent upsert is idempotent on its unique key,
 * and callers (checkAndCompleteContract) may run next to code that holds the PT lock (lock order: PT first, contract second).
 */
export async function completeContractRecordingEnding(contractId: string, extra: { completedAt: Date }): Promise<ContractRow | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.contract.updateMany({
      where: { id: contractId, status: ContractStatus.ACTIVE },
      data: { status: ContractStatus.COMPLETED, ...extra },
    });
    if (count === 0) return null;
    const contract = await contractRepository.findById(contractId, tx);
    if (!contract) return null;
    if (payableOrNull(contract)) {
      await sessionSettlementRepository.upsertPending(
        {
          kind: SessionSettlementKind.CONTRACT_TERMINATION,
          idempotencyKey: `CONTRACT_TERMINATE:${contractId}`,
          sessionId: null,
          contractId,
          reason: "COMPLETED",
          snapshotFacts: contractMoneyFacts(contract),
        },
        tx,
      );
    }
    return contract;
  });
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
      if (cur && isParkedRow(cur)) {
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
        // FH-3c: a delivered session whose release the ledger never performed is HELD (counted in unresolvedSessions), not also used.
        usedSessions: Math.max(0, contract.usedSessions - (terms.heldDelivered ?? 0)),
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
      const refusal = ledgerRefusalOf(e);
      if (refusal) {
        // FH-2b: payment-service refused BEFORE writing anything. Retrying only repeats the refusal: park CONFLICT, alert, no retry.
        const note = `payment-service refused the termination (${refusal.code}): ${refusal.message}`;
        await sessionSettlementRepository.park(intent.rowId, CONFLICT_PREFIX, note);
        logger.error({ error: `[MoneyAttention] payment-service refused the contract ending (${refusal.code}) - parked CONFLICT, will not be retried`, contractId, message: refusal.message });
        throw Object.assign(codedError(`Việc kết thúc hợp đồng cần được kiểm tra thủ công: ${note}`, 409, CONTRACT_ENDING_CONFLICT), { cause: e });
      }
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

    const malformed = invalidMoneyFigures(result);
    if (malformed) {
      // FH-3: the figures contradict each other (paid > owed, unpaid != owed - paid ...). Nothing is applied and a retry replays the same answer.
      await sessionSettlementRepository.park(intent.rowId, NEEDS_RECONCILIATION_PREFIX, `malformed payment-service termination answer: ${malformed}`);
      logger.error({ error: "[MoneyAttention] payment-service's termination answer has contradicting figures - parked for a human, nothing applied", contractId, malformed });
      throw codedError(`Việc kết thúc hợp đồng cần được kiểm tra thủ công: ${malformed}`, 409, CONTRACT_ENDING_CONFLICT);
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
 * FH-9. Asks payment-service to release what is still held for the PT on an ENDED contract. Called by the holdback sweep
 * (contractService.releaseDueHoldbacks). payment-service decides from its own ledger whether the release is due (the ending is
 * recorded and nothing of the contract is unreconciled), moves the money and answers what it moved and what is still held; nothing
 * here computes or sends an amount. Idempotent on payment-service's side (the amount is derived from the contract's own HOLDBACK, which
 * the release empties; a final answer is stored under `HOLDBACK_RELEASE:<contractId>`), so a retry after a crash can never pay twice.
 * Throws on failure, unlike the best-effort session release: the sweep leaves the contract un-marked and tries again on its next tick.
 */
export async function releaseHoldbackMoney(
  contractId: string,
): Promise<{ released: string; heldAfter: string; ended: boolean; reconciled: boolean; blockedBy?: unknown } | null> {
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
    // D77: naming the payment transaction lets payment-service account for the late-arrival compensations the ledger holds for it
    // (deducted from the sessions they were paid for) - the very facts terminate uses - so the quote equals what is credited.
    ...(contract.paymentTransactionId ? { transactionId: contract.paymentTransactionId } : {}),
    price: contract.price.toString(),
    totalSessions: contract.totalSessions,
    usedSessions: Math.max(0, contract.usedSessions - (terms?.heldDelivered ?? 0)),
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
