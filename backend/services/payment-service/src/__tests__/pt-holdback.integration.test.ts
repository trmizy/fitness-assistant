/**
 * PT holdback: the first money a PT earns on a contract is held back, and a PT-fault ending
 * pays the client compensation OUT OF THAT HELD AMOUNT ONLY.
 *
 *   evidence label: BACKEND INTEGRATION (real ledger code against the isolated *_test database).
 *
 * Replaces pt-cancellation-compensation.integration.test.ts, which pinned the rejected
 * mechanism (charge the PT's AVAILABLE balance, platform fronts the rest, receivable against
 * the PT). Nothing of that survives: this file asserts the opposite — no debit of the PT's
 * available balance for compensation, no coverShortfall, no PartnerReceivable.
 *
 * The rule (per contract with holdback rate h, price P, H = floor(h × P)):
 *   1. after u confirmed sessions the PT has been released max(0, E − H) (E = PT share of u
 *      sessions); min(E, H) stays in their pending for that contract;
 *   2. COMPLETED / EXPIRED / CLIENT_CANCELLED / MUTUAL give the held amount back to the PT
 *      (through the ordinary top-up — no second path);
 *   3. PT_CANCELLED / PT_BANNED / PT_REPEATED_NO_SHOW pay the client min(h × base, held);
 *   4. a contract with rate 0 or no rate posts exactly what it always has.
 *
 * Everything asserts REAL ledger rows and wallet balances, never a formula's return value.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables, like its siblings):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-holdback.integration.test.ts
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

/** Every scenario starts from an empty ledger, ledger_operations included. */
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
  /** The holdback rate this contract carries; undefined = the legacy shape (nothing sent). */
  h?: string;
  /** User-service's running totals, updated the way it updates them. */
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
  opts: { price: number; totalSessions: number; withGym?: boolean; ptUserId?: string; h?: string; ptRate?: '0.90' | '0.50' },
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
    rates: opts.withGym
      ? rateTable(m, '0.10', '0.55', '0.35')
      : opts.ptRate === '0.50' ? rateTable(m, '0.50', '0.50', '0') : rateTable(m, '0.10', '0.90', '0'),
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

/** Confirm `count` sessions the way user-service does: what comes back is added to releasedTo*. */
async function deliver(m: Mods, f: Fixture, count: number) {
  const results: Awaited<ReturnType<Mods['ledger']['releaseSession']>>[] = [];
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
    results.push(r);
  }
  return results;
}

/** A PT no-show: the client is compensated one session and the entitlement is consumed. */
async function noShow(m: Mods, f: Fixture) {
  const n = ++f.seq;
  const r = await m.ledger.compensateNoShow({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions,
    rates: f.rates, parties: f.parties, label: `${f.contractId} no-show ${n}`,
    idempotencyKey: `PT_NO_SHOW:${f.contractId}:${n}`,
  });
  f.compensatedSessions++;
  return r;
}

async function terminateParams(m: Mods, f: Fixture, reason: Reason, transactionId?: string) {
  return {
    transactionId: transactionId ?? f.txnId,
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

async function terminate(m: Mods, f: Fixture, reason: Reason) {
  const params = await terminateParams(m, f, reason);
  const result = await m.ledger.terminateContract(params);
  return { result, txnId: params.transactionId, params };
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

/** What the ledger says is held back for the PT on this contract right now. */
async function heldNow(m: Mods, f: Fixture): Promise<string> {
  const pt = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  return m.wallet.withWallets([pt.id], f.txnId, async (ops) => (await m.ledger.ptHeld(ops, pt.id, f.txnId)).toFixed(2));
}

/** The termination's ledger rows as readable, sorted lines (rows whose description names the termination). */
async function postings(m: Mods, transactionId: string, contains = 'termination'): Promise<string[]> {
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { transactionId, description: { contains } }, include: { wallet: true } });
  return rows
    .map((r) => {
      const who = r.wallet.ownerType === 'PLATFORM' ? r.wallet.ownerId : r.wallet.ownerType;
      return `${who} ${r.entryType} ${r.bucket} ${r.amount.toFixed(2)} | ${r.description}`;
    })
    .sort();
}

async function receivableCount(m: Mods): Promise<number> {
  return m.prisma.partnerReceivable.count();
}

/**
 * Conservation, checked three ways after every scenario: the system invariant (escrow = every
 * claim on it, no negative wallet), the books (every bucket balance is fully explained by its
 * ledger rows) and whole-đồng amounts.
 */
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

/** A termination only reallocates claims on cash the platform already holds: it never touches ESCROW and nets to zero. */
async function assertTerminationIsPureReallocation(m: Mods, transactionId: string, context: string) {
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { transactionId, description: { contains: 'termination' } }, include: { wallet: true } });
  let net = new m.Prisma.Decimal(0);
  for (const r of rows) {
    assert.notEqual(`${r.wallet.ownerType}/${r.wallet.ownerId}`, 'PLATFORM/ESCROW', `${context}: escrow is never posted to on termination`);
    net = r.entryType === 'CREDIT' ? net.plus(r.amount) : net.minus(r.amount);
  }
  assert.equal(net.toFixed(2), '0.00', `${context}: the termination's own postings sum to zero`);
}

/** The rejected mechanism must be gone: nothing charges the PT's available balance, fronts money or books a debt. */
async function assertNoOldMechanism(m: Mods, transactionId: string, context: string) {
  const lines = await postings(m, transactionId, '');
  assert.equal(lines.filter((l) => /PT cancellation compensation charge/.test(l)).length, 0, `${context}: no charge row against the PT's available balance`);
  assert.equal(lines.filter((l) => /fronted by the platform/.test(l)).length, 0, `${context}: the platform fronted nothing`);
  assert.equal(await receivableCount(m), 0, `${context}: no receivable was booked`);
}

