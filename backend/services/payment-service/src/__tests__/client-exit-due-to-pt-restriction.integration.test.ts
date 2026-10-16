/**
 * CLIENT_EXIT_DUE_TO_PT_RESTRICTION: the client leaves because the PT is administratively
 * suspended and cannot deliver. It is neither the client's choice to walk away nor proof of PT
 * fault, so it settles exactly like MUTUAL:
 *
 *   - the client gets 100% of the unused training value back (no cancellation fee);
 *   - nothing is taken out of the PT's held-back earnings (no compensation, no penalty, no
 *     receivable) — whatever is held for the PT on that contract goes back to the PT through the
 *     ordinary top-up, as it does for MUTUAL;
 *   - every party keeps what the delivered sessions earned;
 *   - the refund row names the reason, so a ledger reader can tell it from a MUTUAL refund, and
 *     it is still withdrawable (withdrawal.repository#sumRefundSourcedCredits matches "refund").
 *
 *   evidence label: BACKEND INTEGRATION (real ledger code and real express router against the
 *   isolated *_test database).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables, like its siblings):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/client-exit-due-to-pt-restriction.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard'; // D57-6-5 / D64: the database NAME must end with _test (the old /_test/i on the whole URL also matched the user name gymcoach_test)

const databaseUrl = process.env.DATABASE_URL || '';
const canUseIntegrationDb = isTestDatabaseUrl(databaseUrl);
const skipOpts = {
  skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
  walletMod: typeof import('../services/wallet.service');
  withdrawals: (typeof import('../repositories/withdrawal.repository'))['withdrawalRepository'];
};

let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    const walletMod = await import('../services/wallet.service');
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/contract-ledger.service'),
      reconcile: await import('../services/reconcile.service'),
      wallet: walletMod.walletService,
      walletMod,
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

/** A contract the client has paid for: escrow holds the price, the parties' pending the split. */
async function paidContract(
  m: Mods,
  opts: { price: number; totalSessions: number; withGym?: boolean; ptUserId?: string; h?: string },
): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const parties = {
    ptUserId: opts.ptUserId ?? `pt-${suffix}`,
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

/** Confirm `count` sessions the way user-service does: what comes back is added to releasedTo. */
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

/** A compensated PT no-show: the client is paid one session and the entitlement is consumed. */
async function noShow(m: Mods, f: Fixture) {
  const n = ++f.seq;
  await m.ledger.compensateNoShow({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: `${f.contractId} no-show ${n}`,
    idempotencyKey: `PT_NO_SHOW:${f.contractId}:${n}`,
  });
  f.compensatedSessions++;
}

function terminateParams(m: Mods, f: Fixture, reason: Reason) {
  return {
    transactionId: f.txnId,
    price: f.price,
    totalSessions: f.totalSessions,
    usedSessions: f.usedSessions,
    compensatedSessions: f.compensatedSessions,
    rates: f.rates,
    reason,
    alreadyReleased: f.releasedTo,
    parties: f.parties,
    label: `${f.contractId} termination`,
    idempotencyKey: `CONTRACT_TERMINATE:${f.contractId}`,
    ...holdbackArg(m, f),
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
    ptAvailable: pt.availableBalance.toFixed(2),
    ptLocked: pt.lockedBalance.toFixed(2),
    gymPending: gym?.pendingBalance.toFixed(2) ?? '0.00',
    gymAvailable: gym?.availableBalance.toFixed(2) ?? '0.00',
    clientAvailable: client.availableBalance.toFixed(2),
    escrow: escrow.availableBalance.toFixed(2),
    platformPending: revenue.pendingBalance.toFixed(2),
    platformRevenue: revenue.availableBalance.toFixed(2),
  };
}

async function heldNow(m: Mods, f: Fixture): Promise<string> {
  const pt = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  return m.wallet.withWallets([pt.id], f.txnId, async (ops) => (await m.ledger.ptHeld(ops, pt.id, f.txnId)).toFixed(2));
}

/** The termination's ledger rows as readable, sorted lines. */
async function postings(m: Mods, transactionId: string, contains = 'termination'): Promise<string[]> {
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { transactionId, description: { contains } }, include: { wallet: true } });
  return rows
    .map((r) => {
      const who = r.wallet.ownerType === 'PLATFORM' ? r.wallet.ownerId : r.wallet.ownerType;
      return `${who} ${r.entryType} ${r.bucket} ${r.amount.toFixed(2)} | ${r.description}`;
    })
    .sort();
}

