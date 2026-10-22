/**
 * Unresolved sessions: a contract ends while some sessions are neither certainly delivered nor
 * certainly not (the PT reported them and the client has not confirmed, or they are disputed).
 *
 *   terminateContract({ unresolvedSessions: n })  refunds only what is certainly undelivered and
 *                                                 leaves n × one session's value in the parties'
 *                                                 own pending for this contract;
 *   resolveUnresolvedSession                      later moves one session's held value to the
 *                                                 parties (DELIVERED) or back to the client
 *                                                 (NOT_DELIVERED).
 *
 *   evidence label: BACKEND INTEGRATION (real ledger code and real express router against the
 *   isolated *_test database).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables, like its siblings):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/unresolved-sessions.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
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
  withdrawals: (typeof import('../repositories/withdrawal.repository'))['withdrawalRepository'];
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
      withdrawals: (await import('../repositories/withdrawal.repository')).withdrawalRepository,
    };
  }
  return mods;
}

test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

type Dec = InstanceType<Mods['Prisma']['Decimal']>;
type Rates = import('../services/contract-money').RateTable;
type Reason = import('../services/contract-money').TerminationReason;

const EXIT: Reason = 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION';
const ALL_REASONS: Reason[] = ['CLIENT_CANCELLED', 'PT_BANNED', 'PT_CANCELLED', 'MUTUAL', 'EXPIRED', 'COMPLETED', 'PT_REPEATED_NO_SHOW', EXIT];

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe('TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE');
}

interface Fixture {
  contractId: string;
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: Dec;
  totalSessions: number;
  rates: Rates;
  h?: string;
  releasedTo: { pt: Dec; gym: Dec; platform: Dec };
  usedSessions: number;
  compensatedSessions: number;
  seq: number;
}

function rateTable(m: Mods, platform: string, pt: string, gym: string): Rates {
  return { platformRate: new m.Prisma.Decimal(platform), ptRate: new m.Prisma.Decimal(pt), gymRate: new m.Prisma.Decimal(gym) };
}

async function paidContract(
  m: Mods,
  opts: { price: number; totalSessions: number; withGym?: boolean; ptUserId?: string; gymId?: string; h?: string },
): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const parties = {
    ptUserId: opts.ptUserId ?? `pt-${suffix}`,
    gymId: opts.withGym ? (opts.gymId ?? `gym-${suffix}`) : null,
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
  const zero = new m.Prisma.Decimal(0);
  const f: Fixture = {
    contractId: `contract-${suffix}`,
    txnId: txn.id,
    parties,
    price: new m.Prisma.Decimal(opts.price),
    totalSessions: opts.totalSessions,
    rates: opts.withGym ? rateTable(m, '0.10', '0.55', '0.35') : rateTable(m, '0.10', '0.90', '0'),
    h: opts.h,
    releasedTo: { pt: zero, gym: zero, platform: zero },
    usedSessions: 0,
    compensatedSessions: 0,
    seq: 0,
  };
  await m.ledger.settleContractPayment({
    transactionId: f.txnId, price: f.price, rates: f.rates, parties: f.parties, label: f.contractId,
  });
  return f;
}

const holdbackArg = (m: Mods, f: Fixture) => (f.h !== undefined ? { ptHoldbackRate: new m.Prisma.Decimal(f.h) } : {});

async function deliver(m: Mods, f: Fixture, count: number) {
  for (let i = 0; i < count; i++) {
    const n = ++f.seq;
    const r = await m.ledger.releaseSession({
      transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
      rates: f.rates, parties: f.parties, label: `${f.contractId} session ${n}`,
      idempotencyKey: `SESSION_RELEASE:${f.contractId}:${n}`,
      ...holdbackArg(m, f),
    });
    f.usedSessions++;
    f.releasedTo.pt = f.releasedTo.pt.plus(r.released.pt);
    f.releasedTo.gym = f.releasedTo.gym.plus(r.released.gym);
    f.releasedTo.platform = f.releasedTo.platform.plus(r.released.platform);
  }
}

async function noShow(m: Mods, f: Fixture) {
  const n = ++f.seq;
  await m.ledger.compensateNoShow({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: `${f.contractId} no-show ${n}`,
    idempotencyKey: `PT_NO_SHOW:${f.contractId}:${n}`,
  });
  f.compensatedSessions++;
}

function terminateParams(m: Mods, f: Fixture, reason: Reason, unresolvedSessions?: number) {
  return {
    transactionId: f.txnId,
    price: f.price,
    totalSessions: f.totalSessions,
    usedSessions: f.usedSessions,
    compensatedSessions: f.compensatedSessions,
    ...(unresolvedSessions === undefined ? {} : { unresolvedSessions }),
    rates: f.rates,
    reason,
    alreadyReleased: f.releasedTo,
    parties: f.parties,
    label: `${f.contractId} termination`,
    idempotencyKey: `CONTRACT_TERMINATE:${f.contractId}`,
    ...holdbackArg(m, f),
  };
}

function resolveParams(m: Mods, f: Fixture, tag: string, outcome: 'DELIVERED' | 'NOT_DELIVERED', over: Record<string, unknown> = {}) {
  return {
    transactionId: f.txnId,
    price: f.price,
    totalSessions: f.totalSessions,
    rates: f.rates,
    parties: f.parties,
    label: `${f.contractId} unresolved ${tag}`,
    idempotencyKey: `UNRESOLVED_SESSION:${f.contractId}:${tag}`,
    outcome,
    ...holdbackArg(m, f),
    ...over,
  };
}

async function balances(m: Mods, f: Fixture) {
  const [pt, gym, client, escrow, revenue] = await Promise.all([
    m.wallet.getOrCreateWallet('PT', f.parties.ptUserId),
    f.parties.gymId ? m.wallet.getOrCreateWallet('GYM', f.parties.gymId) : Promise.resolve(null),
    m.wallet.getOrCreateWallet('CLIENT', f.parties.clientUserId),
    m.wallet.getEscrowWallet(),
    m.wallet.getRevenueWallet(),
  ]);
  return {
    ptPending: pt.pendingBalance.toFixed(2),
    ptHoldback: pt.holdbackBalance.toFixed(2),
    ptAvailable: pt.availableBalance.toFixed(2),
    gymPending: gym?.pendingBalance.toFixed(2) ?? '0.00',
    gymAvailable: gym?.availableBalance.toFixed(2) ?? '0.00',
    clientAvailable: client.availableBalance.toFixed(2),
    escrow: escrow.availableBalance.toFixed(2),
    platformPending: revenue.pendingBalance.toFixed(2),
    platformRevenue: revenue.availableBalance.toFixed(2),
  };
}

/** What THIS contract still has pending, per party — the rows carrying its transaction id. */
async function contractPending(m: Mods, f: Fixture) {
  const ids = [
    (await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId)).id,
    f.parties.gymId ? (await m.wallet.getOrCreateWallet('GYM', f.parties.gymId)).id : null,
    (await m.wallet.getRevenueWallet()).id,
    (await m.wallet.getOrCreateWallet('CLIENT', f.parties.clientUserId)).id,
  ] as const;
  return m.wallet.withWallets(ids.filter((x): x is string => !!x), f.txnId, async (ops) => {
    const get = async (id: string | null) => (id ? (await m.ledger.ownPending(ops, id, f.txnId)) : new m.Prisma.Decimal(0));
    const pt = await get(ids[0]);
    const gym = await get(ids[1]);
    const platform = await get(ids[2]);
    return { pt: pt.toFixed(2), gym: gym.toFixed(2), platform: platform.toFixed(2), total: pt.plus(gym).plus(platform).toFixed(2) };
  });
}

