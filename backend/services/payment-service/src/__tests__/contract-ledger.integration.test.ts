/**
 * The seven acceptance scenarios, run against a real Postgres database.
 *
 * contract-money.test.ts already proves the arithmetic. This file proves the *ledger* agrees
 * with it: that the numbers actually land in the right buckets, that concurrent webhook
 * deliveries settle once, and — after every single step — that the system-wide invariant
 * (escrow = the sum of all claims on it) still holds. A formula that is right on paper and
 * wrong in the wallets is worth nothing.
 *
 * Run:
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test src/__tests__/contract-ledger.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

const databaseUrl = process.env.DATABASE_URL || '';
const canUseIntegrationDb = /_test/i.test(databaseUrl);
const skipOpts = {
  skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  money: typeof import('../services/contract-money');
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
      money: await import('../services/contract-money'),
      reconcile: await import('../services/reconcile.service'),
      wallet: (await import('../services/wallet.service')).walletService,
    };
  }
  return mods;
}

test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

/**
 * Every scenario starts from an empty ledger. The invariant is a property of the whole
 * database, so leftovers from another test would make a genuine violation indistinguishable
 * from stale data.
 */
async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe('TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets RESTART IDENTITY CASCADE');
}

interface Fixture {
  contractId: string;
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: InstanceType<Mods['Prisma']['Decimal']>;
  totalSessions: number;
  rates: import('../services/contract-money').RateTable;
}

/** A paid-for contract: transaction row seeded PENDING, ready for settlement. */
async function seedContract(
  m: Mods,
  opts: { price: number; totalSessions: number; rates: Fixture['rates']; withGym?: boolean },
): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const parties = {
    ptUserId: `pt-${suffix}`,
    gymId: opts.withGym ? `gym-${suffix}` : null,
    clientUserId: `client-${suffix}`,
  };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: parties.clientUserId,
      purpose: 'PT_CONTRACT',
      amount: opts.price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: `vnpay_${suffix}`,
      idempotencyKey: `contract-${suffix}`,
      relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: `contract-${suffix}`,
      activationStatus: 'PENDING',
      sourceService: 'integration-test',
    },
  });
  return {
    contractId: `contract-${suffix}`,
    txnId: txn.id,
    parties,
    price: new m.Prisma.Decimal(opts.price),
    totalSessions: opts.totalSessions,
    rates: opts.rates,
  };
}

/** A second transaction row, because ledger entries are foreign-keyed to one. */
async function nextTxn(m: Mods, f: Fixture, purpose: 'REFUND' | 'PT_CONTRACT' = 'PT_CONTRACT'): Promise<string> {
  const t = await m.prisma.paymentTransaction.create({
    data: {
      payerId: f.parties.clientUserId,
      purpose,
      amount: 0,
      currency: 'VND',
      status: 'PROCESSING',
      provider: 'VNPAY',
      idempotencyKey: `evt-${randomUUID()}`,
      relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: f.contractId,
      sourceService: 'integration-test',
    },
  });
  return t.id;
}

async function balances(m: Mods, f: Fixture) {
  const [pt, gym, client, escrow, revenue] = await Promise.all([
    m.ledger.readWallet('PT', f.parties.ptUserId),
    f.parties.gymId ? m.ledger.readWallet('GYM', f.parties.gymId) : Promise.resolve(null),
    m.ledger.readWallet('CLIENT', f.parties.clientUserId),
    m.wallet.getEscrowWallet(),
    m.wallet.getRevenueWallet(),
  ]);
  return {
    ptPending: pt.pendingBalance,
    ptAvailable: pt.availableBalance,
    gymPending: gym?.pendingBalance ?? '0.00',
    gymAvailable: gym?.availableBalance ?? '0.00',
    clientAvailable: client.availableBalance,
    escrow: escrow.availableBalance.toFixed(2),
    platformPending: revenue.pendingBalance.toFixed(2),
    platformRevenue: revenue.availableBalance.toFixed(2),
  };
}

function rateTable(m: Mods, platform: string, pt: string, gym: string) {
  return {
    platformRate: new m.Prisma.Decimal(platform),
    ptRate: new m.Prisma.Decimal(pt),
    gymRate: new m.Prisma.Decimal(gym),
  };
}

// ── Scenario A ───────────────────────────────────────────────────────────────

