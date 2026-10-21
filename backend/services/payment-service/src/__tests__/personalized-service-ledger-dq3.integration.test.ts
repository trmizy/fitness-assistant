/**
 * [REGRESSION D48] DQ-3 - personalized-service refunds run on the own-funds model.
 *
 * Before this fix, personalized-service-ledger.service.ts refundOrder (a) drew the PT's / platform's POOLED AVAILABLE
 * balance when the order's own pending was not enough, and (b) when even that was short, had the platform front the
 * money and booked a PartnerReceivable against the PT (coverShortfall). D48 / DQ-1 S - already applied to PT contracts
 * (FH-0/1/2) - and the owner's final DQ-3 decision say: only that order's own money; a shortfall is a durable,
 * idempotent OPEN obligation to the client (contract_unpaid_obligations, kind REFUND_SHORT); no pooled draw, nothing
 * fronted, no PartnerReceivable; the client is credited exactly what the order's own pending funded.
 *
 * BACKEND INTEGRATION (real ledger, isolated *_test database).
 * Run THIS FILE ALONE (it TRUNCATEs the ledger):
 *   DATABASE_URL=".../gymcoach_payment_g1_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     npx tsx --test src/__tests__/personalized-service-ledger-dq3.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const canUseIntegrationDb = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const opts = {
  skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  contractLedger: typeof import('../services/contract-ledger.service');
  ledger: typeof import('../services/personalized-service-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
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
      reconcile: await import('../services/reconcile.service'),
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

async function seedHeldOrder(m: Mods, price: number) {
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
  return { orderId: `order-${suffix}`, txnId: txn.id, parties, price: p, rates };
}
type Order = Awaited<ReturnType<typeof seedHeldOrder>>;

async function seedAcceptedOrder(m: Mods, price: number) {
  const f = await seedHeldOrder(m, price);
  await m.ledger.releaseOrder({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'accept',
    idempotencyKey: `PERSONALIZED_RELEASE:${f.orderId}`,
  });
  return f;
}

/** The PT withdrew everything they had: cash left the platform. */
async function ptWithdrawsAll(m: Mods, f: Order, amount: string) {
  const ptWallet = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  const escrow = await m.wallet.getEscrowWallet();
  await m.wallet.withWallets([ptWallet.id, escrow.id], f.txnId, async (ops) => {
    await ops.debit(ptWallet.id, new m.Prisma.Decimal(amount), 'PT withdrew everything');
    await ops.debit(escrow.id, new m.Prisma.Decimal(amount), 'cash left the platform');
  });
}

/** Platform revenue earned from OTHER work - money the platform could (wrongly) front a refund with. */
async function seedOtherRevenue(m: Mods, f: Order, amount: string) {
  const revenue = await m.wallet.getRevenueWallet();
  const escrow = await m.wallet.getEscrowWallet();
  await m.wallet.withWallets([revenue.id, escrow.id], f.txnId, async (ops) => {
    await ops.credit(revenue.id, new m.Prisma.Decimal(amount), 'seed - other commissions');
    await ops.credit(escrow.id, new m.Prisma.Decimal(amount), 'seed - escrow');
  });
}

/** AVAILABLE the PT earned from OTHER work (pooled with whatever this order released). */
async function seedPtOtherEarnings(m: Mods, f: Order, amount: string) {
  const ptWallet = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  const escrow = await m.wallet.getEscrowWallet();
  await m.wallet.withWallets([ptWallet.id, escrow.id], f.txnId, async (ops) => {
    await ops.credit(ptWallet.id, new m.Prisma.Decimal(amount), 'seed - earnings of other work', 'AVAILABLE');
    await ops.credit(escrow.id, new m.Prisma.Decimal(amount), 'seed - escrow');
  });
}

function refundArgs(f: Order, amount: string, label = 'dq3 refund') {
  const a = new (f.price.constructor as new (v: string) => typeof f.price)(amount);
  return {
    transactionId: f.txnId, refundAmount: a, rates: f.rates, parties: f.parties, label,
    idempotencyKey: `PERSONALIZED_REFUND:${f.orderId}:${a.toFixed(2)}`,
  };
}

async function snapshot(m: Mods, f: Order) {
  const [pt, client, revenue] = await Promise.all([
    m.contractLedger.readWallet('PT', f.parties.ptUserId),
    m.contractLedger.readWallet('CLIENT', f.parties.clientUserId),
    m.wallet.getRevenueWallet(),
  ]);
  return {
    ptPending: pt.pendingBalance, ptAvailable: pt.availableBalance, clientAvailable: client.availableBalance,
    revenuePending: revenue.pendingBalance.toFixed(2), revenueAvailable: revenue.availableBalance.toFixed(2),
  };
}