/** The contract's own PENDING rows, as stable text — to prove a neighbour was not touched. */
async function pendingRows(m: Mods, transactionId: string): Promise<string[]> {
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { transactionId }, orderBy: { createdAt: 'asc' }, include: { wallet: true } });
  return rows.map((r) => `${r.wallet.ownerType}/${r.wallet.ownerId} ${r.entryType} ${r.bucket} ${r.amount.toFixed(2)} ${r.description}`);
}

async function assertBooksReconcile(m: Mods, context: string) {
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.drift, '0.00', `${context}: no drift`);
  assert.equal(report.negativeWallets.length, 0, `${context}: no negative wallet`);

  const mismatched = await m.prisma.$queryRawUnsafe<{ id: string }[]>(`
    SELECT w.id
      FROM wallets w
      CROSS JOIN (VALUES ('PENDING'), ('AVAILABLE'), ('LOCKED'), ('HOLDBACK')) AS b(bucket)
      LEFT JOIN wallet_ledger_entries e ON e.wallet_id = w.id AND e.bucket::text = b.bucket
     GROUP BY w.id, b.bucket, w.pending_balance, w.available_balance, w.locked_balance, w.holdback_balance
    HAVING COALESCE(SUM(CASE WHEN e.entry_type::text = 'CREDIT' THEN e.amount ELSE -e.amount END), 0)
           <> CASE b.bucket WHEN 'PENDING' THEN w.pending_balance
                            WHEN 'LOCKED' THEN w.locked_balance
                            WHEN 'HOLDBACK' THEN w.holdback_balance
                            ELSE w.available_balance END`);
  assert.equal(mismatched.length, 0, `${context}: every bucket balance is fully explained by its ledger rows`);

  const fractional = await m.prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT (SELECT COUNT(*) FROM wallet_ledger_entries WHERE amount <> TRUNC(amount))
         + (SELECT COUNT(*) FROM wallets WHERE pending_balance <> TRUNC(pending_balance)
                                            OR available_balance <> TRUNC(available_balance)
                                            OR locked_balance <> TRUNC(locked_balance)
                                            OR holdback_balance <> TRUNC(holdback_balance)) AS n`);
  assert.equal(Number(fractional[0].n), 0, `${context}: every amount is a whole number of đồng`);
}

async function withServer<T>(fn: (post: (path: string, body: unknown) => Promise<{ status: number; json: any }>) => Promise<T>): Promise<T> {
  const express = (await import('express')).default;
  const router = (await import('../routes/internal.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/internal', router);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-secret': process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  try {
    return await fn(post);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const dec = (m: Mods, v: string | number) => new m.Prisma.Decimal(v);

// ── 1. The worked example, every balance at every step ───────────────────────

test('worked example: 5.000.000 / 10 / 0.90-0.10-0, 4 used, 1 awaiting confirmation, 1 disputed — exit, then DELIVERED, then NOT_DELIVERED', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
  await deliver(m, f, 4);
  const before = await balances(m, f);
  assert.deepEqual([before.ptPending, before.ptAvailable, before.platformPending, before.platformRevenue, before.escrow],
    ['2700000.00', '1800000.00', '300000.00', '200000.00', '5000000.00']);
  await assertBooksReconcile(m, 'before the exit');

  const exit = await m.ledger.terminateContract(terminateParams(m, f, EXIT, 2));
  assert.equal(exit.refund, '2000000.00', 'only the 4 sessions certainly not delivered are refunded');
  assert.deepEqual(exit.unresolved, { sessions: 2, amountHeld: '1000000.00', byParty: { pt: '900000.00', gym: '0.00', platform: '100000.00' } });
  assert.deepEqual(exit.topUp, { pt: '0.00', gym: '0.00', platform: '0.00' }, 'the 4 delivered sessions were already paid');
  assert.deepEqual(exit.entitlement, { pt: '1800000.00', gym: '0.00', platform: '200000.00' });
  assert.equal(exit.returnedToEscrow, '2000000.00', 'only the refund is drained');
  assert.equal(exit.shortfall, '0.00');
  const afterExit = await balances(m, f);
  assert.deepEqual(afterExit, {
    ptPending: '900000.00', ptHoldback: '0.00', ptAvailable: '1800000.00', gymPending: '0.00', gymAvailable: '0.00',
    clientAvailable: '2000000.00', escrow: '5000000.00', platformPending: '100000.00', platformRevenue: '200000.00',
  });
  assert.deepEqual(await contractPending(m, f), { pt: '900000.00', gym: '0.00', platform: '100000.00', total: '1000000.00' });
  await assertBooksReconcile(m, 'after the exit');

  const delivered = await m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'A', 'DELIVERED'));
  assert.deepEqual(delivered, {
    outcome: 'DELIVERED', unit: '500000.00', moved: { pt: '450000.00', gym: '0.00', platform: '50000.00', client: '0.00' }, shortfall: '0.00',
  });
  assert.deepEqual(await balances(m, f), {
    ptPending: '450000.00', ptHoldback: '0.00', ptAvailable: '2250000.00', gymPending: '0.00', gymAvailable: '0.00',
    clientAvailable: '2000000.00', escrow: '5000000.00', platformPending: '50000.00', platformRevenue: '250000.00',
  });
  await assertBooksReconcile(m, 'after DELIVERED');

  const notDelivered = await m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'B', 'NOT_DELIVERED'));
  assert.deepEqual(notDelivered, {
    outcome: 'NOT_DELIVERED', unit: '500000.00', moved: { pt: '450000.00', gym: '0.00', platform: '50000.00', client: '500000.00' }, shortfall: '0.00',
  });
  assert.deepEqual(await balances(m, f), {
    ptPending: '0.00', ptHoldback: '0.00', ptAvailable: '2250000.00', gymPending: '0.00', gymAvailable: '0.00',
    clientAvailable: '2500000.00', escrow: '5000000.00', platformPending: '0.00', platformRevenue: '250000.00',
  });
  assert.deepEqual(await contractPending(m, f), { pt: '0.00', gym: '0.00', platform: '0.00', total: '0.00' }, 'nothing is left in this contract’s pending');
  await assertBooksReconcile(m, 'after NOT_DELIVERED');

  // The same contract with the two sessions classified from the start: 5 used, 5 unused.
  await resetLedger(m);
  const g = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
  await deliver(m, g, 5);
  await m.ledger.terminateContract(terminateParams(m, g, EXIT));
  const direct = await balances(m, g);
  assert.equal(direct.clientAvailable, '2500000.00');
  assert.equal(direct.ptAvailable, '2250000.00');
  assert.equal(direct.platformRevenue, '250000.00');
});

// ── 2. Endings with nothing unresolved are untouched ─────────────────────────

for (const reason of ALL_REASONS) {
  test(`${reason}: unresolvedSessions 0 posts exactly what leaving it out posts — result, wallets, ledger rows, no marker`, skipOpts, async () => {
    const m = await load();
    const run = async (variant: 'absent' | 'zero') => {
      await resetLedger(m);
      const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, withGym: true, h: '0.10' });
      await deliver(m, f, 3);
      await noShow(m, f);
      const result = await m.ledger.terminateContract(terminateParams(m, f, reason, variant === 'zero' ? 0 : undefined));
      // Each run builds its own contract, so its ids differ by a random suffix: blank those out,
      // and compare only what was posted.
      const idsToBlank: Array<[string, string]> = [
        [f.contractId, 'C'], [f.parties.ptUserId, 'PT'], [f.parties.gymId ?? '', 'GYM'], [f.parties.clientUserId, 'CLIENT'],
      ];
      const rows = (await pendingRows(m, f.txnId)).map((r) => idsToBlank.reduce((text, [id, token]) => (id ? text.split(id).join(token) : text), r));
      return { result, rows, bal: await balances(m, f), zeroRows: await m.prisma.walletLedgerEntry.count({ where: { transactionId: f.txnId, amount: 0 } }) };
    };
    const absent = await run('absent');
    const zero = await run('zero');
    assert.deepEqual(zero.result, absent.result);
    assert.deepEqual(zero.rows, absent.rows);
    assert.deepEqual(zero.bal, absent.bal);
    assert.ok(!('unresolved' in absent.result), 'no unresolved block at all');
    assert.equal(zero.zeroRows, 0, 'no marker row');
    assert.equal(absent.zeroRows, 0);
    await assertBooksReconcile(m, reason);
  });
}

// ── 3. Conservation after the exit, for every reason and several shapes ──────

const SHAPES: Array<{ name: string; price: number; sessions: number; withGym: boolean; h?: string; taught: number; noShows: number; unresolved: number }> = [
  { name: 'plain', price: 5_000_000, sessions: 10, withGym: false, taught: 4, noShows: 0, unresolved: 2 },
  { name: 'gym + holdback + a compensated no-show', price: 5_000_000, sessions: 10, withGym: true, h: '0.10', taught: 3, noShows: 1, unresolved: 3 },
  { name: 'awkward rounding, gym', price: 1_000_003, sessions: 3, withGym: true, taught: 1, noShows: 0, unresolved: 1 },
  { name: 'nothing taught yet', price: 5_000_000, sessions: 10, withGym: false, h: '0.10', taught: 0, noShows: 0, unresolved: 2 },
  { name: 'everything unresolved', price: 2_000_000, sessions: 4, withGym: true, taught: 0, noShows: 0, unresolved: 4 },
];

for (const shape of SHAPES) {
  for (const reason of ALL_REASONS) {
    test(`conservation [${shape.name}] ${reason}: refund + paid out + held = price − compensation; the held value is exactly what is left in this contract’s pending`, skipOpts, async () => {
      const m = await load();
      await resetLedger(m);
      const f = await paidContract(m, { price: shape.price, totalSessions: shape.sessions, withGym: shape.withGym, h: shape.h });
      await deliver(m, f, shape.taught);
      for (let i = 0; i < shape.noShows; i++) await noShow(m, f);
      const result = await m.ledger.terminateContract(terminateParams(m, f, reason, shape.unresolved));
      const ctx = `${shape.name} ${reason}`;

      const b = await balances(m, f);
      const held = await contractPending(m, f);
      assert.equal(result.unresolved?.sessions, shape.unresolved, ctx);
      assert.equal(held.total, result.unresolved!.amountHeld, `${ctx}: pending left == reported held amount`);
      assert.deepEqual({ pt: held.pt, gym: held.gym, platform: held.platform }, result.unresolved!.byParty, ctx);
      const unit = shape.price / shape.sessions;
      const idealHeld = Math.floor(unit) * shape.unresolved;
      assert.ok(Number(held.total) <= idealHeld && Number(held.total) >= idealHeld - 2, `${ctx}: held ${held.total} is n × floor(P/N) = ${idealHeld} (a sub-đồng corner may trim a đồng or two)`);

      // everything the price became is somewhere explained: client + parties' available +
      // everything still pending (wallets hold nothing else in this fixture)
      const everything = ['clientAvailable', 'ptAvailable', 'ptHoldback', 'gymAvailable', 'platformRevenue', 'ptPending', 'gymPending', 'platformPending']
        .reduce((sum, k) => sum.plus((b as Record<string, string>)[k]), dec(m, 0));
      assert.equal(everything.toFixed(2), shape.price.toFixed(2), `${ctx}: nothing created, nothing lost`);
      assert.equal(b.escrow, shape.price.toFixed(2), `${ctx}: escrow only moves on a real payout`);

      // the refund really credited to the client is the refund reported — and was computed on
      // the sessions certainly not delivered only
      const ceiling = dec(m, shape.price).mul(shape.sessions - shape.taught - shape.noShows - shape.unresolved).div(shape.sessions).toDecimalPlaces(0, m.Prisma.Decimal.ROUND_UP);
      assert.ok(dec(m, result.refund).lessThanOrEqualTo(ceiling), `${ctx}: refund ${result.refund} never above the certainly-undelivered value ${ceiling}`);
      await assertBooksReconcile(m, ctx);
    });
  }
}

// ── 4. After every session is resolved the books equal "classified from the start" ──

type Resolution = 'DELIVERED' | 'NOT_DELIVERED';

async function viaUnresolved(m: Mods, o: { price: number; sessions: number; withGym: boolean; h?: string; taught: number; reason: Reason; outcomes: Resolution[] }) {
  await resetLedger(m);
  const f = await paidContract(m, { price: o.price, totalSessions: o.sessions, withGym: o.withGym, h: o.h });
  await deliver(m, f, o.taught);
  const exit = await m.ledger.terminateContract(terminateParams(m, f, o.reason, o.outcomes.length));
  await assertBooksReconcile(m, `after exit ${o.reason}`);
  const steps: Array<Awaited<ReturnType<typeof m.ledger.resolveUnresolvedSession>>> = [];
  for (const [i, outcome] of o.outcomes.entries()) {
    steps.push(await m.ledger.resolveUnresolvedSession(resolveParams(m, f, `S${i}`, outcome)));
    await assertBooksReconcile(m, `after resolving ${i} as ${outcome}`);
  }
  // FH-9: once every held session is decided the contract is reconciled and the sweep releases whatever stayed held for them.
  await m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` });
  await assertBooksReconcile(m, `after the holdback release ${o.reason}`);
  return { f, exit, steps, bal: await balances(m, f), pending: await contractPending(m, f) };
}

