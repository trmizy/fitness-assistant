/**
 * BE-2 four-eyes on large withdrawals: for an amount >= WITHDRAWAL_FOUR_EYES_MIN_VND (default
 * 5,000,000đ) the admin who confirms the payout (markPaid) must differ from the admin who approved
 * it. Below the threshold nothing changes.
 *
 *   evidence label: BACKEND INTEGRATION (real withdrawalService + real *_test database; the env
 *   parsing tests are pure unit tests and need no database).
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/withdrawal-four-eyes.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';
import { Prisma } from '../generated/prisma';
import { DEFAULT_FOUR_EYES_MIN_VND, isFourEyesRequired, parseFourEyesMinAmount } from '../services/withdrawal.service';

const canUseIntegrationDb = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const skipOpts = { skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

// ---- pure: env parsing / threshold comparison (no database) -------------------------------------

test('parseFourEyesMinAmount: unset/blank -> default 5,000,000', () => {
  assert.equal(DEFAULT_FOUR_EYES_MIN_VND, 5000000);
  for (const raw of [undefined, null, '', '   ']) {
    assert.equal(parseFourEyesMinAmount(raw).toString(), '5000000');
  }
});

test('parseFourEyesMinAmount: a plain positive integer is used as is', () => {
  assert.equal(parseFourEyesMinAmount('1000000').toString(), '1000000');
  assert.equal(parseFourEyesMinAmount(' 20000000 ').toString(), '20000000');
});

test('parseFourEyesMinAmount: anything else falls back to the default (zero, negative, decimal, text, exponent)', () => {
  for (const raw of ['0', '-5', '1.5', '5e6', '5.000.000', 'abc', '0x10', '1 000']) {
    assert.equal(parseFourEyesMinAmount(raw).toString(), '5000000', `raw=${raw}`);
  }
});

test('isFourEyesRequired: exactly at the threshold requires it, one dong below does not (Decimal, no float)', () => {
  const t = new Prisma.Decimal(5000000);
  assert.equal(isFourEyesRequired(new Prisma.Decimal('5000000'), t), true);
  assert.equal(isFourEyesRequired(new Prisma.Decimal('5000000.00'), t), true);
  assert.equal(isFourEyesRequired(new Prisma.Decimal('4999999.99'), t), false);
  assert.equal(isFourEyesRequired(new Prisma.Decimal('12000000'), t), true);
});

// ---- integration --------------------------------------------------------------------------------

type Deps = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  walletService: (typeof import('../services/wallet.service'))['walletService'];
  withdrawalService: (typeof import('../services/withdrawal.service'))['withdrawalService'];
};
let d: Deps;

test.before(async () => {
  if (!canUseIntegrationDb) return;
  d = {
    prisma: (await import('../repositories/prisma')).prisma,
    walletService: (await import('../services/wallet.service')).walletService,
    withdrawalService: (await import('../services/withdrawal.service')).withdrawalService,
  };
});

test.after(async () => {
  if (d?.prisma) await d.prisma.$disconnect();
});

function hasCode(code: string, status?: number) {
  return (e: unknown) =>
    (e as { code?: string }).code === code && (status === undefined || (e as { status?: number }).status === status);
}

async function fund(ptId: string, amount: string) {
  const wallet = await d.walletService.getOrCreateWallet('PT', ptId);
  const escrow = await d.walletService.getEscrowWallet();
  const txn = await d.prisma.paymentTransaction.create({
    data: {
      id: randomUUID(),
      payerId: randomUUID(),
      purpose: 'PT_CONTRACT',
      amount: new Prisma.Decimal(amount),
      idempotencyKey: `test:${randomUUID()}`,
      status: 'PAID',
    },
  });
  await d.walletService.withWallets([wallet.id, escrow.id], txn.id, async (ops) => {
    await ops.credit(wallet.id, new Prisma.Decimal(amount), 'test earnings');
    await ops.credit(escrow.id, new Prisma.Decimal(amount), 'escrow intake for test earnings');
  });
  return wallet;
}

/** An APPROVED request of `amount`, approved by `approver`. */
async function approvedRequest(amount: string, approver: string) {
  const ptId = randomUUID();
  const wallet = await fund(ptId, amount);
  const req = await d.withdrawalService.requestWithdrawal('PT', ptId, amount, 'Bank ABC 0123');
  await d.withdrawalService.approve(req.id, approver);
  return { req, wallet };
}

