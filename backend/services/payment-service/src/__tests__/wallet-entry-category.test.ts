/**
 * Wallet-history `category`: derived, additive, presentation-only. The descriptions below are the exact strings
 * the ledger writes (contract-ledger / membership-ledger / personalized-service-ledger / withdrawal services).
 * Run: npx tsx --test src/__tests__/wallet-entry-category.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWalletEntry } from '../services/wallet-entry-category';

const ID = '97aa71d5-3388-4e8b-8740-887f852b6435';
const c = (description: string, entryType: 'CREDIT' | 'DEBIT' = 'CREDIT', txn?: { purpose?: string; relatedEntityType?: string }) =>
  classifyWalletEntry({ description, entryType }, txn);

test('late payment for a cancelled order / membership / contract is named by product', () => {
  assert.equal(c(`PERSONALIZED_SERVICE_PURCHASE ${ID} — refund (contract could not be activated)`), 'REFUND_UNACTIVATED_PERSONALIZED_SERVICE');
  assert.equal(c(`GYM_MEMBERSHIP ${ID} — refund (contract could not be activated)`), 'REFUND_UNACTIVATED_MEMBERSHIP');
  assert.equal(c(`PT_CONTRACT ${ID} — refund (contract could not be activated)`), 'REFUND_UNACTIVATED_PT_CONTRACT');
  assert.equal(c(`TRAINING_PACKAGE_PURCHASE ${ID} — refund (contract could not be activated)`), 'REFUND_UNACTIVATED_OTHER');
});

test('the transaction purpose names the product when the label does not', () => {
  assert.equal(c('x — refund (contract could not be activated)', 'CREDIT', { relatedEntityType: 'GYM_MEMBERSHIP' }), 'REFUND_UNACTIVATED_MEMBERSHIP');
  assert.equal(c('x — refund', 'CREDIT', { purpose: 'PERSONALIZED_SERVICE_PURCHASE' }), 'REFUND_PERSONALIZED_SERVICE');
});

test('PT contract refunds, no-show and late-arrival compensation', () => {
  assert.equal(c(`Contract ${ID} termination — refund (CLIENT_CANCELLED)`), 'REFUND_PT_CONTRACT');
  assert.equal(c(`Contract ${ID} unresolved session ${ID} — refund (unresolved session not delivered)`), 'REFUND_PT_SESSION_NOT_DELIVERED');
  assert.equal(c(`Contract ${ID} no-show ${ID} — compensation for a missed session`), 'COMPENSATION_PT_NO_SHOW');
  assert.equal(c(`Contract ${ID} PT late arrival ${ID} — compensation for the PT's late arrival`), 'COMPENSATION_PT_LATE_ARRIVAL');
  assert.equal(c(`Contract ${ID} termination — compensation for the PT (from the PT's held-back earnings)`), 'COMPENSATION_PT_FAULT');
});

test('membership and personalized-order refunds', () => {
  assert.equal(c(`Membership ${ID} client self-cancel — refund`), 'REFUND_MEMBERSHIP');
  assert.equal(c(`Membership ${ID} admin refund (DISPUTE) — refund`), 'REFUND_MEMBERSHIP');
  assert.equal(c(`PERSONALIZED_SERVICE_PURCHASE ${ID} — refund`), 'REFUND_PERSONALIZED_SERVICE');
  assert.equal(c('something — refund'), 'REFUND_OTHER');
});

test('withdrawal legs, top-up', () => {
  assert.equal(c(`Withdrawal ${ID} approved — locked for payout`, 'DEBIT'), 'WITHDRAWAL_LOCKED');
  assert.equal(c(`Withdrawal ${ID} rejected — restored from lock`), 'WITHDRAWAL_RESTORED');
  assert.equal(c(`Withdrawal ${ID} paid — ref ABC123`, 'DEBIT'), 'WITHDRAWAL_PAID');
  assert.equal(c('Wallet top-up'), 'TOPUP');
});

test('partner earnings', () => {
  assert.equal(c(`Contract ${ID} — PT share`), 'EARNING_HELD');
  assert.equal(c(`Contract ${ID} session ${ID} — session earned`), 'EARNING_RELEASED');
  assert.equal(c(`Contract ${ID} session ${ID} — release to available`, 'DEBIT'), 'EARNING_MOVED_TO_AVAILABLE');
  assert.equal(c(`Contract ${ID} no-show ${ID} — PT no-show charge`, 'DEBIT'), 'PT_CHARGE_NO_SHOW');
  assert.equal(c(`Contract ${ID} PT late arrival ${ID} — PT late-arrival charge`, 'DEBIT'), 'PT_CHARGE_LATE_ARRIVAL');
  assert.equal(c(`Contract ${ID} holdback — PT holdback retained`), 'HOLDBACK_KEPT');
  assert.equal(c(`Contract ${ID} holdback — PT holdback released (no activity)`), 'HOLDBACK_RELEASED');
  assert.equal(c(`Contract ${ID} holdback — PT holdback released to available`), 'HOLDBACK_RELEASED');
  assert.equal(c(`Contract ${ID} termination — PT holdback used for compensation (PT_CANCELLED)`, 'DEBIT'), 'HOLDBACK_USED_FOR_COMPENSATION');
  assert.equal(c(`Membership ${ID} referral — referral commission`), 'REFERRAL_COMMISSION');
  assert.equal(c(`Contract ${ID} — pending reversed (payment refunded)`, 'DEBIT'), 'PENDING_REVERSED');
});

test('an unknown row is labelled by direction only, never by its text', () => {
  assert.equal(c('Quà tặng khai trương', 'CREDIT'), 'OTHER_CREDIT');
  assert.equal(c(`Session ${ID} SETTLED_X`, 'DEBIT'), 'OTHER_DEBIT');
  assert.equal(classifyWalletEntry({ description: null, entryType: 'CREDIT' }), 'OTHER_CREDIT');
});

test('a debit that merely mentions a refund is not a client refund', () => {
  assert.equal(c(`Contract ${ID} termination — refund (MUTUAL)`, 'DEBIT'), 'OTHER_DEBIT');
});
