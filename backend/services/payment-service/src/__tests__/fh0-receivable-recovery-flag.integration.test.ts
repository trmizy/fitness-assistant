/**
 * Financial Hardening FH-0 (D75, DQ-4) - BACKEND INTEGRATION, real ledger, isolated *_test database.
 *
 * RECEIVABLE_RECOVERY_ENABLED is read on every call inside recoverReceivables. Default (unset / anything but "true"):
 * automatic collection of old PartnerReceivables is PAUSED - a PT with an old receivable who teaches is paid in full, the
 * receivable row is untouched (history kept) and escrow still balances. "true": the old behaviour (debt withheld).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_fha_b_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh0-receivable-recovery-flag.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = {
  skip: isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/contract-ledger.service'),
      reconcile: await import('../services/reconcile.service'),
      wallet: (await import('../services/wallet.service')).walletService,
    };
  }
  return mods;
}
test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

const PT = 'pt-fh0';

async function scenario(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
  const D = (v: string) => new m.Prisma.Decimal(v);
  const clientUserId = 'client-fh0';
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientUserId, purpose: 'PT_CONTRACT', amount: 1_000_000, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${randomUUID()}`, idempotencyKey: `checkout-${randomUUID()}`, relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: 'fh0', activationStatus: 'PENDING', sourceService: 'integration-test',
    },
  });
  const rates = { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') };
  const parties = { ptUserId: PT, gymId: null, clientUserId };
  await m.ledger.settleContractPayment({ transactionId: txn.id, price: D('1000000'), rates, parties, label: 'fh0' });
  // An OLD receivable of this PT (what the pre-FH-1 platform fronting used to book).
  const debt = await m.prisma.partnerReceivable.create({
    data: { partnerType: 'PT', partnerId: PT, amount: 100_000, reason: 'old shortfall', transactionId: txn.id },
  });
  const teach = () =>
    m.ledger.releaseSession({
      transactionId: txn.id, price: D('1000000'), totalSessions: 4, rates, parties, label: 'fh0 session', idempotencyKey: `SESSION_RELEASE:fh0:${randomUUID()}`,
    });
  return { debt, teach };
}

async function withFlag<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.RECEIVABLE_RECOVERY_ENABLED;
  if (value === undefined) delete process.env.RECEIVABLE_RECOVERY_ENABLED;
  else process.env.RECEIVABLE_RECOVERY_ENABLED = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.RECEIVABLE_RECOVERY_ENABLED;
    else process.env.RECEIVABLE_RECOVERY_ENABLED = prev;
  }
}

for (const flag of [undefined, 'false', '', '1', 'yes']) {
  test(`FH-0 RECEIVABLE_RECOVERY_ENABLED=${flag === undefined ? '<unset>' : JSON.stringify(flag)}: the PT is paid in full, the old receivable is untouched, escrow balances`, skipOpts, async () => {
    const m = await load();
    await withFlag(flag, async () => {
      const { debt, teach } = await scenario(m);
      const r = await teach();
      assert.equal(r.released.pt, '225000.00');
      const w = await m.wallet.getOrCreateWallet('PT', PT);
      assert.equal(w.availableBalance.toFixed(2), '225000.00', 'the whole session reached the PT');
      const after = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } });
      assert.equal(after.recovered.toFixed(2), '0.00', 'nothing was collected');
      assert.equal(after.settledAt, null, 'and the debt is still open: history kept');
      assert.equal(after.amount.toFixed(2), '100000.00');
      assert.equal(await m.prisma.walletLedgerEntry.count({ where: { description: { contains: 'withheld against outstanding debt' } } }), 0);
      const report = await m.reconcile.assertInvariant('FH-0 paused');
      assert.equal(report.drift, '0.00');
      assert.equal(report.negativeWallets.length, 0);
    });
  });
}

test('FH-0 RECEIVABLE_RECOVERY_ENABLED=true (case-insensitive): the old behaviour - the debt is withheld from what the PT just earned', skipOpts, async () => {
  const m = await load();
  for (const flag of ['true', 'TRUE', ' True ']) {
    await withFlag(flag, async () => {
      const { debt, teach } = await scenario(m);
      await teach();
      const w = await m.wallet.getOrCreateWallet('PT', PT);
      assert.equal(w.availableBalance.toFixed(2), '125000.00', `${flag}: 100.000 withheld`);
      const after = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } });
      assert.equal(after.recovered.toFixed(2), '100000.00');
      assert.ok(after.settledAt);
      const report = await m.reconcile.assertInvariant('FH-0 enabled');
      assert.equal(report.drift, '0.00');
    });
  }
});

test('FH-0 the flag is read at call time: flipping it between two sessions changes the next session only', skipOpts, async () => {
  const m = await load();
  const { debt, teach } = await scenario(m);
  await withFlag(undefined, () => teach());
  assert.equal((await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } })).recovered.toFixed(2), '0.00');
  await withFlag('true', () => teach());
  assert.equal((await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } })).recovered.toFixed(2), '100000.00');
  assert.equal((await m.wallet.getOrCreateWallet('PT', PT)).availableBalance.toFixed(2), '350000.00', '225.000 + (225.000 - 100.000)');
  await m.reconcile.assertInvariant('FH-0 flip');
});

test('FH-8 columns on top of the flag: with recovery ON a SUSPENDED receivable is not collected (history kept), the PT is paid in full', skipOpts, async () => {
  const m = await load();
  await withFlag('true', async () => {
    const { debt, teach } = await scenario(m);
    await m.prisma.partnerReceivable.update({ where: { id: debt.id }, data: { suspendedAt: new Date(), suspendedBy: 'admin-test', suspensionReason: 'under review' } });
    await teach();
    assert.equal((await m.wallet.getOrCreateWallet('PT', PT)).availableBalance.toFixed(2), '225000.00', 'nothing withheld');
    const after = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } });
    assert.equal(after.recovered.toFixed(2), '0.00');
    assert.equal(after.settledAt, null);
    assert.ok(after.suspendedAt, 'still suspended');
    assert.equal((await m.reconcile.assertInvariant('FH-8 suspended')).drift, '0.00');

    // resuming it makes it collectable again
    await m.prisma.partnerReceivable.update({ where: { id: debt.id }, data: { suspendedAt: null } });
    await teach();
    assert.equal((await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } })).recovered.toFixed(2), '100000.00');
  });
});

test('FH-8 columns on top of the flag: with recovery ON only amount - recovered - waived is collected; a fully waived row is not touched', skipOpts, async () => {
  const m = await load();
  await withFlag('true', async () => {
    const { debt, teach } = await scenario(m);
    await m.prisma.partnerReceivable.update({ where: { id: debt.id }, data: { waived: 60_000, waivedAt: new Date(), waivedBy: 'admin-test' } });
    await teach();
    const after = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } });
    assert.equal(after.recovered.toFixed(2), '40000.00', 'only the 40.000 that was not waived');
    assert.ok(after.settledAt, 'recovered + waived = amount: the row is settled');
    assert.equal((await m.wallet.getOrCreateWallet('PT', PT)).availableBalance.toFixed(2), '185000.00', '225.000 - 40.000');
    assert.equal((await m.reconcile.assertInvariant('FH-8 partial waive')).drift, '0.00');

    const second = await scenario(m);
    await m.prisma.partnerReceivable.update({ where: { id: second.debt.id }, data: { waived: 100_000 } });
    await second.teach();
    const untouched = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: second.debt.id } });
    assert.equal(untouched.recovered.toFixed(2), '0.00');
    assert.equal((await m.wallet.getOrCreateWallet('PT', PT)).availableBalance.toFixed(2), '225000.00');
  });
});