/** Conservation: the system invariant, every bucket explained by its rows, whole đồng only. */
async function assertBooksReconcile(m: Mods, context: string) {
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.drift, '0.00', `${context}: no drift`);
  assert.equal(report.negativeWallets.length, 0, `${context}: no negative wallet`);

  const mismatched = await m.prisma.$queryRawUnsafe<{ id: string }[]>(`
    SELECT w.id
      FROM wallets w
      CROSS JOIN (VALUES ('PENDING'), ('AVAILABLE'), ('LOCKED')) AS b(bucket)
      LEFT JOIN wallet_ledger_entries e ON e.wallet_id = w.id AND e.bucket::text = b.bucket
     GROUP BY w.id, b.bucket, w.pending_balance, w.available_balance, w.locked_balance
    HAVING COALESCE(SUM(CASE WHEN e.entry_type::text = 'CREDIT' THEN e.amount ELSE -e.amount END), 0)
           <> CASE b.bucket WHEN 'PENDING' THEN w.pending_balance
                            WHEN 'LOCKED' THEN w.locked_balance
                            ELSE w.available_balance END`);
  assert.equal(mismatched.length, 0, `${context}: every bucket balance is fully explained by its ledger rows`);

  const fractional = await m.prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT (SELECT COUNT(*) FROM wallet_ledger_entries WHERE amount <> TRUNC(amount))
         + (SELECT COUNT(*) FROM wallets WHERE pending_balance <> TRUNC(pending_balance)
                                            OR available_balance <> TRUNC(available_balance)
                                            OR locked_balance <> TRUNC(locked_balance)) AS n`);
  assert.equal(Number(fractional[0].n), 0, `${context}: every amount is a whole number of đồng`);
}

/** A termination only reallocates claims on cash the platform already holds: escrow is never posted to, and it nets to zero. */
async function assertTerminationIsPureReallocation(m: Mods, transactionId: string, context: string) {
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { transactionId, description: { contains: 'termination' } }, include: { wallet: true } });
  let net = new m.Prisma.Decimal(0);
  for (const r of rows) {
    assert.notEqual(`${r.wallet.ownerType}/${r.wallet.ownerId}`, 'PLATFORM/ESCROW', `${context}: escrow is never posted to on termination`);
    net = r.entryType === 'CREDIT' ? net.plus(r.amount) : net.minus(r.amount);
  }
  assert.equal(net.toFixed(2), '0.00', `${context}: the termination's own postings sum to zero`);
}

/**
 * No PT-fault machinery may run: no compensation row, no charge on the PT, no fronting, no receivable.
 * Only the termination's own rows are inspected — the cash compensation of an earlier PT no-show
 * (compensateNoShow) is a different, legitimate operation and carries its own label.
 */
async function assertNoPtFaultMachinery(m: Mods, transactionId: string, context: string) {
  const lines = await postings(m, transactionId);
  assert.equal(lines.filter((l) => /compensation/i.test(l)).length, 0, `${context}: no compensation row`);
  assert.equal(lines.filter((l) => /PT cancellation compensation charge|fronted by the platform|shortfall/i.test(l)).length, 0, `${context}: no PT charge, no fronting, no shortfall cover`);
  assert.equal(await m.prisma.partnerReceivable.count(), 0, `${context}: no receivable was booked`);
}