test('over the threshold: the approver cannot also confirm the payout (409 FOUR_EYES_REQUIRED), nothing is written', skipOpts, async () => {
  const adminA = randomUUID();
  const { req, wallet } = await approvedRequest('6000000', adminA);
  const before = await d.prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  const ledgerBefore = await d.prisma.walletLedgerEntry.count({ where: { walletId: wallet.id } });

  await assert.rejects(
    () => d.withdrawalService.markPaid(req.id, adminA, 'VCB-REF-1'),
    hasCode('FOUR_EYES_REQUIRED', 409),
  );
  await assert.rejects(
    () => d.withdrawalService.markPaid(req.id, adminA, 'VCB-REF-1'),
    (e: unknown) => /5\.000\.000 ₫ trở lên cần một quản trị viên khác với người đã duyệt xác nhận đã chi\./.test((e as Error).message),
  );

  const after = await d.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(after.status, 'APPROVED', 'status unchanged');
  assert.equal(after.reviewedBy, adminA);
  assert.equal(after.paidAt, null);
  assert.equal(after.bankReference, null);
  const wAfter = await d.prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  assert.equal(wAfter.lockedBalance.toFixed(2), before.lockedBalance.toFixed(2), 'locked money untouched');
  assert.equal(await d.prisma.walletLedgerEntry.count({ where: { walletId: wallet.id } }), ledgerBefore, 'no ledger entry written');
});

test('over the threshold: a DIFFERENT admin confirms the payout -> PAID', skipOpts, async () => {
  const adminA = randomUUID();
  const adminB = randomUUID();
  const { req } = await approvedRequest('6000000', adminA);

  const paid = await d.withdrawalService.markPaid(req.id, adminB, 'VCB-REF-2');
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.reviewedBy, adminA, 'approver stays the approver');
  assert.equal(paid.bankReference, 'VCB-REF-2');
});

test('exactly at the threshold (5,000,000) the second admin is required', skipOpts, async () => {
  const adminA = randomUUID();
  const adminB = randomUUID();
  const { req } = await approvedRequest('5000000', adminA);

  await assert.rejects(() => d.withdrawalService.markPaid(req.id, adminA, 'REF-3'), hasCode('FOUR_EYES_REQUIRED', 409));
  const paid = await d.withdrawalService.markPaid(req.id, adminB, 'REF-3');
  assert.equal(paid.status, 'PAID');
});

test('one dong below the threshold the approver may pay as before (unchanged behaviour)', skipOpts, async () => {
  const adminA = randomUUID();
  const { req } = await approvedRequest('4999999', adminA);

  const paid = await d.withdrawalService.markPaid(req.id, adminA, 'REF-4');
  assert.equal(paid.status, 'PAID');
});

test('below the threshold, paying straight from PENDING by one admin still works (unchanged)', skipOpts, async () => {
  const adminA = randomUUID();
  const ptId = randomUUID();
  await fund(ptId, '1000000');
  const req = await d.withdrawalService.requestWithdrawal('PT', ptId, '1000000', 'Bank ABC');

  const paid = await d.withdrawalService.markPaid(req.id, adminA, 'REF-5');
  assert.equal(paid.status, 'PAID');
});

test('over the threshold a never-approved request cannot be paid straight from PENDING (one admin would approve AND pay)', skipOpts, async () => {
  const adminA = randomUUID();
  const adminB = randomUUID();
  const ptId = randomUUID();
  await fund(ptId, '7000000');
  const req = await d.withdrawalService.requestWithdrawal('PT', ptId, '7000000', 'Bank ABC');

  await assert.rejects(() => d.withdrawalService.markPaid(req.id, adminA, 'REF-6'), hasCode('FOUR_EYES_REQUIRED', 409));
  const still = await d.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(still.status, 'PENDING');
  assert.equal(still.reviewedBy, null);

  // ...and the supported route works: approve by A, pay by B.
  await d.withdrawalService.approve(req.id, adminA);
  const paid = await d.withdrawalService.markPaid(req.id, adminB, 'REF-6');
  assert.equal(paid.status, 'PAID');
});

test('the admin queue reports fourEyesRequired / approvedBy / fourEyesMinAmount per item and keeps the old fields', skipOpts, async () => {
  const adminA = randomUUID();
  const { req: big } = await approvedRequest('6000000', adminA);
  const smallPt = randomUUID();
  await fund(smallPt, '100000');
  const small = await d.withdrawalService.requestWithdrawal('PT', smallPt, '100000', 'Bank ABC');

  const list = await d.withdrawalService.listPending();
  const bigRow = list.find((r) => r.id === big.id)!;
  const smallRow = list.find((r) => r.id === small.id)!;
  assert.equal(bigRow.fourEyesRequired, true);
  assert.equal(bigRow.approvedBy, adminA);
  assert.equal(bigRow.fourEyesMinAmount, '5000000.00');
  assert.equal(bigRow.status, 'APPROVED');
  assert.equal(bigRow.reviewedBy, adminA, 'existing field kept');
  assert.equal(smallRow.fourEyesRequired, false);
  assert.equal(smallRow.approvedBy, null);
  assert.equal(smallRow.fourEyesMinAmount, '5000000.00');
});
