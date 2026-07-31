import { randomUUID } from 'crypto';
import { logger } from '@gym-coach/shared';
import { membershipRepository } from '../repositories/membership.repository';
import { planRepository } from '../repositories/plan.repository';
import { gymService } from './gym.service';
import { paymentClient } from '../clients/payment.client';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/** Shared payment-attempt logic for both first purchase and retry-pay (plan §2.3). */
async function attemptPayment(contract: { id: string; gymId: string; priceAtPurchase: any; status: string; paymentTxnId: string | null }, clientId: string) {
  if (contract.status === 'ACTIVE' || contract.paymentTxnId) {
    throw err('ALREADY_PAID', 409);
  }

  const attemptId = randomUUID();
  const idempotencyKey = `gym-membership:${contract.id}:attempt:${attemptId}`;

  const result = await paymentClient.walletTransfer({
    payerOwnerId: clientId,
    receiverOwnerId: contract.gymId,
    amount: Number(contract.priceAtPurchase),
    relatedEntityId: contract.id,
    idempotencyKey,
    initiatedBy: clientId,
    gymId: contract.gymId,
  });

  if (result.status === 'PAID') {
    const { contract: activated } = await membershipRepository.activateIfPending(contract.id, result.transactionId);
    try {
      await paymentClient.markActivated(result.transactionId);
    } catch (e) {
      // Local activation already succeeded; payment-service's reconciliation job will
      // retry the mark-activated callback and/or the activate endpoint itself.
      logger.warn({ error: 'mark-activated callback failed, reconciliation will retry', membershipId: contract.id, message: (e as Error).message });
    }
    return { membership: activated, payment: result };
  }

  return { membership: await membershipRepository.findById(contract.id), payment: result };
}

