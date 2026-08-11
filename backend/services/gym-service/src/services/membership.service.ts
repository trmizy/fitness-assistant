import { randomUUID } from 'crypto';
import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { membershipRepository } from '../repositories/membership.repository';
import { referralRepository } from '../repositories/referral.repository';
import { planRepository } from '../repositories/plan.repository';
import { profileClient } from '../clients/profile.client';
import { gymService } from './gym.service';
import { collaborationService } from './collaboration.service';
import { paymentClient } from '../clients/payment.client';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/** The platform's cut of a membership. Floored at 10%, same as PT contracts. */
const PLATFORM_RATE = (() => {
  const raw = Number(process.env.PLATFORM_COMMISSION_RATE ?? '0.10');
  return (Number.isFinite(raw) && raw >= 0.1 && raw <= 1 ? raw : 0.1).toFixed(4);
})();

/** PT's cut of a membership sale they referred — carved out of the GYM's own share, never
 * the platform's (money-flow plan §2.5/A3). */
const REFERRAL_RATE = (() => {
  const raw = Number(process.env.GYM_MEMBERSHIP_REFERRAL_RATE ?? '0.10');
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.1;
})();

/** The only three reasons an admin may refund a membership (money-flow plan §2.4). A free-text
 * reason would let "the client asked nicely" quietly become a fourth, unapproved reason. */
export const ADMIN_REFUND_REASONS = ['GYM_VIOLATION_SUSPENDED', 'GYM_CLOSED', 'TRANSACTION_ERROR'] as const;
export type AdminRefundReason = (typeof ADMIN_REFUND_REASONS)[number];

/**
 * Start payment for a membership at the payer's chosen gateway.
 *
 * Returns a redirect rather than a settled payment. The membership activates only once
 * payment-service receives the gateway's signed webhook and has put the price into escrow —
 * activating on this response would mean trusting the browser about whether money moved.
 */
async function attemptPayment(
  contract: { id: string; gymId: string; priceAtPurchase: any; status: string; paymentTxnId: string | null },
  clientId: string,
  provider?: string,
) {
  if (contract.status === 'ACTIVE' || contract.paymentTxnId) {
    throw err('ALREADY_PAID', 409);
  }

  // A fresh key per attempt: an abandoned checkout must not block the client trying again.
  const attemptId = randomUUID();
  const idempotencyKey = `gym-membership:${contract.id}:attempt:${attemptId}`;

  const result = await paymentClient.checkout({
    membershipId: contract.id,
    gymId: contract.gymId,
    clientId,
    amount: Number(contract.priceAtPurchase),
    platformRate: PLATFORM_RATE,
    idempotencyKey,
    provider,
    orderInfo: `Goi hoi vien ${contract.id}`.slice(0, 100),
  });

  logger.info(`[Membership] Checkout started for ${contract.id} via ${result.provider}`);
  return { membership: await membershipRepository.findById(contract.id), payment: result };
}