async function assertNoDebtNoNegative(m: Mods, f: Order, context: string) {
  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no PartnerReceivable was created');
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.negativeWallets.length, 0, 'no wallet went negative');
  assert.equal(report.balanced, true, 'escrow == sum of claims');
  void f;
}

test('[REGRESSION D48] DQ-3: after acceptance the refund draws NO pooled AVAILABLE balance - the PT keeps the earnings, the unpaid part is an OPEN obligation', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedAcceptedOrder(m, 1_000_000);
  await seedPtOtherEarnings(m, f, '300000'); // pooled with the order's 900.000
  const before = await snapshot(m, f);
  assert.equal(before.ptAvailable, '1200000.00');

  const result = await m.ledger.refundOrder(refundArgs(f, '500000'));

  assert.equal(result.owed, '500000.00');
  assert.equal(result.paid, '0.00', "the order's own pending is gone: nothing can be paid out of it");
  assert.equal(result.unpaid, '500000.00');
  assert.equal(result.refund, '0.00', 'refund == what the client was actually credited');
  const after = await snapshot(m, f);
  assert.equal(after.ptAvailable, '1200000.00', "the PT's AVAILABLE (pooled across everything they earned) was not drawn");
  assert.equal(after.revenueAvailable, before.revenueAvailable, "the platform's AVAILABLE was not drawn or fronted");
  assert.equal(after.clientAvailable, '0.00', 'the client is credited exactly what was paid');

  const obligations = await m.prisma.contractUnpaidObligation.findMany({ where: { transactionId: f.txnId } });
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].kind, 'REFUND_SHORT');
  assert.equal(obligations[0].status, 'OPEN');
  assert.equal(obligations[0].party, 'CLIENT');
  assert.equal(obligations[0].owed.toFixed(2), '500000.00');
  assert.equal(obligations[0].paid.toFixed(2), '0.00');
  assert.equal(obligations[0].unpaid.toFixed(2), '500000.00');
  assert.equal(result.obligationId, obligations[0].id);
  await assertNoDebtNoNegative(m, f, 'D48 refund after acceptance');
});

test('[REGRESSION D48] DQ-3: a shortfall becomes an OPEN REFUND_SHORT obligation - platform fronts nothing, no PartnerReceivable', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedAcceptedOrder(m, 1_000_000);
  await ptWithdrawsAll(m, f, '900000');
  await seedOtherRevenue(m, f, '2000000');
  const before = await snapshot(m, f);

  const result = await m.ledger.refundOrder(refundArgs(f, '1000000', 'dq3 full refund'));

  assert.equal(await m.prisma.partnerReceivable.count({ where: { partnerId: f.parties.ptUserId } }), 0, 'no PT debt');
  const obligations = await m.prisma.contractUnpaidObligation.findMany({ where: { transactionId: f.txnId } });
  assert.equal(obligations.length, 1, 'one durable OPEN obligation');
  assert.equal(obligations[0].kind, 'REFUND_SHORT');
  assert.equal(obligations[0].status, 'OPEN');
  assert.deepEqual([result.owed, result.paid, result.unpaid], ['1000000.00', '0.00', '1000000.00']);
  const after = await snapshot(m, f);
  assert.equal(after.clientAvailable, '0.00', "the client was not paid out of the platform's own money");
  assert.equal(after.revenueAvailable, before.revenueAvailable, 'the platform fronted nothing');
  assert.equal(after.ptAvailable, '0.00');
  await assertNoDebtNoNegative(m, f, 'D48 refund after the PT withdrew');
});

test('[REGRESSION D48] refund of an unreleased order: own pending covers it in full - client paid, no obligation, no receivable', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 1_500_000);
  await seedPtOtherEarnings(m, f, '400000');
  const before = await snapshot(m, f);

  const result = await m.ledger.refundOrder(refundArgs(f, '1500000', 'cancel before work'));

  assert.deepEqual([result.owed, result.paid, result.unpaid, result.refund, result.shortfall], ['1500000.00', '1500000.00', '0.00', '1500000.00', '0.00']);
  assert.deepEqual(result.clawedBack, { pt: '1350000.00', platform: '150000.00' });
  assert.equal(result.obligationId, undefined);
  const after = await snapshot(m, f);
  assert.equal(after.clientAvailable, '1500000.00');
  assert.equal(after.ptPending, '0.00');
  assert.equal(after.revenuePending, '0.00');
  assert.equal(after.ptAvailable, before.ptAvailable, "the PT's pooled AVAILABLE is untouched");
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  await assertNoDebtNoNegative(m, f, 'D48 full refund of a held order');
});