/**
 * One scenario, from an empty ledger, end to end. Returns what an auditor would compare: the
 * result, every wallet, and the termination's ledger lines with the contract id and the reason
 * wording normalised away (so two runs on two different contracts compare line for line).
 */
async function scenario(m: Mods, o: {
  h?: string;
  price?: number;
  sessions?: number;
  taught: number;
  noShows?: number;
  reason: Reason;
  withGym?: boolean;
}) {
  await resetLedger(m);
  const f = await paidContract(m, { price: o.price ?? 5_000_000, totalSessions: o.sessions ?? 10, withGym: o.withGym, h: o.h });
  await deliver(m, f, o.taught);
  for (let i = 0; i < (o.noShows ?? 0); i++) await noShow(m, f);
  const heldBefore = await heldNow(m, f);
  const result = await m.ledger.terminateContract(terminateParams(m, f, o.reason));
  const after = await balances(m, f);
  const ctx = `${o.reason} h=${o.h} taught=${o.taught} noShows=${o.noShows ?? 0} gym=${!!o.withGym}`;
  await assertBooksReconcile(m, ctx);
  await assertTerminationIsPureReallocation(m, f.txnId, ctx);
  const lines = (await postings(m, f.txnId)).map((l) => l.split(f.contractId).join('C').split(`(${o.reason})`).join('(REASON)'));
  const { reason: _reason, ...resultWithoutReason } = result;
  return { f, result, resultWithoutReason, after, lines, heldBefore, ctx };
}

const dec = (m: Mods, v: string | number) => new m.Prisma.Decimal(v);

// ── 1. Same money as MUTUAL, line for line ───────────────────────────────────

for (const withGym of [false, true]) {
  for (const taught of [0, 3, 10]) {
    for (const noShows of [0, 2]) {
      if (taught + noShows > 10) continue;
      test(`taught ${taught}, ${noShows} compensated PT no-shows${withGym ? ', gym share' : ''}: the same refund, balances and ledger lines as MUTUAL`, skipOpts, async () => {
        const m = await load();
        const mutual = await scenario(m, { taught, noShows, withGym, reason: 'MUTUAL' });
        const exit = await scenario(m, { taught, noShows, withGym, reason: EXIT });

        assert.equal(exit.result.reason, EXIT);
        assert.deepEqual(exit.resultWithoutReason, mutual.resultWithoutReason, 'every figure of the result matches MUTUAL');
        assert.deepEqual(exit.after, mutual.after, 'every wallet ends where MUTUAL leaves it');
        assert.deepEqual(exit.lines, mutual.lines, 'and so do the termination ledger lines (reason wording aside)');

        // The formula, stated independently: P × (N − u − c) / N, rounded up to the đồng, no fee.
        const expected = dec(m, 5_000_000).mul(10 - taught - noShows).div(10).toDecimalPlaces(0, m.Prisma.Decimal.ROUND_UP);
        assert.equal(exit.result.refund, expected.toFixed(2), '100% of the unused value');
        await assertNoPtFaultMachinery(m, exit.f.txnId, exit.ctx);
      });
    }
  }
}

test('delivered sessions keep their earnings: 4 of 10 used, gym share — PT, gym and platform each hold exactly 40% of the price × their rate', skipOpts, async () => {
  const m = await load();
  const s = await scenario(m, { price: 1_000_000, taught: 4, withGym: true, reason: EXIT });
  assert.equal(s.result.refund, '600000.00', 'no 10% client cancellation fee (CLIENT_CANCELLED would give 540.000)');
  assert.deepEqual(s.result.entitlement, { pt: '220000.00', gym: '140000.00', platform: '40000.00' });
  assert.equal(s.after.clientAvailable, '600000.00');
  assert.equal(s.after.ptAvailable, '220000.00');
  assert.equal(s.after.gymAvailable, '140000.00');
  assert.equal(s.after.ptPending, '0.00');
  assert.equal(s.after.gymPending, '0.00');
  assert.equal(s.result.shortfall, '0.00');
});

