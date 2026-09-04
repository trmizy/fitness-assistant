import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipRepository } from '../repositories/membership.repository';
import { runSweep } from '../services/membershipPayout.sweep';

/**
 * P0 cluster E3 — một đơn hội viên PENDING_PAYMENT không bao giờ hết hạn nếu khách bỏ dở
 * trước khi thanh toán. Sweep hiện có (membershipPayout.sweep.ts) đã lo phần "hết hạn khi
 * đang ACTIVE" — thêm một bước mới ở đầu: đơn PENDING_PAYMENT quá cũ (mặc định 10 phút, cùng
 * NON_TOPUP_STALE_MINUTES payment-service đã dùng cho việc "chờ gateway xác nhận bao lâu thì
 * coi là bỏ dở") bị huỷ qua đúng cancelIfPending — cùng đường idempotent client tự huỷ đã
 * dùng, không phải đường mới.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test('runSweep: huỷ đơn PENDING_PAYMENT đã quá cũ qua cancelIfPending — không đụng đơn còn mới', async () => {
  const stale = { id: 'membership-stale', status: 'PENDING_PAYMENT' };

  let cancelledIds: string[] = [];
  const restores = [
    patch(membershipRepository, 'findStalePendingPayments', async () => [stale] as any),
    patch(membershipRepository, 'cancelIfPending', async (id: string) => {
      cancelledIds.push(id);
      return { ...stale, status: 'CANCELLED' } as any;
    }),
    patch(membershipRepository, 'expirePastEndDateBatch', async () => 0),
    patch(membershipRepository, 'findExpiredNotReleased', async () => []),
  ];

  try {
    const result = await runSweep();
    assert.equal(result.cancelledStale, 1);
    assert.deepEqual(cancelledIds, ['membership-stale']);
  } finally {
    restores.forEach((r) => r());
  }
});

test('runSweep: một đơn lỗi khi huỷ không chặn phần còn lại của lượt quét', async () => {
  const rows = [
    { id: 'membership-bad', status: 'PENDING_PAYMENT' },
    { id: 'membership-ok', status: 'PENDING_PAYMENT' },
  ];

  const cancelledIds: string[] = [];
  const restores = [
    patch(membershipRepository, 'findStalePendingPayments', async () => rows as any),
    patch(membershipRepository, 'cancelIfPending', async (id: string) => {
      if (id === 'membership-bad') throw new Error('DB hiccup');
      cancelledIds.push(id);
      return { id, status: 'CANCELLED' } as any;
    }),
    patch(membershipRepository, 'expirePastEndDateBatch', async () => 0),
    patch(membershipRepository, 'findExpiredNotReleased', async () => []),
  ];

  try {
    const result = await runSweep();
    assert.equal(result.cancelledStale, 1);
    assert.deepEqual(cancelledIds, ['membership-ok']);
  } finally {
    restores.forEach((r) => r());
  }
});