test('[REGRESSION D48] partial refund of an unreleased order: exact slice from own pending, remainder stays pending and is releasable', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 1_000_000);

  const result = await m.ledger.refundOrder(refundArgs(f, '400000'));
  assert.deepEqual([result.owed, result.paid, result.unpaid], ['400000.00', '400000.00', '0.00']);
  const mid = await snapshot(m, f);
  assert.equal(mid.clientAvailable, '400000.00');
  assert.equal(mid.ptPending, '540000.00');
  assert.equal(mid.revenuePending, '60000.00');

  const released = await m.ledger.releaseOrder({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'accept',
    idempotencyKey: `PERSONALIZED_RELEASE:${f.orderId}`,
  });
  assert.deepEqual(released, { released: { pt: '540000.00', platform: '60000.00' } });
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  await assertNoDebtNoNegative(m, f, 'D48 partial refund then accept');
});

test('[REGRESSION D48] own pending only partly covers the refund: client credited exactly what was paid, the rest is OPEN', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 1_000_000);
  await seedPtOtherEarnings(m, f, '700000');

  await m.ledger.refundOrder(refundArgs(f, '800000')); // leaves 180.000 + 20.000 pending
  const result = await m.ledger.refundOrder(refundArgs(f, '400000')); // wants 360.000 + 40.000

  assert.deepEqual(result.clawedBack, { pt: '180000.00', platform: '20000.00' });
  assert.deepEqual([result.owed, result.paid, result.unpaid], ['400000.00', '200000.00', '200000.00']);
  const after = await snapshot(m, f);
  assert.equal(after.clientAvailable, '1000000.00', '800.000 + 200.000');
  assert.equal(after.ptAvailable, '700000.00', "the PT's pooled AVAILABLE is untouched");
  assert.equal(after.ptPending, '0.00');
  const obligations = await m.prisma.contractUnpaidObligation.findMany({ where: { transactionId: f.txnId } });
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].unpaid.toFixed(2), '200000.00');
  assert.equal(obligations[0].paid.toFixed(2), '200000.00');
  await assertNoDebtNoNegative(m, f, 'D48 partly covered refund');
});

test('[REGRESSION D48] an already fully refunded (cancelled) order: a further refund pays nothing and is an OPEN obligation', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 600_000);
  await m.ledger.refundOrder(refundArgs(f, '600000')); // cancelled and refunded in full

  const again = await m.ledger.refundOrder(refundArgs(f, '100000', 'second refund'));

  assert.deepEqual([again.paid, again.unpaid], ['0.00', '100000.00']);
  assert.equal((await snapshot(m, f)).clientAvailable, '600000.00', 'the client got the order refunded once');
  assert.equal(await m.prisma.contractUnpaidObligation.count({ where: { status: 'OPEN' } }), 1);
  await assertNoDebtNoNegative(m, f, 'D48 refund after a full refund');
});

test('[REGRESSION D48] retry with the same key replays the stored result: no second movement, no second obligation', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedAcceptedOrder(m, 1_000_000);
  const first = await m.ledger.refundOrder(refundArgs(f, '500000'));
  const afterFirst = await snapshot(m, f);

  const second = await m.ledger.refundOrder(refundArgs(f, '500000'));

  assert.deepEqual(second, first, 'identical stored result, including the obligation id');
  assert.deepEqual(await snapshot(m, f), afterFirst);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);

  // Same for an unreleased order refunded in full: the replay does not pay the client twice.
  const g = await seedHeldOrder(m, 200_000);
  const r1 = await m.ledger.refundOrder(refundArgs(g, '200000'));
  const r2 = await m.ledger.refundOrder(refundArgs(g, '200000'));
  assert.deepEqual(r2, r1);
  assert.equal((await snapshot(m, g)).clientAvailable, '200000.00');
  await assertNoDebtNoNegative(m, g, 'D48 retry same key');
});

