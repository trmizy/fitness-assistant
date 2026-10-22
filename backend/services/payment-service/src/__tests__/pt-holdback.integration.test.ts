/**
 * PT holdback (FH-9): part of what a PT EARNS on a contract is held back in the HOLDBACK bucket, and a PT-fault ending
 * pays the client compensation OUT OF THAT HELD AMOUNT ONLY.
 *
 *   evidence label: BACKEND INTEGRATION (real ledger code against the isolated *_test database).
 *
 * OWNER DECISION (final): NOTHING is paid to the client out of the hold automatically. A PT-cancelled / repeated-no-show ending keeps the potential
 * PT-fault amount as a RESERVE (and a durable review item); an authorised admin decides (holdback-review.service): VERIFIED pays exactly the verified
 * PT-borne part to the client out of THIS contract's HOLDBACK, the rest goes back to the PT; NOT_VERIFIED releases it all. The fault tests below
 * therefore assert the reserve at the ending and the money after the admin's VERIFIED decision (same numbers as before the decision rule).
 *
 * Ported from the first (pending-label) design when the owner fixed the final rules; the structure and the assertions are the same,
 * the numbers follow the new rule:
 *   1. H = h x (the PT's EXPECTED INCOME on the contract, from its frozen rates) - not h x price;
 *   2. a session that becomes payable puts min(the PT's entitlement for it, H - held so far) into HOLDBACK, the rest to AVAILABLE;
 *   3. COMPLETED / EXPIRED / CLIENT_CANCELLED / MUTUAL / PT_BANNED / CLIENT_EXIT_DUE_TO_PT_RESTRICTION / SERVICE_DISCONTINUED_BY_PLATFORM
 *      give the held amount back to the PT;
 *   4. PT_CANCELLED / PT_REPEATED_NO_SHOW pay the client min(h x base, held) (PT_BANNED is no longer PT fault);
 *   5. a contract with rate 0 or no rate posts exactly what it always has;
 *   6. the old idle release (30 days without a session) is gone: the hold leaves only after the ending, once reconciled.
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
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
  withdrawals: (typeof import('../repositories/withdrawal.repository'))['withdrawalRepository'];
  review: typeof import('../services/holdback-review.service');
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
      review: await import('../services/holdback-review.service'),
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
    ptHoldback: pt.holdbackBalance.toFixed(2),
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

/** The admin's decision (two different people, an approval reference) on the open review of one contract. */
let approvalSeq = 0;
async function decide(m: Mods, f: Fixture, decision: 'VERIFIED' | 'NOT_VERIFIED', verifiedAmount?: string, kind = 'PT_FAULT') {
  const rv = await m.prisma.ptHoldbackReview.findFirstOrThrow({ where: { transactionId: f.txnId, kind: kind as any, status: 'OPEN' } });
  return m.review.decideHoldbackReview({
    reviewId: rv.id, expectedReserve: rv.reserve.toFixed(2), expectedTransactionId: f.txnId, decision, verifiedAmount: decision === 'VERIFIED' ? (verifiedAmount ?? rv.reserve.toFixed(0)) : undefined,
    note: 'checked the evidence of this contract', actor: 'admin-a', approvedBy: 'admin-b', approvalRef: `AP-${++approvalSeq}`, dryRun: false,
  });
}

// ── 1. The collection schedule ───────────────────────────────────────────────

for (const ptRate of ['0.90', '0.50'] as const) {
  test(`collection schedule, price 5.000.000 / 10 sessions / h 0.10 / PT ${ptRate}: target 10% of the PT’s expected income; the PT gets max(0, E − H), the rest is held`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10', ptRate });
    const share = ptRate === '0.90' ? 450_000 : 250_000;
    const H = share; // 10% of the PT’s expected income (10 × share)
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
      assert.equal((await balances(m, f)).ptHoldback, `${Math.min(earned, H)}.00`, `session ${u}: the wallet’s HOLDBACK bucket is that number`);
      assert.equal(r.ptHoldback?.target, `${H}.00`);
      assert.equal(r.ptHoldback?.totalHeld, `${Math.min(earned, H)}.00`);
      // Gym is absent here; the platform is released in full every session, never held.
      assert.equal(r.released.platform, ptRate === '0.90' ? '50000.00' : '250000.00', `session ${u}: platform share released in full`);
      assert.equal(f.releasedTo.pt.toFixed(2), `${expectedCumulative}.00`, `session ${u}: what user-service sums (releasedToPt) is what the PT really has`);
      await assertBooksReconcile(m, `schedule ${ptRate} session ${u}`);
      table.push(`TABLE|release|ptRate=${ptRate}|session=${u}|ptReleased=${expectedThis}|ptCumulative=${expectedCumulative}|ptHeld=${Math.min(earned, H)}`);
    }
    for (const line of table) console.log(line);

    // After the last session the hold is still the hold: it leaves only when the contract ends.
    assert.equal(await heldNow(m, f), `${H}.00`, 'the hold is untouched until the contract ends');
  });
}

