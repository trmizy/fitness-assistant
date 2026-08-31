/**
 * Personalized PT Service escrow + milestone release (P1-FIN-001/002).
 *
 * Same shape as contract-ledger.integration.test.ts / membership-ledger.integration.test.ts:
 * the invariant (escrow = the sum of every claim on it) is asserted after every step — money
 * silently landing in the wrong bucket is still a bug even when the total is right.
 *
 * Run THIS FILE ALONE — it TRUNCATEs the ledger between scenarios and node:test runs separate
 * files concurrently:
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test src/__tests__/personalized-service-ledger.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = {
  skip: /_test/i.test(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/personalized-service-ledger.service');
  contractLedger: typeof import('../services/contract-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
};

let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/personalized-service-ledger.service'),
      contractLedger: await import('../services/contract-ledger.service'),
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
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets RESTART IDENTITY CASCADE',
  );
}

interface Fixture {
  txnId: string;
  buyerId: string;
  sellerId: string;
  price: InstanceType<Mods['Prisma']['Decimal']>;
  commissionRate: InstanceType<Mods['Prisma']['Decimal']>;
}

/** Funds the buyer's wallet directly (bypassing a real gateway top-up — irrelevant to this
 * ledger's own correctness) and holds a Personalized Service purchase through it. */
async function seedHeldOrder(m: Mods, price: number, commissionRate = '0.10'): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const buyerId = `buyer-${suffix}`;
  const sellerId = `pt-${suffix}`;

  const buyerWallet = await m.wallet.getOrCreateWallet('CLIENT', buyerId);
  await m.prisma.wallet.update({ where: { id: buyerWallet.id }, data: { availableBalance: new m.Prisma.Decimal(price) } });

  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: buyerId,
      purpose: 'PERSONALIZED_SERVICE_PURCHASE',
      amount: price,
      currency: 'VND',
      status: 'PROCESSING',
      idempotencyKey: `personalized-service-${suffix}`,
      relatedEntityType: 'PERSONALIZED_SERVICE_PURCHASE',
      relatedEntityId: `order-${suffix}`,
      sourceService: 'integration-test',
    },
  });

  await m.ledger.holdPersonalizedServicePayment({
    transactionId: txn.id,
    price: new m.Prisma.Decimal(price),
    commissionRate: new m.Prisma.Decimal(commissionRate),
    buyerId,
    sellerId,
    label: `order ${suffix}`,
  });

  return { txnId: txn.id, buyerId, sellerId, price: new m.Prisma.Decimal(price), commissionRate: new m.Prisma.Decimal(commissionRate) };
}

async function balances(m: Mods, f: Fixture) {
  const [seller, buyer, revenue, escrow] = await Promise.all([
    m.wallet.getOrCreateWallet('CLIENT', f.sellerId),
    m.wallet.getOrCreateWallet('CLIENT', f.buyerId),
    m.wallet.getRevenueWallet(),
    m.wallet.getEscrowWallet(),
  ]);
  return {
    sellerPending: seller.pendingBalance.toFixed(2),
    sellerAvailable: seller.availableBalance.toFixed(2),
    buyerAvailable: buyer.availableBalance.toFixed(2),
    platformPending: revenue.pendingBalance.toFixed(2),
    platformAvailable: revenue.availableBalance.toFixed(2),
    escrow: escrow.availableBalance.toFixed(2),
  };
}

// ── Hold ─────────────────────────────────────────────────────────────────────

test('hold: the whole price lands in escrow; seller/platform PENDING split 90/10; buyer AVAILABLE debited', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 1_000_000);

  const b = await balances(m, f);
  assert.equal(b.escrow, '1000000.00', 'escrow holds the whole price');
  assert.equal(b.sellerPending, '900000.00', 'seller (PT) pending after hold — 90%');
  assert.equal(b.platformPending, '100000.00', 'platform pending after hold — 10%');
  assert.equal(b.sellerAvailable, '0.00', 'nobody can spend a đồng of a fresh hold yet');
  assert.equal(b.buyerAvailable, '0.00', 'buyer fully debited');
  await m.reconcile.assertInvariant('hold');
});

test('hold: a retried request (same transactionId) does not double-charge the buyer', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 500_000);

  // Simulate a client retry: same transactionId, hold called again.
  await m.ledger.holdPersonalizedServicePayment({
    transactionId: f.txnId,
    price: f.price,
    commissionRate: f.commissionRate,
    buyerId: f.buyerId,
    sellerId: f.sellerId,
    label: 'retry',
  });

  const b = await balances(m, f);
  assert.equal(b.escrow, '500000.00', 'still exactly one price, not two');
  assert.equal(b.sellerPending, '450000.00');
  await m.reconcile.assertInvariant('hold retry');
});