test('[REGRESSION D48] concurrent identical refunds (Promise.all) have exactly one effect', opts, async () => {
  const m = await load();
  await resetLedger(m);
  // Unreleased: one client credit.
  const f = await seedHeldOrder(m, 1_000_000);
  const results = await Promise.all([1, 2, 3, 4].map(() => m.ledger.refundOrder(refundArgs(f, '1000000'))));
  for (const r of results) assert.deepEqual(r, results[0]);
  assert.equal((await snapshot(m, f)).clientAvailable, '1000000.00', 'client paid once');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);

  // Released: exactly one obligation.
  const g = await seedAcceptedOrder(m, 1_000_000);
  const res2 = await Promise.all([1, 2, 3].map(() => m.ledger.refundOrder(refundArgs(g, '300000'))));
  for (const r of res2) assert.deepEqual(r, res2[0]);
  assert.equal(await m.prisma.contractUnpaidObligation.count({ where: { transactionId: g.txnId } }), 1);
  assert.equal(await m.prisma.partnerReceivable.count(), 0);
  await assertNoDebtNoNegative(m, g, 'D48 concurrent refunds');
});

test('[REGRESSION D48] a zero or negative refund is rejected and writes nothing', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 100_000);
  await assert.rejects(m.ledger.refundOrder(refundArgs(f, '0')), /refundAmount must be > 0/);
  await assert.rejects(m.ledger.refundOrder(refundArgs(f, '-5')), /refundAmount must be > 0/);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  assert.equal((await snapshot(m, f)).clientAvailable, '0.00');
  await assertNoDebtNoNegative(m, f, 'D48 zero refund');
});

test('[REGRESSION D48] one order cannot be refunded out of a neighbour order of the same PT', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const a = await seedHeldOrder(m, 1_000_000);
  // A second held order of the SAME PT (and platform): its pending shares the PT wallet bucket.
  const suffix = randomUUID().slice(0, 8);
  const txnB = await m.prisma.paymentTransaction.create({
    data: {
      payerId: `client-b-${suffix}`, purpose: 'PERSONALIZED_SERVICE_PURCHASE', amount: 1_000_000, currency: 'VND', status: 'PENDING',
      provider: 'MOCK', idempotencyKey: `order-b-${suffix}`, relatedEntityType: 'PERSONALIZED_SERVICE_PURCHASE',
      relatedEntityId: `order-b-${suffix}`, activationStatus: 'PENDING', sourceService: 'ai-service',
    },
  });
  await m.contractLedger.settleContractPayment({
    transactionId: txnB.id, price: new m.Prisma.Decimal(1_000_000), rates: { ...a.rates, gymRate: new m.Prisma.Decimal(0) },
    parties: { ptUserId: a.parties.ptUserId, gymId: null, clientUserId: `client-b-${suffix}` }, label: 'PS order B',
  });
  await m.ledger.releaseOrder({
    transactionId: a.txnId, price: a.price, rates: a.rates, parties: a.parties, label: 'accept A',
    idempotencyKey: `PERSONALIZED_RELEASE:${a.orderId}`,
  });

  const result = await m.ledger.refundOrder(refundArgs(a, '500000'));

  assert.equal(result.paid, '0.00', "A's pending is gone; B's pending (same wallet bucket) is not A's to give");
  const pt = await m.contractLedger.readWallet('PT', a.parties.ptUserId);
  assert.equal(pt.pendingBalance, '900000.00', "B's pending is whole");
  await assertNoDebtNoNegative(m, a, 'D48 neighbour order untouched');
});

test('LEDGER_STRICT_OWN_FUNDS=false (emergency rollback only) restores the legacy pooled draw / platform fronting', opts, async () => {
  const m = await load();
  await resetLedger(m);
  const prev = process.env.LEDGER_STRICT_OWN_FUNDS;
  process.env.LEDGER_STRICT_OWN_FUNDS = 'false';
  try {
    const f = await seedAcceptedOrder(m, 1_000_000);
    await ptWithdrawsAll(m, f, '900000');
    await seedOtherRevenue(m, f, '2000000');

    const result = await m.ledger.refundOrder(refundArgs(f, '1000000', 'legacy full refund'));

    assert.equal(result.refund, '1000000.00', 'legacy: the client is made whole');
    assert.equal(result.paid, '1000000.00');
    assert.equal(result.unpaid, '0.00');
    assert.equal(await m.prisma.partnerReceivable.count({ where: { partnerId: f.parties.ptUserId } }), 1, 'legacy: PT debt booked');
    assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
    assert.equal((await snapshot(m, f)).clientAvailable, '1000000.00');
    await m.reconcile.assertInvariant('legacy refund');
  } finally {
    if (prev === undefined) delete process.env.LEDGER_STRICT_OWN_FUNDS;
    else process.env.LEDGER_STRICT_OWN_FUNDS = prev;
  }
});
