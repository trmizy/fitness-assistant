import test from 'node:test';
import assert from 'node:assert/strict';
import { unusedValueAt, proratedRefundAmount } from '../services/complaint-case/rules';
import { membershipService } from '../services/membership.service';

/**
 * Money rule (Ngài, 09/11/2026): a prorated gym membership refund is rounded DOWN to the nearest 1,000 VND.
 * Both unusedValueAt (case quote, fixed at the complaint date) and membershipService.quoteRefund (admin refund path, previews, sums) must give the same answer.
 * Unit tests, no DB.
 */
const DAY = 24 * 60 * 60 * 1000;
const T = new Date('2026-11-01T00:00:00Z');

/** Run both functions for a membership with `remainingMs` left out of `durationDays`, at instant T. */
function both(price: number, durationDays: number, remainingMs: number) {
  const endDate = new Date(T.getTime() + remainingMs);
  const a = unusedValueAt(price, durationDays, endDate, T);
  const b = membershipService.quoteRefund({ priceAtPurchase: price, durationDaysSnapshot: durationDays, startDate: new Date(T.getTime() - DAY), endDate }, T).refundAmount;
  assert.equal(a, b, `unusedValueAt and quoteRefund disagree for price=${price} duration=${durationDays} remainingMs=${remainingMs}`);
  return a;
}

test('299,999.84 (complaint 1.4 s after start, 300,000 / 30 days) -> 299,000', () => {
  const remainingMs = 30 * DAY - 1400;
  assert.equal(both(300_000, 30, remainingMs), 299_000);
  // the raw value really was the decimal one that reached a member wallet before the rule
  assert.equal(Math.round(300_000 * (remainingMs / (30 * DAY)) * 100) / 100, 299_999.84);
});

test('exactly 200,000 stays 200,000 (hand example 300,000 x 20/30), despite floating error in the fraction', () => {
  assert.equal(both(300_000, 30, 20 * DAY), 200_000);
  assert.equal(proratedRefundAmount(300_000, 20 * DAY / (30 * DAY)), 200_000);
  assert.equal(proratedRefundAmount(1_000_000, 0.2), 200_000);
  assert.equal(proratedRefundAmount(1_000_000, 0.3), 300_000);
  assert.equal(proratedRefundAmount(1_000_000, 0.7), 700_000);
});

test('166,666.67-type values -> 166,000 (500,000 x 10/30); 100,000 x 10/30 = 33,333.33 -> 33,000', () => {
  assert.equal(both(500_000, 30, 10 * DAY), 166_000);
  assert.equal(both(100_000, 30, 10 * DAY), 33_000);
});

test('full term unused refunds the FULL price even when the price is not a multiple of 1,000', () => {
  assert.equal(both(299_500, 30, 30 * DAY), 299_500);
  assert.equal(both(299_500, 30, 45 * DAY), 299_500, 'remaining beyond the term is capped at the whole price');
  assert.equal(both(999, 30, 30 * DAY), 999);
  assert.equal(both(300_000, 30, 30 * DAY), 300_000);
});

test('nothing left -> 0 (term over, no end date, zero duration, zero price)', () => {
  assert.equal(both(300_000, 30, 0), 0);
  assert.equal(both(300_000, 30, -5 * DAY), 0);
  assert.equal(unusedValueAt(300_000, 30, null, T), 0);
  assert.equal(membershipService.quoteRefund({ priceAtPurchase: 300_000, durationDaysSnapshot: 30, startDate: T, endDate: null }, T).refundAmount, 0);
  assert.equal(both(300_000, 0, 10 * DAY), 0);
  assert.equal(proratedRefundAmount(0, 0.5), 0);
});

test('a partial refund below 1,000 is 0, and the result is never above the price nor a fraction of a thousand (except the full-term case)', () => {
  assert.equal(both(300_000, 30, 1000), 0, 'under 1,000 left -> 0');
  assert.equal(both(500, 30, 15 * DAY), 0);
  for (const price of [999, 1_000, 49_999, 299_500, 300_000, 1_234_567]) {
    for (let remainingDays = 0; remainingDays <= 31; remainingDays += 0.37) {
      const v = both(price, 30, Math.round(remainingDays * DAY));
      assert.ok(v >= 0 && v <= price, `price=${price} remainingDays=${remainingDays} -> ${v}`);
      if (remainingDays < 30) assert.equal(v % 1000, 0, `partial refund must be a whole thousand: price=${price} remainingDays=${remainingDays} -> ${v}`);
    }
  }
});

test('quoteRefund still returns remainingDays and fraction unchanged', () => {
  const q = membershipService.quoteRefund({ priceAtPurchase: 300_000, durationDaysSnapshot: 30, startDate: T, endDate: new Date(T.getTime() + 20 * DAY) }, T);
  assert.equal(q.remainingDays, 20);
  assert.ok(Math.abs(q.fraction - 20 / 30) < 1e-12);
  assert.equal(q.refundAmount, 200_000);
});