test('the first session of a held contract reports 0 for the PT; the gym and the platform are released in full', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 1_000_000, totalSessions: 10, withGym: true, h: '0.10' });
  // PT 0.55 → 55.000 a session, expected income 550.000, H = 55.000: session 1 holds all 55.000, from session 2 the PT is paid in full.
  const [s1, s2, s3] = await deliver(m, f, 3);
  assert.deepEqual(s1.released, { pt: '0.00', gym: '35000.00', platform: '10000.00' });
  assert.deepEqual(s2.released, { pt: '55000.00', gym: '35000.00', platform: '10000.00' });
  assert.deepEqual(s3.released, { pt: '55000.00', gym: '35000.00', platform: '10000.00' });
  assert.equal(s1.ptHoldback?.heldNow, '55000.00');
  assert.equal(s2.ptHoldback?.heldNow, '0.00');
  assert.equal(s3.ptHoldback?.heldNow, '0.00');
  const b = await balances(m, f);
  assert.equal(b.ptAvailable, '110000.00');
  assert.equal(b.ptHoldback, '55000.00');
  assert.equal(b.gymAvailable, '105000.00', 'the gym is exactly what it would be with no holdback: 3 × 35.000');
  assert.equal(b.platformRevenue, '30000.00');
  await assertBooksReconcile(m, 'gym share, three sessions');
});

test('H is floor(h × the PT’s expected income): the sub-đồng remainder is never held', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  // 1.000.007 × 0.90 = 900.006,3 → expected income 900.006 → × 0.10 = 90.000,6 → H = 90.000.
  const f = await paidContract(m, { price: 1_000_007, totalSessions: 7, h: '0.10' });
  const [r] = await deliver(m, f, 1);
  assert.equal(r.ptHoldback?.target, '90000.00');
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
    assert.equal(await m.prisma.walletLedgerEntry.count({ where: { bucket: 'HOLDBACK' } }), 0, 'no HOLDBACK row for an old contract');
    await assertBooksReconcile(m, `legacy release h=${h}`);
  }
});

for (const reason of ['PT_CANCELLED', 'PT_BANNED', 'PT_REPEATED_NO_SHOW', 'CLIENT_CANCELLED', 'MUTUAL', 'EXPIRED', 'COMPLETED', 'SERVICE_DISCONTINUED_BY_PLATFORM'] as Reason[]) {
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
    assert.equal(withoutRate.after.ptHoldback, '0.00');
  });
}

// ── 3. Normal endings give the holdback back ─────────────────────────────────