/** One scenario, run from an empty ledger, end to end. */
async function scenario(m: Mods, o: {
  h?: string;
  price?: number;
  sessions?: number;
  taught: number;
  noShows?: number;
  reason: Reason;
  withGym?: boolean;
  ptRate?: '0.90' | '0.50';
}) {
  await resetLedger(m);
  const f = await paidContract(m, { price: o.price ?? 5_000_000, totalSessions: o.sessions ?? 10, withGym: o.withGym, h: o.h, ptRate: o.ptRate });
  await deliver(m, f, o.taught);
  for (let i = 0; i < (o.noShows ?? 0); i++) await noShow(m, f);
  const beforeEnd = await balances(m, f);
  const heldBefore = await heldNow(m, f);
  const { result, txnId } = await terminate(m, f, o.reason);
  const after = await balances(m, f);
  await assertBooksReconcile(m, `${o.reason} h=${o.h} taught=${o.taught} noShows=${o.noShows ?? 0}`);
  await assertTerminationIsPureReallocation(m, txnId, `${o.reason} h=${o.h}`);
  await assertNoOldMechanism(m, txnId, `${o.reason} h=${o.h}`);
  return { f, result, txnId, after, beforeEnd, heldBefore };
}

const dec = (m: Mods, v: string) => new m.Prisma.Decimal(v);

// ── 1. The release schedule ──────────────────────────────────────────────────

for (const ptRate of ['0.90', '0.50'] as const) {
  test(`release schedule, price 5.000.000 / 10 sessions / h 0.10 / PT ${ptRate}: the PT gets max(0, E − H), the rest is held`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10', ptRate });
    const share = ptRate === '0.90' ? 450_000 : 250_000;
    const H = 500_000;
    let cumulative = 0;
    const table: string[] = [];

    for (let u = 1; u <= 10; u++) {
      const [r] = await deliver(m, f, 1);
      const earned = share * u;
      const expectedCumulative = Math.max(0, earned - H);
      const expectedThis = expectedCumulative - cumulative;
      cumulative = expectedCumulative;

      assert.equal(r.released.pt, `${expectedThis}.00`, `session ${u}: PT released this session`);
      assert.equal((await balances(m, f)).ptAvailable, `${expectedCumulative}.00`, `session ${u}: PT available = max(0, E − H)`);
      assert.equal(await heldNow(m, f), `${Math.min(earned, H)}.00`, `session ${u}: held = min(E, H)`);
      assert.equal(r.ptHoldback?.target, '500000.00');
      assert.equal(r.ptHoldback?.totalHeld, `${Math.min(earned, H)}.00`);
      // Gym is absent here; the platform is released in full every session, never held.
      assert.equal(r.released.platform, ptRate === '0.90' ? '50000.00' : '250000.00', `session ${u}: platform share released in full`);
      assert.equal(f.releasedTo.pt.toFixed(2), `${expectedCumulative}.00`, `session ${u}: what user-service sums (releasedToPt) is what the PT really has`);
      await assertBooksReconcile(m, `schedule ${ptRate} session ${u}`);
      table.push(`TABLE|release|ptRate=${ptRate}|session=${u}|ptReleased=${expectedThis}|ptCumulative=${expectedCumulative}|ptHeld=${Math.min(earned, H)}`);
    }
    for (const line of table) console.log(line);

    // After the last session everything but the rounding dust is out, and the pot is still the pot.
    assert.equal(await heldNow(m, f), '500000.00', 'the pot is untouched until the contract ends');
  });
}

test('the first session of a held contract reports 0 for the PT; the gym and the platform are released in full', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 1_000_000, totalSessions: 10, withGym: true, h: '0.10' });
  // PT 0.55 → 55.000 a session, H = 100.000: session 1 holds all 55.000, session 2 holds 45.000 and releases 10.000.
  const [s1, s2, s3] = await deliver(m, f, 3);
  assert.deepEqual(s1.released, { pt: '0.00', gym: '35000.00', platform: '10000.00' });
  assert.deepEqual(s2.released, { pt: '10000.00', gym: '35000.00', platform: '10000.00' });
  assert.deepEqual(s3.released, { pt: '55000.00', gym: '35000.00', platform: '10000.00' });
  assert.equal(s1.ptHoldback?.heldNow, '55000.00');
  assert.equal(s2.ptHoldback?.heldNow, '45000.00');
  assert.equal(s3.ptHoldback?.heldNow, '0.00');
  const b = await balances(m, f);
  assert.equal(b.ptAvailable, '65000.00');
  assert.equal(b.gymAvailable, '105000.00', 'the gym is exactly what it would be with no holdback: 3 × 35.000');
  assert.equal(b.platformRevenue, '30000.00');
  await assertBooksReconcile(m, 'gym share, three sessions');
});

test('H is floor(h × price): the sub-đồng remainder is never held', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  // 1.000.007 × 0.10 = 100.000,7 → H = 100.000.
  const f = await paidContract(m, { price: 1_000_007, totalSessions: 7, h: '0.10' });
  const [r] = await deliver(m, f, 1);
  assert.equal(r.ptHoldback?.target, '100000.00');
  await assertBooksReconcile(m, 'fractional H');
});

// ── 2. A contract without a holdback behaves exactly as before ───────────────

