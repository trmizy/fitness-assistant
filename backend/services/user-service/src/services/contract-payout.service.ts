import { logger } from "@gym-coach/shared";
import { Prisma, ContractStatus, SessionSettlementKind } from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { settleTracked } from "./session-settlement.service";

/** Every termination reason ends the contract in exactly one of these two final states. */
function statusFor(reason: string): ContractStatus {
  if (reason === "COMPLETED") return ContractStatus.COMPLETED;
  if (reason === "EXPIRED") return ContractStatus.EXPIRED;
  return ContractStatus.CANCELLED; // CLIENT_CANCELLED, PT_CANCELLED, PT_BANNED, MUTUAL, PT_REPEATED_NO_SHOW
}

/**
 * Tells payment-service to move a contract's money when a session's outcome is settled.
 *
 * user-service owns the contract; payment-service owns the ledger. Nothing here computes an
 * amount — it passes the contract's frozen rate table across and records what came back, so
 * there is exactly one implementation of the formulas in the system.
 */

type ContractRow = NonNullable<Awaited<ReturnType<typeof contractRepository.findById>>>;

function ratesOf(c: ContractRow) {
  return {
    platformRate: c.platformRate.toString(),
    ptRate: c.ptRate.toString(),
    gymRate: c.gymRate.toString(),
  };
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

/**
 * One confirmed session's worth of money moves from pending to available for all three
 * parties.
 *
 * Deliberately best-effort: a payment-service outage must not roll back a session the client
 * has already confirmed, because the session genuinely happened. A missed release is
 * self-healing — termination settles each party up to `rate × (P − refund)` regardless of how
 * much was released along the way, so the only lasting effect is that the PT waits longer for
 * money they still receive in full.
 */
export async function releaseSessionMoney(contractId: string, sessionId: string): Promise<void> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return;

  const idempotencyKey = `SESSION_RELEASE:${sessionId}`;
  // Money-flow plan 1.6: tracked so a failed release is retried by the settlement sweep
  // instead of only ever being reconciled whenever the contract eventually terminates.
  await settleTracked({ kind: SessionSettlementKind.SESSION_RELEASE, idempotencyKey, contractId, sessionId }, async () => {
    const result = await paymentClient.releaseSession({
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
    });

    // Track what has actually been paid out so termination can top each party up to their
    // final entitlement instead of paying the released part twice.
    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        releasedToPt: { increment: new Prisma.Decimal(result.released.pt) },
        releasedToGym: { increment: new Prisma.Decimal(result.released.gym) },
        releasedToPlatform: { increment: new Prisma.Decimal(result.released.platform) },
      },
    });

    logger.info(
      `[ContractPayout] Released session ${sessionId} of ${contract.id}: pt=${result.released.pt} gym=${result.released.gym} platform=${result.released.platform}`,
    );
  });
}

/**
 * The PT did not turn up. The client is compensated one session's value, charged to the three
 * parties in proportion, and the contract's entitlement is consumed by one.
 *
 * Money-flow plan 1.5: `totalSessions` (purchasedSessions) and `price` are immutable once
 * signed — a no-show used to decrement `totalSessions`, which made every subsequent session's
 * unit price (price / totalSessions) drift, and it left a 1-session contract with nothing left
 * to decrement (client kept both the cash AND the right to book the session again).
 * `compensatedSessions` records the same fact — one fewer entitlement owed — without touching
 * the numbers every other formula divides by. See `getRemainingEntitlements` in
 * contract.service.ts for where this is read back.
 *
 * Money-flow plan 1.6: does NOT throw on failure (a previous version did, on the reasoning
 * that swallowing it would silently short-change the client — but both of its callers,
 * `markNoShow` and `addException`, flip the session to NO_SHOW BEFORE calling this, and that
 * status transition already commits regardless. A thrown error here does not undo it — it only
 * blocks every future retry, because both callers' status guards refuse to touch a session that
 * is already NO_SHOW. `settleTracked` records the failure instead, and the settlement sweep
 * retries it — the client is still short-changed for a while, but not permanently and silently.
 */
export async function compensateNoShowMoney(contractId: string, sessionId: string): Promise<void> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return;

  const idempotencyKey = `PT_NO_SHOW:${sessionId}`;
  await settleTracked(
    { kind: SessionSettlementKind.PT_NO_SHOW_COMPENSATION, idempotencyKey, contractId, sessionId },
    async () => {
      const result = await paymentClient.noShow({
        transactionId: contract.paymentTransactionId,
        price: contract.price!.toString(),
        totalSessions: contract.totalSessions,
        rates: ratesOf(contract),
        parties: partiesOf(contract),
        label: `Contract ${contract.id} no-show ${sessionId}`,
        idempotencyKey,
      });

      await contractRepository.incrementCompensatedSessions(
        contract.id,
        `${contract.notes ? contract.notes + "\n" : ""}[${new Date().toISOString().slice(0, 10)}] PT vắng buổi ${sessionId}: bồi thường ${result.compensation}đ cho khách.`,
      );

      if (Number(result.shortfall) > 0) {
        logger.warn(
          `[ContractPayout] No-show shortfall ${result.shortfall} on ${contractId} — platform fronted it, receivable raised against the PT`,
        );
      }
    },
  );
}