for (const reason of ['COMPLETED', 'EXPIRED', 'CLIENT_CANCELLED', 'MUTUAL', 'PT_BANNED', 'SERVICE_DISCONTINUED_BY_PLATFORM', 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION'] as Reason[]) {
  for (const taught of reason === 'COMPLETED' ? [10] : [0, 1, 3, 7]) {
    for (const withGym of [false, true]) {
      test(`${reason} after ${taught} sessions${withGym ? ' (gym share)' : ''}: the PT ends up with exactly what they would have with no holdback`, skipOpts, async () => {
        const m = await load();
        const legacy = await scenario(m, { taught, reason, withGym });
        const held = await scenario(m, { h: '0.10', taught, reason, withGym });

        assert.deepEqual(held.after, legacy.after, 'every wallet ends where it ends with no holdback — the held amount came back, nothing else moved');
        assert.equal(held.after.ptHoldback, '0.00', 'and nothing is left in HOLDBACK');
        assert.equal(held.result.refund, legacy.result.refund, 'the refund is unchanged');
        assert.deepEqual(held.result.entitlement, legacy.result.entitlement);
        const ph = (held.result as any).ptHoldback;
        if (taught === 0) {
          assert.equal(ph, undefined, 'nothing was held, so there is no holdback block');
        } else {
          assert.equal(ph.compensation, '0.00', 'no compensation for a non-fault ending');
          assert.equal(ph.returnedToPt, ph.held, 'the whole held amount goes back to the PT');
          assert.equal(ph.stillHeld, '0.00');
          // The held amount reaches the PT through HOLDBACK -> AVAILABLE, not through the pending top-up: that one is the same as with no holdback.
          assert.equal(held.result.topUp.pt, legacy.result.topUp.pt, 'the pending top-up is unchanged: the held amount does not travel through it');
        }
        assert.equal(held.result.shortfall, '0.00');
        assert.equal(held.after.ptPending, legacy.after.ptPending, 'nothing is left stranded in the PT pending');
      });
    }
  }
}

// ── 4. PT-fault endings: compensation out of the held amount only ────────────

/**
 * Prices 5.000.000 / 10 sessions, h 0.10. H = 10% of the PT’s expected income. Expected, from the rule:
 *   PT 0.90: s = 450.000, H = 450.000.  taught 0 → held 0
 *                           taught 1 → held 450.000, ceiling 10% × 4.500.000 = 450.000 → comp 450.000, PT back 0
 *                           taught 3 → held 450.000, ceiling 350.000 → comp 350.000, PT back 100.000
 *   PT 0.50: s = 250.000, H = 250.000.  taught 0 → held 0
 *                           taught 1 → held 250.000, ceiling 450.000 → comp 250.000 (capped by held), PT back 0
 *                           taught 3 → held 250.000, ceiling 350.000 → comp 250.000 (capped by held), PT back 0
 */
const FAULT_EXPECTATIONS: Record<'0.90' | '0.50', Record<number, { held: string; comp: string; back: string }>> = {
  '0.90': {
    0: { held: '0.00', comp: '0.00', back: '0.00' },
    1: { held: '450000.00', comp: '450000.00', back: '0.00' },
    3: { held: '450000.00', comp: '350000.00', back: '100000.00' },
  },
  '0.50': {
    0: { held: '0.00', comp: '0.00', back: '0.00' },
    1: { held: '250000.00', comp: '250000.00', back: '0.00' },
    3: { held: '250000.00', comp: '250000.00', back: '0.00' },
  },
};

for (const ptRate of ['0.90', '0.50'] as const) {
  for (const taught of [0, 1, 3]) {
    const reason: Reason = 'PT_CANCELLED';
    test(`${reason}, PT ${ptRate}, after ${taught} session(s): nothing is paid at the ending - the potential amount min(10% × remaining, held) is RESERVED; after the admin VERIFIES it, the client gets exactly it out of the hold and the rest returns to the PT`, skipOpts, async () => {
      const m = await load();
      const legacy = await scenario(m, { taught, reason, ptRate });
      const held = await scenario(m, { h: '0.10', taught, reason, ptRate });
      const exp = FAULT_EXPECTATIONS[ptRate][taught];

      const ph = (held.result as any).ptHoldback;
      assert.equal(held.heldBefore, exp.held, 'what was really held when the PT left');
      assert.equal(ph?.held ?? '0.00', exp.held);
      assert.equal(ph?.compensation ?? '0.00', '0.00', 'NOTHING is paid to the client out of the hold at the ending');
      assert.equal(ph?.stillHeld ?? '0.00', exp.comp, 'the potential PT-fault amount stays held as a reserve');
      assert.equal(ph?.returnedToPt ?? '0.00', exp.back, 'the rest of the hold is released to the PT at once');
      assert.equal(held.result.refund, legacy.result.refund, 'the client still gets the normal refund, unchanged');
      assert.equal(held.after.clientAvailable, legacy.after.clientAvailable, 'and nothing more before the decision');
      assert.equal(held.after.ptHoldback, exp.comp, 'the reserve is in the PT wallet HOLDBACK');
      assert.equal(held.after.platformRevenue, legacy.after.platformRevenue);
      assert.equal(held.after.escrow, legacy.after.escrow, 'escrow untouched');
      if (dec(m, exp.comp).isZero()) {
        assert.equal(await m.prisma.ptHoldbackReview.count({ where: { transactionId: held.txnId } }), 0, 'nothing reserved, no review');
        return;
      }
      const review = await m.prisma.ptHoldbackReview.findFirstOrThrow({ where: { transactionId: held.txnId } });
      assert.equal(review.kind, 'PT_FAULT');
      assert.equal(review.status, 'OPEN');
      assert.equal(review.reserve.toFixed(2), exp.comp);
      assert.ok(review.reviewBy.getTime() > Date.now() + 13 * 24 * 3600 * 1000, 'a review-by deadline (14 days) is set');
      assert.equal(review.createdBy, 'SYSTEM');

      // The admin VERIFIES the whole reserve: the client is paid exactly it, from THIS contract's hold.
      const d = await decide(m, held.f, 'VERIFIED');
      assert.equal(d.paidToClient, exp.comp);
      assert.equal(d.releasedToPt, '0.00');
      const after = await balances(m, held.f);
      assert.equal(dec(m, after.clientAvailable).minus(legacy.after.clientAvailable).toFixed(2), exp.comp, 'client: + compensation');
      assert.equal(dec(m, legacy.after.ptAvailable).minus(after.ptAvailable).toFixed(2), exp.comp, 'PT: − compensation, relative to a contract with no holdback');
      assert.equal(after.platformRevenue, legacy.after.platformRevenue, 'the platform neither pays nor gains');
      assert.equal(after.ptHoldback, '0.00');
      assert.equal(after.ptPending, '0.00');
      const share = ptRate === '0.90' ? 450_000 : 250_000;
      const released = Math.max(0, share * taught - share);
      assert.equal(after.ptAvailable, dec(m, String(released)).plus(exp.back).toFixed(2), 'PT final available = released + returned');

      const lines = await postings(m, held.txnId, 'holdback review');
      const clientLines = lines.filter((l) => /^CLIENT CREDIT/.test(l) && /compensation/i.test(l));
      assert.equal(clientLines.length, 1, 'one separate, clearly-described credit to the client');
      assert.match(clientLines[0], new RegExp(`^CLIENT CREDIT AVAILABLE ${exp.comp.replace('.', '\\.')} \\| .*compensation for the PT's responsibility \\(from the PT's held-back earnings\\)$`));
      assert.equal(lines.filter((l) => /^PT DEBIT HOLDBACK/.test(l) && /used for compensation/.test(l)).length, 1, 'funded by exactly one debit of the contract’s own HOLDBACK');
      // Counts as withdrawable: the withdrawal code matches on the word "compensation".
      const clientWallet = await m.wallet.getOrCreateWallet('CLIENT', held.f.parties.clientUserId);
      assert.equal((await m.withdrawals.sumRefundSourcedCredits(clientWallet.id)).toFixed(2), after.clientAvailable, 'refund + compensation are both withdrawable');
      await assertBooksReconcile(m, `${reason} ${ptRate} ${taught} decided`);
      console.log(`TABLE|fault|reason=${reason}|ptRate=${ptRate}|taught=${taught}|held=${exp.held}|reserve=${exp.comp}|returnedAtEnd=${exp.back}|paidAfterVerified=${d.paidToClient}|ptAvailableFinal=${after.ptAvailable}|clientTotal=${after.clientAvailable}`);
    });
  }
}

test('PT_BANNED is NOT a fault reason any more: a ban never compensates the client out of the hold; the PT gets all of it back', skipOpts, async () => {
  const m = await load();
  const legacy = await scenario(m, { taught: 3, reason: 'PT_BANNED' });
  const held = await scenario(m, { h: '0.10', taught: 3, reason: 'PT_BANNED' });
  assert.equal(held.heldBefore, '450000.00');
  assert.equal((held.result as any).ptHoldback.compensation, '0.00');
  assert.equal((held.result as any).ptHoldback.returnedToPt, '450000.00');
  assert.deepEqual(held.after, legacy.after);
  assert.deepEqual((await postings(m, held.txnId)).filter((l) => /compensation/i.test(l)), []);
});

for (const ptRate of ['0.90', '0.50'] as const) {
  test(`PT_REPEATED_NO_SHOW, PT ${ptRate}: 3 taught then 3 no-shows reserves the same potential amount as cancelling after 3 (base = remaining + already-compensated); nothing is paid until the admin verifies it`, skipOpts, async () => {
    const m = await load();
    const cancel = await scenario(m, { h: '0.10', taught: 3, reason: 'PT_CANCELLED', ptRate });
    const legacyNs = await scenario(m, { taught: 3, noShows: 3, reason: 'PT_REPEATED_NO_SHOW', ptRate });
    const ns = await scenario(m, { h: '0.10', taught: 3, noShows: 3, reason: 'PT_REPEATED_NO_SHOW', ptRate }); // last: its ledger is read below

    const held = ptRate === '0.90' ? '450000.00' : '250000.00';
    const comp = ptRate === '0.90' ? '350000.00' : '250000.00';
    const back = ptRate === '0.90' ? '100000.00' : '0.00';
    const ph = (ns.result as any).ptHoldback;
    assert.equal(ns.heldBefore, held, 'the no-show charges came out of the sessions never delivered, not out of the held amount');
    assert.equal(ph.compensation, '0.00', 'nothing is paid at the ending');
    assert.equal(ph.stillHeld, comp, 'remaining 2.000.000 + compensated 1.500.000 = 3.500.000 → 10% = 350.000, capped by what is held');
    assert.equal(ph.stillHeld, (cancel.result as any).ptHoldback.stillHeld, 'never cheaper to stop turning up than to cancel');
    assert.equal(ph.returnedToPt, back);
    assert.equal(ns.result.refund, '2000000.00', 'the refund is the remaining value only — the compensated sessions were already paid back');
    assert.equal(ns.after.clientAvailable, legacyNs.after.clientAvailable);

    const d = await decide(m, ns.f, 'VERIFIED');
    assert.equal(d.paidToClient, comp);
    const after = await balances(m, ns.f);
    assert.equal(dec(m, after.clientAvailable).minus(legacyNs.after.clientAvailable).toFixed(2), comp);
    assert.equal(dec(m, legacyNs.after.ptAvailable).minus(after.ptAvailable).toFixed(2), comp);
    assert.equal(after.platformRevenue, legacyNs.after.platformRevenue);
    console.log(`TABLE|norshow|ptRate=${ptRate}|taught=3|noShows=3|held=${ns.heldBefore}|reserve=${ph.stillHeld}|returnedAtEnd=${ph.returnedToPt}|paidAfterVerified=${d.paidToClient}|ptAvailableFinal=${after.ptAvailable}`);
  });
}

test('PT no-shows eating every undelivered session leave the held amount intact (7 of 10 missed)', skipOpts, async () => {
  const m = await load();
  const r = await scenario(m, { h: '0.10', taught: 3, noShows: 7, reason: 'PT_REPEATED_NO_SHOW' });
  assert.equal(r.heldBefore, '450000.00');
  assert.equal(r.beforeEnd.ptPending, '0.00', 'the no-show charges drained the contract’s pending…');
  assert.equal(r.beforeEnd.ptHoldback, '450000.00', '…and could not touch the held money, which sits in its own bucket');
  assert.equal((r.result as any).ptHoldback.compensation, '0.00');
  assert.equal((r.result as any).ptHoldback.stillHeld, '350000.00', 'base = 0 remaining + 7 × 500.000 compensated → 10% = 350.000 reserved');
  assert.equal((r.result as any).ptHoldback.returnedToPt, '100000.00');
  assert.equal(r.result.refund, '0.00', 'every undelivered session was already paid back');
});

test('the held money cannot be shrunk by anything that draws on pending: a no-show charge, a refund, a termination drain', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 1); // held 450.000
  const ptWallet = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  const revenue = await m.wallet.getRevenueWallet();
  // The extreme the old (pending-label) design had to clamp for: this contract’s pending consumed down to 100.000.
  const drain = ptWallet.pendingBalance.minus(100_000);
  await m.wallet.withWallets([ptWallet.id, revenue.id], f.txnId, async (ops) => {
    await ops.debit(ptWallet.id, drain, 'test — pending consumed by no-show charges', 'PENDING');
    await ops.credit(revenue.id, drain, 'test — charge booked to platform', 'AVAILABLE');
  });
  assert.equal(await heldNow(m, f), '450000.00', 'the held money is in its own bucket: nothing that draws on pending can shrink it');
  await assertBooksReconcile(m, 'held is not pending');
});

