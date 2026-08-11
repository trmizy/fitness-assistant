/**
 * Arithmetic tests for the contract money formulas.
 *
 * These check the exact numbers from the acceptance scenarios rather than "close enough":
 * a three-way split that is one đồng out is a real defect, because the shortfall would have
 * to come out of escrow — money belonging to somebody else.
 *
 * Run: npx tsx --test src/__tests__/contract-money.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../generated/prisma';
import {
  assertRatesValid,
  buildMoneyBreakdown,
  computeNoShowCompensation,
  computeSessionRelease,
  computeTermination,
  countsAsUsed,
  remainingValue,
  resolveRates,
  splitThreeWays,
  unitValue,
  type RateTable,
  type TerminationReason,
} from '../services/contract-money';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** 90/10 — a PT working independently. */
const PT_ONLY: RateTable = { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D(0) };
/** 55/35/10 — a PT working out of a partner gym. */
const WITH_GYM: RateTable = { platformRate: D('0.10'), ptRate: D('0.55'), gymRate: D('0.35') };

const eq = (actual: Prisma.Decimal, expected: string, label: string) =>
  assert.equal(actual.toString(), D(expected).toString(), label);

// ── Rate table constraints ───────────────────────────────────────────────────

test('rates must sum to exactly 1', () => {
  assert.doesNotThrow(() => assertRatesValid(PT_ONLY));
  assert.doesNotThrow(() => assertRatesValid(WITH_GYM));
  assert.throws(
    () => assertRatesValid({ platformRate: D('0.10'), ptRate: D('0.85'), gymRate: D('0.04') }),
    /must equal exactly 1/,
  );
  // Off by a ten-thousandth — still rejected, no tolerance band.
  assert.throws(
    () => assertRatesValid({ platformRate: D('0.10'), ptRate: D('0.8999'), gymRate: D(0) }),
    /must equal exactly 1/,
  );
});

test('platformRate has a floor of 0.10', () => {
  assert.throws(
    () => assertRatesValid({ platformRate: D('0.05'), ptRate: D('0.95'), gymRate: D(0) }),
    /platformRate must be >= 0.1/,
  );
});

test('negative rates are rejected', () => {
  assert.throws(
    () => assertRatesValid({ platformRate: D('0.20'), ptRate: D('1.00'), gymRate: D('-0.20') }),
    /must be >= 0/,
  );
});

test('resolveRates zeroes the gym share for online and independent contracts', () => {
  const online = resolveRates({
    platformRate: D('0.10'), ptRate: D('0.55'), gymRate: D('0.35'),
    hasGym: true, sessionMode: 'ONLINE',
  });
  eq(online.gymRate, '0', 'online contract uses no gym floor space');
  eq(online.ptRate, '0.90', 'the gym share folds back into the PT');

  const independent = resolveRates({ hasGym: false, sessionMode: 'OFFLINE' });
  eq(independent.gymRate, '0', 'no gym attached');
  eq(independent.ptRate, '0.90', 'PT takes everything but the platform fee');

  const viaGym = resolveRates({
    platformRate: D('0.10'), ptRate: D('0.55'), gymRate: D('0.35'),
    hasGym: true, sessionMode: 'OFFLINE',
  });
  eq(viaGym.gymRate, '0.35', 'offline gym contract keeps the negotiated gym share');
});

// ── Session accounting ───────────────────────────────────────────────────────

test('only completed sessions and client no-shows consume quota', () => {
  assert.equal(countsAsUsed('COMPLETED'), true);
  assert.equal(countsAsUsed('NO_SHOW', 'CLIENT'), true);
  assert.equal(countsAsUsed('NO_SHOW', 'PT'), false, 'the PT failing to show must not burn the session');
  assert.equal(countsAsUsed('PENDING_CLIENT_CONFIRMATION'), false);
  assert.equal(countsAsUsed('DISPUTED'), false);
  assert.equal(countsAsUsed('REQUESTED'), false);
  assert.equal(countsAsUsed('CONFIRMED'), false);
  assert.equal(countsAsUsed('CANCELLED'), false);
});

// ── Core quantities ──────────────────────────────────────────────────────────

