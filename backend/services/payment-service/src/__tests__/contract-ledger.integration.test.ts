/**
 * The seven acceptance scenarios, run against a real Postgres database.
 *
 * contract-money.test.ts already proves the arithmetic. This file proves the *ledger* agrees
 * with it: that the numbers actually land in the right buckets, that concurrent webhook
 * deliveries settle once, and — after every single step — that the system-wide invariant
 * (escrow = the sum of all claims on it) still holds. A formula that is right on paper and
 * wrong in the wallets is worth nothing.
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
 *     npx tsx --test src/__tests__/contract-ledger.integration.test.ts
 *
 * Not alongside the other integration file. The invariant is a property of the entire
 * database, so each scenario TRUNCATEs the ledger first — and node:test runs separate files
 * concurrently, which would have this suite wiping tables out from under the other one. The
 * resulting failures look exactly like real money bugs and are not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { HOSTILE_FLAG_VALUES, withRemovedFlag } from './support/d48-flag';
import { isTestDatabaseUrl } from './support/test-db-guard'; // D57-6-5 / D64: the database NAME must end with _test (the old /_test/i on the whole URL also matched the user name gymcoach_test)

// Owner decision: automatic PartnerReceivable recovery was REMOVED. The old switch is set to 'true' on purpose, to prove it is inert.
process.env.RECEIVABLE_RECOVERY_ENABLED = 'true';
const databaseUrl = process.env.DATABASE_URL || '';
const canUseIntegrationDb = isTestDatabaseUrl(databaseUrl);
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
  await m.prisma.$executeRawUnsafe('TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE');
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

/**
 * The transaction id a release, no-show or termination of this contract runs under. It is the
 * contract's OWN payment transaction, exactly as user-service sends it (`contract.paymentTransactionId`
 * on every ledger call): the ledger scopes "this contract's pending" by that id. These scenarios
 * used to mint a fresh transaction row per call, which no production caller does and which would
 * leave every call looking at a contract with no pending of its own. The signature is kept so the
 * call sites, which still say whether the call is a refund, read the same.
 */
async function nextTxn(_m: Mods, f: Fixture, _purpose: 'REFUND' | 'PT_CONTRACT' = 'PT_CONTRACT'): Promise<string> {
  return f.txnId;
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
      idempotencyKey: `SESSION_RELEASE:${`A session ${i + 1}`}`,
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
      idempotencyKey: `SESSION_RELEASE:${`A session ${i + 1}`}`,
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
      idempotencyKey: `SESSION_RELEASE:${`B session ${i + 1}`}`,
    });
    released.pt = released.pt.plus(r.released.pt);
    released.platform = released.platform.plus(r.released.platform);
  }
  await m.reconcile.assertInvariant('B after 2 sessions');

  const out = await m.ledger.terminateContract({
    transactionId: await nextTxn(m, f, 'REFUND'), price: f.price, totalSessions: f.totalSessions,
    usedSessions: 2, rates: f.rates, reason: 'CLIENT_CANCELLED', alreadyReleased: released,
    parties: f.parties, label: 'B termination',
    idempotencyKey: `CONTRACT_TERMINATE:${'B termination'}`,
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
    idempotencyKey: `PT_NO_SHOW:${'C no-show'}`,
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
      idempotencyKey: `SESSION_RELEASE:${`D session ${i + 1}`}`,
    });
    released.pt = released.pt.plus(r.released.pt);
    released.platform = released.platform.plus(r.released.platform);
  }

  const out = await m.ledger.terminateContract({
    transactionId: await nextTxn(m, f, 'REFUND'), price: f.price, totalSessions: f.totalSessions,
    usedSessions: 19, rates: f.rates, reason: 'CLIENT_CANCELLED', alreadyReleased: released,
    parties: f.parties, label: 'D termination',
    idempotencyKey: `CONTRACT_TERMINATE:${'D termination'}`,
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
      idempotencyKey: `SESSION_RELEASE:${`E session ${i + 1}`}`,
    });
    released.pt = released.pt.plus(r.released.pt);
    released.gym = released.gym.plus(r.released.gym);
    released.platform = released.platform.plus(r.released.platform);
  }

  await m.ledger.terminateContract({
    transactionId: await nextTxn(m, f, 'REFUND'), price: f.price, totalSessions: f.totalSessions,
    usedSessions: 2, rates: f.rates, reason: 'CLIENT_CANCELLED', alreadyReleased: released,
    parties: f.parties, label: 'E termination',
    idempotencyKey: `CONTRACT_TERMINATE:${'E termination'}`,
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
    idempotencyKey: `SESSION_RELEASE:${'F session 1'}`,
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
    idempotencyKey: `CONTRACT_TERMINATE:${'F termination'}`,
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
        idempotencyKey: `SESSION_RELEASE:${`G${step} s${i + 1}`}`,
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
      idempotencyKey: `CONTRACT_TERMINATE:${`G${step} end`}`,
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
      idempotencyKey: `PT_NO_SHOW:${`S no-show ${i + 1}`}`,
    });
    await m.reconcile.assertInvariant(`S after no-show ${i + 1}`);
  }

  const b = await balances(m, f);
  assert.equal(b.clientAvailable, '300000.00', 'the client got every missed session back');
  const report = await m.reconcile.assertInvariant('S complete');
  assert.equal(report.negativeWallets.length, 0, 'no wallet went negative');
});