test('money locked for an approved withdrawal and the PT’s available balance are never touched by the reserve or the verified payment', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 3); // released 900.000, held 450.000
  const ptWallet = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  const lock = dec(m, '800000');
  await m.wallet.withWallets([ptWallet.id], f.txnId, async (ops) => {
    await ops.debit(ptWallet.id, lock, 'test — withdrawal approved', 'AVAILABLE');
    await ops.credit(ptWallet.id, lock, 'test — withdrawal approved', 'LOCKED');
  });
  const before = await balances(m, f);
  assert.equal(before.ptAvailable, '100000.00');
  assert.equal(before.ptLocked, '800000.00');

  const { result } = await terminate(m, f, 'PT_CANCELLED');
  assert.equal((result as any).ptHoldback.stillHeld, '350000.00');
  const mid = await balances(m, f);
  assert.equal(mid.ptLocked, '800000.00', 'the approved withdrawal is intact');
  assert.equal(mid.ptAvailable, dec(m, before.ptAvailable).plus('100000').toFixed(2), 'available only GAINED the 100.000 of the hold that is not at risk');
  await decide(m, f, 'VERIFIED');
  const after = await balances(m, f);
  assert.equal(after.ptLocked, '800000.00', 'and the verified payment did not touch it either');
  assert.equal(after.ptAvailable, mid.ptAvailable, 'nor the available balance: it came out of the contract’s hold');
  await assertBooksReconcile(m, 'locked balance respected');
});