test('unit and remaining are computed without intermediate rounding', () => {
  eq(unitValue(D(1_000_000), 10), '100000', 'unit');
  eq(remainingValue({ price: D(1_000_000), totalSessions: 10, usedSessions: 2, rates: PT_ONLY }), '800000', 'remaining');
  eq(remainingValue({ price: D(1_000_000), totalSessions: 3, usedSessions: 0, rates: PT_ONLY }), '1000000', 'nothing used → full price, no division loss');

  // 1.000.000 / 3 is not representable in đồng. What matters is that the fraction survives
  // to the next step instead of being flattened to 333333 — the flattening is what would
  // lose money. (Decimal carries 20 significant digits, so the ×3 round-trip is still off in
  // the 20th digit; that is arithmetic, not a rounding decision, and every đồng-level result
  // is reconciled exactly by splitThreeWays.)
  const third = unitValue(D(1_000_000), 3);
  assert.ok(third.decimalPlaces() > 2, 'the unit must keep sub-đồng precision, got ' + third.toString());
  assert.ok(third.mul(3).minus(D(1_000_000)).abs().lessThan(D('0.000001')), 'unit × N must return P to well below a đồng');
});

test('malformed contracts are rejected rather than silently producing money', () => {
  assert.throws(() => remainingValue({ price: D(100), totalSessions: 0, usedSessions: 0, rates: PT_ONLY }), /positive integer/);
  assert.throws(() => remainingValue({ price: D(100), totalSessions: 5, usedSessions: 6, rates: PT_ONLY }), /cannot exceed/);
  assert.throws(() => remainingValue({ price: D(-1), totalSessions: 5, usedSessions: 0, rates: PT_ONLY }), /price must be >= 0/);
});

// ── Scenario A: a contract that runs normally ────────────────────────────────

test('Scenario A: 1.000.000đ / 10 sessions releases 90/10 per session', () => {
  const rel = computeSessionRelease(D(1_000_000), 10, PT_ONLY);
  eq(rel.unit, '100000', 'unit');
  eq(rel.pt, '90000', 'PT per session');
  eq(rel.platform, '10000', 'platform per session');
  eq(rel.gym, '0', 'no gym');

  // After 3 confirmed sessions.
  eq(rel.pt.mul(3), '270000', 'PT available after 3');
  eq(D(900_000).minus(rel.pt.mul(3)), '630000', 'PT pending after 3');

  // After all 10.
  eq(rel.pt.mul(10), '900000', 'PT available at the end');
  eq(rel.platform.mul(10), '100000', 'platform revenue at the end');
});

// ── Scenario B: client cancels after 2 sessions ──────────────────────────────

test('Scenario B: client cancels after 2 of 10 sessions', () => {
  const out = computeTermination(
    { price: D(1_000_000), totalSessions: 10, usedSessions: 2, rates: PT_ONLY },
    'CLIENT_CANCELLED',
  );
  eq(out.remaining, '800000', 'remaining');
  eq(out.refund, '720000', 'client receives 90% of the unused value');
  eq(out.withheld, '280000', 'withheld');
  eq(out.entitlement.pt, '252000', 'PT total entitlement');
  eq(out.entitlement.platform, '28000', 'platform total entitlement');
  eq(out.refund.plus(out.entitlement.pt).plus(out.entitlement.platform), '1000000', 'the three parts rebuild P');
});

// ── Scenario D: the negative-refund trap ─────────────────────────────────────

test('Scenario D: 20 sessions, 19 used — the refund stays positive', () => {
  const out = computeTermination(
    { price: D(2_000_000), totalSessions: 20, usedSessions: 19, rates: PT_ONLY },
    'CLIENT_CANCELLED',
  );
  eq(out.remaining, '100000', 'one session left');
  eq(out.refund, '90000', 'refund is 90% of that, not negative');
  assert.ok(out.refund.greaterThanOrEqualTo(0), 'refund must never go negative');
  eq(out.withheld, '1910000', 'withheld');
  eq(out.entitlement.pt.plus(out.entitlement.platform).plus(out.refund), '2000000', 'reconciles');
});

