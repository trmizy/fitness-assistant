/**
 * Membership money: referral commission, clawback, and releasing the pending buckets.
 *
 * Scenarios H, I and J from the plan, plus the release triggers. As with the contract ledger
 * suite, the invariant (escrow = the sum of every claim on it) is asserted after each step —
 * a referral that pays the right number into the wrong bucket is still a bug.
 *
 * Run THIS FILE ALONE — it TRUNCATEs the ledger between scenarios and node:test runs separate
 * files concurrently:
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test src/__tests__/membership-ledger.integration.test.ts
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
  ledger: typeof import('../services/contract-ledger.service');
  membership: typeof import('../services/membership-ledger.service');
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
      membership: await import('../services/membership-ledger.service'),
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
  gymId: string;
  ptUserId: string;
  clientId: string;
  price: InstanceType<Mods['Prisma']['Decimal']>;
}

/**
 * A membership paid for at a gateway and settled: escrow holds the price, the gym and the
 * platform hold it as pending. Mirrors what the webhook does for a GYM_MEMBERSHIP purchase —
 * the "PT side" of the rate table is the gym itself, so ptRate is 0.
 */
async function seedPaidMembership(m: Mods, price: number, platformRate = '0.10'): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const gymId = `gym-${suffix}`;
  const ptUserId = `pt-${suffix}`;
  const clientId = `client-${suffix}`;

  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientId,
      purpose: 'GYM_MEMBERSHIP',
      amount: price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: `vnpay_${suffix}`,
      idempotencyKey: `membership-${suffix}`,
      relatedEntityType: 'GYM_MEMBERSHIP',
      relatedEntityId: `membership-${suffix}`,
      sourceService: 'integration-test',
    },
  });

  const gymRate = (1 - Number(platformRate)).toFixed(4);
  await m.ledger.settleContractPayment({
    transactionId: txn.id,
    price: new m.Prisma.Decimal(price),
    rates: {
      platformRate: new m.Prisma.Decimal(platformRate),
      ptRate: new m.Prisma.Decimal(0),
      gymRate: new m.Prisma.Decimal(gymRate),
    },
    parties: { ptUserId: gymId, gymId, clientUserId: clientId },
    label: `membership ${suffix}`,
  });

  return { txnId: txn.id, gymId, ptUserId, clientId, price: new m.Prisma.Decimal(price) };
}

async function balances(m: Mods, f: Fixture) {
  const [gym, pt, client, revenue, escrow] = await Promise.all([
    m.ledger.readWallet('GYM', f.gymId),
    m.ledger.readWallet('PT', f.ptUserId),
    m.ledger.readWallet('CLIENT', f.clientId),
    m.wallet.getRevenueWallet(),
    m.wallet.getEscrowWallet(),
  ]);
  return {
    gymPending: gym.pendingBalance,
    gymAvailable: gym.availableBalance,
    ptPending: pt.pendingBalance,
    ptAvailable: pt.availableBalance,
    clientAvailable: client.availableBalance,
    platformPending: revenue.pendingBalance.toFixed(2),
    platformRevenue: revenue.availableBalance.toFixed(2),
    escrow: escrow.availableBalance.toFixed(2),
  };
}

// ── Scenario H ───────────────────────────────────────────────────────────────

test('Scenario H: referral commission moves from the gym to the PT', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 1_000_000);

  let b = await balances(m, f);
  assert.equal(b.escrow, '1000000.00', 'escrow holds the whole price');
  assert.equal(b.gymPending, '900000.00', 'gym pending after settlement');
  assert.equal(b.platformPending, '100000.00', 'platform pending after settlement');
  await m.reconcile.assertInvariant('H after settlement');

  // 10% of the GROSS price, per the plan's A3 decision.
  await m.membership.settleMembershipReferral({
    transactionId: f.txnId,
    gymId: f.gymId,
    ptUserId: f.ptUserId,
    amount: new m.Prisma.Decimal(100_000),
    label: 'H referral',
  });

  b = await balances(m, f);
  assert.equal(b.gymPending, '800000.00', 'gym pending drops by the commission');
  assert.equal(b.ptPending, '100000.00', 'PT holds the commission as pending');
  assert.equal(b.platformPending, '100000.00', 'the platform share is untouched — commission comes out of the gym');
  assert.equal(b.escrow, '1000000.00', 'escrow unmoved: the claim shifted, no cash left');
  await m.reconcile.assertInvariant('H after referral');
});

