import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipService } from '../services/membership.service';
import { membershipRepository } from '../repositories/membership.repository';
import { referralRepository } from '../repositories/referral.repository';
import { gymRepository } from '../repositories/gym.repository';
import { paymentClient } from '../clients/payment.client';
import { runReferralSettlementSweep } from '../services/referral-settlement-sweep.service';

/**
 * P0 cluster E4 — settleReferral failing during activateViaTransaction used to just log and
 * move on, with nothing anywhere ever retrying it — the referring PT's commission stayed
 * stuck in the gym's pending bucket forever. Now the referral row is marked FAILED, and
 * referral-settlement-sweep.service.ts is what actually retries it.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test('activateViaTransaction: khi settleReferral thất bại, bản ghi giới thiệu được đánh dấu FAILED — không phải trôi mất trong log', async () => {
  const state = {
    id: 'membership-2',
    clientId: 'client-1',
    gymId: 'gym-1',
    status: 'PENDING_PAYMENT',
    paymentTxnId: null,
    priceAtPurchase: 500_000,
    durationDaysSnapshot: 30,
  };
  const referral = { referrerPtUserId: 'pt-1', amount: 50_000, status: 'PENDING' };

  let markedFailedFor: string | null = null;
  const restores = [
    patch(paymentClient, 'getTransaction', async () => ({ status: 'PAID', relatedEntityType: 'GYM_MEMBERSHIP', relatedEntityId: state.id })),
    patch(membershipRepository, 'findById', async () => ({ ...state })),
    patch(gymRepository, 'findById', async () => ({ id: state.gymId, status: 'APPROVED', operationalStatus: 'OPEN' }) as any),
    patch(membershipRepository, 'activateIfPending', async () => {
      state.status = 'ACTIVE';
      return { contract: { ...state } };
    }),
    patch(membershipRepository, 'findByIdWithReferral', async () => ({ ...state, referral: { ...referral } })),
    patch(paymentClient, 'settleReferral', async () => {
      throw new Error('payment-service unreachable');
    }),
    patch(referralRepository, 'markFailed', async (id: string) => {
      markedFailedFor = id;
      referral.status = 'FAILED';
      return {} as any;
    }),
  ];

  try {
    const result = await membershipService.activateViaTransaction(state.id, 'txn-1');
    // The membership itself must still activate — a stuck referral must never block it.
    assert.equal(result!.status, 'ACTIVE');
    assert.equal(markedFailedFor, state.id, 'phải đánh dấu FAILED để sweep tìm thấy — không được chỉ log rồi bỏ qua');
  } finally {
    restores.forEach((r) => r());
  }
});

test('runReferralSettlementSweep: thử lại thành công một bản ghi FAILED và đánh dấu RELEASED', async () => {
  const failedRow = {
    id: 'referral-1',
    membershipContractId: 'membership-3',
    gymId: 'gym-1',
    referrerPtUserId: 'pt-1',
    amount: 50_000,
    membershipContract: { id: 'membership-3', paymentTxnId: 'txn-3', status: 'ACTIVE' },
  };

  let settleCalledWith: any = null;
  let releasedFor: string | null = null;
  const restores = [
    patch(referralRepository, 'listFailed', async () => [failedRow as any]),
    patch(paymentClient, 'settleReferral', async (body: any) => {
      settleCalledWith = body;
      return { moved: '50000.00', shortfall: '0.00' };
    }),
    patch(referralRepository, 'markReleased', async (id: string) => {
      releasedFor = id;
      return {} as any;
    }),
  ];

  try {
    const result = await runReferralSettlementSweep();
    assert.equal(result.scanned, 1);
    assert.equal(result.settled, 1);
    assert.equal(settleCalledWith.transactionId, 'txn-3');
    assert.equal(settleCalledWith.idempotencyKey, 'MEMBERSHIP_REFERRAL:membership-3');
    assert.equal(releasedFor, 'membership-3');
  } finally {
    restores.forEach((r) => r());
  }
});

test('runReferralSettlementSweep: một bản ghi lỗi không chặn các bản ghi khác trong cùng lượt quét', async () => {
  const rowA = { id: 'referral-a', membershipContractId: 'membership-a', gymId: 'gym-1', referrerPtUserId: 'pt-1', amount: 10_000, membershipContract: { id: 'membership-a', paymentTxnId: 'txn-a', status: 'ACTIVE' } };
  const rowB = { id: 'referral-b', membershipContractId: 'membership-b', gymId: 'gym-1', referrerPtUserId: 'pt-2', amount: 20_000, membershipContract: { id: 'membership-b', paymentTxnId: 'txn-b', status: 'ACTIVE' } };

  const released: string[] = [];
  const restores = [
    patch(referralRepository, 'listFailed', async () => [rowA, rowB] as any),
    patch(paymentClient, 'settleReferral', async (body: any) => {
      if (body.transactionId === 'txn-a') throw new Error('still unreachable');
      return { moved: '20000.00', shortfall: '0.00' };
    }),
    patch(referralRepository, 'markReleased', async (id: string) => {
      released.push(id);
      return {} as any;
    }),
  ];

  try {
    const result = await runReferralSettlementSweep();
    assert.equal(result.scanned, 2);
    assert.equal(result.settled, 1);
    assert.deepEqual(released, ['membership-b']);
  } finally {
    restores.forEach((r) => r());
  }
});