test('a flat fee on the whole contract would have gone negative — the guard proves the shape', () => {
  // The rejected design: withheld = usedValue + 0.10 × P.
  const usedValue = D(2_000_000).mul(19).div(20); // 1.900.000
  const flatFee = D(2_000_000).mul('0.10'); // 200.000
  const wouldWithhold = usedValue.plus(flatFee);
  assert.ok(
    wouldWithhold.greaterThan(D(2_000_000)),
    'the discarded formula withholds more than the client ever paid — this is the bug avoided',
  );
});

test('cancelling with every session used refunds nothing and never goes negative', () => {
  const out = computeTermination(
    { price: D(1_000_000), totalSessions: 10, usedSessions: 10, rates: PT_ONLY },
    'CLIENT_CANCELLED',
  );
  eq(out.remaining, '0', 'nothing left');
  eq(out.refund, '0', 'nothing to refund');
  eq(out.entitlement.pt, '900000', 'PT keeps their full share');
});

// ── Scenario E: with a gym ───────────────────────────────────────────────────

test('Scenario E: 55/35/10 split, client cancels after 2 of 10', () => {
  const out = computeTermination(
    { price: D(1_000_000), totalSessions: 10, usedSessions: 2, rates: WITH_GYM },
    'CLIENT_CANCELLED',
  );
  eq(out.refund, '720000', 'client');
  eq(out.entitlement.pt, '154000', 'PT = 0.55 × 280.000');
  eq(out.entitlement.gym, '98000', 'gym = 0.35 × 280.000');
  eq(out.entitlement.platform, '28000', 'platform = 0.10 × 280.000');
  eq(
    out.refund.plus(out.entitlement.pt).plus(out.entitlement.gym).plus(out.entitlement.platform),
    '1000000',
    'all four parts rebuild P',
  );
});

// ── Scenario F: rounding ─────────────────────────────────────────────────────

test('Scenario F: 1.000.000đ over 3 sessions, cancelled after 1 — not one đồng lost', () => {
  const input = { price: D(1_000_000), totalSessions: 3, usedSessions: 1, rates: WITH_GYM };
  const out = computeTermination(input, 'CLIENT_CANCELLED');

  const parts = out.refund.plus(out.entitlement.pt).plus(out.entitlement.gym).plus(out.entitlement.platform);
  eq(parts, '1000000', 'the four parts must rebuild P exactly');

  // remaining = 2/3 × 1.000.000 = 666666.66…; refund rounds UP for the client.
  eq(out.refund, '600000', 'refund = ceil(0.9 × 666666.66…)');
  eq(out.withheld, '400000', 'withheld');

  // PT and gym round down, the platform takes the remainder.
  const exactPt = D(400_000).mul('0.55');
  const exactGym = D(400_000).mul('0.35');
  assert.ok(out.entitlement.pt.lessThanOrEqualTo(exactPt), 'PT rounded down');
  assert.ok(out.entitlement.gym.lessThanOrEqualTo(exactGym), 'gym rounded down');
  const remainderAbsorbed = out.withheld.minus(out.entitlement.pt).minus(out.entitlement.gym);
  eq(out.entitlement.platform, remainderAbsorbed.toString(), 'the platform absorbs the rounding remainder');
});

test('splitThreeWays always reconciles across a sweep of awkward totals', () => {
  for (let total = 1; total <= 400; total++) {
    for (const rates of [PT_ONLY, WITH_GYM]) {
      const s = splitThreeWays(D(total), rates);
      assert.ok(
        s.pt.plus(s.gym).plus(s.platform).equals(D(total)),
        `split of ${total} did not reconcile: ${s.pt}+${s.gym}+${s.platform}`,
      );
      assert.ok(s.pt.greaterThanOrEqualTo(0) && s.gym.greaterThanOrEqualTo(0) && s.platform.greaterThanOrEqualTo(0),
        `split of ${total} produced a negative part`);
      assert.ok(s.pt.isInteger() && s.gym.isInteger(), `split of ${total} produced fractional đồng`);
    }
  }
});

test('a rate table where the platform would round to a negative remainder is caught', () => {
  // 0.10 platform on a 1đ total: PT gets floor(0.9) = 0, so the platform absorbs the whole 1đ.
  const s = splitThreeWays(D(1), PT_ONLY);
  eq(s.pt, '0', 'PT rounds down to nothing');
  eq(s.platform, '1', 'platform takes the đồng');
});

