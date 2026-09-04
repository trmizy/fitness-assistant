/**
 * Rate-table validation for PT ↔ gym collaborations.
 *
 * These three numbers get copied onto every contract signed under the partnership and are then
 * split to the đồng, so "approximately 1" is not good enough — a table summing to 0.9999 is a
 * data-entry mistake that would quietly misallocate money on every session. Mirrors
 * assertRatesValid in payment-service/src/services/contract-money.ts; the two must agree.
 *
 * Run: npx tsx --test src/__tests__/collaboration-rates.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../generated/prisma';
import { validateRates, MAX_ROUNDS } from '../services/collaboration.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** validateRates(ptRate, gymRate, platformRate) */
const check = (pt: string, gym: string, platform: string) => () =>
  validateRates(D(pt), D(gym), D(platform));

test('a table summing to exactly 1 is accepted', () => {
  assert.doesNotThrow(check('0.90', '0', '0.10'), 'independent PT');
  assert.doesNotThrow(check('0.55', '0.35', '0.10'), 'PT working out of a partner gym');
  assert.doesNotThrow(check('0.45', '0.25', '0.30'), 'a higher platform cut is allowed');
  assert.doesNotThrow(check('0', '0.90', '0.10'), 'the whole non-platform share may go to the gym');
});

test('a table that does not sum to 1 is rejected — no tolerance band', () => {
  assert.throws(check('0.85', '0.04', '0.10'), /bằng đúng 1/, 'sums to 0.99');
  assert.throws(check('0.90', '0.10', '0.10'), /bằng đúng 1/, 'sums to 1.10');
  // Off by a ten-thousandth. This is the case a tolerance band would wave through, and it is
  // exactly the case that silently misallocates money on every contract.
  assert.throws(check('0.8999', '0', '0.10'), /bằng đúng 1/, 'sums to 0.9999');
  assert.throws(check('0.9001', '0', '0.10'), /bằng đúng 1/, 'sums to 1.0001');
});

test('the platform floor of 0.10 is enforced', () => {
  assert.throws(check('0.95', '0', '0.05'), /không được nhỏ hơn/, 'below the floor');
  assert.throws(check('1', '0', '0'), /không được nhỏ hơn/, 'no platform share at all');
  assert.doesNotThrow(check('0.90', '0', '0.10'), 'exactly at the floor is fine');
});

test('negative rates are rejected before anything else', () => {
  assert.throws(check('1.20', '-0.30', '0.10'), /không được âm/, 'negative gym share');
  assert.throws(check('-0.10', '1.00', '0.10'), /không được âm/, 'negative PT share');
  // Sums to 1 and the PT/gym shares are positive, but the platform share is negative — the
  // floor check catches it, which is the stricter of the two messages.
  assert.throws(check('0.70', '0.40', '-0.10'), /không được âm|không được nhỏ hơn/);
});

test('the negotiation round cap is a positive number', () => {
  // A misconfigured MAX_COLLABORATION_ROUNDS of 0 or NaN would either kill every negotiation
  // on its first counter-offer or let one run forever.
  assert.ok(Number.isFinite(MAX_ROUNDS), 'MAX_ROUNDS must parse to a number');
  assert.ok(MAX_ROUNDS >= 1, `MAX_ROUNDS must allow at least one counter-offer, got ${MAX_ROUNDS}`);
});