test('rate absent and rate 0 post exactly the rows a release always posted, and the result has no holdback field', skipOpts, async () => {
  const m = await load();
  for (const h of [undefined, '0', '0.0000']) {
    await resetLedger(m);
    const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h });
    const [r] = await deliver(m, f, 1);

    assert.deepEqual(r, { unit: '500000.00', released: { pt: '450000.00', gym: '0.00', platform: '50000.00' } }, `h=${h}: byte-for-byte the pre-holdback result`);
    assert.equal('ptHoldback' in r, false);
    assert.deepEqual(await postings(m, f.txnId, 'session 1'), [
      `PT CREDIT AVAILABLE 450000.00 | ${f.contractId} session 1 — session earned`,
      `PT DEBIT PENDING 450000.00 | ${f.contractId} session 1 — release to available`,
      `REVENUE CREDIT AVAILABLE 50000.00 | ${f.contractId} session 1 — session earned`,
      `REVENUE DEBIT PENDING 50000.00 | ${f.contractId} session 1 — release to available`,
    ].sort(), `h=${h}`);
    assert.equal(await heldNow(m, f), '0.00');
    await assertBooksReconcile(m, `legacy release h=${h}`);
  }
});

for (const reason of ['PT_CANCELLED', 'PT_BANNED', 'PT_REPEATED_NO_SHOW', 'CLIENT_CANCELLED', 'MUTUAL', 'EXPIRED', 'COMPLETED'] as Reason[]) {
  test(`a legacy contract ending ${reason}: refund, top-up and rows are the ones it always had, and no holdback field appears`, skipOpts, async () => {
    const m = await load();
    const withoutRate = await scenario(m, { taught: 4, reason });
    const rateZero = await scenario(m, { h: '0', taught: 4, reason });

    assert.equal('ptHoldback' in withoutRate.result, false, 'no holdback field in the result');
    assert.deepEqual(rateZero.result, withoutRate.result, 'an explicit zero rate is the same result');
    assert.deepEqual(rateZero.after, withoutRate.after, 'and the same balances');
    // PT gets exactly the entitlement rate × withheld, as ever.
    const refund = dec(m, withoutRate.result.refund);
    const withheld = dec(m, '5000000').minus(refund);
    assert.equal(dec(m, withoutRate.after.ptAvailable).toFixed(2), withheld.mul('0.90').toDecimalPlaces(0, m.Prisma.Decimal.ROUND_DOWN).toFixed(2));
  });
}

// ── 3. Normal endings give the holdback back ─────────────────────────────────

for (const reason of ['COMPLETED', 'EXPIRED', 'CLIENT_CANCELLED', 'MUTUAL'] as Reason[]) {
  for (const taught of reason === 'COMPLETED' ? [10] : [0, 1, 3, 7]) {
    for (const withGym of [false, true]) {
      test(`${reason} after ${taught} sessions${withGym ? ' (gym share)' : ''}: the PT ends up with exactly what they would have with no holdback`, skipOpts, async () => {
        const m = await load();
        const legacy = await scenario(m, { taught, reason, withGym });
        const held = await scenario(m, { h: '0.10', taught, reason, withGym });

        assert.deepEqual(held.after, legacy.after, 'every wallet ends where it ends with no holdback — the held amount came back, nothing else moved');
        assert.equal(held.result.refund, legacy.result.refund, 'the refund is unchanged');
        assert.deepEqual(held.result.entitlement, legacy.result.entitlement);
        const ph = (held.result as any).ptHoldback;
        assert.equal(ph.compensation, '0.00', 'no compensation for a non-fault ending');
        assert.equal(ph.returnedToPt, ph.held, 'the whole held amount goes back to the PT');
        // The top-up the PT receives is larger than with no holdback by exactly what was held.
        assert.equal(
          dec(m, held.result.topUp.pt).minus(legacy.result.topUp.pt).toFixed(2),
          ph.held,
          'the extra top-up is the held amount',
        );
        assert.equal(held.result.shortfall, '0.00');
        assert.equal(held.after.ptPending, legacy.after.ptPending, 'nothing is left stranded in the PT pending');
      });
    }
  }
}

// ── 4. PT-fault endings: compensation out of the held amount only ────────────

/**
 * Prices 5.000.000 / 10 sessions, h 0.10 (H 500.000). Expected, from the rule:
 *   PT 0.90: s = 450.000.   taught 0 → held 0       target 500.000 (10% × 5.000.000) → comp 0
 *                           taught 1 → held 450.000 target 450.000 → comp 450.000, PT back 0
 *                           taught 3 → held 500.000 target 350.000 → comp 350.000, PT back 150.000
 *   PT 0.50: s = 250.000.   taught 0 → comp 0
 *                           taught 1 → held 250.000 target 450.000 → comp 250.000 (capped by held), PT back 0
 *                           taught 3 → held 500.000 target 350.000 → comp 350.000, PT back 150.000
 */
const FAULT_EXPECTATIONS: Record<'0.90' | '0.50', Record<number, { held: string; comp: string; back: string }>> = {
  '0.90': {
    0: { held: '0.00', comp: '0.00', back: '0.00' },
    1: { held: '450000.00', comp: '450000.00', back: '0.00' },
    3: { held: '500000.00', comp: '350000.00', back: '150000.00' },
  },
  '0.50': {
    0: { held: '0.00', comp: '0.00', back: '0.00' },
    1: { held: '250000.00', comp: '250000.00', back: '0.00' },
    3: { held: '500000.00', comp: '350000.00', back: '150000.00' },
  },
};