// ── Every termination reason ─────────────────────────────────────────────────

test('all six termination reasons produce a reconciling outcome', () => {
  const reasons: TerminationReason[] = [
    'CLIENT_CANCELLED', 'PT_BANNED', 'PT_CANCELLED', 'MUTUAL', 'EXPIRED', 'COMPLETED',
  ];
  const input = { price: D(1_000_000), totalSessions: 10, usedSessions: 4, rates: WITH_GYM };

  const expectedRefund: Record<TerminationReason, string> = {
    CLIENT_CANCELLED: '540000', // 0.9 × 600.000
    PT_BANNED: '600000',
    PT_CANCELLED: '600000',
    MUTUAL: '600000',
    EXPIRED: '0',
    COMPLETED: '0',
  };

  for (const reason of reasons) {
    const out = computeTermination(input, reason);
    eq(out.refund, expectedRefund[reason], `${reason} refund`);
    const total = out.refund
      .plus(out.entitlement.pt).plus(out.entitlement.gym).plus(out.entitlement.platform);
    eq(total, '1000000', `${reason} reconciles`);
    assert.ok(out.refund.greaterThanOrEqualTo(0), `${reason} refund non-negative`);
  }
});

test('a banned PT costs the client nothing — unlike the client walking away', () => {
  const input = { price: D(1_000_000), totalSessions: 10, usedSessions: 2, rates: PT_ONLY };
  const banned = computeTermination(input, 'PT_BANNED');
  const walked = computeTermination(input, 'CLIENT_CANCELLED');
  eq(banned.refund, '800000', 'full remaining value returned');
  assert.ok(banned.refund.greaterThan(walked.refund), 'no cancellation fee when the fault is the PT’s');
  eq(banned.penalty, '0', 'a ban is not an extra fine on top');
});

test('PT_CANCELLED mirrors the client fee as a penalty charged to the PT side', () => {
  const out = computeTermination(
    { price: D(1_000_000), totalSessions: 10, usedSessions: 2, rates: PT_ONLY },
    'PT_CANCELLED',
  );
  eq(out.refund, '800000', 'client made whole');
  eq(out.penalty, '80000', '10% of the remaining value, the same slice a client would forfeit');
});

// ── Scenario C: PT no-show ───────────────────────────────────────────────────

test('Scenario C: PT misses a session — client compensated one session, all three charged', () => {
  const c = computeNoShowCompensation(D(1_000_000), 10, PT_ONLY);
  eq(c.compensation, '100000', 'client receives one session of value');
  eq(c.pt, '90000', 'PT charged their share');
  eq(c.platform, '10000', 'platform gives back its commission on the session that never happened');
  eq(c.pt.plus(c.gym).plus(c.platform), '100000', 'the charges fund the compensation exactly');

  // The pending buckets after the charge, per the worked example.
  eq(D(900_000).minus(c.pt), '810000', 'PT pending 900.000 → 810.000');
  eq(D(100_000).minus(c.platform), '90000', 'platform pending 100.000 → 90.000');
});

test('no-show compensation splits three ways when a gym is involved', () => {
  const c = computeNoShowCompensation(D(1_000_000), 10, WITH_GYM);
  eq(c.compensation, '100000', 'compensation');
  eq(c.pt, '55000', 'PT');
  eq(c.gym, '35000', 'gym');
  eq(c.platform, '10000', 'platform');
  eq(c.pt.plus(c.gym).plus(c.platform), '100000', 'reconciles');
});

// ── Breakdown endpoint payload ───────────────────────────────────────────────

test('money breakdown reports released, pending and the refund on offer right now', () => {
  const b = buildMoneyBreakdown({ price: D(1_000_000), totalSessions: 10, usedSessions: 3, rates: PT_ONLY });
  assert.equal(b.released.pt, '270000.00');
  assert.equal(b.stillPending.pt, '630000.00');
  assert.equal(b.released.platform, '30000.00');
  assert.equal(b.stillPending.platform, '70000.00');
  assert.equal(b.refundIfCancelledNow, '630000.00', '0.9 × 700.000');
  assert.equal(b.unit, '100000.00');
});
