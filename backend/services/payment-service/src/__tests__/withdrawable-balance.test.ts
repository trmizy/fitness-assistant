/**
 * Gym Owner handoff item 7 (22/11/2026): "Có thể rút" must equal what requestWithdrawal accepts, so both use ONE formula
 * (withdrawable-balance.ts). evidence label: TEST FIXTURE (pure arithmetic, no database). The same formula against the real ledger,
 * incl. a gym's open platform debt, is covered by withdrawal-gym-registered-payout.integration.test.ts and gym-debt-auto-recovery.integration.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../generated/prisma';
import { withdrawableFromParts } from '../services/withdrawable-balance';

const D = (v: string | number) => new Prisma.Decimal(v);
const s = (d: Prisma.Decimal) => d.toFixed(0);

test('GYM: available minus PENDING requests minus open platform debt', () => {
  const out = withdrawableFromParts({ ownerType: 'GYM', available: D(1_000_000), pendingReserved: D(300_000), gymDebt: D(150_000) });
  assert.equal(s(out.withdrawable), '550000');
  assert.equal(s(out.reservedPending), '300000');
  assert.equal(s(out.gymDebt), '150000');
});

test('GYM: no PENDING and no debt -> the whole available balance', () => {
  const out = withdrawableFromParts({ ownerType: 'GYM', available: D(800_000), pendingReserved: D(0), gymDebt: D(0) });
  assert.equal(s(out.withdrawable), '800000');
});

test('GYM: debt larger than what is left is floored at 0, never negative', () => {
  const out = withdrawableFromParts({ ownerType: 'GYM', available: D(100_000), pendingReserved: D(40_000), gymDebt: D(500_000) });
  assert.equal(s(out.withdrawable), '0');
});

test('GYM: PENDING larger than available (cannot normally happen) is floored at 0', () => {
  const out = withdrawableFromParts({ ownerType: 'GYM', available: D(10_000), pendingReserved: D(50_000), gymDebt: D(0) });
  assert.equal(s(out.withdrawable), '0');
});

test('GYM: APPROVED requests are NOT an input - they already left available for LOCKED, so they are not subtracted twice', () => {
  // availableBalance here is what is left AFTER approve() moved the approved amount to LOCKED; only PENDING is passed in.
  const out = withdrawableFromParts({ ownerType: 'GYM', available: D(400_000), pendingReserved: D(0), gymDebt: D(0) });
  assert.equal(s(out.withdrawable), '400000');
});

test('PT: available minus PENDING; the gym debt input is ignored for a non-GYM wallet', () => {
  const out = withdrawableFromParts({ ownerType: 'PT', available: D(500_000), pendingReserved: D(100_000), gymDebt: D(999_999) });
  assert.equal(s(out.withdrawable), '400000');
  assert.equal(s(out.gymDebt), '0');
});

test('CLIENT: refund-sourced net, capped by available minus PENDING', () => {
  assert.equal(s(withdrawableFromParts({ ownerType: 'CLIENT', available: D(900_000), pendingReserved: D(0), clientRefundNet: D(250_000) }).withdrawable), '250000');
  assert.equal(s(withdrawableFromParts({ ownerType: 'CLIENT', available: D(100_000), pendingReserved: D(0), clientRefundNet: D(250_000) }).withdrawable), '100000');
  assert.equal(s(withdrawableFromParts({ ownerType: 'CLIENT', available: D(900_000), pendingReserved: D(0), clientRefundNet: D(-5) }).withdrawable), '0');
});