/**
 * Open-room online session — the PT joined the room, but after the grace window past the
 * scheduled start. The client's entitlement is untouched (this is not a no-show — the PT did
 * show up), but they are compensated in cash at half a full no-show's rate. A near-duplicate
 * of compensateNoShowMoney above rather than a shared helper, for the same reason
 * payment-service's compensateLateArrival is its own function: that one is relied on exactly
 * as-is by its existing callers.
 */
export async function compensateLateArrivalMoney(contractId: string, sessionId: string): Promise<void> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return;

  const idempotencyKey = `PT_LATE_ARRIVAL:${sessionId}`;
  await settleTracked(
    { kind: SessionSettlementKind.PT_LATE_ARRIVAL_COMPENSATION, idempotencyKey, contractId, sessionId },
    async () => {
      const result = await paymentClient.lateArrival({
        transactionId: contract.paymentTransactionId,
        price: contract.price!.toString(),
        totalSessions: contract.totalSessions,
        rates: ratesOf(contract),
        parties: partiesOf(contract),
        label: `Contract ${contract.id} PT late arrival ${sessionId}`,
        idempotencyKey,
      });

      if (Number(result.shortfall) > 0) {
        logger.warn(
          `[ContractPayout] Late-arrival shortfall ${result.shortfall} on ${contractId} — platform fronted it, receivable raised against the PT`,
        );
      }
    },
  );
}

export type TerminationReason =
  | "CLIENT_CANCELLED"
  | "PT_BANNED"
  | "PT_CANCELLED"
  | "MUTUAL"
  | "EXPIRED"
  | "COMPLETED"
  // Vòng 4 / Phase E2 — the client's own right to terminate after a 3rd PT no-show
  // (ptAtFault), not an admin/system decision. Same 100%-refund-of-remaining formula as
  // PT_BANNED/MUTUAL (contract-money.ts) — the PT is at fault here too, just via a pattern of
  // no-shows rather than a single administrative ban.
  | "PT_REPEATED_NO_SHOW";

/**
 * Settle a contract's money for good: refund the client per the reason's formula and bring
 * every party to their final entitlement.
 */
export async function terminateContractMoney(
  contractId: string,
  reason: TerminationReason,
): Promise<any> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return null;

  const result = await paymentClient.terminate({
    transactionId: contract.paymentTransactionId,
    price: contract.price!.toString(),
    totalSessions: contract.totalSessions,
    usedSessions: contract.usedSessions,
    // Money-flow plan 1.5 / P0 cluster A1: without this, payment-service's remainingValue()
    // does not know a no-show session was already compensated in cash, and counts it as
    // still-unused entitlement on top of the cash payout the client already received —
    // paying the same session's value twice.
    compensatedSessions: contract.compensatedSessions,
    rates: ratesOf(contract),
    reason,
    alreadyReleased: {
      pt: contract.releasedToPt.toString(),
      gym: contract.releasedToGym.toString(),
      platform: contract.releasedToPlatform.toString(),
    },
    parties: partiesOf(contract),
    label: `Contract ${contract.id} termination`,
    // Money-flow redesign plan 1.1: a contract only ever terminates once, regardless of
    // which reason triggers it — this key is stable across retries of the SAME termination.
    idempotencyKey: `CONTRACT_TERMINATE:${contract.id}`,
  });

  // Money settles above regardless — this must still land, or the contract stays ACTIVE
  // forever with its escrow already emptied: assertSlotBookable only gates on status, so a
  // client could keep booking new sessions against a contract that has no money left behind
  // it.
  await prisma.contract.update({
    where: { id: contract.id },
    data: { terminationReason: reason as any, terminatedAt: new Date(), status: statusFor(reason) },
  });

  return result;
}

/** What the client would get back if they cancelled right now, and where the money stands. */
export async function moneyBreakdown(contractId: string): Promise<any> {
  const contract = await contractRepository.findById(contractId);
  if (!contract || contract.price == null || contract.totalSessions <= 0) return null;

  const breakdown = await paymentClient.moneyBreakdown({
    price: contract.price.toString(),
    totalSessions: contract.totalSessions,
    usedSessions: contract.usedSessions,
    // Same reason as terminateContractMoney above — a preview of "what would I get back right
    // now" must also exclude compensated sessions from the still-pending pool it quotes.
    compensatedSessions: contract.compensatedSessions,
    rates: ratesOf(contract),
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