for (const reason of ['PT_CANCELLED', 'PT_BANNED'] as Reason[]) {
  for (const ptRate of ['0.90', '0.50'] as const) {
    for (const taught of [0, 1, 3]) {
      test(`${reason}, PT ${ptRate}, after ${taught} session(s): compensation = min(10% × remaining, held), carved out of the held amount only`, skipOpts, async () => {
        const m = await load();
        const legacy = await scenario(m, { taught, reason, ptRate });
        const held = await scenario(m, { h: '0.10', taught, reason, ptRate });
        const exp = FAULT_EXPECTATIONS[ptRate][taught];

        const ph = (held.result as any).ptHoldback;
        assert.equal(held.heldBefore, exp.held, 'what was really held when the PT left');
        assert.equal(ph.held, exp.held);
        assert.equal(ph.compensation, exp.comp, 'compensation');
        assert.equal(ph.returnedToPt, exp.back, 'what the held amount returns to the PT');
        assert.equal(held.result.refund, legacy.result.refund, 'the client still gets the normal refund, unchanged');

        // The client gets the compensation on top; the PT gets exactly that much less; nobody else moves.
        assert.equal(dec(m, held.after.clientAvailable).minus(legacy.after.clientAvailable).toFixed(2), exp.comp, 'client: + compensation');
        assert.equal(dec(m, legacy.after.ptAvailable).minus(held.after.ptAvailable).toFixed(2), exp.comp, 'PT: − compensation, relative to a contract with no holdback');
        assert.equal(held.after.platformRevenue, legacy.after.platformRevenue, 'the platform neither pays nor gains');
        assert.equal(held.after.escrow, legacy.after.escrow, 'escrow untouched');
        assert.equal(held.after.ptPending, '0.00');

        // The PT's final total: what was released along the way + what the held amount gives back.
        const released = Math.max(0, (ptRate === '0.90' ? 450_000 : 250_000) * taught - 500_000);
        assert.equal(held.after.ptAvailable, dec(m, String(released)).plus(exp.back).toFixed(2), 'PT final available = released + returned');

        const lines = await postings(m, held.txnId);
        const compLines = lines.filter((l) => /compensation/i.test(l));
        if (dec(m, exp.comp).isZero()) {
          assert.deepEqual(compLines, [], 'nothing held → no compensation row at all');
        } else {
          assert.deepEqual(compLines, [
            `CLIENT CREDIT AVAILABLE ${exp.comp} | ${held.f.contractId} termination — compensation for ${reason === 'PT_CANCELLED' ? "the PT's cancellation" : "the PT's removal"} (from the PT's held-back earnings)`,
          ], 'one separate, clearly-described credit to the client');
          // Counts as withdrawable: the withdrawal code matches on the word "compensation".
          const clientWallet = await m.wallet.getOrCreateWallet('CLIENT', held.f.parties.clientUserId);
          assert.equal(
            (await m.withdrawals.sumRefundSourcedCredits(clientWallet.id)).toFixed(2),
            held.after.clientAvailable,
            'refund + compensation are both withdrawable',
          );
        }
        console.log(`TABLE|fault|reason=${reason}|ptRate=${ptRate}|taught=${taught}|held=${exp.held}|compensation=${ph.compensation}|returnedToPt=${ph.returnedToPt}|topUpPt=${held.result.topUp.pt}|ptAvailableFinal=${held.after.ptAvailable}|clientTotal=${held.after.clientAvailable}`);
      });
    }
  }
}

for (const ptRate of ['0.90', '0.50'] as const) {
  test(`PT_REPEATED_NO_SHOW, PT ${ptRate}: 3 taught then 3 no-shows costs the PT the same as cancelling after 3 — base is remaining + already-compensated`, skipOpts, async () => {
    const m = await load();
    const cancel = await scenario(m, { h: '0.10', taught: 3, reason: 'PT_CANCELLED', ptRate });
    const legacyNs = await scenario(m, { taught: 3, noShows: 3, reason: 'PT_REPEATED_NO_SHOW', ptRate });
    const ns = await scenario(m, { h: '0.10', taught: 3, noShows: 3, reason: 'PT_REPEATED_NO_SHOW', ptRate }); // last: its ledger is read below

    const ph = (ns.result as any).ptHoldback;
    assert.equal(ns.heldBefore, '500000.00', 'the no-show charges came out of the sessions never delivered, not out of the held amount');
    assert.equal(ph.compensation, '350000.00', 'remaining 2.000.000 + compensated 1.500.000 = 3.500.000 → 10% = 350.000');
    assert.equal(ph.compensation, (cancel.result as any).ptHoldback.compensation, 'never cheaper to stop turning up than to cancel');
    assert.equal(ph.returnedToPt, '150000.00');
    assert.equal(ns.result.refund, '2000000.00', 'the refund is the remaining value only — the compensated sessions were already paid back');

    // Relative to the same story with no holdback: client + 350.000, PT − 350.000, nobody else.
    assert.equal(dec(m, ns.after.clientAvailable).minus(legacyNs.after.clientAvailable).toFixed(2), '350000.00');
    assert.equal(dec(m, legacyNs.after.ptAvailable).minus(ns.after.ptAvailable).toFixed(2), '350000.00');
    assert.equal(ns.after.platformRevenue, legacyNs.after.platformRevenue);
    const lines = (await postings(m, ns.txnId)).filter((l) => /compensation/i.test(l));
    assert.deepEqual(lines, [
      `CLIENT CREDIT AVAILABLE 350000.00 | ${ns.f.contractId} termination — compensation for the PT's repeated no-shows (from the PT's held-back earnings)`,
    ]);
    console.log(`TABLE|norshow|ptRate=${ptRate}|taught=3|noShows=3|held=${ns.heldBefore}|compensation=${ph.compensation}|returnedToPt=${ph.returnedToPt}|ptAvailableFinal=${ns.after.ptAvailable}`);
  });
}

