/**
 * Audit finding #2 (DQ-3) - personalized-service refunds still use the OLD pooled model.
 *
 * personalized-service-ledger.service.ts refundOrder (a) draws the PT's / platform's POOLED AVAILABLE balance when the
 * order's own pending is not enough, and (b) when even that is short, has the platform front the money and books a
 * PartnerReceivable against the PT (coverShortfall). D48 / DQ-1 S - already applied to PT contracts (FH-0/1/2) - says:
 * only that order's own money, a shortfall is an OPEN obligation to the client (contract_unpaid_obligations, kind
 * REFUND_SHORT), no pooled draw, nothing fronted, no new PartnerReceivable.
 *
 * STATUS: both tests below describe the DQ-1 S behaviour and FAIL ON HEAD (that is the proof). They are registered as
 * `todo` so the suite stays green. They are NOT fixed because the fix is a product decision, not a contained edit:
 * the C5 tests (personalized-service-ledger.integration.test.ts, contract-pending-isolation.integration.test.ts)
 * deliberately assert "admin refund AFTER acceptance claws back the PT's AVAILABLE earnings", and ai-service
 * adminResolveRefund marks the order REFUNDED on the REQUESTED amount, not on what the ledger could pay. Applying DQ-1 S
 * means an admin-approved refund of an already-accepted order pays the client nothing automatically. Remove `todo`
 * when the owner decides that policy.
 *
 * BACKEND INTEGRATION (real ledger, isolated *_test database).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const canUseIntegrationDb = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const opts = {
  skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.',
  todo: 'DQ-3 (personalized-order refunds on the own-funds model) awaits the owner decision on refund-after-acceptance policy',
};

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  contractLedger: typeof import('../services/contract-ledger.service');
  ledger: typeof import('../services/personalized-service-ledger.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      contractLedger: await import('../services/contract-ledger.service'),
      ledger: await import('../services/personalized-service-ledger.service'),
      wallet: (await import('../services/wallet.service')).walletService,
    };
  }
  return mods;
}
test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, contract_unpaid_obligations, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
}

async function seedAcceptedOrder(m: Mods, price: number) {
  const suffix = randomUUID().slice(0, 8);
  const parties = { ptUserId: `pt-${suffix}`, clientUserId: `client-${suffix}` };
  const rates = { platformRate: new m.Prisma.Decimal('0.10'), ptRate: new m.Prisma.Decimal('0.90') };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: parties.clientUserId, purpose: 'PERSONALIZED_SERVICE_PURCHASE', amount: price, currency: 'VND', status: 'PENDING',
      provider: 'MOCK', idempotencyKey: `order-${suffix}`, relatedEntityType: 'PERSONALIZED_SERVICE_PURCHASE',
      relatedEntityId: `order-${suffix}`, activationStatus: 'PENDING', sourceService: 'ai-service',
    },
  });
  const p = new m.Prisma.Decimal(price);
  await m.contractLedger.settleContractPayment({
    transactionId: txn.id, price: p, rates: { ...rates, gymRate: new m.Prisma.Decimal(0) },
    parties: { ptUserId: parties.ptUserId, gymId: null, clientUserId: parties.clientUserId }, label: `PS order-${suffix}`,
  });
  await m.ledger.releaseOrder({
    transactionId: txn.id, price: p, rates, parties, label: 'accept', idempotencyKey: `PERSONALIZED_RELEASE:order-${suffix}`,
  });
  return { orderId: `order-${suffix}`, txnId: txn.id, parties, price: p, rates };
}

test('DQ-3: after acceptance the refund draws NO pooled AVAILABLE balance - the PT keeps the earnings the order released', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedAcceptedOrder(m, 1_000_000);
  const before = await m.contractLedger.readWallet('PT', f.parties.ptUserId);
  assert.equal(before.availableBalance, '900000.00');

  const amount = new m.Prisma.Decimal('500000');
  await m.ledger.refundOrder({
    transactionId: f.txnId, refundAmount: amount, rates: f.rates, parties: f.parties, label: 'dq3 refund',
    idempotencyKey: `PERSONALIZED_REFUND:${f.orderId}:${amount.toFixed(2)}`,
  });

  const after = await m.contractLedger.readWallet('PT', f.parties.ptUserId);
  assert.equal(after.availableBalance, '900000.00', "the PT's AVAILABLE (pooled across everything they earned) was not drawn");
});

test('DQ-3: a shortfall becomes an OPEN REFUND_SHORT obligation - platform fronts nothing, no PartnerReceivable', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedAcceptedOrder(m, 1_000_000);
  // The PT withdrew everything; the platform has plenty of other money it could (wrongly) front.
  const ptWallet = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  const escrow = await m.wallet.getEscrowWallet();
  await m.wallet.withWallets([ptWallet.id, escrow.id], f.txnId, async (ops) => {
    await ops.debit(ptWallet.id, new m.Prisma.Decimal('900000'), 'PT withdrew everything');
    await ops.debit(escrow.id, new m.Prisma.Decimal('900000'), 'cash left the platform');
  });
  const revenue = await m.wallet.getRevenueWallet();
  await m.wallet.withWallets([revenue.id, escrow.id], f.txnId, async (ops) => {
    await ops.credit(revenue.id, new m.Prisma.Decimal('2000000'), 'seed - other commissions');
    await ops.credit(escrow.id, new m.Prisma.Decimal('2000000'), 'seed - escrow');
  });

  const amount = f.price;
  await m.ledger.refundOrder({
    transactionId: f.txnId, refundAmount: amount, rates: f.rates, parties: f.parties, label: 'dq3 full refund',
    idempotencyKey: `PERSONALIZED_REFUND:${f.orderId}:${amount.toFixed(2)}`,
  });

  assert.equal(await m.prisma.partnerReceivable.count({ where: { partnerId: f.parties.ptUserId } }), 0, 'no PT debt');
  const obligations = await m.prisma.contractUnpaidObligation.findMany({ where: { transactionId: f.txnId } });
  assert.equal(obligations.length, 1, 'one durable OPEN obligation');
  assert.equal(obligations[0].kind, 'REFUND_SHORT');
  assert.equal(obligations[0].status, 'OPEN');
  const client = await m.contractLedger.readWallet('CLIENT', f.parties.clientUserId);
  assert.notEqual(client.availableBalance, '1000000.00', "the client was not paid out of the platform's own money");
});
