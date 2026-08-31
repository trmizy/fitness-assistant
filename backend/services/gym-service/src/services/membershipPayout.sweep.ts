import { logger } from '@gym-coach/shared';
import { membershipRepository } from '../repositories/membership.repository';
import { paymentClient } from '../clients/payment.client';

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

export function startMembershipPayoutSweep(): void {
  logger.info(`Membership payout sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runSweep();
  }, INTERVAL_MS);
}

export async function runSweep(): Promise<{ cancelledStale: number; expired: number; released: number; failed: number }> {
  if (running) {
    logger.info('[MembershipPayoutSweep] Previous run still in progress — skipping tick');
    return { cancelledStale: 0, expired: 0, released: 0, failed: 0 };
  }
  running = true;

  let cancelledStale = 0;
  let expired = 0;
  let released = 0;
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
    const due = await membershipRepository.findExpiredNotReleased(BATCH_SIZE);
    for (const m of due) {
      try {
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
        await membershipRepository.markPayoutReleased(m.id);
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
  return { cancelledStale, expired, released, failed };
}