// ── F1: the PT's commission must not be stranded ─────────────────────────────

test('F1: a membership with a referral expires — the PT can withdraw the commission', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 1_000_000);
  await m.membership.settleMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId,
    amount: new m.Prisma.Decimal(100_000), label: 'F1 referral',
  });

  // Natural expiry: nothing refunded, everything released.
  const r = await m.membership.releaseMembershipPending({
    transactionId: f.txnId,
    gymId: f.gymId,
    clientId: f.clientId,
    ptUserId: f.ptUserId,
    refundToClient: new m.Prisma.Decimal(0),
    label: 'F1 expiry',
  });

  const b = await balances(m, f);
  assert.equal(b.ptPending, '0.00', 'the PT commission must NOT be stranded in pending');
  assert.equal(b.ptAvailable, '100000.00', 'the PT can withdraw it');
  assert.equal(b.gymPending, '0.00', 'gym pending drained');
  assert.equal(b.gymAvailable, '800000.00', 'gym withdrawable');
  assert.equal(b.platformPending, '0.00', 'platform pending drained');
  assert.equal(b.platformRevenue, '100000.00', 'platform revenue');
  assert.equal(r.released.ptReferral, '100000.00', 'release reports the referral leg');

  const total = new m.Prisma.Decimal(b.ptAvailable).plus(b.gymAvailable).plus(b.platformRevenue);
  assert.equal(total.toFixed(2), '1000000.00', 'the three parts rebuild the price');
  await m.reconcile.assertInvariant('F1 complete');
});

test('a membership with no referral releases cleanly', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 500_000);

  const r = await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId,
    ptUserId: null, refundToClient: new m.Prisma.Decimal(0), label: 'no-referral expiry',
  });

  const b = await balances(m, f);
  assert.equal(r.released.ptReferral, '0.00', 'no referral leg');
  assert.equal(b.gymAvailable, '450000.00', 'gym');
  assert.equal(b.platformRevenue, '50000.00', 'platform');
  await m.reconcile.assertInvariant('no-referral release');
});

// ── Scenario I ───────────────────────────────────────────────────────────────

test('Scenario I: an admin refunds half — the referral is clawed back in proportion', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 1_000_000);
  await m.membership.settleMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId,
    amount: new m.Prisma.Decimal(100_000), label: 'I referral',
  });

  // Half the membership is refunded → half the commission comes back.
  const claw = await m.membership.clawbackMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId,
    amount: new m.Prisma.Decimal(50_000), label: 'I clawback',
  });
  assert.equal(claw.recovered, '50000.00', 'half the commission recovered');
  assert.equal(claw.shortfall, '0.00', 'nothing had to be fronted');
  await m.reconcile.assertInvariant('I after clawback');

  const rel = await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId, ptUserId: f.ptUserId,
    refundToClient: new m.Prisma.Decimal(500_000), label: 'I admin refund',
  });

  const b = await balances(m, f);
  assert.equal(b.clientAvailable, '500000.00', 'client refunded half');
  assert.equal(b.ptPending, '0.00', 'nothing stranded');
  assert.equal(b.gymPending, '0.00', 'nothing stranded');
  assert.equal(b.platformPending, '0.00', 'nothing stranded');

  // F2: every đồng of the original price is accounted for exactly once.
  const total = new m.Prisma.Decimal(b.clientAvailable)
    .plus(b.gymAvailable).plus(b.ptAvailable).plus(b.platformRevenue);
  assert.equal(total.toFixed(2), '1000000.00', 'refund + clawback + release rebuild the price exactly');
  assert.equal(rel.shortfall, '0.00', 'no shortfall');
  await m.reconcile.assertInvariant('I complete');
});

// ── Scenario J ───────────────────────────────────────────────────────────────

