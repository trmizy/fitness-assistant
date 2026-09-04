/**
 * Cụm A1 — user-service và payment-service dùng hai định nghĩa "quyền lợi còn lại" khác nhau.
 * user-service trừ cả compensatedSessions khi tính remaining entitlements
 * (getRemainingEntitlements trong contract.service.ts), nhưng payment-service's
 * remainingValue() chỉ trừ usedSessions — không hề biết compensatedSessions tồn tại.
 *
 * Kịch bản trong đề bài: hợp đồng 12 buổi giá 1.200.000, PT vắng 1 buổi (khách đã nhận bồi
 * thường 100.000, compensatedSessions=1), khách chưa tập buổi nào rồi huỷ. Giá trị buổi đã
 * bồi thường bị tính hai lần: một lần lúc bồi thường, một lần nữa nằm trong remaining khi huỷ.
 *
 * Run: npx tsx --test src/__tests__/compensated-sessions-reduce-remaining-value.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../generated/prisma';
import {
  computeTermination,
  remainingValue,
  buildMoneyBreakdown,
  type RateTable,
} from '../services/contract-money';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const PT_ONLY: RateTable = { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D(0) };

test('remainingValue trừ cả compensatedSessions, không chỉ usedSessions', () => {
  // 12 buổi, 1.200.000đ, PT vắng 1 buổi đã bồi thường (compensatedSessions=1), khách chưa
  // dùng buổi nào (usedSessions=0). Quyền lợi còn lại phải tính trên 12 − 0 − 1 = 11 buổi.
  const remaining = remainingValue({
    price: D('1200000'),
    totalSessions: 12,
    usedSessions: 0,
    compensatedSessions: 1,
    rates: PT_ONLY,
  } as any);
  assert.equal(remaining.toString(), D('1100000').toString(), 'remaining phải bằng 1.200.000 × 11/12 = 1.100.000, không phải 1.200.000');
});

test('remainingValue mặc định compensatedSessions=0 khi không truyền — không phá lời gọi cũ', () => {
  const remaining = remainingValue({
    price: D('1200000'),
    totalSessions: 12,
    usedSessions: 3,
    rates: PT_ONLY,
  } as any);
  assert.equal(remaining.toString(), D('900000').toString());
});

test('validate từ chối khi usedSessions + compensatedSessions vượt totalSessions', () => {
  assert.throws(() =>
    remainingValue({
      price: D('1200000'),
      totalSessions: 12,
      usedSessions: 10,
      compensatedSessions: 3,
      rates: PT_ONLY,
    } as any),
  );
});

test('computeTermination — huỷ CLIENT_CANCELLED không tính hai lần giá trị buổi đã bồi thường', () => {
  // Hợp đồng 12 buổi/1.200.000, đã bồi thường 1 buổi (100.000đ đã trả từ ví các bên cho
  // khách), usedSessions=0, huỷ do khách. Tổng tiền RA khỏi hệ thống (bồi thường + hoàn +
  // phần còn lại chia cho 3 bên) phải khớp TUYỆT ĐỐI 1.200.000 — không dư, không thiếu.
  const compensationAlreadyPaid = D('100000');
  const outcome = computeTermination(
    {
      price: D('1200000'),
      totalSessions: 12,
      usedSessions: 0,
      compensatedSessions: 1,
      rates: PT_ONLY,
    } as any,
    'CLIENT_CANCELLED',
  );

  // remaining phải dựa trên 11 buổi chưa dùng (12 − 0 − 1), không phải 12
  assert.equal(outcome.remaining.toString(), D('1100000').toString());

  const totalOut = compensationAlreadyPaid
    .plus(outcome.refund)
    .plus(outcome.entitlement.pt)
    .plus(outcome.entitlement.gym)
    .plus(outcome.entitlement.platform);
  assert.equal(totalOut.toString(), D('1200000').toString(), 'tổng tiền ra phải khớp tuyệt đối giá hợp đồng');
});

test('buildMoneyBreakdown cũng phản ánh compensatedSessions trong remaining', () => {
  const breakdown = buildMoneyBreakdown({
    price: D('1200000'),
    totalSessions: 12,
    usedSessions: 0,
    compensatedSessions: 1,
    rates: PT_ONLY,
  } as any);
  assert.equal(breakdown.remaining, '1100000.00');
});