// ── Milestone release ────────────────────────────────────────────────────────

test('release: INTAKE_REVIEWED (10%) → DRAFT_DELIVERED (30%) → ACCEPTED (40%) → COMPLETED drains the exact remainder', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 1_000_000); // 900k seller pending, 100k platform pending

  await m.ledger.releasePersonalizedServiceMilestone({
    transactionId: f.txnId, sellerId: f.sellerId, price: f.price, commissionRate: f.commissionRate,
    milestone: 'INTAKE_REVIEWED', label: 'm1',
  });
  let b = await balances(m, f);
  assert.equal(b.sellerAvailable, '90000.00', '10% of the seller share released');
  assert.equal(b.platformAvailable, '10000.00', '10% of the platform share released');
  assert.equal(b.sellerPending, '810000.00');
  assert.equal(b.platformPending, '90000.00');
  assert.equal(b.escrow, '1000000.00', 'escrow untouched — release is a reallocation, not a payout');
  await m.reconcile.assertInvariant('after INTAKE_REVIEWED');

  await m.ledger.releasePersonalizedServiceMilestone({
    transactionId: f.txnId, sellerId: f.sellerId, price: f.price, commissionRate: f.commissionRate,
    milestone: 'DRAFT_DELIVERED', label: 'm2',
  });
  b = await balances(m, f);
  assert.equal(b.sellerAvailable, '360000.00', '10% + 30% = 40% released');
  assert.equal(b.platformAvailable, '40000.00');
  await m.reconcile.assertInvariant('after DRAFT_DELIVERED');

  await m.ledger.releasePersonalizedServiceMilestone({
    transactionId: f.txnId, sellerId: f.sellerId, price: f.price, commissionRate: f.commissionRate,
    milestone: 'ACCEPTED', label: 'm3',
  });
  b = await balances(m, f);
  assert.equal(b.sellerAvailable, '720000.00', '10% + 30% + 40% = 80% released');
  assert.equal(b.platformAvailable, '80000.00');
  assert.equal(b.sellerPending, '180000.00', 'exactly the remaining 20%');
  await m.reconcile.assertInvariant('after ACCEPTED');

  await m.ledger.releasePersonalizedServiceMilestone({
    transactionId: f.txnId, sellerId: f.sellerId, price: f.price, commissionRate: f.commissionRate,
    milestone: 'COMPLETED', label: 'm4',
  });
  b = await balances(m, f);
  assert.equal(b.sellerAvailable, '900000.00', 'COMPLETED drained the exact remainder, not a separately-rounded 20%');
  assert.equal(b.platformAvailable, '100000.00');
  assert.equal(b.sellerPending, '0.00', 'fully drained');
  assert.equal(b.platformPending, '0.00', 'fully drained');
  await m.reconcile.assertInvariant('after COMPLETED');
});

// IMPORTANT, matches releasePersonalizedServiceMilestone's own doc comment: for the three
// FIXED-fraction milestones, this function has no memory of "has INTAKE_REVIEWED already
// fired for this order" — only the caller (ai-service's milestone*ReleasedAt guard fields,
// checked BEFORE ever calling this) prevents a real double-payout. Calling the SAME
// fixed-fraction milestone twice releases that slice TWICE, as long as enough PENDING from
// the OTHER not-yet-released milestones remains to cover it — proven here deliberately, not
// as a bug report, so nobody "fixes" this file into asserting a guarantee the design never
// made. Idempotency-Design-Doesn't-Live-Here.
test('release: a repeated FIXED-fraction milestone call is NOT self-idempotent — that guard lives in the caller, not here', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 200_000); // seller pending 180000, platform pending 20000

  await m.ledger.releasePersonalizedServiceMilestone({
    transactionId: f.txnId, sellerId: f.sellerId, price: f.price, commissionRate: f.commissionRate,
    milestone: 'INTAKE_REVIEWED', label: 'first',
  });
  const second = await m.ledger.releasePersonalizedServiceMilestone({
    transactionId: f.txnId, sellerId: f.sellerId, price: f.price, commissionRate: f.commissionRate,
    milestone: 'INTAKE_REVIEWED', label: 'duplicate — same milestone, called again',
  });
  // 10% released a SECOND time — there was enough PENDING left (the other 90%) to cover it.
  assert.equal(second.released.seller, '18000.00');
  assert.equal(second.released.platform, '2000.00');
  const b = await balances(m, f);
  assert.equal(b.sellerAvailable, '36000.00', '2 x 10% actually paid out — proves the guard is NOT here');
  await m.reconcile.assertInvariant('after duplicate release'); // still fully reconciled — no money fabricated, just moved twice
});

