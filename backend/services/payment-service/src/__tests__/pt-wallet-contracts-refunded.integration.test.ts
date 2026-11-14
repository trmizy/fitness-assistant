/**
 * N13C-06 - the PT wallet's per-contract view must not show an "expected income" for money that was given back.
 * BACKEND INTEGRATION: the real ledger + the real view against the isolated *_test database. Display only: the view writes nothing.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_fh9_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-wallet-contracts-refunded.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = { skip: isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  view: (typeof import('../services/pt-wallet-contracts.service'))['buildPtWalletContractsView'];
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/contract-ledger.service'),
      view: (await import('../services/pt-wallet-contracts.service')).buildPtWalletContractsView,
    };
  }
  return mods;
}
test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations, contract_unpaid_obligations RESTART IDENTITY CASCADE',
  );
}

type Dec = InstanceType<Mods['Prisma']['Decimal']>;
interface Fx {
  contractId: string;
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: Dec;
  n: number;
  rates: import('../services/contract-money').RateTable;
  used: number;
  releasedPt: Dec;
  releasedPlatform: Dec;
}

async function paid(m: Mods, ptUserId: string, price = 1_000_000, n = 10): Promise<Fx> {
  const D = (v: string | number) => new m.Prisma.Decimal(v);
  const sfx = randomUUID().slice(0, 8);
  const rates = { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D(0) };
  const parties = { ptUserId, gymId: null, clientUserId: `client-${sfx}` };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: parties.clientUserId, purpose: 'PT_CONTRACT', amount: price, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${sfx}`, idempotencyKey: `contract-${sfx}`, relatedEntityType: 'PT_CONTRACT', relatedEntityId: `contract-${sfx}`,
      activationStatus: 'PENDING', sourceService: 'integration-test',
      metadata: { rates: { platformRate: '0.10', ptRate: '0.90', gymRate: '0' }, parties },
    },
  });
  const f: Fx = { contractId: `contract-${sfx}`, txnId: txn.id, parties, price: D(price), n, rates, used: 0, releasedPt: D(0), releasedPlatform: D(0) };
  await m.ledger.settleContractPayment({ transactionId: f.txnId, price: f.price, rates, parties, label: f.contractId });
  return f;
}

async function deliver(m: Mods, f: Fx) {
  const n = ++f.used;
  const r = await m.ledger.releaseSession({
    transactionId: f.txnId, price: f.price, totalSessions: f.n, rates: f.rates, parties: f.parties,
    label: `${f.contractId} session ${n}`, idempotencyKey: `SESSION_RELEASE:${f.contractId}:${n}`,
  });
  f.releasedPt = f.releasedPt.plus(r.released.pt);
  f.releasedPlatform = f.releasedPlatform.plus(r.released.platform);
}

const terminate = (m: Mods, f: Fx, reason: import('../services/contract-money').TerminationReason) =>
  m.ledger.terminateContract({
    transactionId: f.txnId, price: f.price, totalSessions: f.n, usedSessions: f.used, compensatedSessions: 0, rates: f.rates, reason,
    alreadyReleased: { pt: f.releasedPt, gym: new m.Prisma.Decimal(0), platform: f.releasedPlatform }, parties: f.parties,
    label: `${f.contractId} termination`, idempotencyKey: `CONTRACT_TERMINATE:${f.contractId}`,
  });

test('N13C-06: a running paid contract shows the PT income; fully refunded ones show 0 (never-activated auto refund, PT_CANCELLED, REFUNDED payment); a partial refund shows exactly the PT remainder', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const ptUserId = `pt-n13c06-${randomUUID().slice(0, 6)}`;
  const row = async (f: Fx) => (await m.view(ptUserId)).contracts.find((c) => c.transactionId === f.txnId)!;

  // 1. paid and running: income shown
  const running = await paid(m, ptUserId);
  let r = await row(running);
  assert.equal(r.expectedIncome, '900000.00');
  assert.equal(r.pending, '900000.00');
  assert.equal(r.release.ended, false);

  // 2. paid, but the contract could not be activated and the payment was refunded in full (the N13C-06 case): nothing is owed to the PT
  const unactivated = await paid(m, ptUserId);
  assert.equal((await row(unactivated)).expectedIncome, '900000.00', 'before the refund the claim is visible');
  await m.ledger.refundUnactivatedContractPayment({
    transactionId: unactivated.txnId, parties: unactivated.parties, label: unactivated.contractId, reason: 'CONTRACT_NOT_ACTIVATABLE', contractStatus: 'CANCELLED',
  });
  r = await row(unactivated);
  assert.equal(r.expectedIncome, '0.00');
  assert.equal(r.pending, '0.00');
  assert.equal(r.earned, '0.00');
  assert.equal(r.contractValue, '1000000.00', 'what the client paid is still the record of the payment');

  // 3. the PT cancels before any session: the client is refunded in full, the PT earns nothing
  const ptCancelled = await paid(m, ptUserId);
  await terminate(m, ptCancelled, 'PT_CANCELLED');
  r = await row(ptCancelled);
  assert.equal(r.release.ended, true);
  assert.equal(r.expectedIncome, '0.00');
  assert.equal(r.pending, '0.00');
  assert.equal(r.earned, '0.00');

  // 4. an original payment marked REFUNDED (admin refund flow): nothing is owed to the PT
  const adminRefunded = await paid(m, ptUserId);
  await m.prisma.paymentTransaction.update({ where: { id: adminRefunded.txnId }, data: { status: 'REFUNDED', refundedAt: new Date() } });
  r = await row(adminRefunded);
  assert.equal(r.expectedIncome, '0.00');
  assert.equal(r.pending, '0.00');

  // 5. partial refund: the client cancels late (3 of 10 delivered) -> the claim is exactly what the ledger gave the PT
  const partial = await paid(m, ptUserId);
  await deliver(m, partial);
  await deliver(m, partial);
  await deliver(m, partial);
  await terminate(m, partial, 'CLIENT_CANCELLED');
  r = await row(partial);
  const credited = await m.prisma.$queryRawUnsafe<{ total: string }[]>(
    `SELECT coalesce(sum(CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END),0)::text AS total
       FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id
      WHERE w.owner_type='PT' AND w.owner_id=$1 AND e.transaction_id=$2 AND e.bucket IN ('AVAILABLE','HOLDBACK')`,
    ptUserId,
    partial.txnId,
  );
  assert.equal(r.release.ended, true);
  assert.equal(r.pending, '0.00');
  assert.equal(r.expectedIncome, r.earned, 'an ended contract: the claim is what the PT has been paid (+ held)');
  assert.equal(r.expectedIncome, new m.Prisma.Decimal(credited[0].total).toFixed(2), 'and that is what the ledger really credited the PT');
  assert.ok(new m.Prisma.Decimal(r.expectedIncome).greaterThan(0), 'the PT delivered sessions: the remainder is positive');
  assert.ok(new m.Prisma.Decimal(r.expectedIncome).lessThan(900000), 'and smaller than the full-contract income');

  // the running contract is untouched by all of this
  r = await row(running);
  assert.equal(r.expectedIncome, '900000.00');
});