test('Scenario J: a full refund reclaims the whole commission', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 1_000_000);
  await m.membership.settleMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId,
    amount: new m.Prisma.Decimal(100_000), label: 'J referral',
  });

  const claw = await m.membership.clawbackMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId,
    amount: new m.Prisma.Decimal(100_000), label: 'J clawback',
  });
  assert.equal(claw.recovered, '100000.00', 'the entire commission comes back');

  await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId, ptUserId: f.ptUserId,
    refundToClient: new m.Prisma.Decimal(1_000_000), label: 'J full refund',
  });

  const b = await balances(m, f);
  assert.equal(b.clientAvailable, '1000000.00', 'client made whole');
  assert.equal(b.ptAvailable, '0.00', 'PT keeps nothing');
  assert.equal(b.ptPending, '0.00', 'PT keeps nothing');
  assert.equal(b.gymAvailable, '0.00', 'gym keeps nothing');
  assert.equal(b.platformRevenue, '0.00', 'platform keeps nothing');
  const report = await m.reconcile.assertInvariant('J complete');
  assert.equal(report.negativeWallets.length, 0, 'no wallet went negative');
});

// ── Client-cancelled: no refund, and the commission stays with the PT ────────

test('a client who cancels gets nothing back, and the PT keeps the commission', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 1_000_000);
  await m.membership.settleMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId,
    amount: new m.Prisma.Decimal(100_000), label: 'cancel referral',
  });

  // Client-cancelled = release with refundToClient 0, and NO clawback call. The membership was
  // sold and activated legitimately; the client walking away is not the PT's fault.
  await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId, ptUserId: f.ptUserId,
    refundToClient: new m.Prisma.Decimal(0), label: 'client cancelled',
  });

  const b = await balances(m, f);
  assert.equal(b.clientAvailable, '0.00', 'not one đồng goes back to the client');
  assert.equal(b.ptAvailable, '100000.00', 'the PT keeps the whole commission');
  assert.equal(b.gymAvailable, '800000.00', 'gym keeps the rest');
  await m.reconcile.assertInvariant('client cancelled');
});

// ── Idempotency of release ───────────────────────────────────────────────────

test('releasing the same membership twice does not pay out twice', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 800_000);

  await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId,
    ptUserId: null, refundToClient: new m.Prisma.Decimal(0), label: 'first release',
  });
  const after1 = await balances(m, f);

  const second = await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId,
    ptUserId: null, refundToClient: new m.Prisma.Decimal(0), label: 'second release',
  });
  const after2 = await balances(m, f);

  assert.equal(second.released.gym, '0.00', 'the second call releases nothing');
  assert.equal(after2.gymAvailable, after1.gymAvailable, 'gym balance unchanged by the replay');
  assert.equal(after2.platformRevenue, after1.platformRevenue, 'platform balance unchanged');
  await m.reconcile.assertInvariant('double release');
});

// ── Clawback beyond what the PT still holds ──────────────────────────────────

test('a clawback the PT cannot cover raises a receivable and still funds the refund', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedPaidMembership(m, 1_000_000);
  await m.membership.settleMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId,
    amount: new m.Prisma.Decimal(100_000), label: 'shortfall referral',
  });

  // Drain the PT's pending by releasing it to available, then spend it out of the system by
  // clawing back more than remains.
  await m.membership.releaseMembershipPending({
    transactionId: f.txnId, gymId: f.gymId, clientId: f.clientId, ptUserId: f.ptUserId,
    refundToClient: new m.Prisma.Decimal(0), label: 'release before clawback',
  });

  const claw = await m.membership.clawbackMembershipReferral({
    transactionId: f.txnId, gymId: f.gymId, ptUserId: f.ptUserId,
    amount: new m.Prisma.Decimal(100_000), label: 'clawback after release',
  });

  assert.equal(claw.recovered, '100000.00', 'reclaimed from the PT available bucket');
  const report = await m.reconcile.assertInvariant('clawback after release');
  assert.equal(report.negativeWallets.length, 0, 'no wallet went negative');
});