test('never platform money: with REVENUE empty, a PT quitting before the first session still settles — nothing held, nothing owed, nothing fronted', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  assert.equal((await balances(m, f)).platformRevenue, '0.00');
  const { result, txnId } = await terminate(m, f, 'PT_CANCELLED');
  assert.equal(result.refund, '5000000.00');
  assert.equal((result as any).ptHoldback, undefined, 'nothing held, no holdback block');
  assert.deepEqual((await postings(m, txnId)).filter((l) => /compensation/i.test(l)), []);
  assert.equal((await balances(m, f)).clientAvailable, '5000000.00', 'the client gets exactly the refund');
  await assertNoOldMechanism(m, txnId, 'before first session');
  await assertBooksReconcile(m, 'quit before first session');
});

test('a contract with a gym share: the gym and the platform keep exactly what they earned; the PT alone funds the (verified) compensation', skipOpts, async () => {
  const m = await load();
  const legacy = await scenario(m, { price: 1_000_000, sessions: 10, taught: 2, reason: 'PT_CANCELLED', withGym: true });
  const held = await scenario(m, { h: '0.10', price: 1_000_000, sessions: 10, taught: 2, reason: 'PT_CANCELLED', withGym: true });
  // PT s = 55.000, H = 10% × 550.000 = 55.000: after 2 sessions held 55.000, released 55.000. Ceiling = 10% × 800.000 = 80.000 → reserve capped by held.
  assert.equal((held.result as any).ptHoldback.stillHeld, '55000.00');
  assert.equal((held.result as any).ptHoldback.compensation, '0.00');
  await decide(m, held.f, 'VERIFIED');
  const after = await balances(m, held.f);
  assert.equal(after.gymAvailable, legacy.after.gymAvailable, 'gym unchanged');
  assert.equal(after.gymPending, legacy.after.gymPending);
  assert.equal(after.platformRevenue, legacy.after.platformRevenue, 'platform unchanged');
  assert.equal(dec(m, after.clientAvailable).minus(legacy.after.clientAvailable).toFixed(2), '55000.00');
  assert.equal(dec(m, legacy.after.ptAvailable).minus(after.ptAvailable).toFixed(2), '55000.00');
  const sum = dec(m, after.clientAvailable).plus(after.ptAvailable).plus(after.gymAvailable).plus(after.platformRevenue);
  assert.equal(sum.toFixed(2), '1000000.00', 'all four parts rebuild the price');
});