test('PT no-shows eating every undelivered session leave the held amount intact (7 of 10 missed)', skipOpts, async () => {
  const m = await load();
  const r = await scenario(m, { h: '0.10', taught: 3, noShows: 7, reason: 'PT_REPEATED_NO_SHOW' });
  assert.equal(r.heldBefore, '500000.00');
  assert.equal(r.beforeEnd.ptPending, '500000.00', 'all that is left in the PT’s pending is the held amount');
  assert.equal((r.result as any).ptHoldback.compensation, '350000.00', 'base = 0 remaining + 7 × 500.000 compensated');
  assert.equal(r.result.refund, '0.00', 'every undelivered session was already paid back');
});

test('ptHeld never exceeds the PT’s own pending for the contract (a no-show charge that digs into the pot shrinks it)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 1); // held 450.000
  const ptWallet = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  const revenue = await m.wallet.getRevenueWallet();
  // Simulate the extreme: this contract's pending consumed down to 100.000, below the 450.000 pot.
  const drain = ptWallet.pendingBalance.minus(100_000);
  await m.wallet.withWallets([ptWallet.id, revenue.id], f.txnId, async (ops) => {
    await ops.debit(ptWallet.id, drain, 'test — pending consumed by no-show charges', 'PENDING');
    await ops.credit(revenue.id, drain, 'test — charge booked to platform', 'AVAILABLE');
  });
  assert.equal(await heldNow(m, f), '100000.00', 'held is clamped to what the PT really has pending on this contract');
  await assertBooksReconcile(m, 'ptHeld clamp');
});

test('money locked for an approved withdrawal and the PT’s available balance are never touched by the compensation', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 3); // released 850.000, held 500.000
  const ptWallet = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  const lock = dec(m, '800000');
  await m.wallet.withWallets([ptWallet.id], f.txnId, async (ops) => {
    await ops.debit(ptWallet.id, lock, 'test — withdrawal approved', 'AVAILABLE');
    await ops.credit(ptWallet.id, lock, 'test — withdrawal approved', 'LOCKED');
  });
  const before = await balances(m, f);
  assert.equal(before.ptAvailable, '50000.00');
  assert.equal(before.ptLocked, '800000.00');

  const { result } = await terminate(m, f, 'PT_CANCELLED');
  assert.equal((result as any).ptHoldback.compensation, '350000.00');
  const after = await balances(m, f);
  assert.equal(after.ptLocked, '800000.00', 'the approved withdrawal is intact');
  assert.equal(after.ptAvailable, dec(m, before.ptAvailable).plus('150000').toFixed(2), 'available only GAINED the unused 150.000 of the pot');
  await assertBooksReconcile(m, 'locked balance respected');
});

test('never platform money: with REVENUE empty, a PT quitting before the first session still settles — compensation is 0, nothing fronted', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  assert.equal((await balances(m, f)).platformRevenue, '0.00');
  const { result, txnId } = await terminate(m, f, 'PT_CANCELLED');
  assert.equal(result.refund, '5000000.00');
  assert.equal((result as any).ptHoldback.compensation, '0.00', 'nothing held, nothing owed');
  assert.deepEqual((await postings(m, txnId)).filter((l) => /compensation/i.test(l)), []);
  assert.equal((await balances(m, f)).clientAvailable, '5000000.00', 'the client gets exactly the refund');
  await assertNoOldMechanism(m, txnId, 'before first session');
  await assertBooksReconcile(m, 'quit before first session');
});

test('a contract with a gym share: the gym and the platform keep exactly what they earned; the PT alone funds the compensation', skipOpts, async () => {
  const m = await load();
  const legacy = await scenario(m, { price: 1_000_000, sessions: 10, taught: 2, reason: 'PT_CANCELLED', withGym: true });
  const held = await scenario(m, { h: '0.10', price: 1_000_000, sessions: 10, taught: 2, reason: 'PT_CANCELLED', withGym: true });
  // H = 100.000; PT s = 55.000: after 2 sessions held 100.000, released 10.000. target = 10% × 800.000 = 80.000.
  assert.equal((held.result as any).ptHoldback.compensation, '80000.00');
  assert.equal(held.after.gymAvailable, legacy.after.gymAvailable, 'gym unchanged');
  assert.equal(held.after.gymPending, legacy.after.gymPending);
  assert.equal(held.after.platformRevenue, legacy.after.platformRevenue, 'platform unchanged');
  assert.equal(dec(m, held.after.clientAvailable).minus(legacy.after.clientAvailable).toFixed(2), '80000.00');
  assert.equal(dec(m, legacy.after.ptAvailable).minus(held.after.ptAvailable).toFixed(2), '80000.00');
  const sum = dec(m, held.after.clientAvailable).plus(held.after.ptAvailable).plus(held.after.gymAvailable).plus(held.after.platformRevenue);
  assert.equal(sum.toFixed(2), '1000000.00', 'all four parts rebuild the price');
});