async function classifiedFromStart(m: Mods, o: { price: number; sessions: number; withGym: boolean; h?: string; taught: number; reason: Reason }) {
  await resetLedger(m);
  const f = await paidContract(m, { price: o.price, totalSessions: o.sessions, withGym: o.withGym, h: o.h });
  await deliver(m, f, o.taught);
  await m.ledger.terminateContract(terminateParams(m, f, o.reason));
  await assertBooksReconcile(m, `classified ${o.reason}`);
  return { f, bal: await balances(m, f) };
}

const FINAL_KEYS = ['clientAvailable', 'ptAvailable', 'ptHoldback', 'gymAvailable', 'platformRevenue', 'ptPending', 'gymPending', 'platformPending', 'escrow'] as const;

for (const withGym of [false, true]) {
  for (const h of [undefined, '0.10']) {
    for (const reason of ALL_REASONS) {
      test(`all unresolved sessions DELIVERED later == those sessions confirmed before the exit (${reason}${withGym ? ', gym' : ''}${h ? ', holdback' : ''})`, skipOpts, async () => {
        const m = await load();
        const shape = { price: 5_000_000, sessions: 10, withGym, h, taught: 4, reason };
        const later = await viaUnresolved(m, { ...shape, outcomes: ['DELIVERED', 'DELIVERED'] });
        const laterBal = later.bal;
        const direct = await classifiedFromStart(m, { ...shape, taught: 6 });
        for (const k of FINAL_KEYS) assert.equal(laterBal[k], direct.bal[k], `${k}`);
        assert.deepEqual(later.pending, { pt: '0.00', gym: '0.00', platform: '0.00', total: '0.00' });
      });
    }
  }
}

