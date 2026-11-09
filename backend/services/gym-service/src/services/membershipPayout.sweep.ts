import { logger } from '@gym-coach/shared';
import { membershipRepository } from '../repositories/membership.repository';
import { paymentClient } from '../clients/payment.client';
import { prisma } from '../repositories/prisma';
import { membershipHolds } from './complaint-case/refund-guard';

/**
 * Money-flow plan §2.3①: a membership's gym/platform/referral share sits in the pending
 * bucket for the membership's whole life (A1's deliberate trade-off — see docs/money-flow.md).
 * Without this sweep, that money would never move to AVAILABLE: nothing else in the system
 * expires an ACTIVE membership or releases its payout on its own.
 *
 * Same overlap-guard shape as user-service's session-autoconfirm job.
 */
const INTERVAL_MS = Number(process.env.MEMBERSHIP_PAYOUT_SWEEP_INTERVAL_MS ?? 10 * 60 * 1000);
const BATCH_SIZE = 100;
// P0 cluster E3 — same window payment-service's own NON_TOPUP_STALE_MINUTES already uses for
// "how long do we wait for a gateway to confirm before treating a purchase as abandoned".
// Generous enough for a real QR-scan payment (open banking app, scan, confirm) — adjustable
// via env without a code change if that turns out too tight or too loose in practice.
const PENDING_PAYMENT_STALE_MINUTES = Number(process.env.GYM_MEMBERSHIP_PENDING_PAYMENT_STALE_MINUTES ?? 10);

let running = false;

/** B1: the memberships a Gym Case holds right now (cheap pre-filter; the decision is re-made under the row lock before each release). */
async function heldMembershipIds(): Promise<Set<string>> {
  const rows = await prisma.gymMembershipContract.findMany({ where: { status: 'EXPIRED', payoutReleasedAt: null, paymentTxnId: { not: null } }, select: { id: true }, take: 5000 });
  return new Set((await membershipHolds(prisma, rows.map((r) => r.id))).keys());
}

export function startMembershipPayoutSweep(): void {
  logger.info(`Membership payout sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runSweep();
  }, INTERVAL_MS);
}

export async function runSweep(): Promise<{ cancelledStale: number; expired: number; released: number; failed: number; held?: number }> {
  if (running) {
    logger.info('[MembershipPayoutSweep] Previous run still in progress — skipping tick');
    return { cancelledStale: 0, expired: 0, released: 0, failed: 0 };
  }
  running = true;

  let cancelledStale = 0;
  let expired = 0;
  let released = 0;
  let held = 0;
  let failed = 0;
  try {
    // Step 0 (P0 cluster E3): a PENDING_PAYMENT order nobody ever paid for and nobody
    // explicitly cancelled either used to sit there forever — nothing expired it. Goes
    // through the exact same cancelIfPending the client's own "cancel my pending order"
    // button uses, so there is one implementation of what cancelling an unpaid order does.
    const cutoff = new Date(Date.now() - PENDING_PAYMENT_STALE_MINUTES * 60 * 1000);
    const stale = await membershipRepository.findStalePendingPayments(cutoff, BATCH_SIZE);
    for (const m of stale) {
      try {
        await membershipRepository.cancelIfPending(m.id);
        cancelledStale++;
      } catch (err) {
        // Per-row isolation — one bad row must not block the rest of the batch, and the next
        // tick retries it (still PENDING_PAYMENT until this succeeds).
        logger.error({
          error: '[MembershipPayoutSweep] cancelling one stale pending-payment order failed',
          membershipId: m.id,
          message: (err as Error).message,
        });
      }
    }
    if (cancelledStale > 0) {
      logger.info(`[MembershipPayoutSweep] Cancelled ${cancelledStale} stale PENDING_PAYMENT order(s) (never paid, past ${PENDING_PAYMENT_STALE_MINUTES}min)`);
    }

    // Step 1: catch memberships nobody has read since they lapsed (see repository comment).
    expired = await membershipRepository.expirePastEndDateBatch(BATCH_SIZE);
    if (expired > 0) {
      logger.info(`[MembershipPayoutSweep] Lazily expired ${expired} membership(s) past their endDate`);
    }

    // Step 2: release the payout for every EXPIRED membership that still has one pending.
    // B1: a membership with an unfinished Gym Case (or an approved, unexecuted refund) keeps ITS OWN unsettled money; every other membership releases as before.
    const heldNow = await heldMembershipIds();
    held += heldNow.size;
    const due = await membershipRepository.findExpiredNotReleased(BATCH_SIZE, [...heldNow]);
    for (const m of due) {
      try {
        // Decide "hold or release" under the membership row lock: opening a case / an appeal takes the same lock, so none can slip between this check and the release.
        const skipped = await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM gym_membership_contracts WHERE id = ${m.id} FOR UPDATE`;
            const holds = await membershipHolds(tx as any, [m.id]);
            if (holds.has(m.id)) return holds.get(m.id)!;
            await paymentClient.releaseMembershipPending({
          transactionId: m.paymentTxnId!,
          gymId: m.gymId,
          clientId: m.clientId,
          ptUserId: m.referral?.referrerPtUserId ?? null,
          membershipStatus: 'EXPIRED',
          label: `Membership ${m.id} natural expiry`,
          // Same MEMBERSHIP_RELEASE:<id> key as the admin-refund and self-cancel paths (plan
          // 1.1) — this also makes a retried sweep tick safe: markPayoutReleased only stamps
          // AFTER this call returns, so a crash between the two used to risk a second release
          // on the next tick before this key existed.
          idempotencyKey: `MEMBERSHIP_RELEASE:${m.id}`,
            });
            await tx.gymMembershipContract.update({ where: { id: m.id }, data: { payoutReleasedAt: new Date() } });
            return null;
          },
          { timeout: 30_000, maxWait: 10_000 },
        );
        if (skipped) {
          held++;
          continue;
        }
        released++;
      } catch (err) {
        failed++;
        // Per-row isolation — one bad membership must not block the rest of the batch, and
        // the next tick retries it (payoutReleasedAt is only stamped on success).
        logger.error({
          error: '[MembershipPayoutSweep] release failed for one membership',
          membershipId: m.id,
          message: (err as Error).message,
        });
      }
    }
  } catch (err) {
    logger.error({ error: '[MembershipPayoutSweep] sweep failed', message: (err as Error).message });
  } finally {
    running = false;
  }
  if (held > 0) logger.info(`[MembershipPayoutSweep] Held ${held} membership(s) with an unfinished Gym Case (their money stays pending)`);
  return { cancelledStale, expired, released, failed, held };
}
