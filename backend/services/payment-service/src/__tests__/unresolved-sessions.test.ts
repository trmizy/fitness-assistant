/**
 * Arithmetic of "unresolved sessions": sessions that are neither used nor unused when a contract
 * ends (the PT reported them delivered and the client has not confirmed yet, or they are
 * disputed). Pure functions only — evidence label: TEST FIXTURE (no database, no ledger).
 * The ledger side is unresolved-sessions.integration.test.ts.
 *
 * Run: ./node_modules/.bin/tsx --test src/__tests__/unresolved-sessions.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../generated/prisma';
import {
  buildMoneyBreakdown,
  computeTermination,
  remainingValue,
  unresolvedHeldValue,
  type ContractMoneyInput,
  type RateTable,
  type TerminationReason,
} from '../services/contract-money';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const PT_ONLY: RateTable = { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D(0) };
const WITH_GYM: RateTable = { platformRate: D('0.10'), ptRate: D('0.55'), gymRate: D('0.35') };

const REASONS: TerminationReason[] = [
  'CLIENT_CANCELLED', 'PT_BANNED', 'PT_CANCELLED', 'MUTUAL', 'EXPIRED', 'COMPLETED',
  'PT_REPEATED_NO_SHOW', 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION',
];

test('worked example: 5.000.000 / 10 sessions / 0.90-0.10-0, 4 used, 2 unresolved, exit due to PT restriction', () => {
  const t = computeTermination(
    { price: D(5_000_000), totalSessions: 10, usedSessions: 4, unresolvedSessions: 2, rates: PT_ONLY },
    'CLIENT_EXIT_DUE_TO_PT_RESTRICTION',
  );
  assert.equal(t.remaining.toString(), '2000000', 'only the 4 sessions certainly not delivered');
  assert.equal(t.refund.toString(), '2000000');
  assert.equal(t.unresolvedHeld.total.toString(), '1000000', '2 × 500.000');
  assert.equal(t.unresolvedHeld.pt.toString(), '900000');
  assert.equal(t.unresolvedHeld.platform.toString(), '100000');
  assert.equal(t.entitlement.pt.toString(), '1800000', '4 delivered sessions × 450.000');
  assert.equal(t.entitlement.platform.toString(), '200000');
  assert.equal(t.withheld.toString(), '2000000', 'shared out now: 3.000.000 − 1.000.000 held');
});

/** What compensateNoShow really paid out for `c` no-shows: each one's value rounded UP to a whole dong (FH-1 follow-up). */
const compensationCash = (price: number, total: number, c: number) =>
  Prisma.Decimal.min(D(price).div(total).toDecimalPlaces(0, Prisma.Decimal.ROUND_UP).mul(c), D(price));

test('with no unresolved sessions the outcome is exactly what it was, for every reason', () => {
  for (const rates of [PT_ONLY, WITH_GYM]) {
    for (const reason of REASONS) {
      for (const [u, c] of [[0, 0], [3, 0], [4, 2], [10, 0]] as const) {
        const base: ContractMoneyInput = { price: D(1_000_003), totalSessions: 10, usedSessions: u, compensatedSessions: c, rates };
        const absent = computeTermination(base, reason);
        const zero = computeTermination({ ...base, unresolvedSessions: 0 }, reason);
        assert.deepEqual(zero, absent, `${reason} u=${u} c=${c}: explicit 0 is the same as absent`);
        assert.equal(absent.unresolvedHeld.total.toString(), '0');
        // the legacy identities
        assert.equal(absent.withheld.toString(), D(1_000_003).minus(compensationCash(1_000_003, 10, c)).minus(absent.refund).toString());
        const sum = absent.entitlement.pt.plus(absent.entitlement.gym).plus(absent.entitlement.platform);
        assert.equal(sum.toString(), absent.withheld.toString(), 'entitlements still add up to the withheld amount');
      }
    }
  }
});