for (const withGym of [false, true]) {
  for (const h of [undefined, '0.10']) {
    for (const reason of [EXIT, 'MUTUAL'] as Reason[]) {
      for (const outcomes of [['NOT_DELIVERED', 'NOT_DELIVERED'], ['DELIVERED', 'NOT_DELIVERED'], ['NOT_DELIVERED', 'DELIVERED']] as Resolution[][]) {
        const delivered = outcomes.filter((o) => o === 'DELIVERED').length;
        test(`unresolved resolved ${outcomes.join('+')} == the same sessions classified from the start (${reason}${withGym ? ', gym' : ''}${h ? ', holdback' : ''})`, skipOpts, async () => {
          const m = await load();
          const shape = { price: 5_000_000, sessions: 10, withGym, h, taught: 4, reason };
          const later = await viaUnresolved(m, { ...shape, outcomes });
          const laterBal = later.bal;
          const direct = await classifiedFromStart(m, { ...shape, taught: 4 + delivered });
          for (const k of FINAL_KEYS) assert.equal(laterBal[k], direct.bal[k], `${k}`);
          assert.deepEqual(later.pending, { pt: '0.00', gym: '0.00', platform: '0.00', total: '0.00' });
        });
      }
    }
  }
}

test('rounding: 1.000.003 over 3 sessions with a gym — whole đồng at every step; DELIVERED is exact, NOT_DELIVERED is at most one đồng per session below "unused from the start"', skipOpts, async () => {
  const m = await load();
  const shape = { price: 1_000_003, sessions: 3, withGym: true, taught: 1, reason: EXIT };

  const delivered = await viaUnresolved(m, { ...shape, outcomes: ['DELIVERED'] });
  const deliveredBal = delivered.bal;
  const directUsed = await classifiedFromStart(m, { ...shape, taught: 2 });
  for (const k of FINAL_KEYS) assert.equal(deliveredBal[k], directUsed.bal[k], `delivered ${k}`);

  const notDelivered = await viaUnresolved(m, { ...shape, outcomes: ['NOT_DELIVERED'] });
  const notBal = notDelivered.bal;
  const directUnused = await classifiedFromStart(m, { ...shape, taught: 1 });
  const gap = dec(m, directUnused.bal.clientAvailable).minus(notBal.clientAvailable);
  assert.ok(gap.greaterThanOrEqualTo(0) && gap.lessThanOrEqualTo(1), `the client is at most 1 đồng below the from-the-start refund (gap ${gap})`);
  // the missing đồng is not lost: it is in the parties' totals, and the books balance
  const sum = (b: typeof notBal) => ['clientAvailable', 'ptAvailable', 'gymAvailable', 'platformRevenue'].reduce((s, k) => s.plus((b as Record<string, string>)[k]), dec(m, 0));
  assert.equal(sum(notBal).toFixed(2), '1000003.00');
  assert.equal(sum(directUnused.bal).toFixed(2), '1000003.00');
  // and the unit really is floor(P/N) with the platform taking the split remainder
  assert.equal(notDelivered.steps[0].unit, '333334.00');
});

