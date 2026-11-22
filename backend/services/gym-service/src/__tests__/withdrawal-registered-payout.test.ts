import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYOUT_SOURCE_REGISTERED,
  PayoutAccountRequiredError,
  formatRegisteredPayout,
  registeredPayoutFrom,
  resolveRegisteredPayoutInfo,
  type PayoutDb,
} from '../services/withdrawal-payout.service';
import { withdrawalRecipientsForGym, type WithdrawalRecipientsDb } from '../services/withdrawal-recipients.service';

/**
 * Gym Owner handoff items 1 and 3 (owner decisions 22/11/2026), gym-service side, without a database.
 * evidence label: TEST FIXTURE (stub db objects). The same code behind the real routes + a real *_test database:
 * withdrawal-registered-payout.integration.test.ts.
 */

const FULL = { payoutBankName: 'Vietcombank', payoutBankAccountNumber: '0123456789', payoutBankAccountHolder: 'NGUYEN VAN A' };

function payoutDb(opts: { accountPartnerId?: string | null; brandPartnerId?: string | null; partner?: { payoutBankName: string | null; payoutBankAccountNumber: string | null; payoutBankAccountHolder: string | null } | null }): PayoutDb {
  return {
    gymPartnerAccount: { findUnique: async () => (opts.accountPartnerId ? { partnerId: opts.accountPartnerId } : null) },
    gymPartner: {
      findFirst: async () => (opts.brandPartnerId ? { id: opts.brandPartnerId } : null),
      findUnique: async () => (opts.partner === undefined ? FULL : opts.partner),
    },
  };
}

test('registeredPayoutFrom: only a COMPLETE account counts (bank, number, holder), blanks trimmed', () => {
  assert.deepEqual(registeredPayoutFrom({ payoutBankName: ' VCB ', payoutBankAccountNumber: ' 123 ', payoutBankAccountHolder: ' A ' }), {
    bankName: 'VCB',
    accountNumber: '123',
    accountHolder: 'A',
  });
  assert.equal(registeredPayoutFrom(null), null);
  assert.equal(registeredPayoutFrom({ ...FULL, payoutBankAccountNumber: null }), null);
  assert.equal(registeredPayoutFrom({ ...FULL, payoutBankName: '  ' }), null);
  assert.equal(registeredPayoutFrom({ ...FULL, payoutBankAccountHolder: null }), null);
});

test('formatRegisteredPayout: "Ngân hàng — số tài khoản — chủ tài khoản"', () => {
  assert.equal(formatRegisteredPayout({ bankName: 'Vietcombank', accountNumber: '0123456789', accountHolder: 'NGUYEN VAN A' }), 'Vietcombank — 0123456789 — NGUYEN VAN A');
  assert.equal(PAYOUT_SOURCE_REGISTERED, 'REGISTERED_ACCOUNT');
});

test('resolveRegisteredPayoutInfo: the destination comes from the partner of the branch owner', async () => {
  const out = await resolveRegisteredPayoutInfo({ ownerId: 'u1', brandId: 'b1' }, payoutDb({ accountPartnerId: 'p1' }));
  assert.equal(out.payoutInfo, 'Vietcombank — 0123456789 — NGUYEN VAN A');
  assert.equal(out.account.accountNumber, '0123456789');
});

test('resolveRegisteredPayoutInfo: a legacy owner with no account row is resolved through the brand link', async () => {
  const out = await resolveRegisteredPayoutInfo({ ownerId: 'u1', brandId: 'b1' }, payoutDb({ accountPartnerId: null, brandPartnerId: 'p9' }));
  assert.match(out.payoutInfo, /^Vietcombank/);
});

test('resolveRegisteredPayoutInfo: no partner record -> 409 PAYOUT_ACCOUNT_REQUIRED with a Vietnamese message', async () => {
  await assert.rejects(
    () => resolveRegisteredPayoutInfo({ ownerId: 'u1', brandId: null }, payoutDb({ accountPartnerId: null })),
    (e: any) => e instanceof PayoutAccountRequiredError && e.status === 409 && e.code === 'PAYOUT_ACCOUNT_REQUIRED' && /tài khoản nhận tiền/i.test(e.message),
  );
});

test('resolveRegisteredPayoutInfo: partner exists but declared no / an incomplete account -> 409 PAYOUT_ACCOUNT_REQUIRED', async () => {
  const none = { payoutBankName: null, payoutBankAccountNumber: null, payoutBankAccountHolder: null };
  await assert.rejects(() => resolveRegisteredPayoutInfo({ ownerId: 'u1' }, payoutDb({ accountPartnerId: 'p1', partner: none })), (e: any) => e.code === 'PAYOUT_ACCOUNT_REQUIRED');
  await assert.rejects(
    () => resolveRegisteredPayoutInfo({ ownerId: 'u1' }, payoutDb({ accountPartnerId: 'p1', partner: { ...FULL, payoutBankAccountHolder: null } as any })),
    (e: any) => e.code === 'PAYOUT_ACCOUNT_REQUIRED',
  );
});

// ── recipients (item 3) ────────────────────────────────────────────────────────────────────────────

function recipientsDb(opts: { gym: any; accountPartnerId?: string | null; owners?: string[] }): WithdrawalRecipientsDb & { queries: any[] } {
  const queries: any[] = [];
  return {
    queries,
    gym: { findUnique: async () => opts.gym },
    gymPartnerAccount: {
      findUnique: async () => (opts.accountPartnerId ? { partnerId: opts.accountPartnerId } : null),
      findMany: async (args: any) => {
        queries.push(args);
        return (opts.owners ?? []).map((userId) => ({ userId }));
      },
    },
    gymPartner: { findFirst: async () => null },
  };
}

const GYM = { id: 'g1', ownerId: 'owner-1', brandId: 'b1', name: 'Gym Nội bộ', approvedName: 'Gym Quận 1' };

test('withdrawalRecipientsForGym: the branch owner + every ACTIVE OWNER account of the partner, once each; the public branch name', async () => {
  const db = recipientsDb({ gym: GYM, accountPartnerId: 'p1', owners: ['owner-1', 'owner-2'] });
  const out = await withdrawalRecipientsForGym('g1', db);
  assert.deepEqual(out!.userIds.sort(), ['owner-1', 'owner-2']);
  assert.equal(out!.gymName, 'Gym Quận 1');
  assert.deepEqual(db.queries[0].where, { partnerId: 'p1', role: 'OWNER', status: 'ACTIVE' }, 'only ACTIVE OWNER accounts - never managers / receptionists / accountants / revoked');
});

test('withdrawalRecipientsForGym: no partner record -> still the branch owner', async () => {
  const out = await withdrawalRecipientsForGym('g1', recipientsDb({ gym: { ...GYM, approvedName: null }, accountPartnerId: null }));
  assert.deepEqual(out!.userIds, ['owner-1']);
  assert.equal(out!.gymName, 'Gym Nội bộ');
});

test('withdrawalRecipientsForGym: unknown branch -> null (the route answers 404)', async () => {
  assert.equal(await withdrawalRecipientsForGym('nope', recipientsDb({ gym: null })), null);
});