// COMPLETED is the one exception: it drains whatever's actually left rather than computing
// its own fixed slice, so a second call — unlike the fixed-fraction milestones above — always
// finds nothing more to move regardless of how many times it's called.
test('release: COMPLETED (drain-remainder) IS self-idempotent — a second call always finds nothing left', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 200_000);

  await m.ledger.releasePersonalizedServiceMilestone({
    transactionId: f.txnId, sellerId: f.sellerId, price: f.price, commissionRate: f.commissionRate,
    milestone: 'COMPLETED', label: 'first — drains everything since nothing else was released',
  });
  const after1 = await balances(m, f);

  const second = await m.ledger.releasePersonalizedServiceMilestone({
    transactionId: f.txnId, sellerId: f.sellerId, price: f.price, commissionRate: f.commissionRate,
    milestone: 'COMPLETED', label: 'duplicate',
  });
  const after2 = await balances(m, f);

  assert.deepEqual(after2, after1, 'balances unchanged by the duplicate call');
  assert.equal(second.released.seller, '0.00', 'nothing left to drain the second time');
  assert.equal(second.released.platform, '0.00');
  await m.reconcile.assertInvariant('after duplicate COMPLETED release');
});

test('release: a legacy pre-escrow order (never held — zero PENDING throughout) degrades to a harmless no-op', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const sellerId = `pt-${randomUUID().slice(0, 8)}`;
  const fakeTxnId = randomUUID();

  const result = await m.ledger.releasePersonalizedServiceMilestone({
    transactionId: fakeTxnId, sellerId, price: new m.Prisma.Decimal(100_000), commissionRate: new m.Prisma.Decimal('0.10'),
    milestone: 'COMPLETED', label: 'legacy order',
  });
  assert.equal(result.released.seller, '0.00');
  assert.equal(result.released.platform, '0.00');
});

// ── Refund ───────────────────────────────────────────────────────────────────

test('refund: before any release, draws entirely from PENDING', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 1_000_000);

  const r = await m.ledger.refundPersonalizedServiceHeld({
    transactionId: f.txnId, sellerId: f.sellerId, buyerId: f.buyerId,
    refundAmount: new m.Prisma.Decimal(500_000), commissionRate: f.commissionRate, label: 'half refund',
  });
  assert.equal(r.refunded, '500000.00');
  assert.equal(r.drawnFrom.sellerPending, '450000.00');
  assert.equal(r.drawnFrom.platformPending, '50000.00');
  assert.equal(r.drawnFrom.sellerAvailable, '0.00');
  assert.equal(r.shortfall, '0.00');

  const b = await balances(m, f);
  assert.equal(b.buyerAvailable, '500000.00', 'buyer got the refund back');
  assert.equal(b.sellerPending, '450000.00', 'remaining 45% still held');
  assert.equal(b.escrow, '1000000.00', 'escrow untouched — refund is a reallocation too');
  await m.reconcile.assertInvariant('after PENDING-only refund');
});

test('refund: after full release, claws back from pooled AVAILABLE instead', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 1_000_000);
  for (const milestone of ['INTAKE_REVIEWED', 'DRAFT_DELIVERED', 'ACCEPTED', 'COMPLETED'] as const) {
    await m.ledger.releasePersonalizedServiceMilestone({
      transactionId: f.txnId, sellerId: f.sellerId, price: f.price, commissionRate: f.commissionRate,
      milestone, label: milestone,
    });
  }
  // Everything is now AVAILABLE, nothing PENDING.
  let b = await balances(m, f);
  assert.equal(b.sellerPending, '0.00');

  const r = await m.ledger.refundPersonalizedServiceHeld({
    transactionId: f.txnId, sellerId: f.sellerId, buyerId: f.buyerId,
    refundAmount: new m.Prisma.Decimal(300_000), commissionRate: f.commissionRate, label: 'post-completion refund',
  });
  assert.equal(r.drawnFrom.sellerPending, '0.00', 'nothing left in PENDING to draw from');
  assert.equal(r.drawnFrom.sellerAvailable, '270000.00', 'clawed back from released AVAILABLE instead');
  assert.equal(r.drawnFrom.platformAvailable, '30000.00');
  assert.equal(r.shortfall, '0.00', 'the PT/platform had enough released money to cover it');

  b = await balances(m, f);
  assert.equal(b.buyerAvailable, '300000.00');
  assert.equal(b.sellerAvailable, '630000.00', '900000 released - 270000 clawed back');
  await m.reconcile.assertInvariant('after post-completion refund');
});