// ── Old PartnerReceivable rows are history: nothing is ever deducted for them ─────────────────────────────
//
// Owner decision (final): no automatic recovery of a partner's debt by deducting income - not from the contract that
// earns it, not from another. Old debts (booked before D48, when the platform could still front a shortfall) are seeded
// directly; these prove a PT is paid in full and the row is left exactly as it was, even with the old switch set.

/** A debt the platform has already fronted for this fixture's PT. */
async function seedReceivable(m: Mods, f: Fixture, amount: number) {
  return m.prisma.partnerReceivable.create({
    data: {
      partnerType: 'PT',
      partnerId: f.parties.ptUserId,
      amount,
      reason: 'seeded debt',
      transactionId: f.txnId,
    },
  });
}

test('an old PartnerReceivable is NOT deducted from a session the PT earns (RECEIVABLE_RECOVERY_ENABLED=true changes nothing)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, { price: 1_000_000, totalSessions: 10, rates: rateTable(m, '0.10', '0.90', '0') });

  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'R1',
  });
  const debt = await seedReceivable(m, f, 50_000);

  await m.ledger.releaseSession({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: 'R1 session 1',
    idempotencyKey: `SESSION_RELEASE:${'R1 session 1'}`,
  });

  const b = await balances(m, f);
  assert.equal(b.ptAvailable, '90000.00', 'the PT is paid the whole 90.000');
  assert.equal(b.platformRevenue, '10000.00', 'the platform has only its own 10.000 commission');
  assert.equal(b.escrow, '1000000.00', 'escrow untouched');

  const after = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } });
  assert.equal(after.recovered.toFixed(2), '0.00', 'nothing recovered');
  assert.equal(after.settledAt, null, 'the row is untouched: history kept');
  assert.equal(after.amount.toFixed(2), '50000.00');
  assert.equal(await m.prisma.walletLedgerEntry.count({ where: { description: { contains: 'withheld against outstanding debt' } } }), 0);

  await m.reconcile.assertInvariant('R1 complete');
});

test('a debt larger than a session is never worked off over several sessions: every session pays the PT in full', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, { price: 1_000_000, totalSessions: 10, rates: rateTable(m, '0.10', '0.90', '0') });
  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'R2',
  });
  const debt = await seedReceivable(m, f, 200_000);
  for (let i = 1; i <= 4; i++) {
    await m.ledger.releaseSession({
      transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
      rates: f.rates, parties: f.parties, label: `R2 session ${i}`,
      idempotencyKey: `SESSION_RELEASE:${`R2 session ${i}`}`,
    });
    await m.reconcile.assertInvariant(`R2 after session ${i}`);
  }
  const b = await balances(m, f);
  assert.equal(b.ptAvailable, '360000.00', 'four sessions of 90.000, none withheld');
  const row = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } });
  assert.equal(row.recovered.toFixed(2), '0.00');
  assert.equal(row.settledAt, null);
});