test('rounding: 1.000.000 over 3 sessions with a gym share — whole đồng, the reserve is capped by the hold, nothing lost', skipOpts, async () => {
  const m = await load();
  const legacy = await scenario(m, { price: 1_000_000, sessions: 3, taught: 1, reason: 'PT_CANCELLED', withGym: true });
  const held = await scenario(m, { h: '0.10', price: 1_000_000, sessions: 3, taught: 1, reason: 'PT_CANCELLED', withGym: true });
  // s_pt = floor(333.333 × 0.55) = 183.333; expected income 550.000 → H = 55.000: held 55.000, released 128.333.
  // ceiling = ceil(10% × 666.666,67) = 66.667 → reserve capped by what is held.
  const ph = (held.result as any).ptHoldback;
  assert.equal(ph.held, '55000.00');
  assert.equal(ph.stillHeld, '55000.00', 'capped by the held amount');
  assert.equal(ph.returnedToPt, '0.00');
  assert.equal(held.result.refund, '666667.00', 'rounded up like every client-facing amount');
  await decide(m, held.f, 'VERIFIED');
  const after = await balances(m, held.f);
  assert.equal(dec(m, legacy.after.ptAvailable).minus(after.ptAvailable).toFixed(2), '55000.00');
  const total = ['clientAvailable', 'ptAvailable', 'gymAvailable', 'platformRevenue', 'ptPending', 'gymPending', 'platformPending', 'ptHoldback']
    .reduce((acc, k) => acc.plus((after as any)[k]), dec(m, '0'));
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
  assert.equal(lines.filter((l) => /^CLIENT CREDIT/.test(l) && /compensation/i.test(l)).length, 0, 'no automatic compensation');
  assert.equal(lines.filter((l) => /refund \(PT_CANCELLED\)/.test(l)).length, 1, 'one refund');
  assert.equal(await m.prisma.ptHoldbackReview.count({ where: { transactionId: params.transactionId } }), 1, 'one review item, however many callers');
  const bal = await balances(m, f);
  assert.equal(bal.clientAvailable, '3500000.00', 'client paid once: the refund only');
  assert.equal(bal.ptAvailable, '1000000.00', '900.000 released + 100.000 returned');
  assert.equal(bal.ptHoldback, '350000.00', 'the potential PT-fault amount is reserved, once');
  await assertBooksReconcile(m, 'concurrent termination');
});

test('a retried release replays; concurrent releases of different sessions fill the hold exactly once', skipOpts, async () => {
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
  assert.equal(b.ptAvailable, '1350000.00', 'four distinct sessions: 4 × 450.000 − 450.000 (the duplicate of session 2 changed nothing)');
  assert.equal(await heldNow(m, f), '450000.00');
  await assertBooksReconcile(m, 'concurrent releases');
});

// ── 6. Contracts sharing a PT wallet ─────────────────────────────────────────