test('rounding: 1.000.000 over 3 sessions with a gym share, 1 taught — the client is rounded up, nothing is lost, books balance', skipOpts, async () => {
  const m = await load();
  const mutual = await scenario(m, { price: 1_000_000, sessions: 3, taught: 1, withGym: true, reason: 'MUTUAL' });
  const exit = await scenario(m, { price: 1_000_000, sessions: 3, taught: 1, withGym: true, reason: EXIT });
  assert.equal(exit.result.refund, '666667.00', '666.666,67 rounded up in the client’s favour');
  assert.deepEqual(exit.resultWithoutReason, mutual.resultWithoutReason);
  assert.deepEqual(exit.after, mutual.after);
  assert.equal(exit.result.shortfall, '0.00');
  await assertNoPtFaultMachinery(m, exit.f.txnId, 'rounding');
});

// ── 2. Holdback: nothing is taken from the PT; the held amount goes where MUTUAL sends it ────

for (const withGym of [false, true]) {
  for (const taught of [0, 1, 3, 7]) {
    test(`holdback 0.10, taught ${taught}${withGym ? ', gym share' : ''}: no compensation row, the held amount returns to the PT exactly as for MUTUAL`, skipOpts, async () => {
      const m = await load();
      const legacy = await scenario(m, { taught, withGym, reason: EXIT });
      const mutual = await scenario(m, { h: '0.10', taught, withGym, reason: 'MUTUAL' });
      const exit = await scenario(m, { h: '0.10', taught, withGym, reason: EXIT });

      const ph = (exit.result as any).ptHoldback;
      assert.ok(ph, 'the holdback block is reported for a contract that carries one');
      assert.equal(ph.compensation, '0.00', 'a PT restriction is not a PT-fault ending: nothing is carved out of the held amount');
      assert.equal(ph.returnedToPt, ph.held, 'the whole held amount is returned to the PT');
      assert.equal(ph.held, exit.heldBefore, 'and it is what the ledger said was held');
      assert.deepEqual(exit.resultWithoutReason, mutual.resultWithoutReason, 'identical to MUTUAL');
      assert.deepEqual(exit.after, mutual.after, 'every wallet where MUTUAL leaves it');
      assert.deepEqual(exit.lines, mutual.lines);
      // …which is also exactly where a contract with no holdback ends: the held amount came back, nothing else moved.
      assert.deepEqual(exit.after, legacy.after, 'same balances as the same contract with no holdback at all');
      assert.equal(exit.after.ptPending, legacy.after.ptPending, 'nothing is stranded in the PT’s pending');
      assert.equal(
        dec(m, exit.result.topUp.pt).minus(legacy.result.topUp.pt).toFixed(2),
        ph.held,
        'the PT’s top-up is larger than without holdback by exactly the held amount',
      );
      await assertNoPtFaultMachinery(m, exit.f.txnId, `holdback taught=${taught}`);
    });
  }
}

test('pinned numbers: 5.000.000 / 10 sessions / h 0.10, 3 taught — 3.500.000 to the client, 500.000 held goes back to the PT, no compensation', skipOpts, async () => {
  const m = await load();
  const s = await scenario(m, { h: '0.10', taught: 3, reason: EXIT });
  assert.equal(s.heldBefore, '500000.00');
  assert.deepEqual((s.result as any).ptHoldback, { target: '500000.00', held: '500000.00', compensation: '0.00', returnedToPt: '500000.00' });
  assert.equal(s.result.refund, '3500000.00');
  assert.equal(s.result.topUp.pt, '500000.00');
  assert.equal(s.after.clientAvailable, '3500000.00');
  assert.equal(s.after.ptAvailable, '1350000.00', '3 × 450.000, 850.000 released along the way + 500.000 returned');
  assert.equal(s.after.ptPending, '0.00');
  assert.equal(s.after.platformRevenue, '150000.00');
});