test('two old debts (one suspended) are untouched through the sessions and the final settlement', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await seedContract(m, { price: 1_000_000, totalSessions: 2, rates: rateTable(m, '0.10', '0.90', '0') });
  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'R3',
  });
  const older = await seedReceivable(m, f, 60_000);
  const newer = await seedReceivable(m, f, 60_000);
  await m.prisma.partnerReceivable.update({ where: { id: newer.id }, data: { suspendedAt: new Date(), suspendedBy: 'admin', suspensionReason: 'review' } });
  for (let i = 1; i <= 2; i++) {
    await m.ledger.releaseSession({
      transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
      rates: f.rates, parties: f.parties, label: `R3 session ${i}`,
      idempotencyKey: `SESSION_RELEASE:${`R3 session ${i}`}`,
    });
  }
  await m.ledger.terminateContract({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions, usedSessions: 2, rates: f.rates, reason: 'COMPLETED',
    alreadyReleased: { pt: new m.Prisma.Decimal(900_000), gym: new m.Prisma.Decimal(0), platform: new m.Prisma.Decimal(100_000) },
    parties: f.parties, label: 'R3 end', idempotencyKey: `CONTRACT_TERMINATE:${f.contractId}`,
  });
  const b = await balances(m, f);
  assert.equal(b.ptAvailable, '900000.00');
  for (const d of [older, newer]) {
    const row = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: d.id } });
    assert.equal(row.recovered.toFixed(2), '0.00');
    assert.equal(row.settledAt, null);
  }
  await m.reconcile.assertInvariant('R3 complete');
});

test('[REGRESSION D48-INVARIANT] LEDGER_STRICT_OWN_FUNDS=false / garbage is inert: a no-show shortfall is still an OPEN obligation — no platform fronting, no PartnerReceivable, the PT keeps what the next contract earns', skipOpts, async () => {
  const m = await load();
  for (const value of HOSTILE_FLAG_VALUES) {
    await withRemovedFlag(value, async () => {
      await resetLedger(m);
      const tag = `R4(${JSON.stringify(value)})`;

      // A healthy contract first, so REVENUE holds money the platform COULD front with — it must not.
      const funder = await seedContract(m, { price: 1_000_000, totalSessions: 10, rates: rateTable(m, '0.10', '0.90', '0') });
      await m.ledger.settleContractPayment({
        transactionId: funder.txnId, price: funder.price, rates: funder.rates, parties: funder.parties, label: `${tag} funder`,
      });
      for (let i = 0; i < 10; i++) {
        await m.ledger.releaseSession({
          transactionId: funder.txnId, price: funder.price, totalSessions: funder.totalSessions,
          rates: funder.rates, parties: funder.parties, label: `${tag} funder session ${i + 1}`,
          idempotencyKey: `SESSION_RELEASE:${tag} funder session ${i + 1}`,
        });
      }
      const revenueBefore = (await balances(m, funder)).platformRevenue;

      const f = await seedContract(m, { price: 300_000, totalSessions: 3, rates: rateTable(m, '0.10', '0.90', '0') });
      await m.ledger.settleContractPayment({
        transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: tag,
      });

      // Four no-shows against a three-session contract: the fourth finds none of THIS contract's pending left.
      const results = [];
      for (let i = 0; i < 4; i++) {
        results.push(await m.ledger.compensateNoShow({
          transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
          rates: f.rates, parties: f.parties, label: `${tag} no-show ${i + 1}`,
          idempotencyKey: `PT_NO_SHOW:${tag}-${i + 1}`,
        }));
        await m.reconcile.assertInvariant(`${tag} after no-show ${i + 1}`);
      }
      assert.equal(results[3].paid, '0.00', `${tag}: nothing fronted`);
      assert.equal(results[3].unpaid, '100000.00');
      assert.ok(results[3].obligationId);
      assert.equal(await m.prisma.partnerReceivable.count(), 0, `${tag}: no PartnerReceivable`);
      const obligations = await m.prisma.contractUnpaidObligation.findMany();
      assert.equal(obligations.length, 1);
      assert.deepEqual([obligations[0].kind, obligations[0].status], ['NO_SHOW', 'OPEN']);
      assert.equal((await balances(m, f)).clientAvailable, '300000.00', 'the client holds exactly what the contract could fund');
      assert.equal((await balances(m, funder)).platformRevenue, revenueBefore, 'REVENUE AVAILABLE untouched: the platform fronted nothing');

      // The same PT earns on another contract: every đồng reaches the PT, nothing is withheld against a debt.
      const next = await seedContract(m, { price: 1_000_000, totalSessions: 10, rates: rateTable(m, '0.10', '0.90', '0') });
      next.parties.ptUserId = f.parties.ptUserId;
      await m.ledger.settleContractPayment({
        transactionId: next.txnId, price: next.price, rates: next.rates, parties: next.parties, label: `${tag} next`,
      });
      await m.ledger.releaseSession({
        transactionId: next.txnId, price: next.price, totalSessions: next.totalSessions,
        rates: next.rates, parties: next.parties, label: `${tag} next session 1`,
        idempotencyKey: `SESSION_RELEASE:${tag} next session 1`,
      });
      assert.equal((await balances(m, next)).ptAvailable, '90000.00', 'the whole session reached the PT');
      const report = await m.reconcile.assertInvariant(`${tag} complete`);
      assert.equal(report.negativeWallets.length, 0, 'no wallet went negative');
    });
  }
});

