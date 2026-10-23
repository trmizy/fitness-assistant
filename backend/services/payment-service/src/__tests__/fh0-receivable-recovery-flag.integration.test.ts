/**
 * Owner decision (final) - BACKEND INTEGRATION, real ledger, isolated *_test database.
 *
 * There is NO automatic recovery of a partner's debt by deducting income: `recoverReceivables` no longer exists and no
 * environment variable brings it back. This file used to pin the FH-0 switch (RECEIVABLE_RECOVERY_ENABLED); it now pins that
 * the switch is INERT: for every value of it, with an old PartnerReceivable on the books, a session release and the final
 * settlement pay the partner in full, the receivable row is unchanged (no delete, no waive, no recovered amount), no ledger
 * row mentions debt recovery and the books are sound.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_fh9_test?schema=public" FITNESS_DISABLE_REDIS=true \
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
  return { debt, teach, txn, rates, parties, D };
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

for (const flag of [undefined, 'false', '', '1', 'yes', 'true', 'TRUE', ' True ']) {
  test(`RECEIVABLE_RECOVERY_ENABLED=${flag === undefined ? '<unset>' : JSON.stringify(flag)}: the PT is paid in full, the old receivable is untouched, books are sound`, skipOpts, async () => {
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
      assert.equal(after.waived.toFixed(2), '0.00', 'no mass waive either');
      assert.equal(await m.prisma.walletLedgerEntry.count({ where: { description: { contains: 'outstanding debt' } } }), 0);
      assert.equal(await m.prisma.partnerReceivable.count(), 1, 'no row deleted or created');
      const report = await m.reconcile.assertInvariant('receivable untouched');
      assert.equal(report.drift, '0.00');
      assert.equal(report.negativeWallets.length, 0);
    });
  });
}

test('the final settlement pays the rest in full as well and leaves the receivable alone (switch on and off)', skipOpts, async () => {
  const m = await load();
  for (const flag of ['true', undefined]) {
    await withFlag(flag, async () => {
      const { debt, teach, txn, rates, parties, D } = await scenario(m);
      await teach();
      await m.ledger.terminateContract({
        transactionId: txn.id, price: D('1000000'), totalSessions: 4, usedSessions: 1, rates, reason: 'MUTUAL',
        alreadyReleased: { pt: D('225000'), gym: D('0'), platform: D('25000') }, parties, label: 'fh0 end', idempotencyKey: `CONTRACT_TERMINATE:fh0:${randomUUID()}`,
      });
      const w = await m.wallet.getOrCreateWallet('PT', PT);
      assert.equal(w.availableBalance.toFixed(2), '225000.00');
      const after = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } });
      assert.equal(after.recovered.toFixed(2), '0.00');
      assert.equal(after.settledAt, null);
      assert.equal((await m.reconcile.assertInvariant('fh0 end')).drift, '0.00');
    });
  }
});

test('setting the removed switch only warns; nothing branches on its value', skipOpts, async () => {
  const m = await load();
  assert.equal(m.ledger.warnIfRemovedReceivableRecoveryFlagSet({} as NodeJS.ProcessEnv), false);
  assert.equal(m.ledger.warnIfRemovedReceivableRecoveryFlagSet({ RECEIVABLE_RECOVERY_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv), true);
  assert.equal((m.ledger as Record<string, unknown>).recoverReceivables, undefined, 'the collector is gone');
  assert.equal((m.ledger as Record<string, unknown>).receivableRecoveryEnabled, undefined, 'and so is its reader');
});