export const membershipService = {
  /**
   * First purchase at a gym. `referralCode`, when present, credits a PT for bringing this
   * client in — see §2.5's ordered checks: every one of them must pass before a
   * GymMembershipReferral row is created, so a rejected code never leaves rack behind.
   */
  async purchase(
    gymId: string,
    planId: string,
    clientId: string,
    provider?: string,
    referralCode?: string,
    acknowledgedMultiGymWarning?: boolean,
  ) {
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

    const referral = referralCode ? await this.resolveReferral(referralCode, gymId, clientId) : null;

    // A4: stamp evidence of the warning ONLY when there was something to warn about and the
    // client actually clicked through it — never true by default, and never a purchase
    // blocker either way (§2.6: "cảnh báo, không chặn").
    const others = await membershipRepository.findOtherActiveMemberships(clientId, gymId);
    const multiGymWarned = others.length > 0 && Boolean(acknowledgedMultiGymWarning);

    let contract;
    try {
      contract = await membershipRepository.create({
        gym: { connect: { id: gymId } },
        plan: { connect: { id: planId } },
        clientId,
        priceAtPurchase: plan.price,
        durationDaysSnapshot: plan.durationDays,
        totalVisits: plan.visitLimit,
        multiGymWarned,
      });
    } catch {
      // Unique-index race — the DB constraint is the real guard against two concurrent
      // purchase requests both slipping past the app-level pre-check above.
      throw err('ALREADY_HAS_OPEN_MEMBERSHIP', 409);
    }

    if (referral) {
      const amount = new Prisma.Decimal(plan.price).mul(REFERRAL_RATE).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
      await referralRepository.create({
        membershipContractId: contract.id,
        gymId,
        referrerPtUserId: referral.ptUserId,
        rate: REFERRAL_RATE,
        amount,
      });
    }

    return attemptPayment(contract, clientId, provider);
  },

  /**
   * §2.5 — every check must pass, in order, before a referral code is accepted. A reject at
   * any step means NO GymMembershipReferral row is created; the purchase still succeeds
   * (referral is a bonus for the PT, never a blocker for the client).
   */
  async resolveReferral(code: string, gymId: string, clientId: string): Promise<{ ptUserId: string } | null> {
    const ptUserId = await profileClient.resolveReferralCode(code);
    if (!ptUserId) throw err('REFERRAL_CODE_NOT_FOUND', 400);

    if (ptUserId === clientId) throw err('CANNOT_REFER_YOURSELF', 400);

    // A2: the code only pays out inside an accepted PT↔gym partnership — the gym is the one
    // paying, so the gym is the one who must have agreed to it.
    const collab = await collaborationService.activeRates(gymId, ptUserId);
    if (!collab) throw err('REFERRAL_NOT_APPLICABLE_AT_THIS_GYM', 400);

    // A2: first membership only — otherwise a PT could hand the code to someone already
    // renewing, referring nothing.
    const hadOne = await membershipRepository.hasEverHadMembershipAt(clientId, gymId);
    if (hadOne) throw err('REFERRAL_ONLY_FOR_FIRST_MEMBERSHIP', 400);

    return { ptUserId };
  },

  async retryPay(membershipId: string, clientId: string, provider?: string) {
    const contract = await membershipRepository.findById(membershipId);
    if (!contract) throw err('Membership not found', 404);
    if (contract.clientId !== clientId) throw err('Not authorized', 403);
    if (contract.status === 'ACTIVE' || contract.paymentTxnId) throw err('ALREADY_PAID', 409);
    if (contract.status !== 'PENDING_PAYMENT') throw err(`Cannot pay for membership in ${contract.status} status`, 400);
    return attemptPayment(contract, clientId, provider);
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
   * Client cancels their own ACTIVE membership. Money-flow plan §2.4: NO refund — the unused
   * portion is forfeited, full stop. (The old behaviour — a prorated refund on client
   * request — is gone; that is now `refundByAdmin`, gated to the three exceptional reasons.)
   *
   * The payment-service call runs BEFORE the local status flips to CANCELLED, deliberately:
   * if it fails, the membership stays ACTIVE and the client can simply try cancelling again,
   * rather than being left CANCELLED with money permanently stuck in pending. The forfeit
   * endpoint is itself idempotent (a membership with nothing left pending is a safe no-op),
   * so calling it twice on a retry is harmless.
   */
  async cancelByClient(membershipId: string, clientId: string) {
    const contract = await membershipRepository.findByIdWithReferral(membershipId);
    if (!contract) throw err('Membership not found', 404);
    if (contract.clientId !== clientId) throw err('Not authorized', 403);
    if (contract.status === 'ACTIVE' && contract.endDate && contract.endDate < new Date()) {
      await membershipRepository.expireIfPastEndDate(contract);
      throw err('Membership has already expired', 409);
    }
    if (contract.status !== 'ACTIVE') throw err(`Cannot cancel a membership in ${contract.status} status`, 409);

    if (contract.paymentTxnId) {
      await paymentClient.forfeitMembershipOnCancel({
        transactionId: contract.paymentTxnId,
        gymId: contract.gymId,
        clientId,
        ptUserId: contract.referral?.referrerPtUserId ?? null,
        label: `Membership ${contract.id} client self-cancel`,
      });
    }

    const { contract: cancelled } = await membershipRepository.cancelByClient(membershipId);
    if (contract.paymentTxnId) await membershipRepository.markPayoutReleased(membershipId);
    return { membership: cancelled };
  },

  /**
   * Admin-only exceptional refund (money-flow plan §2.4): the gym was suspended for a
   * violation, closed while the client still had time left, or the original transaction was
   * simply wrong. `reason` must be one of `ADMIN_REFUND_REASONS` — validated by the route's
   * zod schema before this is ever called.
   *
   * KNOWN GAP (documented per "không được sửa lặng lẽ" — see docs/money-flow.md's "Quyết định
   * phát sinh"): unlike self-cancel/natural-expiry, this operation is not safely retryable —
   * if the clawback step succeeds but the release step then fails, re-running the whole
   * function would claw back the referral commission a second time. This is an admin-only,
   * low-frequency, manually-triggered action; a failure surfaces as a 5xx the admin can
   * investigate via GET /admin/payments/reconciliation before retrying by hand.
   */
  async refundByAdmin(membershipId: string, adminId: string, reason: AdminRefundReason) {
    if (!ADMIN_REFUND_REASONS.includes(reason)) throw err('INVALID_REFUND_REASON', 400);

    const contract = await membershipRepository.findByIdWithReferral(membershipId);
    if (!contract) throw err('Membership not found', 404);
    if (contract.status === 'ACTIVE' && contract.endDate && contract.endDate < new Date()) {
      await membershipRepository.expireIfPastEndDate(contract);
      throw err('Membership has already expired', 409);
    }
    if (contract.status !== 'ACTIVE') throw err(`Cannot refund a membership in ${contract.status} status`, 409);
    if (!contract.paymentTxnId) throw err('No payment on record to refund', 409);

    const { refundAmount, remainingDays } = this.quoteRefund(contract);
    const price = Number(contract.priceAtPurchase);

    let clawback: { recovered: string; shortfall: string } | null = null;
    if (contract.referral && refundAmount > 0) {
      const remainingCommission = Number(contract.referral.amount) - Number(contract.referral.clawedBack);
      if (remainingCommission > 0) {
        const clawbackAmount = Math.round((refundAmount / price) * remainingCommission * 100) / 100;
        if (clawbackAmount > 0) {
          clawback = await paymentClient.clawbackReferral({
            transactionId: contract.paymentTxnId,
            gymId: contract.gymId,
            ptUserId: contract.referral.referrerPtUserId,
            amount: String(clawbackAmount),
            label: `Membership ${contract.id} admin refund (${reason})`,
          });
          await referralRepository.recordClawback(contract.id, clawback.recovered);
        }
      }
    }

    const release = await paymentClient.releaseMembershipPending({
      transactionId: contract.paymentTxnId,
      gymId: contract.gymId,
      clientId: contract.clientId,
      ptUserId: contract.referral?.referrerPtUserId ?? null,
      refundToClient: String(refundAmount),
      membershipStatus: 'CANCELLED',
      label: `Membership ${contract.id} admin refund (${reason})`,
    });

    const cancelled = await membershipRepository.cancelAfterRefund(contract.id);
    await membershipRepository.markPayoutReleased(contract.id);

    logger.info(`[Membership] Admin ${adminId} refunded ${contract.id}: ${refundAmount}đ (${reason})`);
    return { membership: cancelled, refundAmount, remainingDays, clawback, release };
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

  /** A4: gyms where this client already holds an active membership, for the "you already have
   * a membership elsewhere" warning shown before confirming a new purchase. */
  async warnOtherActiveMemberships(clientId: string, gymId: string) {
    const others = await membershipRepository.findOtherActiveMemberships(clientId, gymId);
    return others.map((m) => ({ gymId: m.gymId, gymName: m.gym.name, endDate: m.endDate }));
  },

  /** Called by the internal /activate endpoint — verifies the transaction before activating. */
  async activateViaTransaction(membershipId: string, transactionId: string) {
    const txn = await paymentClient.getTransaction(transactionId);
    if (!txn || txn.status !== 'PAID' || txn.relatedEntityType !== 'GYM_MEMBERSHIP' || txn.relatedEntityId !== membershipId) {
      throw err('Transaction verification failed', 400);
    }
    const { contract } = await membershipRepository.activateIfPending(membershipId, transactionId);

    // Referral commission moves from the gym's pending bucket to the PT's the moment the
    // membership actually activates — not at purchase time, when the client might still
    // abandon payment.
    const withReferral = await membershipRepository.findByIdWithReferral(membershipId);
    if (withReferral?.referral && withReferral.referral.status === 'PENDING') {
      try {
        await paymentClient.settleReferral({
          transactionId,
          gymId: withReferral.gymId,
          ptUserId: withReferral.referral.referrerPtUserId,
          amount: withReferral.referral.amount.toString(),
          label: `Membership ${membershipId} referral`,
        });
        await referralRepository.markReleased(membershipId);
      } catch (e) {
        // The membership itself activated fine; a missed referral settlement is retried by
        // nothing today (no sweep for PENDING referrals — a gap, not silently pretended
        // fixed) — logged loudly so it surfaces in ops rather than vanishing.
        logger.error({
          error: '[Membership] referral settlement failed after activation',
          membershipId,
          message: (e as Error).message,
        });
      }
    }

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