test('holdback with compensated PT no-shows on the contract: still no compensation, still MUTUAL’s figures', skipOpts, async () => {
  const m = await load();
  const mutual = await scenario(m, { h: '0.10', taught: 3, noShows: 3, reason: 'MUTUAL' });
  const exit = await scenario(m, { h: '0.10', taught: 3, noShows: 3, reason: EXIT });
  assert.equal((exit.result as any).ptHoldback.compensation, '0.00');
  assert.deepEqual(exit.resultWithoutReason, mutual.resultWithoutReason);
  assert.deepEqual(exit.after, mutual.after);
  assert.equal(exit.result.refund, '2000000.00', '4 undelivered sessions of 10; the 3 compensated ones were already paid back');
  await assertNoPtFaultMachinery(m, exit.f.txnId, 'holdback + no-shows');
});

// ── 3. The refund row names the reason and is withdrawable ───────────────────

test('the refund row carries the reason, so it is distinguishable from a MUTUAL refund — and the client can withdraw it', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const mutual = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  const exit = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  for (const f of [mutual, exit]) await deliver(m, f, 3);
  await m.ledger.terminateContract(terminateParams(m, mutual, 'MUTUAL'));
  await m.ledger.terminateContract(terminateParams(m, exit, EXIT));

  const refundRows = async (f: Fixture) => (await postings(m, f.txnId)).filter((l) => /CLIENT CREDIT/.test(l));
  assert.deepEqual(await refundRows(mutual), [`CLIENT CREDIT AVAILABLE 3500000.00 | ${mutual.contractId} termination — refund (MUTUAL)`]);
  assert.deepEqual(await refundRows(exit), [`CLIENT CREDIT AVAILABLE 3500000.00 | ${exit.contractId} termination — refund (CLIENT_EXIT_DUE_TO_PT_RESTRICTION)`]);

  for (const f of [mutual, exit]) {
    const wallet = await m.wallet.getOrCreateWallet('CLIENT', f.parties.clientUserId);
    const withdrawable = await m.withdrawals.sumRefundSourcedCredits(wallet.id);
    assert.equal(withdrawable.toFixed(2), '3500000.00', 'the whole refund counts as withdrawable');
    assert.equal(wallet.availableBalance.toFixed(2), '3500000.00');
  }
  await assertBooksReconcile(m, 'refund wording');
});

// ── 4. Other contracts are untouched ─────────────────────────────────────────

test('another running contract of the same PT is untouched: pending, held pot and ledger rows', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const pt = 'pt-shared';
  const a = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10', ptUserId: pt });
  const b = await paidContract(m, { price: 2_000_000, totalSessions: 8, h: '0.10', ptUserId: pt });
  await deliver(m, a, 3);
  await deliver(m, b, 1); // s = 225.000, H = 200.000 → held 200.000
  assert.equal(await heldNow(m, b), '200000.00');

  const ptWallet = await m.wallet.getOrCreateWallet('PT', pt);
  const pendingOf = (f: Fixture) =>
    m.wallet.withWallets([ptWallet.id], f.txnId, async (ops) => (await m.walletMod.pendingForTransaction(ops, ptWallet.id, f.txnId)).toFixed(2));
  const bPending = await pendingOf(b);
  const bRows = await m.prisma.walletLedgerEntry.count({ where: { transactionId: b.txnId } });

  await m.ledger.terminateContract(terminateParams(m, a, EXIT));

  assert.equal(await heldNow(m, b), '200000.00', 'B’s held pot is untouched');
  assert.equal(await pendingOf(b), bPending, 'B’s pending is untouched');
  assert.equal(await m.prisma.walletLedgerEntry.count({ where: { transactionId: b.txnId } }), bRows, 'no ledger row of B was written');
  assert.equal(await pendingOf(a), '0.00', 'A’s own pending is fully settled');
  await assertBooksReconcile(m, 'shared PT wallet');

  // B can still end normally afterwards, on its own money.
  await m.ledger.terminateContract(terminateParams(m, b, 'MUTUAL'));
  await assertBooksReconcile(m, 'shared PT wallet, B ended after A');
});