// ── 5. Holdback interplay ────────────────────────────────────────────────────

test('holdback, non-fault exit with unresolved sessions: the sessions’ value is held in PENDING, which secures the client refund, so NO holdback is kept for them — the whole hold goes back to the PT at the ending (Decision 2)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 3);
  const mid = await balances(m, f);
  assert.equal(mid.ptAvailable, '900000.00', '3 × 450.000 less the 450.000 hold');
  assert.equal(mid.ptHoldback, '450000.00');

  const exit = await m.ledger.terminateContract(terminateParams(m, f, EXIT, 2));
  assert.equal(exit.refund, '2500000.00');
  assert.equal(exit.ptHoldback?.held, '450000.00');
  assert.equal(exit.ptHoldback?.compensation, '0.00');
  assert.equal(exit.ptHoldback?.stillHeld, '0.00', 'the two undecided sessions are already secured by the pending of this contract');
  assert.deepEqual(exit.ptHoldback?.reserves, []);
  assert.equal(exit.ptHoldback?.returnedToPt, '450000.00');
  assert.equal(exit.topUp.pt, '0.00', 'not a đồng of the unresolved sessions is topped up');
  assert.equal(exit.unresolved?.byParty.pt, '900000.00');
  const b = await balances(m, f);
  assert.equal(b.ptAvailable, '1350000.00');
  assert.equal(b.ptPending, '900000.00', 'the unresolved PT shares stay in pending');
  assert.equal(b.ptHoldback, '0.00');
  assert.equal(await m.prisma.ptHoldbackReview.count({ where: { transactionId: f.txnId } }), 0, 'no reserve, no review');

  const sweep = () => m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` });
  const early = await sweep();
  assert.equal(early.released, '0.00', 'nothing left to release');
  assert.equal(early.reconciled, true);
  assert.deepEqual(await balances(m, f), b, 'and nothing moved');

  // DELIVERED pays the PT in full: no holdback is applied again to a contract that is over
  const r = await m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'A', 'DELIVERED'));
  assert.equal(r.moved.pt, '450000.00');
  await m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'B', 'DELIVERED'));
  const end = await balances(m, f);
  assert.equal(end.ptAvailable, '2250000.00', '5 × 450.000: what five confirmed sessions give a PT whose hold was returned');
  assert.equal(end.ptPending, '0.00');
  assert.equal(end.ptHoldback, '0.00');
  await assertBooksReconcile(m, 'holdback non-fault');
});

test('holdback, PT-fault exit with unresolved sessions: the potential PT-fault amount is reserved (10% × the certainly-undelivered sessions), nothing is paid until verified; the unresolved PT share in pending is not touched', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 3);
  const exit = await m.ledger.terminateContract(terminateParams(m, f, 'PT_CANCELLED', 2));
  assert.equal(exit.refund, '2500000.00');
  assert.equal(exit.ptHoldback?.compensation, '0.00', 'nothing automatic');
  assert.equal(exit.ptHoldback?.stillHeld, '250000.00', '10% × 2.500.000 — not × 3.500.000');
  assert.equal(exit.ptHoldback?.returnedToPt, '200000.00');
  assert.equal(exit.topUp.pt, '0.00');
  const b = await balances(m, f);
  assert.equal(b.ptPending, '900000.00', 'the 2 unresolved PT shares are intact');
  assert.equal(b.clientAvailable, '2500000.00', 'refund only');
  assert.equal(b.ptAvailable, '1100000.00');
  assert.equal(b.ptHoldback, '250000.00');
  await assertBooksReconcile(m, 'holdback PT fault');

  const early = await m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` });
  assert.equal(early.released, '0.00', 'the PT-fault review is open: the sweep never decides it');
  assert.equal(early.reconciled, false);
  assert.equal(early.blockedBy?.openReviews[0]?.kind, 'PT_FAULT');
  assert.equal((await balances(m, f)).ptPending, '900000.00');
});

