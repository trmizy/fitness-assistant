import { logger } from "@gym-coach/shared";
import { Prisma, ContractStatus } from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";

/** Every termination reason ends the contract in exactly one of these two final states. */
function statusFor(reason: string): ContractStatus {
  if (reason === "COMPLETED") return ContractStatus.COMPLETED;
  if (reason === "EXPIRED") return ContractStatus.EXPIRED;
  return ContractStatus.CANCELLED; // CLIENT_CANCELLED, PT_CANCELLED, PT_BANNED, MUTUAL
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

  try {
    const result = await paymentClient.releaseSession({
      transactionId: contract.paymentTransactionId,
      price: contract.price!.toString(),
      totalSessions: contract.totalSessions,
      rates: ratesOf(contract),
      parties: partiesOf(contract),
      label: `Contract ${contract.id} session ${sessionId}`,
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
  } catch (e) {
    logger.error({
      error: "Session money release failed — termination will reconcile it",
      contractId,
      sessionId,
      message: (e as Error).message,
    });
  }
}

/**
 * The PT did not turn up. The client is compensated one session's value, charged to the three
 * parties in proportion, and the contract loses a session from its quota.
 *
 * Dropping totalSessions is not bookkeeping tidiness — without it the client holds both the
 * cash for the missed session and the right to book it again, and would be paid twice.
 */
export async function compensateNoShowMoney(contractId: string, sessionId: string): Promise<void> {
  const contract = payableOrNull(await contractRepository.findById(contractId));
  if (!contract) return;

  // A one-session contract cannot shrink any further; refuse rather than divide by zero.
  if (contract.totalSessions <= 1) {
    logger.warn(`[ContractPayout] Contract ${contractId} has one session left — compensating without shrinking quota`);
  }

  try {
    const result = await paymentClient.noShow({
      transactionId: contract.paymentTransactionId,
      price: contract.price!.toString(),
      totalSessions: contract.totalSessions,
      rates: ratesOf(contract),
      parties: partiesOf(contract),
      label: `Contract ${contract.id} no-show ${sessionId}`,
    });

    if (contract.totalSessions > 1) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          totalSessions: { decrement: 1 },
          notes: `${contract.notes ? contract.notes + "\n" : ""}[${new Date().toISOString().slice(0, 10)}] PT vắng buổi ${sessionId}: bồi thường ${result.compensation}đ cho khách, tổng số buổi giảm còn ${contract.totalSessions - 1}.`,
        },
      });
    }

    if (Number(result.shortfall) > 0) {
      logger.warn(
        `[ContractPayout] No-show shortfall ${result.shortfall} on ${contractId} — platform fronted it, receivable raised against the PT`,
      );
    }
  } catch (e) {
    logger.error({
      error: "No-show compensation failed",
      contractId,
      sessionId,
      message: (e as Error).message,
    });
    throw e; // the client is owed money — surface this rather than swallowing it
  }
}

export type TerminationReason =
  | "CLIENT_CANCELLED"
  | "PT_BANNED"
  | "PT_CANCELLED"
  | "MUTUAL"
  | "EXPIRED"
  | "COMPLETED";

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
    rates: ratesOf(contract),
    reason,
    alreadyReleased: {
      pt: contract.releasedToPt.toString(),
      gym: contract.releasedToGym.toString(),
      platform: contract.releasedToPlatform.toString(),
    },
    parties: partiesOf(contract),
    label: `Contract ${contract.id} termination`,
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