// ── 5. Idempotency and concurrency ───────────────────────────────────────────

test('the same request sent again posts nothing further', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 3);
  const params = terminateParams(m, f, EXIT);

  const first = await m.ledger.terminateContract(params);
  const afterFirst = await balances(m, f);
  const entries = await m.prisma.walletLedgerEntry.count();

  const second = await m.ledger.terminateContract(params);
  const third = await m.ledger.terminateContract({ ...params, label: 'retried' });
  assert.deepEqual(second, first, 'the retry replays the first result');
  assert.deepEqual(third, first);
  assert.deepEqual(await balances(m, f), afterFirst, 'no balance moved again');
  assert.equal(await m.prisma.walletLedgerEntry.count(), entries, 'no ledger row was added');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: params.idempotencyKey } }), 1);
  await assertBooksReconcile(m, 'replayed termination');
});

test('two concurrent requests post once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 3);
  const params = terminateParams(m, f, EXIT);

  const [a, b] = await Promise.all([m.ledger.terminateContract(params), m.ledger.terminateContract(params)]);
  assert.deepEqual(a, b, 'both callers are told the same thing');
  const lines = await postings(m, f.txnId);
  assert.equal(lines.filter((l) => /refund \(CLIENT_EXIT_DUE_TO_PT_RESTRICTION\)/.test(l)).length, 1, 'one refund');
  const bal = await balances(m, f);
  assert.equal(bal.clientAvailable, '3500000.00', 'client paid once');
  assert.equal(bal.ptAvailable, '1350000.00', 'PT paid once');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: params.idempotencyKey } }), 1);
  await assertBooksReconcile(m, 'concurrent termination');
});

// ── 6. The internal endpoint ─────────────────────────────────────────────────

test('POST /internal/contracts/terminate accepts the reason, settles it, and still rejects an unknown reason', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const express = (await import('express')).default;
  const router = (await import('../routes/internal.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/internal', router);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const post = async (body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/contracts/terminate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-secret': process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  try {
    const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
    await deliver(m, f, 3);
    const body = (reason: string, key = `CONTRACT_TERMINATE:${f.contractId}`) => ({
      transactionId: f.txnId, price: f.price.toString(), totalSessions: 10, usedSessions: 3,
      rates: { platformRate: '0.10', ptRate: '0.90', gymRate: '0' }, parties: f.parties,
      reason, label: `${f.contractId} termination`, idempotencyKey: key,
      alreadyReleased: { pt: f.releasedTo.pt.toString(), gym: '0', platform: f.releasedTo.platform.toString() },
      ptHoldbackRate: '0.10',
    });

    const entriesBefore = await m.prisma.walletLedgerEntry.count();
    const unknown = await post(body('CLIENT_EXIT_DUE_TO_PT_RESTRICTIONS'));
    assert.equal(unknown.status, 400, 'a reason that is not in the list is refused');
    assert.equal(unknown.json.error.code, 'VALIDATION_ERROR');
    const lower = await post(body('client_exit_due_to_pt_restriction'));
    assert.equal(lower.status, 400, 'the wire value is exact');
    assert.equal(await m.prisma.walletLedgerEntry.count(), entriesBefore, 'a refused request moved nothing');

    const ok = await post(body(EXIT));
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.reason, EXIT);
    assert.equal(ok.json.data.refund, '3500000.00');
    assert.equal(ok.json.data.ptHoldback.compensation, '0.00');
    assert.equal(ok.json.data.ptHoldback.returnedToPt, '500000.00');

    const replay = await post(body(EXIT));
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.json.data, ok.json.data, 'the endpoint replays too');
    assert.equal((await balances(m, f)).clientAvailable, '3500000.00', 'the client was refunded once');
    await assertBooksReconcile(m, 'internal endpoint');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