test('rounding: 1.000.000 over 3 sessions with a gym share — whole đồng, compensation rounds up for the client, nothing lost', skipOpts, async () => {
  const m = await load();
  const legacy = await scenario(m, { price: 1_000_000, sessions: 3, taught: 1, reason: 'PT_CANCELLED', withGym: true });
  const held = await scenario(m, { h: '0.10', price: 1_000_000, sessions: 3, taught: 1, reason: 'PT_CANCELLED', withGym: true });
  // s_pt = floor(333.333 × 0.55) = 183.333 ≥ H = 100.000 → held 100.000, released 83.333.
  // target = ceil(10% × 666.666,67) = 66.667 ≤ held.
  const ph = (held.result as any).ptHoldback;
  assert.equal(ph.held, '100000.00');
  assert.equal(ph.compensation, '66667.00', 'rounded up like every client-facing amount');
  assert.equal(ph.returnedToPt, '33333.00');
  assert.equal(held.result.refund, '666667.00');
  assert.equal(dec(m, legacy.after.ptAvailable).minus(held.after.ptAvailable).toFixed(2), '66667.00');
  const total = ['clientAvailable', 'ptAvailable', 'gymAvailable', 'platformRevenue', 'ptPending', 'gymPending', 'platformPending']
    .reduce((acc, k) => acc.plus((held.after as any)[k]), dec(m, '0'));
  assert.equal(total.toFixed(2), '1000000.00', 'not one đồng created or lost');
});

// ── 5. Idempotency and concurrency ───────────────────────────────────────────

test('the same termination sent again posts nothing further — no second refund, compensation or top-up', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 3);
  const params = await terminateParams(m, f, 'PT_CANCELLED');

  const first = await m.ledger.terminateContract(params);
  const afterFirst = await balances(m, f);
  const entries = await m.prisma.walletLedgerEntry.count();

  const second = await m.ledger.terminateContract(params);
  const third = await m.ledger.terminateContract({ ...params, transactionId: params.transactionId, label: 'retried' });
  assert.deepEqual(second, first, 'the retry replays the first result');
  assert.deepEqual(third, first);
  assert.ok((first as any).ptHoldback, 'and the stored copy carries the holdback block');
  assert.deepEqual(await balances(m, f), afterFirst, 'no balance moved again');
  assert.equal(await m.prisma.walletLedgerEntry.count(), entries, 'no ledger row was added');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: params.idempotencyKey } }), 1);
  await assertBooksReconcile(m, 'replayed termination');
});

test('two concurrent termination requests settle the contract once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 3);
  const params = await terminateParams(m, f, 'PT_CANCELLED');

  const [a, b] = await Promise.all([m.ledger.terminateContract(params), m.ledger.terminateContract(params)]);
  assert.deepEqual(a, b, 'both callers are told the same thing');
  const lines = await postings(m, params.transactionId);
  assert.equal(lines.filter((l) => /compensation/i.test(l)).length, 1, 'one compensation credit');
  assert.equal(lines.filter((l) => /refund \(PT_CANCELLED\)/.test(l)).length, 1, 'one refund');
  const bal = await balances(m, f);
  assert.equal(bal.clientAvailable, '3850000.00', 'client paid once: 3.500.000 + 350.000');
  assert.equal(bal.ptAvailable, '1000000.00', '850.000 released + 150.000 returned');
  await assertBooksReconcile(m, 'concurrent termination');
});

test('a retried release replays; concurrent releases of different sessions fill the pot exactly once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  const base = {
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions, rates: f.rates, parties: f.parties,
    ptHoldbackRate: new m.Prisma.Decimal('0.10'),
  };
  const call = (n: number) => m.ledger.releaseSession({ ...base, label: `${f.contractId} s${n}`, idempotencyKey: `SESSION_RELEASE:${f.contractId}:${n}` });

  const first = await call(1);
  const replay = await call(1);
  assert.deepEqual(replay, first);
  assert.equal((await balances(m, f)).ptAvailable, '0.00', 'replaying session 1 released nothing more');
  assert.equal(await heldNow(m, f), '450000.00', 'and held nothing more');

  await Promise.all([call(2), call(3), call(4), call(2)]);
  const b = await balances(m, f);
  assert.equal(b.ptAvailable, '1300000.00', 'four distinct sessions: 4 × 450.000 − 500.000 (the duplicate of session 2 changed nothing)');
  assert.equal(await heldNow(m, f), '500000.00');
  await assertBooksReconcile(m, 'concurrent releases');
});

// ── 6. Contracts sharing a PT wallet ─────────────────────────────────────────

test('two held contracts of one PT: each pot is its own; ending one leaves the other’s pot and pending intact', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const pt = 'pt-shared';
  const a = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10', ptUserId: pt });
  const b = await paidContract(m, { price: 2_000_000, totalSessions: 8, h: '0.10', ptUserId: pt });
  await deliver(m, a, 3);
  await deliver(m, b, 1); // s = 225.000, H = 200.000 → held 200.000, released 25.000
  assert.equal(await heldNow(m, a), '500000.00');
  assert.equal(await heldNow(m, b), '200000.00');

  const pendingB = async () => {
    const w = await m.wallet.getOrCreateWallet('PT', pt);
    return m.wallet.withWallets([w.id], b.txnId, async (ops) => (await (await import('../services/wallet.service')).pendingForTransaction(ops, w.id, b.txnId)).toFixed(2));
  };
  const bPendingBefore = await pendingB();
  const { result } = await terminate(m, a, 'PT_CANCELLED');
  assert.equal((result as any).ptHoldback.held, '500000.00');
  assert.equal((result as any).ptHoldback.compensation, '350000.00');
  assert.equal(await heldNow(m, b), '200000.00', 'B’s pot is untouched');
  assert.equal(await pendingB(), bPendingBefore, 'B’s pending is untouched');
  await assertBooksReconcile(m, 'shared PT wallet');
});

// ── 7. Debt recovery works off released money only ───────────────────────────