test('Scenario A: a contract that runs to completion', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, { price: 1_000_000, totalSessions: 10, rates: rateTable(m, '0.10', '0.90', '0') });

  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'A',
  });
  let b = await balances(m, f);
  assert.equal(b.escrow, '1000000.00', 'escrow holds the whole price');
  assert.equal(b.ptPending, '900000.00', 'PT pending');
  assert.equal(b.platformPending, '100000.00', 'platform pending');
  assert.equal(b.ptAvailable, '0.00', 'nothing withdrawable yet');
  await m.reconcile.assertInvariant('A after payment');

  for (let i = 0; i < 3; i++) {
    await m.ledger.releaseSession({
      transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
      rates: f.rates, parties: f.parties, label: `A session ${i + 1}`,
    });
    await m.reconcile.assertInvariant(`A after session ${i + 1}`);
  }
  b = await balances(m, f);
  assert.equal(b.ptAvailable, '270000.00', 'PT available after 3 sessions');
  assert.equal(b.ptPending, '630000.00', 'PT pending after 3 sessions');

  for (let i = 3; i < 10; i++) {
    await m.ledger.releaseSession({
      transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
      rates: f.rates, parties: f.parties, label: `A session ${i + 1}`,
    });
  }
  b = await balances(m, f);
  assert.equal(b.ptAvailable, '900000.00', 'PT available after all 10');
  assert.equal(b.ptPending, '0.00', 'PT pending empty');
  assert.equal(b.platformRevenue, '100000.00', 'platform revenue');
  assert.equal(b.escrow, '1000000.00', 'escrow unchanged — nothing has been paid out yet');
  await m.reconcile.assertInvariant('A complete');
});

// ── Scenario B ───────────────────────────────────────────────────────────────

test('Scenario B: client cancels after 2 of 10 sessions', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, { price: 1_000_000, totalSessions: 10, rates: rateTable(m, '0.10', '0.90', '0') });

  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'B',
  });
  const released = { pt: new m.Prisma.Decimal(0), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(0) };
  for (let i = 0; i < 2; i++) {
    const r = await m.ledger.releaseSession({
      transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
      rates: f.rates, parties: f.parties, label: `B session ${i + 1}`,
    });
    released.pt = released.pt.plus(r.released.pt);
    released.platform = released.platform.plus(r.released.platform);
  }
  await m.reconcile.assertInvariant('B after 2 sessions');

  const out = await m.ledger.terminateContract({
    transactionId: await nextTxn(m, f, 'REFUND'), price: f.price, totalSessions: f.totalSessions,
    usedSessions: 2, rates: f.rates, reason: 'CLIENT_CANCELLED', alreadyReleased: released,
    parties: f.parties, label: 'B termination',
  });

  const b = await balances(m, f);
  assert.equal(b.clientAvailable, '720000.00', 'client receives 90% of the unused value');
  assert.equal(b.ptAvailable, '252000.00', 'PT total');
  assert.equal(b.ptPending, '0.00', 'PT pending emptied');
  assert.equal(b.platformRevenue, '28000.00', 'platform revenue');
  assert.equal(b.platformPending, '0.00', 'platform pending emptied');
  assert.equal(out.shortfall, '0.00', 'nothing had to be fronted');

  const sum = new m.Prisma.Decimal(b.clientAvailable).plus(b.ptAvailable).plus(b.platformRevenue);
  assert.equal(sum.toFixed(2), '1000000.00', 'the three parts rebuild the contract price');
  await m.reconcile.assertInvariant('B complete');
});

// ── Scenario C ───────────────────────────────────────────────────────────────

test('Scenario C: the PT misses a session', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, { price: 1_000_000, totalSessions: 10, rates: rateTable(m, '0.10', '0.90', '0') });

  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'C',
  });
  const r = await m.ledger.compensateNoShow({
    transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'C no-show',
  });

  const b = await balances(m, f);
  assert.equal(r.compensation, '100000.00', 'one session of value');
  assert.equal(b.clientAvailable, '100000.00', 'client compensated');
  assert.equal(b.ptPending, '810000.00', 'PT pending 900.000 → 810.000');
  assert.equal(b.platformPending, '90000.00', 'platform pending 100.000 → 90.000');
  assert.equal(r.shortfall, '0.00', 'the pending buckets covered it');
  assert.equal(b.escrow, '1000000.00', 'escrow untouched — no cash left the platform');
  await m.reconcile.assertInvariant('C complete');
});

// ── Scenario D ───────────────────────────────────────────────────────────────

