import { logger } from '@gym-coach/shared';
import { referralRepository } from '../repositories/referral.repository';
import { paymentClient } from '../clients/payment.client';

/**
 * P0 cluster E4 — activateViaTransaction's referral-settlement step used to swallow a
 * payment-service failure with nothing to retry it, leaving the referring PT's commission
 * stuck in the gym's pending bucket forever with no visible trace of the problem. It now
 * marks the row FAILED (membership.service.ts) instead; this sweep is what actually retries
 * it. Mirrors session-settlement-sweep.service.ts (user-service): interval polling, an
 * overlap guard, one failure per row isolated so it cannot stop the rest of the batch.
 */
const INTERVAL_MS = Number(process.env.REFERRAL_SETTLEMENT_SWEEP_INTERVAL_MS ?? 10 * 60 * 1000);

let running = false;

export function startReferralSettlementSweepJob(): void {
  logger.info(`Referral settlement sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runReferralSettlementSweep();
  }, INTERVAL_MS);
}

export async function runReferralSettlementSweep(): Promise<{ scanned: number; settled: number }> {
  if (running) {
    logger.info('[ReferralSettlementSweep] Previous run still in progress — skipping tick');
    return { scanned: 0, settled: 0 };
  }
  running = true;

  let scanned = 0;
  let settled = 0;
  try {
    const failed = await referralRepository.listFailed();
    scanned = failed.length;
    if (scanned === 0) return { scanned, settled };

    logger.info(`[ReferralSettlementSweep] ${scanned} failed referral settlement(s) to retry`);
    for (const referral of failed) {
      try {
        // The membership must have actually activated (paymentTxnId set) for there to be
        // anything to settle — a defensive check, not expected to ever fail in practice since
        // markFailed is only ever called after activation succeeded.
        if (!referral.membershipContract.paymentTxnId) {
          logger.warn(`[ReferralSettlementSweep] referral ${referral.id} has no paymentTxnId — skipping`);
          continue;
        }
        await paymentClient.settleReferral({
          transactionId: referral.membershipContract.paymentTxnId,
          gymId: referral.gymId,
          ptUserId: referral.referrerPtUserId,
          amount: referral.amount.toString(),
          label: `Membership ${referral.membershipContractId} referral (retry)`,
          idempotencyKey: `MEMBERSHIP_REFERRAL:${referral.membershipContractId}`,
        });
        await referralRepository.markReleased(referral.membershipContractId);
        settled++;
      } catch (err) {
        logger.error({
          error: '[ReferralSettlementSweep] retry failed for one referral — stays FAILED for the next tick',
          referralId: referral.id,
          membershipId: referral.membershipContractId,
          message: (err as Error).message,
        });
      }
    }

    logger.info(`[ReferralSettlementSweep] Settled ${settled}/${scanned} referral(s)`);
    return { scanned, settled };
  } catch (err) {
    logger.error({ error: '[ReferralSettlementSweep] sweep failed', message: (err as Error).message });
    return { scanned, settled };
  } finally {
    running = false;
  }
}
