import { randomUUID } from 'crypto';
import { logger } from '@gym-coach/shared';
import { Prisma } from '../generated/prisma';
import { membershipRepository } from '../repositories/membership.repository';
import { referralRepository } from '../repositories/referral.repository';
import { planRepository } from '../repositories/plan.repository';
import { gymRepository } from '../repositories/gym.repository';
import { profileClient } from '../clients/profile.client';
import { gymService } from './gym.service';
import { collaborationService } from './collaboration.service';
import { paymentClient } from '../clients/payment.client';
import { isPlanOnSale } from './plan.service';

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
    // Re-check server-side: the client may have had this plan open in a tab since before a
    // marketing window closed. Never trust that what the browser is showing is still true.
    if (!isPlanOnSale(plan)) throw err('Gói này hiện không còn trong thời gian mở bán', 409);

    // Money-flow plan 2.5 — the first of three status chokepoints: a gym that is not
    // APPROVED (still under review, rejected, or suspended for a violation) must not accept
    // new money. Without this, "suspended" was purely cosmetic on the purchase flow.
    const gym = await gymRepository.findById(gymId);
    if (!gym || gym.status !== 'APPROVED') throw err('Phòng tập hiện không hoạt động, không thể mua gói', 409);

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
    // P0 cluster E1: purchase() checks the gym is APPROVED at order-creation time, but that
    // is only true at that instant — a gym can be suspended (violation, closure) any time
    // between then and this retry. Without re-checking here, a client could still pay into
    // (and activate a membership at) a gym that is no longer allowed to accept money.
    const gym = await gymRepository.findById(contract.gymId);
    if (!gym || gym.status !== 'APPROVED') throw err('Phòng tập hiện không hoạt động, không thể thanh toán', 409);
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
        // Same MEMBERSHIP_RELEASE:<id> key as the admin-refund and natural-expiry paths — a
        // membership only ever reaches ONE of the three terminal release triggers, never more
        // than one, so the shared key cannot conflate two different real events.
        idempotencyKey: `MEMBERSHIP_RELEASE:${contract.id}`,
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
   * Money-flow plan 1.7 (closes what used to be a KNOWN GAP here — see docs/money-flow.md's
   * "Quyết định phát sinh"): the clawback step's LOCAL bookkeeping
   * (`GymMembershipReferral.clawedBack`) is not itself idempotent, even though the
   * payment-service call behind it already is (plan 1.1) — a retry after the later release
   * step fails would re-enter the clawback branch and increment `clawedBack` a second time
   * for money that only ever moved once. `contract.refundClawbackDone` guards against that:
   * set right after the clawback step's local write commits, checked before ever entering
   * that branch again. This operation is otherwise still an admin-only, low-frequency, manual
   * action — a failure surfaces as a 5xx the admin investigates via
   * GET /admin/payments/reconciliation before retrying by hand; the guarantee this closes is
   * only that the retry itself is now safe, not that failures become invisible.
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
    if (contract.referral && refundAmount > 0 && !contract.refundClawbackDone) {
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
            idempotencyKey: `REFERRAL_CLAWBACK:${contract.id}`,
          });
          await referralRepository.recordClawback(contract.id, clawback.recovered);
        }
      }
      // Set regardless of whether an amount actually moved (remainingCommission or
      // clawbackAmount could legitimately be 0) — the STEP is complete either way, and a
      // retry must not re-evaluate it.
      await membershipRepository.markClawbackDone(contract.id);
    }

    const release = await paymentClient.releaseMembershipPending({
      transactionId: contract.paymentTxnId,
      gymId: contract.gymId,
      clientId: contract.clientId,
      ptUserId: contract.referral?.referrerPtUserId ?? null,
      refundToClient: String(refundAmount),
      membershipStatus: 'CANCELLED',
      label: `Membership ${contract.id} admin refund (${reason})`,
      idempotencyKey: `MEMBERSHIP_RELEASE:${contract.id}`,
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

  /**
   * Called by the internal /activate endpoint — verifies the transaction before activating.
   *
   * P0 cluster E2: the gym could have been suspended/closed any time between checkout and
   * this webhook — the money already settled into escrow + gym/platform pending
   * (settleContractPayment ran in payment-service before it ever called this endpoint), so
   * activating a membership at a gym no longer allowed to operate would be wrong. Refunds it
   * back out in full instead (nothing was ever delivered). If that refund itself fails, the
   * error is NOT swallowed — it propagates up through the controller so payment-service's own
   * activation-retry sweep (reconciliation.service.ts's reconcilePendingActivations, already
   * built, already retries on a schedule) keeps calling this endpoint again on its existing
   * cadence; a genuinely stuck case still ends up in the admin queue
   * (listPendingIssues/resolvePendingIssueByAdmin below) once that sweep gives up.
   */
  async activateViaTransaction(membershipId: string, transactionId: string) {
    const txn = await paymentClient.getTransaction(transactionId);
    if (!txn || txn.status !== 'PAID' || txn.relatedEntityType !== 'GYM_MEMBERSHIP' || txn.relatedEntityId !== membershipId) {
      throw err('Transaction verification failed', 400);
    }

    const before = await membershipRepository.findById(membershipId);
    if (!before) throw err('Membership not found', 404);

    // A retry (the sweep above, or a duplicate webhook delivery) of a membership whose first
    // refund attempt already failed — try the refund again. Safe: releaseMembershipPending's
    // idempotency key is stable per membership, and nothing else here re-runs.
    if (before.status === 'PENDING_ISSUE') {
      await this.refundPendingIssue(before, transactionId);
      return membershipRepository.findById(membershipId);
    }
    if (before.status !== 'PENDING_PAYMENT') {
      // Already ACTIVE (idempotent replay of a webhook that already succeeded) or some other
      // terminal state — nothing left to do.
      return before;
    }

    const gym = await gymRepository.findById(before.gymId);
    if (!gym || gym.status !== 'APPROVED') {
      const { affected, contract: marked } = await membershipRepository.markPendingIssueIfPending(membershipId, transactionId);
      if (affected === 0 || !marked) return membershipRepository.findById(membershipId); // lost a race — another call is already handling it
      logger.warn(`[Membership] ${membershipId} could not activate — gym ${before.gymId} is ${gym?.status ?? 'missing'}, refunding in full`);
      await this.refundPendingIssue(marked, transactionId);
      return membershipRepository.findById(membershipId);
    }

    const { contract } = await membershipRepository.activateIfPending(membershipId, transactionId);

    // P0 cluster E4: referral commission moves from the gym's pending bucket to the PT's the
    // moment the membership actually activates — not at purchase time, when the client might
    // still abandon payment. Used to swallow a failure here with nothing to retry it; now
    // marks the row FAILED so referral-settlement-sweep.service.ts finds and retries it —
    // same discipline as every other money-moving sweep in this codebase.
    const withReferral = await membershipRepository.findByIdWithReferral(membershipId);
    if (withReferral?.referral && withReferral.referral.status === 'PENDING') {
      try {
        await paymentClient.settleReferral({
          transactionId,
          gymId: withReferral.gymId,
          ptUserId: withReferral.referral.referrerPtUserId,
          amount: withReferral.referral.amount.toString(),
          label: `Membership ${membershipId} referral`,
          // Money-flow redesign plan 1.1: a membership settles its referral commission at
          // most once, ever — a retry after this committed but the caller failed to record
          // it (e.g. markReleased below throwing) must not move the commission twice.
          idempotencyKey: `MEMBERSHIP_REFERRAL:${membershipId}`,
        });
        await referralRepository.markReleased(membershipId);
      } catch (e) {
        logger.error({
          error: '[Membership] referral settlement failed after activation — marked FAILED for the retry sweep',
          membershipId,
          message: (e as Error).message,
        });
        await referralRepository.markFailed(membershipId).catch(() => {});
      }
    }

    return contract;
  },

  /**
   * P0 cluster E2 — refunds a PENDING_ISSUE membership's full price back to the client and
   * marks it CANCELLED. Called both from the fresh-detection branch in activateViaTransaction
   * and from its own retry branch (an already-PENDING_ISSUE membership seen again) — same
   * function either way, so the two paths cannot drift apart. Deliberately lets
   * releaseMembershipPending's failure propagate — see activateViaTransaction's own doc
   * comment for why that is the right thing to do here (payment-service's existing
   * reconciliation sweep is the auto-retry; resolvePendingIssueByAdmin is the manual fallback
   * once that sweep gives up).
   */
  async refundPendingIssue(
    contract: { id: string; gymId: string; clientId: string; priceAtPurchase: any },
    transactionId: string,
  ) {
    await paymentClient.releaseMembershipPending({
      transactionId,
      gymId: contract.gymId,
      clientId: contract.clientId,
      // Referral commission is never settled until activation succeeds (see the block above)
      // — a membership that never activated has nothing sitting in a PT's pending bucket to
      // touch, so there is no referral party to name here.
      ptUserId: null,
      refundToClient: String(contract.priceAtPurchase),
      membershipStatus: 'PENDING_ISSUE',
      label: `Membership ${contract.id} could not activate — gym unavailable`,
      idempotencyKey: `MEMBERSHIP_RELEASE:${contract.id}`,
    });
    await membershipRepository.cancelAfterRefund(contract.id);
    await membershipRepository.markPayoutReleased(contract.id);

    const withReferral = await membershipRepository.findByIdWithReferral(contract.id);
    if (withReferral?.referral && withReferral.referral.status === 'PENDING') {
      await referralRepository.markVoided(contract.id).catch(() => {});
    }
  },

  /** The admin queue for a PENDING_ISSUE membership whose auto-refund kept failing past
   * payment-service's own reconciliation-sweep retry budget. */
  async listPendingIssues() {
    return membershipRepository.listPendingIssues();
  },

  /** Admin-triggered manual retry of the exact same refund activateViaTransaction's retry
   * branch attempts automatically — for the rare case a membership outlives payment-service's
   * own retry budget (10 attempts, ~50 min) and needs a human to kick it again later. */
  async resolvePendingIssueByAdmin(membershipId: string, adminId: string) {
    const contract = await membershipRepository.findById(membershipId);
    if (!contract) throw err('Membership not found', 404);
    if (contract.status !== 'PENDING_ISSUE') throw err(`Membership is not PENDING_ISSUE (status ${contract.status})`, 409);
    if (!contract.paymentTxnId) throw err('No payment transaction on record — cannot refund', 409);

    await this.refundPendingIssue(contract, contract.paymentTxnId);
    logger.info(`[Membership] Admin ${adminId} manually resolved PENDING_ISSUE membership ${membershipId}`);
    return membershipRepository.findById(membershipId);
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