test('conservation for every reason and shape: refund + entitlements + held = price − compensation, whole đồng', () => {
  for (const rates of [PT_ONLY, WITH_GYM]) {
    for (const price of [5_000_000, 1_000_000, 1_000_003, 999_999, 7]) {
      for (const total of [1, 3, 10]) {
        for (let u = 0; u <= total; u++) {
          for (let c = 0; u + c <= total; c++) {
            for (let n = 0; u + c + n <= total; n++) {
              for (const reason of REASONS) {
                // A shape the legacy formula itself cannot settle (a fractional compensation value
                // that rounds the refund above what is left) is not this feature's to fix: with the
                // unresolved sessions counted as used it must fail in the same way, or not at all.
                let legacyThrows = false;
                try { computeTermination({ price: D(price), totalSessions: total, usedSessions: u + n, compensatedSessions: c, rates }, reason); } catch { legacyThrows = true; }
                if (legacyThrows) continue;
                const t = computeTermination({ price: D(price), totalSessions: total, usedSessions: u, compensatedSessions: c, unresolvedSessions: n, rates }, reason);
                const comp = compensationCash(price, total, c);
                const sum = t.refund.plus(t.entitlement.pt).plus(t.entitlement.gym).plus(t.entitlement.platform).plus(t.unresolvedHeld.total);
                const label = `${reason} P=${price} N=${total} u=${u} c=${c} n=${n}`;
                assert.equal(sum.toString(), D(price).minus(comp).toString(), label);
                for (const v of [t.entitlement.pt, t.entitlement.gym, t.unresolvedHeld.pt, t.unresolvedHeld.gym, t.unresolvedHeld.platform]) {
                  assert.ok(v.greaterThanOrEqualTo(0), `${label}: no negative share`);
                  // (a compensation value P × c / N that is not a whole đồng makes the legacy
                  // remainder fractional in the platform's share; that is not this feature's to change)
                  if (comp.equals(comp.toDecimalPlaces(0))) assert.ok(v.equals(v.toDecimalPlaces(0)), `${label}: whole đồng`);
                }
                assert.ok(t.entitlement.platform.greaterThanOrEqualTo(0), `${label}: platform not negative`);
                // the unresolved value is not refundable: the refund never exceeds the value of
                // the sessions certainly not delivered (rounded up to the đồng)
                const ceiling = D(price).mul(total - u - c - n).div(total).toDecimalPlaces(0, Prisma.Decimal.ROUND_UP);
                assert.ok(t.refund.lessThanOrEqualTo(ceiling), `${label}: refund ${t.refund} <= ${ceiling}`);
              }
            }
          }
        }
      }
    }
  }
});

test('an unresolved session is as untouchable as a used one: the refund equals the refund with those sessions marked used', () => {
  for (const reason of REASONS) {
    const a = computeTermination({ price: D(5_000_000), totalSessions: 10, usedSessions: 4, unresolvedSessions: 2, rates: PT_ONLY }, reason);
    const b = computeTermination({ price: D(5_000_000), totalSessions: 10, usedSessions: 6, rates: PT_ONLY }, reason);
    assert.equal(a.refund.toString(), b.refund.toString(), reason);
    // all parties' totals once the held value is added back are the same as for 6 used sessions
    assert.equal(a.entitlement.pt.plus(a.unresolvedHeld.pt).toString(), b.entitlement.pt.toString(), `${reason} pt`);
    assert.equal(a.entitlement.platform.plus(a.unresolvedHeld.platform).toString(), b.entitlement.platform.toString(), `${reason} platform`);
  }
  assert.equal(remainingValue({ price: D(5_000_000), totalSessions: 10, usedSessions: 4, unresolvedSessions: 2, rates: PT_ONLY }).toString(), '2000000');
});

test('PT-fault compensation is measured on the sessions certainly not delivered only', () => {
  const t = computeTermination(
    { price: D(5_000_000), totalSessions: 10, usedSessions: 4, unresolvedSessions: 2, rates: PT_ONLY, ptHoldbackRate: D('0.10') },
    'PT_CANCELLED',
  );
  assert.equal(t.ptFaultCompensationTarget.toString(), '200000', '10% × 2.000.000, not × 3.000.000');
  const client = computeTermination(
    { price: D(5_000_000), totalSessions: 10, usedSessions: 4, unresolvedSessions: 2, rates: PT_ONLY, ptHoldbackRate: D('0.10') },
    'CLIENT_EXIT_DUE_TO_PT_RESTRICTION',
  );
  assert.equal(client.ptFaultCompensationTarget.toString(), '0');
});