test('Scenario D: 20 sessions, 19 used, then cancelled — no negative refund', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, { price: 2_000_000, totalSessions: 20, rates: rateTable(m, '0.10', '0.90', '0') });

  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'D',
  });
  const released = { pt: new m.Prisma.Decimal(0), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(0) };
  for (let i = 0; i < 19; i++) {
    const r = await m.ledger.releaseSession({
      transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
      rates: f.rates, parties: f.parties, label: `D session ${i + 1}`,
    });
    released.pt = released.pt.plus(r.released.pt);
    released.platform = released.platform.plus(r.released.platform);
  }

  const out = await m.ledger.terminateContract({
    transactionId: await nextTxn(m, f, 'REFUND'), price: f.price, totalSessions: f.totalSessions,
    usedSessions: 19, rates: f.rates, reason: 'CLIENT_CANCELLED', alreadyReleased: released,
    parties: f.parties, label: 'D termination',
  });

  const b = await balances(m, f);
  assert.equal(out.refund, '90000.00', 'refund is 90.000, not negative');
  assert.equal(b.clientAvailable, '90000.00', 'client wallet');
  const report = await m.reconcile.assertInvariant('D complete');
  assert.equal(report.negativeWallets.length, 0, 'no wallet went negative');
});

// ── Scenario E ───────────────────────────────────────────────────────────────

test('Scenario E: three-way split with a gym, cancelled after 2 of 10', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, {
    price: 1_000_000, totalSessions: 10, withGym: true, rates: rateTable(m, '0.10', '0.55', '0.35'),
  });

  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'E',
  });
  let b = await balances(m, f);
  assert.equal(b.ptPending, '550000.00', 'PT pending after payment');
  assert.equal(b.gymPending, '350000.00', 'gym pending after payment');
  assert.equal(b.platformPending, '100000.00', 'platform pending after payment');

  const released = { pt: new m.Prisma.Decimal(0), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(0) };
  for (let i = 0; i < 2; i++) {
    const r = await m.ledger.releaseSession({
      transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
      rates: f.rates, parties: f.parties, label: `E session ${i + 1}`,
    });
    released.pt = released.pt.plus(r.released.pt);
    released.gym = released.gym.plus(r.released.gym);
    released.platform = released.platform.plus(r.released.platform);
  }

  await m.ledger.terminateContract({
    transactionId: await nextTxn(m, f, 'REFUND'), price: f.price, totalSessions: f.totalSessions,
    usedSessions: 2, rates: f.rates, reason: 'CLIENT_CANCELLED', alreadyReleased: released,
    parties: f.parties, label: 'E termination',
  });

  b = await balances(m, f);
  assert.equal(b.clientAvailable, '720000.00', 'client');
  assert.equal(b.ptAvailable, '154000.00', 'PT = 0.55 × 280.000');
  assert.equal(b.gymAvailable, '98000.00', 'gym = 0.35 × 280.000');
  assert.equal(b.platformRevenue, '28000.00', 'platform = 0.10 × 280.000');
  const sum = new m.Prisma.Decimal(b.clientAvailable).plus(b.ptAvailable).plus(b.gymAvailable).plus(b.platformRevenue);
  assert.equal(sum.toFixed(2), '1000000.00', 'all four parts rebuild the price');
  await m.reconcile.assertInvariant('E complete');
});

// ── Scenario F ───────────────────────────────────────────────────────────────

test('Scenario F: 1.000.000đ over 3 sessions — rounding loses nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, {
    price: 1_000_000, totalSessions: 3, withGym: true, rates: rateTable(m, '0.10', '0.55', '0.35'),
  });

  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'F',
  });
  const r = await m.ledger.releaseSession({
    transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'F session 1',
  });
  const released = {
    pt: new m.Prisma.Decimal(r.released.pt),
    gym: new m.Prisma.Decimal(r.released.gym),
    platform: new m.Prisma.Decimal(r.released.platform),
  };

  await m.ledger.terminateContract({
    transactionId: await nextTxn(m, f, 'REFUND'), price: f.price, totalSessions: f.totalSessions,
    usedSessions: 1, rates: f.rates, reason: 'CLIENT_CANCELLED', alreadyReleased: released,
    parties: f.parties, label: 'F termination',
  });

  const b = await balances(m, f);
  const sum = new m.Prisma.Decimal(b.clientAvailable)
    .plus(b.ptAvailable).plus(b.gymAvailable).plus(b.platformRevenue)
    .plus(b.ptPending).plus(b.gymPending).plus(b.platformPending);
  assert.equal(sum.toFixed(2), '1000000.00', 'not one đồng lost to rounding');
  assert.equal(b.ptPending, '0.00', 'pending fully drained');
  assert.equal(b.gymPending, '0.00', 'pending fully drained');
  assert.equal(b.platformPending, '0.00', 'pending fully drained');
  await m.reconcile.assertInvariant('F complete');
});

// ── Scenario G ───────────────────────────────────────────────────────────────