test('two held contracts of one PT: each hold is its own; ending one (reserve, then verified payment) leaves the other’s hold and pending intact', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const pt = 'pt-shared';
  const a = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10', ptUserId: pt });
  const b = await paidContract(m, { price: 2_000_000, totalSessions: 8, h: '0.10', ptUserId: pt });
  await deliver(m, a, 3);
  await deliver(m, b, 1); // s = 225.000, expected 1.800.000, H = 180.000 → held 180.000, released 45.000
  assert.equal(await heldNow(m, a), '450000.00');
  assert.equal(await heldNow(m, b), '180000.00');

  const pendingB = async () => {
    const w = await m.wallet.getOrCreateWallet('PT', pt);
    return m.wallet.withWallets([w.id], b.txnId, async (ops) => (await (await import('../services/wallet.service')).pendingForTransaction(ops, w.id, b.txnId)).toFixed(2));
  };
  const bPendingBefore = await pendingB();
  const bRows = await m.prisma.walletLedgerEntry.count({ where: { transactionId: b.txnId } });
  const { result } = await terminate(m, a, 'PT_CANCELLED');
  assert.equal((result as any).ptHoldback.held, '450000.00');
  assert.equal((result as any).ptHoldback.stillHeld, '350000.00');
  assert.equal((await m.wallet.getOrCreateWallet('PT', pt)).holdbackBalance.toFixed(2), '530000.00', 'B’s 180.000 + A’s reserve 350.000');
  const d = await decide(m, a, 'VERIFIED', '200000');
  assert.equal(d.paidToClient, '200000.00');
  assert.equal(d.releasedToPt, '150000.00', 'the rest of A’s reserve goes back to the PT');
  assert.equal(await heldNow(m, a), '0.00');
  assert.equal(await heldNow(m, b), '180000.00', 'B’s hold is untouched');
  assert.equal(await pendingB(), bPendingBefore, 'B’s pending is untouched');
  assert.equal(await m.prisma.walletLedgerEntry.count({ where: { transactionId: b.txnId } }), bRows, 'no ledger row of B was written');
  assert.equal((await m.wallet.getOrCreateWallet('PT', pt)).holdbackBalance.toFixed(2), '180000.00', 'the wallet bucket is exactly B’s hold now');
  await assertBooksReconcile(m, 'shared PT wallet');
});

// ── 7. An old debt is never collected (owner decision) ───────────────────────

test('a PT who owes the platform an old debt is paid in full: nothing is deducted from released or held money', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  const debt = await m.prisma.partnerReceivable.create({
    data: { partnerType: 'PT', partnerId: f.parties.ptUserId, amount: 100_000, reason: 'test debt', transactionId: f.txnId },
  });
  await deliver(m, f, 1);
  await deliver(m, f, 1);
  const row = await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } });
  assert.equal(row.recovered.toFixed(2), '0.00', 'nothing recovered');
  assert.equal(row.settledAt, null);
  assert.equal((await balances(m, f)).ptAvailable, '450000.00', 'the whole 450.000 release reached the PT');
  assert.equal(await heldNow(m, f), '450000.00', 'and the hold is intact');
  await terminate(m, f, 'COMPLETED');
  assert.equal((await m.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: debt.id } })).recovered.toFixed(2), '0.00', 'not at the release of the hold either');
  await assertBooksReconcile(m, 'no debt recovery with holdback');
});

// ── 8. Release: only after the contract has ended and is reconciled (replaces the old idle release) ──

test('release is never early: on a running contract it moves nothing and says why; later sessions still release in full once the hold is full', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 2); // released 450.000, held 450.000
  assert.equal((await balances(m, f)).ptAvailable, '450000.00');

  const release = (key = `HOLDBACK_RELEASE:${f.contractId}`) => m.ledger.releasePtHoldback({
    transactionId: f.txnId, parties: f.parties, label: `${f.contractId} holdback`, idempotencyKey: key,
  });
  const r1 = await release();
  assert.deepEqual(r1, { released: '0.00', heldAfter: '450000.00', ended: false, reconciled: false, blockedBy: { notEnded: true, openReviews: [] } });
  const before = await balances(m, f);
  assert.equal(before.ptAvailable, '450000.00', 'nothing moved');
  assert.equal(await heldNow(m, f), '450000.00');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: `HOLDBACK_RELEASE:${f.contractId}` } }), 0, 'a non-final answer is not stored: the next sweep must be able to release');

  const [s3] = await deliver(m, f, 1);
  assert.equal(s3.released.pt, '450000.00');
  assert.equal(s3.ptHoldback?.heldNow, '0.00', 'the hold is full: nothing more is held');
  await assertBooksReconcile(m, 'release is never early');
});