test('a PT who owes the platform repays out of what is released, never out of the held amount', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  const debt = await m.prisma.partnerReceivable.create({
    data: { partnerType: 'PT', partnerId: f.parties.ptUserId, amount: 100_000, reason: 'test debt', transactionId: f.txnId },
  });
  await deliver(m, f, 1); // releases 0 → nothing to withhold against
  assert.equal((await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } })).recovered.toFixed(2), '0.00', 'a release of 0 recovers 0');
  assert.equal(await heldNow(m, f), '450000.00', 'and the pot is intact');
  await deliver(m, f, 1); // releases 400.000 → 100.000 goes against the debt
  assert.equal((await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } })).recovered.toFixed(2), '100000.00');
  assert.equal((await balances(m, f)).ptAvailable, '300000.00', '400.000 released − 100.000 recovered');
  await assertBooksReconcile(m, 'debt recovery with holdback');
});

// ── 8. Idle release ──────────────────────────────────────────────────────────

test('idle release: the held amount goes to the PT, later sessions release in full, a later PT-fault ending pays no compensation', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 2); // released 400.000, held 500.000
  assert.equal((await balances(m, f)).ptAvailable, '400000.00');

  const release = () => m.ledger.releasePtHoldback({
    transactionId: f.txnId, parties: f.parties, label: `${f.contractId} holdback`, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}`,
  });
  const r1 = await release();
  assert.deepEqual(r1, { released: '500000.00' });
  // user-service adds what the idle release really moved to the contract's releasedToPt, so
  // termination later sees it as already paid (see the sweep in contract-expiry-sweep.service).
  f.releasedTo.pt = f.releasedTo.pt.plus(r1.released);
  let b = await balances(m, f);
  assert.equal(b.ptAvailable, '900000.00', '400.000 + the 500.000 pot');
  assert.equal(await heldNow(m, f), '0.00');
  assert.deepEqual(
    (await postings(m, f.txnId, `${f.contractId} holdback`)).sort(),
    [
      `PT CREDIT AVAILABLE 500000.00 | ${f.contractId} holdback — PT holdback released (no activity)`,
      `PT DEBIT PENDING 500000.00 | ${f.contractId} holdback — PT holdback released (no activity)`,
    ].sort(),
  );
  await assertBooksReconcile(m, 'idle release');

  // Idempotent: same key replays, a different key for the same payment is a no-op through the marker.
  assert.deepEqual(await release(), r1);
  const other = await m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: 'again', idempotencyKey: 'HOLDBACK_RELEASE:other-key' });
  assert.deepEqual(other, { released: '0.00' });
  assert.deepEqual(await balances(m, f), b, 'nothing moved again');

  // The caller is still sending the rate (its flag has not been saved yet): payment-service
  // enforces "released" from the ledger — the next session releases in full.
  const [s3] = await deliver(m, f, 1);
  assert.equal(s3.released.pt, '450000.00');
  assert.equal('ptHoldback' in s3, false, 'and the result says no holdback applied');
  b = await balances(m, f);
  assert.equal(b.ptAvailable, '1350000.00');

  // A later PT-fault ending: no compensation, even though the caller still sends h.
  const { result, txnId } = await terminate(m, f, 'PT_CANCELLED');
  assert.equal('ptHoldback' in result, false);
  assert.deepEqual((await postings(m, txnId)).filter((l) => /compensation/i.test(l)), []);
  assert.equal(result.refund, '3500000.00');
  assert.equal((await balances(m, f)).ptAvailable, '1350000.00', 'the PT keeps everything earned, no clawback');
  await assertNoOldMechanism(m, txnId, 'after idle release');
  await assertBooksReconcile(m, 'after idle release and PT_CANCELLED');
});

test('idle release with nothing held writes a zero-amount marker, so a session confirmed after it is not held', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  const r = await m.ledger.releasePtHoldback({
    transactionId: f.txnId, parties: f.parties, label: `${f.contractId} holdback`, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}`,
  });
  assert.deepEqual(r, { released: '0.00' });
  const [s1] = await deliver(m, f, 1);
  assert.equal(s1.released.pt, '450000.00', 'first session after the release pays in full');
  await assertBooksReconcile(m, 'idle release, nothing held');
});

test('idle release racing a session release: the pot is released once and nothing is double-moved', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 2);
  const [rel, sess] = await Promise.all([
    m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: 'race', idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` }),
    m.ledger.releaseSession({
      transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions, rates: f.rates, parties: f.parties,
      label: 'race session', idempotencyKey: `SESSION_RELEASE:${f.contractId}:race`, ptHoldbackRate: new m.Prisma.Decimal('0.10'),
    }),
  ]);
  const b = await balances(m, f);
  assert.equal(rel.released, '500000.00', 'whichever ran first, the pot is the same 500.000');
  assert.equal(dec(m, b.ptAvailable).plus(b.ptPending).toFixed(2), '4500000.00', 'PT total claim is the contract’s PT share, nothing created or lost');
  assert.equal(await heldNow(m, f), '0.00', 'the pot is gone');
  void sess;
  await assertBooksReconcile(m, 'race');
});

test('idle release on a contract that already ended moves nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 2);
  await terminate(m, f, 'COMPLETED');
  const before = await balances(m, f);
  const r = await m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: 'late', idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` });
  assert.deepEqual(r, { released: '0.00' });
  assert.deepEqual(await balances(m, f), before);
  await assertBooksReconcile(m, 'release after end');
});

// ── 9. Validation ────────────────────────────────────────────────────────────