test('the holdback release on a contract that is terminated with nothing unresolved moves nothing more (the ending already returned the hold)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 3);
  await m.ledger.terminateContract(terminateParams(m, f, EXIT));
  const before = await balances(m, f);
  const rel = await m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` });
  assert.equal(rel.released, '0.00');
  assert.equal(rel.reconciled, true);
  assert.deepEqual(await balances(m, f), before);
});

// ── 6. Resolve: idempotency, the one-way rule, guards ────────────────────────

async function exited(m: Mods, n = 2, opts: { withGym?: boolean; price?: number; sessions?: number; ptUserId?: string; gymId?: string } = {}) {
  const f = await paidContract(m, { price: opts.price ?? 5_000_000, totalSessions: opts.sessions ?? 10, withGym: opts.withGym, ptUserId: opts.ptUserId, gymId: opts.gymId });
  await deliver(m, f, 4);
  await m.ledger.terminateContract(terminateParams(m, f, EXIT, n));
  return f;
}

test('resolve is idempotent: the same session, same key replays; the OTHER outcome is refused (FH-2b: 409 conflict, was a silent replay of the first result) and posts nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await exited(m);
  const first = await m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'A', 'NOT_DELIVERED'));
  const bal = await balances(m, f);
  const rows = (await pendingRows(m, f.txnId)).length;

  const replay = await m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'A', 'NOT_DELIVERED'));
  assert.deepEqual(replay, first);
  await assert.rejects(
    () => m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'A', 'DELIVERED')),
    (e: any) => e.code === 'IDEMPOTENCY_KEY_CONFLICT',
    'the other outcome is a conflict, not a silent answer with the first outcome',
  );
  assert.equal(first.outcome, 'NOT_DELIVERED');
  assert.deepEqual(await balances(m, f), bal, 'no money moved');
  assert.equal((await pendingRows(m, f.txnId)).length, rows, 'no ledger row written');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: `UNRESOLVED_SESSION:${f.contractId}:A` } }), 1);

  // and concurrently
  const raced = await Promise.allSettled([
    m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'B', 'DELIVERED')),
    m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'B', 'NOT_DELIVERED')),
  ]);
  assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1, 'racing outcomes for one session: exactly one wins');
  const lost = raced.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal(lost.reason.code, 'IDEMPOTENCY_KEY_CONFLICT', 'and the loser is told it conflicted');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: `UNRESOLVED_SESSION:${f.contractId}:B` } }), 1);
  await assertBooksReconcile(m, 'resolve idempotency');
});

test('resolve refuses what the termination did not leave open — nothing moves', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);

  // 1. an active contract that was never terminated
  const active = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
  await deliver(m, active, 2);
  const activeBefore = await balances(m, active);
  await assert.rejects(() => m.ledger.resolveUnresolvedSession(resolveParams(m, active, 'A', 'NOT_DELIVERED')), (e: any) => e.code === 'NO_UNRESOLVED_HELD');
  assert.deepEqual(await balances(m, active), activeBefore, 'an active contract’s pending is out of reach');

  // 2. a contract terminated with nothing unresolved
  const clean = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
  await deliver(m, clean, 2);
  await m.ledger.terminateContract(terminateParams(m, clean, EXIT));
  await assert.rejects(() => m.ledger.resolveUnresolvedSession(resolveParams(m, clean, 'A', 'DELIVERED')), (e: any) => e.code === 'NO_UNRESOLVED_HELD');

  // 3. more sessions than the termination left open
  const f = await exited(m, 2);
  await m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'A', 'DELIVERED'));
  await m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'B', 'DELIVERED'));
  const done = await balances(m, f);
  await assert.rejects(() => m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'C', 'DELIVERED')), (e: any) => e.code === 'ALL_UNRESOLVED_RESOLVED');
  assert.deepEqual(await balances(m, f), done);
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: `UNRESOLVED_SESSION:${f.contractId}:C` } }), 0, 'a refusal is not remembered as a result');
  await assertBooksReconcile(m, 'resolve guards');
});

test('resolve only ever touches this contract’s own pending — a neighbour of the same PT and gym keeps every đồng; a shortfall is reported, never invented', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const pt = `pt-shared-${randomUUID().slice(0, 6)}`;
  const gym = `gym-shared-${randomUUID().slice(0, 6)}`;
  const neighbour = await paidContract(m, { price: 8_000_000, totalSessions: 8, withGym: true, ptUserId: pt, gymId: gym });
  await deliver(m, neighbour, 1);
  const f = await exited(m, 2, { withGym: true, ptUserId: pt, gymId: gym });
  const neighbourBefore = await pendingRows(m, neighbour.txnId);
  const neighbourPending = await contractPending(m, neighbour);

  // A request that claims a bigger session than was held (price 20.000.000 over 10 sessions = 2.000.000 per
  // session; the contract holds 500.000 each). Before FH-2b the ledger clamped it to what the contract had and
  // reported a shortfall; now it never gets that far: the price disagrees with the payment transaction's own
  // amount, so it is refused (422) and nothing moves at all.
  await assert.rejects(
    () => m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'A', 'NOT_DELIVERED', { price: dec(m, 20_000_000) })),
    (e: any) => e.code === 'REQUEST_DOES_NOT_MATCH_TRANSACTION',
  );
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: `UNRESOLVED_SESSION:${f.contractId}:A` } }), 0, 'a refusal is not remembered');

  assert.deepEqual(await pendingRows(m, neighbour.txnId), neighbourBefore, 'the neighbour’s ledger rows are untouched');
  assert.deepEqual(await contractPending(m, neighbour), neighbourPending, 'and so is its pending');
  await assertBooksReconcile(m, 'resolve isolation');
});

test('DELIVERED pays the PT the session in full: an old PartnerReceivable is not deducted (owner decision - no automatic recovery)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await exited(m, 1);
  const debt = await m.prisma.partnerReceivable.create({ data: { partnerType: 'PT', partnerId: f.parties.ptUserId, amount: 100_000, reason: 'earlier shortfall', transactionId: f.txnId } });
  const before = await balances(m, f);
  const r = await m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'A', 'DELIVERED'));
  assert.equal(r.moved.pt, '450000.00', 'the session’s share moved to available…');
  const after = await balances(m, f);
  assert.equal(dec(m, after.ptAvailable).minus(before.ptAvailable).toFixed(2), '450000.00', '…and all of it reached the PT');
  const row = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } });
  assert.equal(row.recovered.toFixed(2), '0.00');
  assert.equal(row.settledAt, null);
  assert.equal(dec(m, after.platformRevenue).minus(before.platformRevenue).toFixed(2), '50000.00', 'platform: only its own 50.000 share');
  await assertBooksReconcile(m, 'receivable not recovered');
});

test('NOT_DELIVERED credits the client in one clearly worded row that counts as withdrawable', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await exited(m, 2);
  const client = await m.wallet.getOrCreateWallet('CLIENT', f.parties.clientUserId);
  const refundBefore = await m.withdrawals.sumRefundSourcedCredits(client.id);
  assert.equal(refundBefore.toFixed(2), '2000000.00');
  await m.ledger.resolveUnresolvedSession(resolveParams(m, f, 'A', 'NOT_DELIVERED'));
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { walletId: client.id, description: { contains: 'unresolved session not delivered' } } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entryType, 'CREDIT');
  assert.equal(rows[0].bucket, 'AVAILABLE');
  assert.equal(rows[0].amount.toFixed(2), '500000.00');
  assert.match(rows[0].description ?? '', /refund/i);
  assert.equal((await m.withdrawals.sumRefundSourcedCredits(client.id)).toFixed(2), '2500000.00');
  const escrowRows = await m.prisma.walletLedgerEntry.count({ where: { transactionId: f.txnId, description: { contains: 'unresolved' }, wallet: { ownerId: 'ESCROW' } } });
  assert.equal(escrowRows, 0, 'escrow is never posted to');
});

// ── 7. Replay and validation of the termination itself ───────────────────────

test('terminate with unresolved sessions replays: same result, no further rows, one refund', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 4);
  const params = terminateParams(m, f, EXIT, 2);
  const first = await m.ledger.terminateContract(params);
  const rows = (await pendingRows(m, f.txnId)).length;
  const bal = await balances(m, f);
  const second = await m.ledger.terminateContract(params);
  assert.deepEqual(second, first);
  assert.equal((await pendingRows(m, f.txnId)).length, rows);
  assert.deepEqual(await balances(m, f), bal);
  assert.equal(bal.clientAvailable, first.refund);
});

test('an impossible unresolved count is refused before any money moves (function level)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
  await deliver(m, f, 4);
  await noShow(m, f);
  const rows = await m.prisma.walletLedgerEntry.count();
  for (const bad of [6, 7, -1, 1.5]) {
    await assert.rejects(() => m.ledger.terminateContract(terminateParams(m, f, EXIT, bad)), (e: unknown) => e instanceof Error, `n=${bad}`);
  }
  assert.equal(await m.prisma.walletLedgerEntry.count(), rows, 'no ledger row was written');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: `CONTRACT_TERMINATE:${f.contractId}` } }), 0, 'and the key is still free');
  const ok = await m.ledger.terminateContract(terminateParams(m, f, EXIT, 5));
  assert.equal(ok.unresolved?.sessions, 5, 'exactly the room left (10 − 4 − 1) is accepted');
  assert.equal(ok.refund, '0.00');
});

// ── 8. The HTTP endpoints, and the preview against the real termination ──────

test('POST /internal/contracts/terminate: unresolvedSessions is bounded (400), accepted at the bound, and reported', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  await withServer(async (post) => {
    const f = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
    await deliver(m, f, 4);
    const body = (over: Record<string, unknown> = {}) => ({
      transactionId: f.txnId, price: '5000000', totalSessions: 10, usedSessions: 4, compensatedSessions: 1,
      rates: { platformRate: '0.10', ptRate: '0.90', gymRate: '0' }, parties: f.parties,
      reason: EXIT, label: `${f.contractId} termination`, idempotencyKey: `CONTRACT_TERMINATE:${f.contractId}`,
      alreadyReleased: { pt: f.releasedTo.pt.toString(), gym: '0', platform: f.releasedTo.platform.toString() },
      ...over,
    });
    const rows = await m.prisma.walletLedgerEntry.count();
    for (const bad of [6, -1, 1.5, '1', null]) {
      const r = await post('/contracts/terminate', body({ unresolvedSessions: bad }));
      assert.equal(r.status, 400, `unresolvedSessions=${JSON.stringify(bad)}`);
      assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    }
    assert.equal(await m.prisma.walletLedgerEntry.count(), rows, 'nothing moved');
    // compensatedSessions 1 but no compensation was posted for it: this request is about the route’s
    // bound only, so use a consistent shape from here on
    const ok = await post('/contracts/terminate', body({ compensatedSessions: 0, unresolvedSessions: 2 }));
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.refund, '2000000.00');
    assert.deepEqual(ok.json.data.unresolved, { sessions: 2, amountHeld: '1000000.00', byParty: { pt: '900000.00', gym: '0.00', platform: '100000.00' } });
    const replay = await post('/contracts/terminate', body({ compensatedSessions: 0, unresolvedSessions: 2 }));
    assert.deepEqual(replay.json.data, ok.json.data);
  });
});

test('POST /internal/contracts/resolve-unresolved-session: shapes, validation, 409 mapping', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  await withServer(async (post) => {
    const f = await exited(m, 1);
    const body = (over: Record<string, unknown> = {}) => ({
      transactionId: f.txnId, price: '5000000', totalSessions: 10,
      rates: { platformRate: '0.10', ptRate: '0.90', gymRate: '0' }, parties: f.parties,
      label: `${f.contractId} unresolved`, idempotencyKey: `UNRESOLVED_SESSION:${f.contractId}:HTTP`,
      outcome: 'NOT_DELIVERED', ...over,
    });
    for (const bad of [{ outcome: 'MAYBE' }, { outcome: undefined }, { idempotencyKey: '' }, { ptHoldbackRate: '1.5' }]) {
      const r = await post('/contracts/resolve-unresolved-session', body(bad));
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    const ok = await post('/contracts/resolve-unresolved-session', body());
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.data, {
      outcome: 'NOT_DELIVERED', unit: '500000.00', moved: { pt: '450000.00', gym: '0.00', platform: '50000.00', client: '500000.00' }, shortfall: '0.00',
    });
    const same = await post('/contracts/resolve-unresolved-session', body());
    assert.equal(same.status, 200);
    assert.deepEqual(same.json.data, ok.json.data, 'the identical request replays the first result');
    const flipped = await post('/contracts/resolve-unresolved-session', body({ outcome: 'DELIVERED' }));
    assert.equal(flipped.status, 409, 'the other outcome is a conflict (FH-2b)');
    assert.equal(flipped.json.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
    const tooMany = await post('/contracts/resolve-unresolved-session', body({ idempotencyKey: `UNRESOLVED_SESSION:${f.contractId}:EXTRA` }));
    assert.equal(tooMany.status, 409);
    assert.equal(tooMany.json.error.code, 'ALL_UNRESOLVED_RESOLVED');
    await assertBooksReconcile(m, 'resolve endpoint');
  });
});

const PREVIEW_SHAPES: Array<{ price: number; sessions: number; withGym: boolean; h?: string; taught: number; noShows: number; unresolved: number }> = [
  { price: 5_000_000, sessions: 10, withGym: false, taught: 4, noShows: 0, unresolved: 2 },
  { price: 5_000_000, sessions: 10, withGym: true, h: '0.10', taught: 3, noShows: 1, unresolved: 3 },
  { price: 1_000_003, sessions: 3, withGym: true, taught: 1, noShows: 0, unresolved: 1 },
  { price: 5_000_000, sessions: 10, withGym: false, taught: 0, noShows: 0, unresolved: 0 },
  { price: 5_000_000, sessions: 10, withGym: false, taught: 10, noShows: 0, unresolved: 0 },
];

for (const shape of PREVIEW_SHAPES) {
  for (const reason of ALL_REASONS) {
    test(`preview == real termination, over HTTP [${shape.price}/${shape.sessions} taught ${shape.taught} noShows ${shape.noShows} unresolved ${shape.unresolved}${shape.withGym ? ' gym' : ''}${shape.h ? ' h' : ''}] ${reason}`, skipOpts, async () => {
      const m = await load();
      await resetLedger(m);
      await withServer(async (post) => {
        const f = await paidContract(m, { price: shape.price, totalSessions: shape.sessions, withGym: shape.withGym, h: shape.h });
        await deliver(m, f, shape.taught);
        for (let i = 0; i < shape.noShows; i++) await noShow(m, f);

        const rates = { platformRate: f.rates.platformRate.toString(), ptRate: f.rates.ptRate.toString(), gymRate: f.rates.gymRate.toString() };
        const preview = await post('/contracts/money-breakdown', {
          price: String(shape.price), totalSessions: shape.sessions, usedSessions: shape.taught, compensatedSessions: shape.noShows,
          ...(shape.unresolved > 0 ? { unresolvedSessions: shape.unresolved } : {}), reason, rates,
        });
        assert.equal(preview.status, 200);
        assert.equal(preview.json.data.reasonUsed, reason);

        const real = await post('/contracts/terminate', {
          transactionId: f.txnId, price: String(shape.price), totalSessions: shape.sessions, usedSessions: shape.taught, compensatedSessions: shape.noShows,
          ...(shape.unresolved > 0 ? { unresolvedSessions: shape.unresolved } : {}), rates, parties: f.parties, reason,
          label: `${f.contractId} termination`, idempotencyKey: `CONTRACT_TERMINATE:${f.contractId}`,
          alreadyReleased: { pt: f.releasedTo.pt.toString(), gym: f.releasedTo.gym.toString(), platform: f.releasedTo.platform.toString() },
          ...(shape.h ? { ptHoldbackRate: shape.h } : {}),
        });
        assert.equal(real.status, 200, JSON.stringify(real.json));
        assert.equal(preview.json.data.refundIfCancelledNow, real.json.data.refund, 'the preview’s refund is the refund that was posted');
        assert.equal(real.json.data.unpaid, '0.00', 'and none of it is left unpaid');

        const refundRows = await m.prisma.walletLedgerEntry.findMany({
          where: { transactionId: f.txnId, entryType: 'CREDIT', bucket: 'AVAILABLE', description: { contains: `refund (${reason})` } },
        });
        const credited = refundRows.reduce((s, r) => s.plus(r.amount), dec(m, 0));
        assert.equal(credited.toFixed(2), preview.json.data.refundIfCancelledNow, 'and it is what the client’s wallet actually received');

        if (shape.unresolved > 0) {
          assert.equal(preview.json.data.unresolvedAmountHeld, real.json.data.unresolved.amountHeld, 'the preview’s held amount is what stayed');
          assert.equal(preview.json.data.unresolvedSessions, shape.unresolved);
        } else {
          assert.ok(!('unresolvedAmountHeld' in preview.json.data));
        }
        await assertBooksReconcile(m, `preview ${reason}`);
      });
    });
  }
}

test('money-breakdown: no reason sent means CLIENT_CANCELLED as before; every old field is still there; a bad unresolved count or reason is a 400', skipOpts, async () => {
  const m = await load();
  await withServer(async (post) => {
    const base = { price: '1000000', totalSessions: 10, usedSessions: 3, rates: { platformRate: '0.10', ptRate: '0.90', gymRate: '0' } };
    const plain = await post('/contracts/money-breakdown', base);
    assert.equal(plain.status, 200);
    assert.equal(plain.json.data.reasonUsed, 'CLIENT_CANCELLED');
    assert.equal(plain.json.data.refundIfCancelledNow, '630000.00');
    for (const k of ['price', 'totalSessions', 'usedSessions', 'compensatedSessions', 'unit', 'remaining', 'rates', 'released', 'stillPending', 'refundIfCancelledNow']) {
      assert.ok(k in plain.json.data, k);
    }
    assert.ok(!('unresolvedAmountHeld' in plain.json.data));
    const exit = await post('/contracts/money-breakdown', { ...base, reason: EXIT, unresolvedSessions: 2 });
    assert.equal(exit.json.data.refundIfCancelledNow, '500000.00', '(10 − 3 − 2) × 100.000');
    assert.equal(exit.json.data.unresolvedAmountHeld, '200000.00');
    assert.equal((await post('/contracts/money-breakdown', { ...base, unresolvedSessions: 8 })).status, 400, '3 used + 8 > 10');
    assert.equal((await post('/contracts/money-breakdown', { ...base, unresolvedSessions: -1 })).status, 400);
    assert.equal((await post('/contracts/money-breakdown', { ...base, reason: 'SOMETHING_ELSE' })).status, 400);
    void m;
  });
});