test('release after the ending: an ending that returned everything leaves a final, zero answer; a session call arriving after the ending is never held', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 2);
  await terminate(m, f, 'MUTUAL');
  const release = () => m.ledger.releasePtHoldback({
    transactionId: f.txnId, parties: f.parties, label: `${f.contractId} holdback`, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}`,
  });
  const r = await release();
  assert.deepEqual(r, { released: '0.00', heldAfter: '0.00', ended: true, reconciled: true });
  assert.deepEqual(await release(), r);
  const late = await m.ledger.releaseSession({
    transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions, rates: f.rates, parties: f.parties,
    label: 'late', idempotencyKey: `SESSION_RELEASE:${f.contractId}:late`, ptHoldbackRate: new m.Prisma.Decimal('0.10'),
  });
  assert.equal('ptHoldback' in late, false, 'the hold is never raised after the ending');
  assert.equal(await heldNow(m, f), '0.00');
  await assertBooksReconcile(m, 'release after the ending');
});

test('a release racing a session release on a running contract: the release is a no-op, the hold is kept, nothing is double-moved', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paidContract(m, { price: 5_000_000, totalSessions: 10, h: '0.10' });
  await deliver(m, f, 2);
  const [rel] = await Promise.all([
    m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: 'race', idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` }),
    m.ledger.releaseSession({
      transactionId: f.txnId, price: f.price, totalSessions: f.totalSessions, rates: f.rates, parties: f.parties,
      label: 'race session', idempotencyKey: `SESSION_RELEASE:${f.contractId}:race`, ptHoldbackRate: new m.Prisma.Decimal('0.10'),
    }),
  ]);
  const b = await balances(m, f);
  assert.equal(rel.released, '0.00');
  assert.equal(dec(m, b.ptAvailable).plus(b.ptPending).plus(b.ptHoldback).toFixed(2), '4500000.00', 'PT total claim is the contract’s PT share, nothing created or lost');
  assert.equal(await heldNow(m, f), '450000.00', 'the hold is kept');
  await assertBooksReconcile(m, 'race');
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
    assert.deepEqual(r1.json.data.ptHoldback, { target: '450000.00', heldNow: '450000.00', totalHeld: '450000.00' });
    const r1b = await post('release-session', { ...common(held), label: 'h2', idempotencyKey: `SESSION_RELEASE:${held.contractId}:2`, ptHoldbackRate: '0.10' });
    assert.equal(r1b.json.data.released.pt, '450000.00');

    // Terminate it with the rate: PT_CANCELLED after 2 sessions. base 4.000.000 → 400.000; held 450.000.
    const t = await post('terminate', {
      ...common(held), usedSessions: 2, reason: 'PT_CANCELLED', label: 'x', idempotencyKey: `CONTRACT_TERMINATE:${held.contractId}`,
      alreadyReleased: { pt: '450000', gym: '0', platform: '100000' }, ptHoldbackRate: '0.10',
    });
    assert.equal(t.status, 200);
    assert.equal(t.json.data.ptHoldback.compensation, '0.00', 'nothing is paid automatically');
    assert.equal(t.json.data.ptHoldback.stillHeld, '400000.00', 'the potential PT-fault amount is reserved');
    assert.equal(t.json.data.ptHoldback.returnedToPt, '50000.00');
    assert.deepEqual(t.json.data.ptHoldback.reserves.map((r: any) => [r.kind, r.reserve]), [['PT_FAULT', '400000.00']]);
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

    // D49: the new reason is accepted by the endpoint and is not PT fault.
    const d49 = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
    await post('release-session', { ...common(d49), label: 'd', idempotencyKey: `SESSION_RELEASE:${d49.contractId}:1`, ptHoldbackRate: '0.10' });
    const td = await post('terminate', {
      ...common(d49), usedSessions: 1, reason: 'SERVICE_DISCONTINUED_BY_PLATFORM', label: 'd', idempotencyKey: `CONTRACT_TERMINATE:${d49.contractId}`,
      alreadyReleased: { pt: '0', gym: '0', platform: '50000' }, ptHoldbackRate: '0.10',
    });
    assert.equal(td.status, 200);
    assert.equal(td.json.data.ptHoldback.compensation, '0.00');
    assert.equal(td.json.data.ptHoldback.returnedToPt, '450000.00');

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

    // release-holdback: not before the ending, then final.
    const idle = await paidContract(m, { price: 5_000_000, totalSessions: 10 });
    await post('release-session', { ...common(idle), label: 'i1', idempotencyKey: `SESSION_RELEASE:${idle.contractId}:1`, ptHoldbackRate: '0.10' });
    const rhEarly = await post('release-holdback', {
      transactionId: idle.txnId, parties: idle.parties, label: 'idle', idempotencyKey: `HOLDBACK_RELEASE:${idle.contractId}`,
    });
    assert.equal(rhEarly.status, 200);
    assert.equal(rhEarly.json.data.released, '0.00');
    assert.equal(rhEarly.json.data.ended, false);
    assert.equal(rhEarly.json.data.heldAfter, '450000.00');
    const tIdle = await post('terminate', {
      ...common(idle), usedSessions: 1, reason: 'COMPLETED', label: 'i', idempotencyKey: `CONTRACT_TERMINATE:${idle.contractId}`,
      alreadyReleased: { pt: '0', gym: '0', platform: '50000' }, ptHoldbackRate: '0.10',
    });
    assert.equal(tIdle.status, 200);
    const rh = await post('release-holdback', {
      transactionId: idle.txnId, parties: idle.parties, label: 'idle', idempotencyKey: `HOLDBACK_RELEASE:${idle.contractId}`,
    });
    assert.equal(rh.status, 200);
    assert.deepEqual(rh.json.data, { released: '0.00', heldAfter: '0.00', ended: true, reconciled: true });
    const rhBad = await post('release-holdback', { transactionId: idle.txnId, parties: idle.parties, label: 'idle' });
    assert.equal(rhBad.status, 400, 'an idempotency key is required');
    await assertBooksReconcile(m, 'internal endpoints');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