export const membershipService = {
  async purchase(gymId: string, planId: string, clientId: string) {
    const plan = await planRepository.findById(planId);
    if (!plan || plan.gymId !== gymId || plan.status !== 'ACTIVE') throw err('Plan not found or inactive', 404);

    const existingOpen = await membershipRepository.findOpenByClientAndGym(clientId, gymId);
    if (existingOpen) {
      await membershipRepository.expireIfPastEndDate(existingOpen);
      const recheck = await membershipRepository.findOpenByClientAndGym(clientId, gymId);
      if (recheck) {
        if (recheck.status === 'PENDING_PAYMENT') {
          const e = err('ALREADY_HAS_PENDING_MEMBERSHIP', 409);
          throw Object.assign(e, { membershipId: recheck.id });
        }
        throw err('ALREADY_HAS_OPEN_MEMBERSHIP', 409);
      }
    }

    let contract;
    try {
      contract = await membershipRepository.create({
        gym: { connect: { id: gymId } },
        plan: { connect: { id: planId } },
        clientId,
        priceAtPurchase: plan.price,
        durationDaysSnapshot: plan.durationDays,
        totalVisits: plan.visitLimit,
      });
    } catch {
      // Unique-index race — the DB constraint is the real guard against two concurrent
      // purchase requests both slipping past the app-level pre-check above.
      throw err('ALREADY_HAS_OPEN_MEMBERSHIP', 409);
    }

    return attemptPayment(contract, clientId);
  },

  async retryPay(membershipId: string, clientId: string) {
    const contract = await membershipRepository.findById(membershipId);
    if (!contract) throw err('Membership not found', 404);
    if (contract.clientId !== clientId) throw err('Not authorized', 403);
    if (contract.status === 'ACTIVE' || contract.paymentTxnId) throw err('ALREADY_PAID', 409);
    if (contract.status !== 'PENDING_PAYMENT') throw err(`Cannot pay for membership in ${contract.status} status`, 400);
    return attemptPayment(contract, clientId);
  },

  async cancelPending(membershipId: string, clientId: string) {
    const contract = await membershipRepository.findById(membershipId);
    if (!contract) throw err('Membership not found', 404);
    if (contract.clientId !== clientId) throw err('Not authorized', 403);
    if (contract.status !== 'PENDING_PAYMENT') throw err(`Cannot cancel membership in ${contract.status} status`, 400);
    return membershipRepository.cancelIfPending(membershipId);
  },

  /** Compute the prorated refund (by remaining days) for an ACTIVE membership, without mutating. */
  quoteRefund(contract: { priceAtPurchase: any; durationDaysSnapshot: number; startDate: Date | null; endDate: Date | null }) {
    const now = Date.now();
    const totalMs = contract.durationDaysSnapshot * 24 * 60 * 60 * 1000;
    const end = contract.endDate ? contract.endDate.getTime() : now;
    const remainingMs = Math.max(0, end - now);
    const fraction = totalMs > 0 ? Math.min(1, remainingMs / totalMs) : 0;
    const refundAmount = Math.round(Number(contract.priceAtPurchase) * fraction * 100) / 100;
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    return { refundAmount, remainingDays, fraction };
  },

  /**
   * Client cancels their own ACTIVE membership and gets a PRORATED refund (by remaining days).
   * Refunds the unused portion to the client wallet, debits the gym + platform proportionally
   * (payment-service does the ledger reversal), then marks the membership CANCELLED. The used
   * portion is forfeited.
   */
  async refund(membershipId: string, clientId: string) {
    const contract = await membershipRepository.findById(membershipId);
    if (!contract) throw err('Membership not found', 404);
    if (contract.clientId !== clientId) throw err('Not authorized', 403);
    if (contract.status === 'ACTIVE' && contract.endDate && contract.endDate < new Date()) {
      await membershipRepository.expireIfPastEndDate(contract);
      throw err('Membership has already expired', 409);
    }
    if (contract.status !== 'ACTIVE') throw err(`Cannot refund a membership in ${contract.status} status`, 409);
    if (!contract.paymentTxnId) throw err('No payment on record to refund', 409);

    const { refundAmount, remainingDays } = this.quoteRefund(contract);

    let refund = null;
    if (refundAmount >= 1) {
      refund = await paymentClient.refund({
        originalTransactionId: contract.paymentTxnId,
        refundAmount,
        idempotencyKey: `gym-membership-refund:${contract.id}:${randomUUID()}`,
        initiatedBy: clientId,
        reason: 'Client cancelled membership (prorated refund)',
      });
    }

    const cancelled = await membershipRepository.cancelAfterRefund(contract.id);
    return { membership: cancelled, refundAmount, remainingDays, refund };
  },

  async listForClient(clientId: string) {
    const list = await membershipRepository.findByClient(clientId);
    const result = [];
    for (const m of list) {
      result.push((await membershipRepository.expireIfPastEndDate(m)) ?? m);
    }
    return result;
  },

  async getForClient(membershipId: string, clientId: string) {
    const m = await membershipRepository.findById(membershipId);
    if (!m) throw err('Membership not found', 404);
    if (m.clientId !== clientId) throw err('Not authorized', 403);
    return (await membershipRepository.expireIfPastEndDate(m)) ?? m;
  },

  async listForOwner(gymId: string, ownerId: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    return membershipRepository.findByGym(gymId);
  },

  /** Called by the internal /activate endpoint — verifies the transaction before activating. */
  async activateViaTransaction(membershipId: string, transactionId: string) {
    const txn = await paymentClient.getTransaction(transactionId);
    if (!txn || txn.status !== 'PAID' || txn.relatedEntityType !== 'GYM_MEMBERSHIP' || txn.relatedEntityId !== membershipId) {
      throw err('Transaction verification failed', 400);
    }
    const { contract } = await membershipRepository.activateIfPending(membershipId, transactionId);
    return contract;
  },

  /** Called by the internal /cancel-after-refund endpoint — verifies both transactions first. */
  async cancelAfterRefundViaTransaction(membershipId: string, originalTransactionId: string, refundTransactionId: string) {
    const [original, refund] = await Promise.all([
      paymentClient.getTransaction(originalTransactionId),
      paymentClient.getTransaction(refundTransactionId),
    ]);
    if (!original || original.status !== 'REFUNDED' || original.relatedEntityId !== membershipId) {
      throw err('Original transaction verification failed', 400);
    }
    if (!refund || refund.status !== 'PAID' || refund.refundOfTransactionId !== originalTransactionId) {
      throw err('Refund transaction verification failed', 400);
    }
    return membershipRepository.cancelAfterRefund(membershipId);
  },
};