test('FH-1: a shortfall is an unpaid obligation to the client — no platform fronting, no PT debt, and the PT keeps what the next contract earns', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);

  const f = await seedContract(m, { price: 300_000, totalSessions: 3, rates: rateTable(m, '0.10', '0.90', '0') });
  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: 'R4s',
  });
  // Four no-shows against a three-session contract: the fourth finds none of THIS contract's pending left.
  const results = [];
  for (let i = 0; i < 4; i++) {
    results.push(await m.ledger.compensateNoShow({
      transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
      rates: f.rates, parties: f.parties, label: `R4s no-show ${i + 1}`,
      idempotencyKey: `PT_NO_SHOW:R4s-${i + 1}`,
    }));
    await m.reconcile.assertInvariant(`R4s after no-show ${i + 1}`);
  }
  for (const r of results.slice(0, 3)) {
    assert.equal(r.paid, '100000.00');
    assert.equal(r.owed, '100000.00');
    assert.equal(r.unpaid, '0.00');
    assert.equal(r.obligationId, undefined, 'a fully funded compensation leaves no obligation row');
  }
  assert.equal(results[3].paid, '0.00');
  assert.equal(results[3].owed, '100000.00');
  assert.equal(results[3].unpaid, '100000.00');
  assert.ok(results[3].obligationId);

  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no PT debt');
  const obligations = await m.prisma.contractUnpaidObligation.findMany();
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].kind, 'NO_SHOW');
  assert.equal(obligations[0].status, 'OPEN');
  assert.equal(obligations[0].unpaid.toFixed(2), '100000.00');
  assert.equal((await balances(m, f)).clientAvailable, '300000.00', 'the client holds exactly what the contract could fund');
  assert.equal((await balances(m, f)).platformRevenue, '0.00', 'the platform fronted nothing');

  // The same PT earns on another contract: every đồng reaches the PT.
  const next = await seedContract(m, { price: 1_000_000, totalSessions: 10, rates: rateTable(m, '0.10', '0.90', '0') });
  next.parties.ptUserId = f.parties.ptUserId;
  await m.ledger.settleContractPayment({
    transactionId: next.txnId, price: next.price, rates: next.rates, parties: next.parties, label: 'R4s next',
  });
  await m.ledger.releaseSession({
    transactionId: next.txnId, price: next.price, totalSessions: next.totalSessions,
    rates: next.rates, parties: next.parties, label: 'R4s next session 1',
    idempotencyKey: 'SESSION_RELEASE:R4s-next-1',
  });
  assert.equal((await balances(m, next)).ptAvailable, '90000.00', 'the whole session reached the PT');
  const report = await m.reconcile.assertInvariant('R4s complete');
  assert.equal(report.negativeWallets.length, 0);
});
