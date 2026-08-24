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

let running = false;

export function startMembershipPayoutSweep(): void {
  logger.info(`Membership payout sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runSweep();
  }, INTERVAL_MS);
}

export async function runSweep(): Promise<{ expired: number; released: number; failed: number }> {
  if (running) {
    logger.info('[MembershipPayoutSweep] Previous run still in progress — skipping tick');
    return { expired: 0, released: 0, failed: 0 };
  }
  running = true;

  let expired = 0;
  let released = 0;
  let failed = 0;
  try {
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
  return { expired, released, failed };
}
