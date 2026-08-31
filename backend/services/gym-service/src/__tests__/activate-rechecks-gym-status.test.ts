import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipService } from '../services/membership.service';
import { membershipRepository } from '../repositories/membership.repository';
import { gymRepository } from '../repositories/gym.repository';
import { paymentClient } from '../clients/payment.client';

/**
 * P0 cluster E2 — phòng gym có thể bị khoá GIỮA lúc thanh toán đang xử lý (đặt hàng lúc phòng
 * gym còn APPROVED, nhưng webhook xác nhận thanh toán tới SAU khi phòng gym đã bị khoá).
 * activateViaTransaction trước đây kích hoạt bất kể trạng thái phòng gym hiện tại — tiền đã
 * vào ngăn chờ của phòng gym/nền tảng (settleContractPayment chạy TRƯỚC khi webhook gọi tới
 * đây), và hội viên được kích hoạt tại một phòng gym không còn được phép hoạt động.
 *
 * Monkey-patches theo đúng khuôn mẫu refund-clawback-is-retry-safe.test.ts — dựng "DB" bằng
 * một object trong bộ nhớ, patch các singleton thật để activateViaTransaction thật chạy.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function makeState(overrides: Record<string, any> = {}) {
  return {
    id: 'membership-1',
    clientId: 'client-1',
    gymId: 'gym-1',
    status: 'PENDING_PAYMENT',
    paymentTxnId: null,
    priceAtPurchase: 500_000,
    durationDaysSnapshot: 30,
    referral: null,
    ...overrides,
  };
}

function stubTransactionPaid(membershipId: string) {
  paymentClient.getTransaction = async () => ({
    status: 'PAID',
    relatedEntityType: 'GYM_MEMBERSHIP',
    relatedEntityId: membershipId,
  });
}

test('activateViaTransaction: từ chối kích hoạt và hoàn tiền toàn bộ khi phòng gym đã bị khoá lúc webhook tới', async () => {
  const state = makeState();
  stubTransactionPaid(state.id);

  let releaseCalledWith: any = null;
  const restores = [
    patch(membershipRepository, 'findById', async () => ({ ...state })),
    patch(membershipRepository, 'findByIdWithReferral', async () => ({ ...state, referral: state.referral })),
    patch(gymRepository, 'findById', async () => ({ id: state.gymId, status: 'SUSPENDED' }) as any),
    patch(membershipRepository, 'markPendingIssueIfPending', async () => {
      if (state.status !== 'PENDING_PAYMENT') return { affected: 0, contract: { ...state } };
      state.status = 'PENDING_ISSUE';
      return { affected: 1, contract: { ...state } };
    }),
    patch(paymentClient, 'releaseMembershipPending', async (body: any) => {
      releaseCalledWith = body;
      return { released: { gym: '0.00', platform: '0.00', ptReferral: '0.00' }, refundedToClient: String(state.priceAtPurchase), shortfall: '0.00' };
    }),
    patch(membershipRepository, 'cancelAfterRefund', async () => {
      state.status = 'CANCELLED';
      return { ...state } as any;
    }),
    patch(membershipRepository, 'markPayoutReleased', async () => {
      return {} as any;
    }),
  ];

  try {
    await membershipService.activateViaTransaction(state.id, 'txn-1');
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(state.status, 'CANCELLED', 'phải hoàn tất bằng CANCELLED (đã hoàn tiền), không được ACTIVE');
  assert.ok(releaseCalledWith, 'phải gọi hoàn tiền — không được im lặng bỏ qua');
  assert.equal(releaseCalledWith.refundToClient, String(state.priceAtPurchase), 'phải hoàn ĐỦ 100% — chưa có buổi/ngày nào được sử dụng');
  assert.equal(releaseCalledWith.membershipStatus, 'PENDING_ISSUE');
  assert.equal(releaseCalledWith.ptUserId, null, 'hoa hồng giới thiệu chưa từng được chốt vì chưa từng kích hoạt — không có gì để đụng tới ở phía PT');
});

test('activateViaTransaction: kích hoạt bình thường khi phòng gym vẫn APPROVED', async () => {
  const state = makeState();
  stubTransactionPaid(state.id);

  const restores = [
    patch(membershipRepository, 'findById', async () => ({ ...state })),
    patch(gymRepository, 'findById', async () => ({ id: state.gymId, status: 'APPROVED' }) as any),
    patch(membershipRepository, 'findByIdWithReferral', async () => ({ ...state, referral: null })),
    patch(membershipRepository, 'activateIfPending', async () => {
      state.status = 'ACTIVE';
      return { contract: { ...state } };
    }),
  ];

  try {
    const result = await membershipService.activateViaTransaction(state.id, 'txn-1');
    assert.equal(result!.status, 'ACTIVE');
  } finally {
    restores.forEach((r) => r());
  }
});

test('activateViaTransaction: gọi lại một hội viên đã PENDING_ISSUE (payment-service sweep retry) thử hoàn tiền lại — không báo lỗi sai trạng thái', async () => {
  const state = makeState({ status: 'PENDING_ISSUE' });
  stubTransactionPaid(state.id);

  let releaseCallCount = 0;
  const restores = [
    patch(membershipRepository, 'findById', async () => ({ ...state })),
    patch(membershipRepository, 'findByIdWithReferral', async () => ({ ...state, referral: null })),
    patch(paymentClient, 'releaseMembershipPending', async () => {
      releaseCallCount++;
      return { released: { gym: '0.00', platform: '0.00', ptReferral: '0.00' }, refundedToClient: String(state.priceAtPurchase), shortfall: '0.00' };
    }),
    patch(membershipRepository, 'cancelAfterRefund', async () => {
      state.status = 'CANCELLED';
      return { ...state } as any;
    }),
    patch(membershipRepository, 'markPayoutReleased', async () => ({}) as any),
  ];

  try {
    await membershipService.activateViaTransaction(state.id, 'txn-1');
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(releaseCallCount, 1, 'phải thử hoàn tiền lại — retry của sweep phải thật sự đi tới bước tiền, không bị chặn ở kiểm tra trạng thái');
  assert.equal(state.status, 'CANCELLED');
});

test('activateViaTransaction: nếu hoàn tiền thất bại, lỗi phải lan lên trên — để sweep của payment-service tự động thử lại (không im lặng nuốt lỗi)', async () => {
  const state = makeState();
  stubTransactionPaid(state.id);

  const restores = [
    patch(membershipRepository, 'findById', async () => ({ ...state })),
    patch(gymRepository, 'findById', async () => ({ id: state.gymId, status: 'SUSPENDED' }) as any),
    patch(membershipRepository, 'markPendingIssueIfPending', async () => {
      state.status = 'PENDING_ISSUE';
      return { affected: 1, contract: { ...state } };
    }),
    patch(paymentClient, 'releaseMembershipPending', async () => {
      throw new Error('payment-service unreachable');
    }),
  ];

  try {
    await assert.rejects(() => membershipService.activateViaTransaction(state.id, 'txn-1'));
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(state.status, 'PENDING_ISSUE', 'ở lại hàng chờ admin/tự động thử lại — không được coi như đã xử lý xong');
});