test('refund: a gap neither PENDING nor AVAILABLE can cover is fronted by platform revenue and booked as a PT receivable', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedHeldOrder(m, 100_000);

  // First refund is entirely legitimate — drains PENDING exactly (covered by the "before any
  // release" test above). A SECOND refund attempt for the same order (payment-service itself
  // does not enforce the priceAtPurchase ceiling — that guard is ai-service's job, see
  // adminResolveRefund; this is payment-service's own belt-and-braces for if that guard is
  // ever bypassed, same principle contract-ledger.service.ts's compensateNoShow already
  // relies on) finds nothing left in either bucket for either party — a genuine, ledger-
  // consistent shortfall, not a simulated one.
  await m.ledger.refundPersonalizedServiceHeld({
    transactionId: f.txnId, sellerId: f.sellerId, buyerId: f.buyerId,
    refundAmount: f.price, commissionRate: f.commissionRate, label: 'first (legitimate) refund',
  });

  // Fund platform revenue generously — this is BOTH the platform's own party wallet (its
  // 10% charge below draws from here first, and succeeds) AND coverShortfall's funding
  // source for whatever the seller still can't cover.
  const revenueWallet = await m.wallet.getRevenueWallet();
  await m.prisma.wallet.update({ where: { id: revenueWallet.id }, data: { availableBalance: new m.Prisma.Decimal(500_000) } });

  const r = await m.ledger.refundPersonalizedServiceHeld({
    transactionId: f.txnId, sellerId: f.sellerId, buyerId: f.buyerId,
    refundAmount: f.price, commissionRate: f.commissionRate, label: 'second (over-refund) attempt',
  });
  assert.equal(r.drawnFrom.sellerPending, '0.00');
  assert.equal(r.drawnFrom.sellerAvailable, '0.00');
  assert.equal(r.drawnFrom.platformPending, '0.00');
  assert.equal(r.drawnFrom.platformAvailable, '10000.00', 'platform covers its OWN 10% share from the revenue wallet just funded');
  assert.equal(r.shortfall, '90000.00', 'only the seller\'s 90% share — nothing left anywhere for them — is a genuine gap');

  const receivables = await m.prisma.partnerReceivable.findMany({ where: { partnerType: 'PT', partnerId: f.sellerId } });
  assert.equal(receivables.length, 1);
  assert.equal(new m.Prisma.Decimal(receivables[0].amount).toFixed(2), '90000.00');

  const b = await balances(m, f);
  assert.equal(b.buyerAvailable, '200000.00', 'buyer was credited both times — the over-refund itself is not this function\'s job to prevent');
});

test('getPersonalizedServiceLedgerSummary: reads the exact PENDING remaining for one order, ignoring other orders sharing the same seller wallet', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f1 = await seedHeldOrder(m, 100_000);
  // A second, unrelated order for the SAME seller — proves the summary is scoped per
  // transactionId, not the seller wallet's pooled total (F2's reasoning from
  // membership-ledger.service.ts, reused here via pendingRemainingForTxn).
  const suffix2 = randomUUID().slice(0, 8);
  const txn2 = await m.prisma.paymentTransaction.create({
    data: {
      payerId: `buyer-${suffix2}`, purpose: 'PERSONALIZED_SERVICE_PURCHASE', amount: 50_000, currency: 'VND',
      status: 'PROCESSING', idempotencyKey: `personalized-service-${suffix2}`,
      relatedEntityType: 'PERSONALIZED_SERVICE_PURCHASE', relatedEntityId: `order-${suffix2}`, sourceService: 'integration-test',
    },
  });
  await m.prisma.wallet.update({
    where: { id: (await m.wallet.getOrCreateWallet('CLIENT', `buyer-${suffix2}`)).id },
    data: { availableBalance: new m.Prisma.Decimal(50_000) },
  });
  await m.ledger.holdPersonalizedServicePayment({
    transactionId: txn2.id, price: new m.Prisma.Decimal(50_000), commissionRate: f1.commissionRate,
    buyerId: `buyer-${suffix2}`, sellerId: f1.sellerId, label: 'second order, same seller',
  });

  const summary = await m.ledger.getPersonalizedServiceLedgerSummary({ transactionId: f1.txnId, sellerId: f1.sellerId });
  assert.equal(summary.held.seller, '90000.00', 'order 1\'s own held amount, not pooled with order 2\'s 45000');
});