test('the held value is n × the unit releaseSession uses, split the way releaseSession splits it', () => {
  const h = unresolvedHeldValue(D(1_000_000), 3, WITH_GYM, 2);
  assert.equal(h.unit.toString(), '333333', 'floor(P/N)');
  // one session: pt floor(333333×.55)=183333, gym floor(333333×.35)=116666, platform the rest 33334
  assert.equal(h.pt.toString(), '366666');
  assert.equal(h.gym.toString(), '233332');
  assert.equal(h.platform.toString(), '66668');
  assert.equal(h.total.toString(), '666666');
});

test('validation: unresolved sessions must be an integer in 0..(N − used − compensated)', () => {
  const base = { price: D(1_000_000), totalSessions: 10, usedSessions: 4, compensatedSessions: 1, rates: PT_ONLY };
  assert.doesNotThrow(() => computeTermination({ ...base, unresolvedSessions: 5 }, 'MUTUAL'), 'exactly the room left');
  assert.throws(() => computeTermination({ ...base, unresolvedSessions: 6 }, 'MUTUAL'), /cannot exceed/);
  assert.throws(() => computeTermination({ ...base, unresolvedSessions: -1 }, 'MUTUAL'), /non-negative integer/);
  assert.throws(() => computeTermination({ ...base, unresolvedSessions: 1.5 }, 'MUTUAL'), /non-negative integer/);
  assert.throws(() => buildMoneyBreakdown({ ...base, unresolvedSessions: 6 }), /cannot exceed/);
});

test('preview: same function, same inputs — the refund figure equals the termination refund for every reason and shape', () => {
  for (const rates of [PT_ONLY, WITH_GYM]) {
    for (const [price, total, u, c, n] of [
      [5_000_000, 10, 4, 0, 2], [5_000_000, 10, 0, 0, 0], [1_000_003, 3, 1, 1, 1], [999_999, 7, 2, 2, 3], [5_000_000, 10, 10, 0, 0], [7, 3, 0, 0, 3],
    ] as const) {
      for (const reason of REASONS) {
        const input: ContractMoneyInput = { price: D(price), totalSessions: total, usedSessions: u, compensatedSessions: c, unresolvedSessions: n, rates };
        const preview = buildMoneyBreakdown(input, reason);
        assert.equal(preview.refundIfCancelledNow, computeTermination(input, reason).refund.toFixed(2), `${reason} ${price}/${total} u${u} c${c} n${n}`);
        assert.equal(preview.reasonUsed, reason);
        if (n > 0) {
          assert.equal(preview.unresolvedAmountHeld, computeTermination(input, reason).unresolvedHeld.total.toFixed(2));
          assert.equal(preview.unresolvedSessions, n);
        } else {
          assert.ok(!('unresolvedAmountHeld' in preview), 'absent when nothing is unresolved');
          assert.ok(!('unresolvedSessions' in preview));
        }
      }
    }
  }
});

test('preview defaults to CLIENT_CANCELLED and keeps every existing field', () => {
  const b = buildMoneyBreakdown({ price: D(1_000_000), totalSessions: 10, usedSessions: 3, rates: PT_ONLY });
  assert.equal(b.reasonUsed, 'CLIENT_CANCELLED');
  assert.equal(b.refundIfCancelledNow, '630000.00');
  for (const key of ['price', 'totalSessions', 'usedSessions', 'compensatedSessions', 'unit', 'remaining', 'rates', 'released', 'stillPending', 'refundIfCancelledNow']) {
    assert.ok(key in b, `existing field ${key} is still there`);
  }
  assert.equal(buildMoneyBreakdown({ price: D(1_000_000), totalSessions: 10, usedSessions: 3, rates: PT_ONLY }, 'MUTUAL').refundIfCancelledNow, '700000.00');
});