test('Scenario G: five scenarios back to back in one database keep the invariant', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const D = (v: number | string) => new m.Prisma.Decimal(v);

  const cases = [
    { price: 1_000_000, n: 10, use: 10, gym: false, rates: rateTable(m, '0.10', '0.90', '0'), reason: 'COMPLETED' as const },
    { price: 1_000_000, n: 10, use: 2, gym: false, rates: rateTable(m, '0.10', '0.90', '0'), reason: 'CLIENT_CANCELLED' as const },
    { price: 2_000_000, n: 20, use: 19, gym: false, rates: rateTable(m, '0.10', '0.90', '0'), reason: 'CLIENT_CANCELLED' as const },
    { price: 1_000_000, n: 10, use: 2, gym: true, rates: rateTable(m, '0.10', '0.55', '0.35'), reason: 'PT_BANNED' as const },
    { price: 1_000_000, n: 3, use: 1, gym: true, rates: rateTable(m, '0.10', '0.55', '0.35'), reason: 'MUTUAL' as const },
  ];

  let step = 0;
  for (const c of cases) {
    step++;
    const f = await seedContract(m, { price: c.price, totalSessions: c.n, rates: c.rates, withGym: c.gym });
    await m.ledger.settleContractPayment({
      transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: `G${step}`,
    });
    await m.reconcile.assertInvariant(`G${step} after payment`);

    const released = { pt: D(0), gym: D(0), platform: D(0) };
    for (let i = 0; i < c.use; i++) {
      const r = await m.ledger.releaseSession({
        transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
        rates: f.rates, parties: f.parties, label: `G${step} s${i + 1}`,
      });
      released.pt = released.pt.plus(r.released.pt);
      released.gym = released.gym.plus(r.released.gym);
      released.platform = released.platform.plus(r.released.platform);
      await m.reconcile.assertInvariant(`G${step} after session ${i + 1}`);
    }

    await m.ledger.terminateContract({
      transactionId: await nextTxn(m, f, 'REFUND'), price: f.price, totalSessions: f.totalSessions,
      usedSessions: c.use, rates: f.rates, reason: c.reason, alreadyReleased: released,
      parties: f.parties, label: `G${step} end`,
    });
    await m.reconcile.assertInvariant(`G${step} after termination (${c.reason})`);
  }

  const report = await m.reconcile.assertInvariant('G final');
  assert.equal(report.drift, '0.00', 'no drift after five overlapping contracts');
  assert.equal(report.negativeWallets.length, 0, 'no negative wallets');
});

// ── Duplicate delivery ───────────────────────────────────────────────────────

test('a webhook delivered twice allocates the money once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, { price: 1_000_000, totalSessions: 10, rates: rateTable(m, '0.10', '0.90', '0') });

  const settle = () => m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'dup',
  });

  await settle();
  await settle(); // exact duplicate
  await settle(); // and again

  const b = await balances(m, f);
  assert.equal(b.escrow, '1000000.00', 'escrow credited exactly once');
  assert.equal(b.ptPending, '900000.00', 'PT pending credited exactly once');
  assert.equal(b.platformPending, '100000.00', 'platform pending credited exactly once');
  await m.reconcile.assertInvariant('duplicate delivery');
});

test('two concurrent deliveries for the same contract allocate once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, { price: 500_000, totalSessions: 5, rates: rateTable(m, '0.10', '0.90', '0') });

  const settle = () => m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'race',
  });
  await Promise.all([settle(), settle()]);

  const b = await balances(m, f);
  assert.equal(b.escrow, '500000.00', 'escrow credited once despite the race');
  assert.equal(b.ptPending, '450000.00', 'PT pending credited once');
  await m.reconcile.assertInvariant('concurrent delivery');
});

// ── Shortfall handling ───────────────────────────────────────────────────────

test('a PT with an exhausted pending bucket still leaves the client whole', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, { price: 300_000, totalSessions: 3, rates: rateTable(m, '0.10', '0.90', '0') });

  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'S',
  });
  // Burn the whole contract: three no-shows against a three-session contract drains pending
  // and then bites into what was released.
  for (let i = 0; i < 3; i++) {
    await m.ledger.compensateNoShow({
      transactionId: await nextTxn(m, f), price: f.price, totalSessions: f.totalSessions,
      rates: f.rates, parties: f.parties, label: `S no-show ${i + 1}`,
    });
    await m.reconcile.assertInvariant(`S after no-show ${i + 1}`);
  }

  const b = await balances(m, f);
  assert.equal(b.clientAvailable, '300000.00', 'the client got every missed session back');
  const report = await m.reconcile.assertInvariant('S complete');
  assert.equal(report.negativeWallets.length, 0, 'no wallet went negative');
});
