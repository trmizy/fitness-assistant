import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipService } from '../services/membership.service';
import { membershipRepository } from '../repositories/membership.repository';
import { referralRepository } from '../repositories/referral.repository';
import { paymentClient } from '../clients/payment.client';

/**
 * Money-flow redesign plan item 1.7 — "hoàn tiền gói hội viên chưa bảo đảm lặp an toàn".
 *
 * `refundByAdmin`'s referral clawback step calls payment-service (idempotent there, per plan
 * 1.1) but then does a LOCAL, non-idempotent `clawedBack: { increment }` on gym-service's own
 * `GymMembershipReferral` row. If the clawback step succeeds but the LATER release step fails,
 * an admin retrying the same refund re-enters the clawback branch: `remainingCommission` is
 * recomputed from the now-partially-reduced `clawedBack`, producing a DIFFERENT, smaller
 * `clawbackAmount` — but `paymentClient.clawbackReferral` is called with the SAME
 * idempotencyKey as the first attempt, so payment-service's own guard returns the FIRST
 * attempt's CACHED amount, not the newly-requested one. That cached amount then gets
 * incremented onto `clawedBack` a SECOND time, silently doubling it even though the ledger
 * itself only ever moved money once.
 *
 * Monkey-patches the real singletons (`membershipRepository`, `referralRepository`,
 * `paymentClient`) so the REAL `refundByAdmin` runs; the "local DB" is a plain in-memory object
 * mutated by the fakes exactly the way the real repository would mutate a row.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test('a retry after the release step fails does not claw back the referral commission twice', async () => {
  const now = Date.now();
  const state = {
    id: 'membership-1',
    clientId: 'client-1',
    gymId: 'gym-1',
    status: 'ACTIVE',
    paymentTxnId: 'txn-1',
    priceAtPurchase: 1_000_000,
    durationDaysSnapshot: 30,
    startDate: new Date(now - 15 * 24 * 60 * 60 * 1000),
    endDate: new Date(now + 15 * 24 * 60 * 60 * 1000), // half the term remains → refundAmount ≈ 500,000
    refundClawbackDone: false,
    referral: {
      referrerPtUserId: 'pt-1',
      amount: 100_000,
      clawedBack: 0,
    },
  };

  let clawbackCallCount = 0;
  let releaseShouldFail = true;

  const restores = [
    patch(membershipRepository, 'findByIdWithReferral', async () => ({ ...state, referral: { ...state.referral } })),
    patch(paymentClient, 'clawbackReferral', async () => {
      clawbackCallCount++;
      // Simulate payment-service's OWN idempotency (plan 1.1): every call with this key
      // returns the FIRST attempt's cached amount, regardless of what THIS call asked for.
      return { recovered: '50000.00', shortfall: '0.00' };
    }),
    patch(referralRepository, 'recordClawback', async (_id: string, amount: string) => {
      state.referral.clawedBack = Number(state.referral.clawedBack) + Number(amount);
      return {} as any;
    }),
    patch(paymentClient, 'releaseMembershipPending', async () => {
      if (releaseShouldFail) throw new Error('payment-service unreachable');
      return { refunded: '500000.00' };
    }),
    patch(membershipRepository, 'cancelAfterRefund', async () => {
      state.status = 'CANCELLED';
      return { ...state } as any;
    }),
    patch(membershipRepository, 'markPayoutReleased', async () => ({}) as any),
    patch(membershipRepository, 'markClawbackDone', async () => {
      state.refundClawbackDone = true;
      return {} as any;
    }),
  ];

  try {
    // First attempt: clawback succeeds, release fails — mirrors the KNOWN GAP scenario.
    await assert.rejects(() => membershipService.refundByAdmin('membership-1', 'admin-1', 'TRANSACTION_ERROR'));
    assert.equal(state.referral.clawedBack, 50_000, 'the first attempt clawback is recorded exactly once');

    // Retry: same admin action, same membership — release now succeeds.
    releaseShouldFail = false;
    await membershipService.refundByAdmin('membership-1', 'admin-1', 'TRANSACTION_ERROR');
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(clawbackCallCount, 1, 'the retry must not re-enter the clawback step at all — it already completed');
  assert.equal(state.referral.clawedBack, 50_000, 'clawedBack must not double from a retry of the same refund');
});