test('a rate outside 0..1 is refused before any money moves (release and terminate)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
  await deliver(m, f, 2);
  const before = await balances(m, f);
  for (const bad of ['-0.10', '1.01']) {
    await assert.rejects(
      () => m.ledger.releaseSession({
        transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions, rates: f.rates, parties: f.parties,
        label: 'bad', idempotencyKey: `bad-release-${bad}`, ptHoldbackRate: new m.Prisma.Decimal(bad),
      }),
      /ptHoldbackRate must be between 0 and 1/,
    );
    const params = { ...(await terminateParams(m, f, 'PT_CANCELLED')), ptHoldbackRate: new m.Prisma.Decimal(bad) };
    await assert.rejects(() => m.ledger.terminateContract(params), /ptHoldbackRate must be between 0 and 1/);
  }
  assert.deepEqual(await balances(m, f), before);
  await assertBooksReconcile(m, 'invalid rate');
});

// ── 10. The internal endpoints ───────────────────────────────────────────────

test('internal endpoints: release-session / terminate carry the rate, a body without one is unchanged, a malformed rate is a 400, release-holdback works', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const express = (await import('express')).default;
  const router = (await import('../routes/internal.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/internal', router);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/contracts/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-secret': process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  const rates = { platformRate: '0.10', ptRate: '0.90', gymRate: '0' };
  const common = (f: Fixture) => ({
    transactionId: f.txnId, price: f.price.toString(), totalSessions: f.totalSessions, rates, parties: f.parties,
  });

  try {
    // Today's body — no rate: release-session response is the legacy shape.
    const legacy = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
    const r0 = await post('release-session', { ...common(legacy), label: 'l', idempotencyKey: `SESSION_RELEASE:${legacy.contractId}:1` });
    assert.equal(r0.status, 200);
    assert.deepEqual(r0.json.data, { unit: '500000.00', released: { pt: '450000.00', gym: '0.00', platform: '50000.00' } });

    // A contract that carries the holdback.
    const held = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
    const r1 = await post('release-session', { ...common(held), label: 'h', idempotencyKey: `SESSION_RELEASE:${held.contractId}:1`, ptHoldbackRate: '0.10' });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.json.data.released, { pt: '0.00', gym: '0.00', platform: '50000.00' });
    assert.deepEqual(r1.json.data.ptHoldback, { target: '500000.00', heldNow: '450000.00', totalHeld: '450000.00' });
    const r1b = await post('release-session', { ...common(held), label: 'h2', idempotencyKey: `SESSION_RELEASE:${held.contractId}:2`, ptHoldbackRate: '0.10' });
    assert.equal(r1b.json.data.released.pt, '400000.00');

    // Terminate it with the rate: PT_CANCELLED after 2 sessions. base 4.000.000 → 400.000; held 500.000.
    const t = await post('terminate', {
      ...common(held), usedSessions: 2, reason: 'PT_CANCELLED', label: 'x', idempotencyKey: `CONTRACT_TERMINATE:${held.contractId}`,
      alreadyReleased: { pt: '400000', gym: '0', platform: '100000' }, ptHoldbackRate: '0.10',
    });
    assert.equal(t.status, 200);
    assert.equal(t.json.data.ptHoldback.compensation, '400000.00');
    assert.equal(t.json.data.ptHoldback.returnedToPt, '100000.00');
    // The old parameter is not part of the contract any more: unknown keys are ignored, nothing is charged.
    const old = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
    await post('release-session', { ...common(old), label: 'o', idempotencyKey: `SESSION_RELEASE:${old.contractId}:1` });
    const tOld = await post('terminate', {
      ...common(old), usedSessions: 1, reason: 'PT_CANCELLED', label: 'o', idempotencyKey: `CONTRACT_TERMINATE:${old.contractId}`,
      alreadyReleased: { pt: '450000', gym: '0', platform: '50000' }, ptCancellationCompensationRate: '0.10',
    });
    assert.equal(tOld.status, 200);
    assert.equal('ptHoldback' in tOld.json.data, false);
    assert.equal(await receivableCount(m), 0);

    // Malformed / out of range → 400, never silently "no holdback".
    const bad = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
    for (const rate of ['ten percent', '1.5', '-0.1', '', 0.1]) {
      const rr = await post('release-session', { ...common(bad), label: 'b', idempotencyKey: `SESSION_RELEASE:${bad.contractId}:bad`, ptHoldbackRate: rate });
      assert.equal(rr.status, 400, `rate ${JSON.stringify(rate)} is rejected`);
      assert.equal(rr.json.error.code, 'VALIDATION_ERROR');
      const rt = await post('terminate', {
        ...common(bad), usedSessions: 0, reason: 'PT_CANCELLED', label: 'b', idempotencyKey: `CONTRACT_TERMINATE:${bad.contractId}`,
        alreadyReleased: { pt: '0', gym: '0', platform: '0' }, ptHoldbackRate: rate,
      });
      assert.equal(rt.status, 400, `terminate: rate ${JSON.stringify(rate)} is rejected`);
    }

    // release-holdback
    const idle = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
    await post('release-session', { ...common(idle), label: 'i1', idempotencyKey: `SESSION_RELEASE:${idle.contractId}:1`, ptHoldbackRate: '0.10' });
    const rh = await post('release-holdback', {
      transactionId: idle.txnId, parties: idle.parties, label: 'idle', idempotencyKey: `HOLDBACK_RELEASE:${idle.contractId}`,
    });
    assert.equal(rh.status, 200);
    assert.deepEqual(rh.json.data, { released: '450000.00' });
    const rhBad = await post('release-holdback', { transactionId: idle.txnId, parties: idle.parties, label: 'idle' });
    assert.equal(rhBad.status, 400, 'an idempotency key is required');
    await assertBooksReconcile(m, 'internal endpoints');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
