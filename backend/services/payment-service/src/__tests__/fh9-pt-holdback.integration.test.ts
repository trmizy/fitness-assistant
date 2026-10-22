/**
 * FH-9 - PT FINANCIAL HOLDBACK (final owner rules). BACKEND INTEGRATION: the real ledger code against the isolated *_test database.
 *
 * Rules pinned here (each assertion reads REAL ledger rows / wallet balances, never a formula's return value):
 *   - the target is rate x (the PT's EXPECTED INCOME on the contract, from the contract's frozen rates) - never the client's payment;
 *   - the hold is collected when a session becomes payable: min(the PT's actual entitlement for the session, target - held so far);
 *     the rest goes to AVAILABLE; once the target is held nothing more is held; a PT no-show session has no PT income -> nothing held;
 *   - held money is its own bucket (HOLDBACK): earned, the PT's, not withdrawable, per contract, never platform revenue;
 *   - release: only after the contract has ended AND no reserve waits; exactly once; early endings settle the contract's own items first,
 *     the rest returns to the PT; nothing is forfeited automatically; PT_BANNED / restrictions / SERVICE_DISCONTINUED_BY_PLATFORM are not PT fault;
 *   - OWNER DECISION: nothing is paid to the client out of the hold automatically. The ending keeps only a RESERVE (potential PT-fault amount,
 *     the PT-borne part of open obligations, the unsecured part of unresolved sessions; up to the whole hold if the risk cannot be computed), each
 *     with a durable review item (reason, amount, deadline); an authorised admin VERIFIES (pays exactly the PT-borne verified part from THIS
 *     contract's hold, returns the rest) or NOT_VERIFIES (returns all); four-eyes, idempotent, CAS, dry-run;
 *   - no phantom money: escrow == every claim, every bucket is explained by its rows, no negative balance, no PartnerReceivable.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:<pw>@localhost:55433/gymcoach_payment_fh9_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh9-pt-holdback.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = { skip: isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  money: typeof import('../services/contract-money');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
  withdrawals: (typeof import('../services/withdrawal.service'))['withdrawalService'];
  review: typeof import('../services/holdback-review.service');
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
      withdrawals: (await import('../services/withdrawal.service')).withdrawalService,
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

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations, contract_unpaid_obligations RESTART IDENTITY CASCADE',
  );
}

const D = (m: Mods, v: string | number) => new m.Prisma.Decimal(v);
const rt = (m: Mods, platform: string, pt: string, gym: string): Rates => ({ platformRate: D(m, platform), ptRate: D(m, pt), gymRate: D(m, gym) });

interface Fx {
  contractId: string;
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: Dec;
  n: number;
  rates: Rates;
  h?: string;
  releasedTo: { pt: Dec; gym: Dec; platform: Dec };
  used: number;
  compensated: number;
  seq: number;
}

async function paid(
  m: Mods,
  o: { price: number; n: number; rates?: Rates; h?: string; ptUserId?: string; withGym?: boolean },
): Promise<Fx> {
  const sfx = randomUUID().slice(0, 8);
  const rates = o.rates ?? (o.withGym ? rt(m, '0.10', '0.55', '0.35') : rt(m, '0.10', '0.90', '0'));
  const hasGym = rates.gymRate.greaterThan(0);
  const parties = { ptUserId: o.ptUserId ?? `pt-${sfx}`, gymId: hasGym ? `gym-${sfx}` : null, clientUserId: `client-${sfx}` };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: parties.clientUserId, purpose: 'PT_CONTRACT', amount: o.price, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${sfx}`, idempotencyKey: `contract-${sfx}`, relatedEntityType: 'PT_CONTRACT', relatedEntityId: `contract-${sfx}`,
      activationStatus: 'PENDING', sourceService: 'integration-test',
      metadata: {
        rates: { platformRate: rates.platformRate.toString(), ptRate: rates.ptRate.toString(), gymRate: rates.gymRate.toString() },
        parties,
      },
    },
  });
  const z = D(m, 0);
  const f: Fx = { contractId: `contract-${sfx}`, txnId: txn.id, parties, price: D(m, o.price), n: o.n, rates, h: o.h, releasedTo: { pt: z, gym: z, platform: z }, used: 0, compensated: 0, seq: 0 };
  await m.ledger.settleContractPayment({ transactionId: f.txnId, price: f.price, rates, parties, label: f.contractId });
  return f;
}

const hArg = (m: Mods, f: Fx) => (f.h !== undefined ? { ptHoldbackRate: D(m, f.h) } : {});

async function deliver(m: Mods, f: Fx, late = false) {
  const n = ++f.seq;
  if (late) {
    await m.ledger.compensateLateArrival({
      transactionId: f.txnId, price: f.price, totalSessions: f.n, rates: f.rates, parties: f.parties,
      label: `${f.contractId} late ${n}`, idempotencyKey: `PT_LATE_ARRIVAL:${f.contractId}:${n}`,
    });
  }
  const r = await m.ledger.releaseSession({
    transactionId: f.txnId, price: f.price, totalSessions: f.n, rates: f.rates, parties: f.parties,
    label: `${f.contractId} session ${n}`, idempotencyKey: `SESSION_RELEASE:${f.contractId}:${n}`, ...hArg(m, f),
  });
  f.used++;
  f.releasedTo.pt = f.releasedTo.pt.plus(r.released.pt);
  f.releasedTo.gym = f.releasedTo.gym.plus(r.released.gym);
  f.releasedTo.platform = f.releasedTo.platform.plus(r.released.platform);
  return r;
}

async function noShow(m: Mods, f: Fx) {
  const n = ++f.seq;
  const r = await m.ledger.compensateNoShow({
    transactionId: f.txnId, price: f.price, totalSessions: f.n, rates: f.rates, parties: f.parties,
    label: `${f.contractId} no-show ${n}`, idempotencyKey: `PT_NO_SHOW:${f.contractId}:${n}`,
  });
  if (Number(r.paid) > 0 || Number(r.owed) === Number(r.paid)) f.compensated++;
  return r;
}

function termParams(m: Mods, f: Fx, reason: Reason, extra: { unresolved?: number } = {}) {
  return {
    transactionId: f.txnId, price: f.price, totalSessions: f.n, usedSessions: f.used, compensatedSessions: f.compensated,
    ...(extra.unresolved ? { unresolvedSessions: extra.unresolved } : {}),
    rates: f.rates, reason, alreadyReleased: f.releasedTo, parties: f.parties, label: `${f.contractId} termination`,
    idempotencyKey: `CONTRACT_TERMINATE:${f.contractId}`, ...hArg(m, f),
  };
}
const terminate = (m: Mods, f: Fx, reason: Reason, extra: { unresolved?: number } = {}) => m.ledger.terminateContract(termParams(m, f, reason, extra));

async function bal(m: Mods, f: Fx) {
  const [pt, gym, client, escrow, rev] = await Promise.all([
    m.wallet.getOrCreateWallet('PT', f.parties.ptUserId),
    f.parties.gymId ? m.wallet.getOrCreateWallet('GYM', f.parties.gymId) : Promise.resolve(null),
    m.wallet.getOrCreateWallet('CLIENT', f.parties.clientUserId),
    m.wallet.getEscrowWallet(),
    m.wallet.getRevenueWallet(),
  ]);
  return {
    ptAvailable: pt.availableBalance, ptPending: pt.pendingBalance, ptHoldback: pt.holdbackBalance, ptLocked: pt.lockedBalance,
    gymAvailable: gym?.availableBalance ?? D(m, 0),
    client: client.availableBalance, escrow: escrow.availableBalance, revenue: rev.availableBalance, revenuePending: rev.pendingBalance,
  };
}
const str = (v: Dec) => v.toFixed(0);

/** Σ HOLDBACK rows of ONE contract = what is held for it. */
async function heldOf(m: Mods, f: Fx): Promise<string> {
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { transactionId: f.txnId, bucket: 'HOLDBACK' } });
  return rows.reduce((s, r) => (r.entryType === 'CREDIT' ? s.plus(r.amount) : s.minus(r.amount)), D(m, 0)).toFixed(0);
}

/** Escrow == every claim; no negative wallet; every bucket (incl. HOLDBACK) equals the sum of its rows; whole đồng only; no receivable. */
async function assertBooksSound(m: Mods, ctx: string) {
  const report = await m.reconcile.assertInvariant(ctx);
  assert.equal(report.drift, '0.00', `${ctx}: escrow == claims`);
  assert.equal(report.negativeWallets.length, 0, `${ctx}: no negative wallet`);
  const bad = await m.prisma.$queryRawUnsafe<{ id: string; b: string }[]>(`
    SELECT w.id, b.bucket AS b
      FROM wallets w CROSS JOIN (VALUES ('PENDING'),('AVAILABLE'),('LOCKED'),('HOLDBACK')) AS b(bucket)
      LEFT JOIN wallet_ledger_entries e ON e.wallet_id = w.id AND e.bucket::text = b.bucket
     GROUP BY w.id, b.bucket, w.pending_balance, w.available_balance, w.locked_balance, w.holdback_balance
    HAVING COALESCE(SUM(CASE WHEN e.entry_type::text='CREDIT' THEN e.amount ELSE -e.amount END),0)
           <> CASE b.bucket WHEN 'PENDING' THEN w.pending_balance WHEN 'LOCKED' THEN w.locked_balance WHEN 'HOLDBACK' THEN w.holdback_balance ELSE w.available_balance END`);
  assert.equal(bad.length, 0, `${ctx}: every bucket is explained by its ledger rows`);
  const frac = await m.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT (SELECT COUNT(*) FROM wallet_ledger_entries WHERE amount <> TRUNC(amount)) AS n`);
  assert.equal(Number(frac[0].n), 0, `${ctx}: whole đồng only`);
  assert.equal(await m.prisma.partnerReceivable.count(), 0, `${ctx}: no PartnerReceivable`);
  // A holdback is never platform revenue: nothing ever moves HOLDBACK -> the revenue wallet.
  const revHold = await m.prisma.walletLedgerEntry.count({ where: { bucket: 'HOLDBACK', wallet: { ownerType: 'PLATFORM' } } });
  assert.equal(revHold, 0, `${ctx}: a platform wallet never holds HOLDBACK`);
}

/** Independent arithmetic (BigInt, no ledger code): the PT's expected income, the target, and the per-session schedule. */
function expected(price: bigint, n: bigint, ptRateBp: bigint, h100: bigint) {
  const ptExpected = (price * ptRateBp) / 10000n;
  const target = (ptExpected * h100) / 100n;
  const unit = price / n;
  const share = (unit * ptRateBp) / 10000n;
  return { ptExpected, target, share };
}

const h = (v: unknown) => String(v);

let approvalSeq = 0;
/** The admin's decision on the open review of kind `kind` of one contract (two different people, a fresh approval reference). */
async function decide(m: Mods, f: Fx, decision: 'VERIFIED' | 'NOT_VERIFIED', verifiedAmount?: string, kind = 'PT_FAULT', over: Record<string, unknown> = {}) {
  const rv = await m.prisma.ptHoldbackReview.findFirstOrThrow({ where: { transactionId: f.txnId, kind: kind as any, status: 'OPEN' } });
  return m.review.decideHoldbackReview({
    reviewId: rv.id, expectedReserve: rv.reserve.toFixed(2), expectedTransactionId: f.txnId, decision,
    verifiedAmount: decision === 'VERIFIED' ? (verifiedAmount ?? rv.reserve.toFixed(0)) : undefined,
    note: 'checked the evidence of this contract', actor: 'admin-a', approvedBy: 'admin-b', approvalRef: `AP-${++approvalSeq}`, dryRun: false, ...over,
  });
}
const openReviews = (m: Mods, f: Fx) => m.prisma.ptHoldbackReview.findMany({ where: { transactionId: f.txnId, status: 'OPEN' }, orderBy: { createdAt: 'asc' } });
/** TEST FIXTURE: an OPEN unpaid obligation of THIS contract (stands in for an unfunded no-show), written before the ending. */
async function fixtureObligation(m: Mods, f: Fx, unpaid: number, kind: 'NO_SHOW' | 'LATE_ARRIVAL' | 'REFUND_SHORT' = 'NO_SHOW') {
  return m.prisma.contractUnpaidObligation.create({
    data: { key: `fixture:${f.contractId}:${randomUUID().slice(0, 6)}`, transactionId: f.txnId, contractRef: f.contractId, kind, party: 'CLIENT', owed: unpaid, paid: 0, unpaid },
  });
}

// ───────────────────────────── the three mandatory examples (exact per-session tables) ─────────────────────────────

async function runSchedule(m: Mods, n: number, price = 1_000_000) {
  await resetLedger(m);
  const f = await paid(m, { price, n, h: '0.10' });
  const rows: Array<{ session: number; availableDelta: string; held: string }> = [];
  let prev = (await bal(m, f)).ptAvailable;
  for (let i = 1; i <= n; i++) {
    await deliver(m, f);
    const b = await bal(m, f);
    rows.push({ session: i, availableDelta: str(b.ptAvailable.minus(prev)), held: await heldOf(m, f) });
    prev = b.ptAvailable;
    await assertBooksSound(m, `schedule n=${n} S${i}`);
  }
  const beforeEnd = await bal(m, f);
  const result = await terminate(m, f, 'COMPLETED');
  const after = await bal(m, f);
  await assertBooksSound(m, `schedule n=${n} completed`);
  return { f, rows, beforeEnd, after, result, finalDelta: str(after.ptAvailable.minus(beforeEnd.ptAvailable)) };
}

test('EXAMPLE 1 - 1.000.000 / 10 sessions / PT 90%: target 90.000; S1 +0 (held 90.000); S2-S9 +90.000; S10 +90.000 then +90.000 release = +180.000; PT 900.000, platform 100.000', skipOpts, async () => {
  const m = await load();
  const e = expected(1_000_000n, 10n, 9000n, 10n);
  assert.equal(h(e.target), '90000');
  const r = await runSchedule(m, 10);
  assert.deepEqual(
    r.rows.map((x) => x.availableDelta),
    ['0', '90000', '90000', '90000', '90000', '90000', '90000', '90000', '90000', '90000'],
  );
  assert.deepEqual(r.rows.map((x) => x.held), Array(10).fill('90000'), 'held 90.000 from S1 and never more');
  assert.equal(r.finalDelta, '90000', 'the final reconciliation releases the 90.000');
  assert.equal(r.rows[9].availableDelta + '+' + r.finalDelta, '90000+90000', 'S10 + release = 180.000');
  assert.equal(str(r.after.ptAvailable), '900000', 'the PT ends with exactly 900.000');
  assert.equal(str(r.after.ptHoldback), '0');
  assert.equal(str(r.after.revenue), '100000', 'the platform ends with exactly 100.000');
  assert.equal(str(r.after.escrow), '1000000', 'ESCROW still holds the only real money: nothing left the platform');
  assert.equal(str(r.after.ptPending.plus(r.after.revenuePending)), '0');
  assert.equal(await heldOf(m, r.f), '0');
  assert.equal(r.result.ptHoldback?.returnedToPt, '90000.00');
  assert.equal(r.result.ptHoldback?.compensation, '0.00');
});

test('EXAMPLE 2 - 1.000.000 / 4 sessions: S1 +135.000 (held 90.000), S2 +225.000, S3 +225.000, S4 +225.000 then the release = +315.000; PT 900.000', skipOpts, async () => {
  const m = await load();
  const r = await runSchedule(m, 4);
  assert.deepEqual(r.rows.map((x) => x.availableDelta), ['135000', '225000', '225000', '225000']);
  assert.deepEqual(r.rows.map((x) => x.held), ['90000', '90000', '90000', '90000']);
  assert.equal(r.finalDelta, '90000');
  assert.equal(Number(r.rows[3].availableDelta) + Number(r.finalDelta), 315000);
  assert.equal(str(r.after.ptAvailable), '900000');
  assert.equal(str(r.after.revenue), '100000');
});

test('EXAMPLE 3 - 1.000.000 / 20 sessions: S1 held 45.000 (+0), S2 held 45.000 (+0), S3.. +45.000, S20 +45.000 then the release = +135.000; PT 900.000', skipOpts, async () => {
  const m = await load();
  const r = await runSchedule(m, 20);
  const exp = ['0', '0', ...Array(18).fill('45000')];
  assert.deepEqual(r.rows.map((x) => x.availableDelta), exp);
  assert.deepEqual(r.rows.map((x) => x.held), ['45000', ...Array(19).fill('90000')]);
  assert.equal(r.finalDelta, '90000');
  assert.equal(Number(r.rows[19].availableDelta) + Number(r.finalDelta), 135000);
  assert.equal(str(r.after.ptAvailable), '900000');
  assert.equal(str(r.after.revenue), '100000');
});

test('the target is rate x the PT’s EXPECTED INCOME (frozen rates), not 10% of the client’s payment', skipOpts, async () => {
  const m = await load();
  const rates = m.money;
  assert.equal(rates.holdbackTarget(D(m, 1_000_000), D(m, '0.10'), rt(m, '0.10', '0.90', '0')).toFixed(0), '90000');
  assert.equal(rates.holdbackTarget(D(m, 1_000_000), D(m, '0.10'), rt(m, '0.10', '0.55', '0.35')).toFixed(0), '55000', 'gym 35%: the PT’s expected income is 550.000');
  assert.equal(rates.holdbackTarget(D(m, 1_000_000), D(m, '0.10'), rt(m, '0.20', '0.80', '0')).toFixed(0), '80000');
  assert.equal(rates.holdbackTarget(D(m, 1_000_000), undefined, rt(m, '0.10', '0.90', '0')).toFixed(0), '0');
  assert.equal(rates.holdbackTarget(D(m, 1_000_003), D(m, '0.10'), rt(m, '0.10', '0.90', '0')).toFixed(0), '90000', '900.002,7 -> 900.002 -> 90.000,2 -> 90.000');
});

// ───────────────────────────── other contract shapes ─────────────────────────────

test('1-session contract: the one session is payable, 90.000 held of the PT’s 900.000 expected income, 810.000 AVAILABLE; the ending releases the rest', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 1, h: '0.10' });
  const r = await deliver(m, f);
  assert.equal(r.released.pt, '810000.00');
  assert.equal(r.ptHoldback?.heldNow, '90000.00');
  assert.equal(await heldOf(m, f), '90000');
  await terminate(m, f, 'COMPLETED');
  const b = await bal(m, f);
  assert.equal(str(b.ptAvailable), '900000');
  assert.equal(str(b.revenue), '100000');
  assert.equal(await heldOf(m, f), '0');
  await assertBooksSound(m, '1 session');
});

for (const [name, platform, pt, gym] of [
  ['gym 35% / PT 55% / platform 10%', '0.10', '0.55', '0.35'],
  ['gym 20% / PT 70% / platform 10%', '0.10', '0.70', '0.20'],
  ['no gym / PT 80% / platform 20%', '0.20', '0.80', '0'],
] as const) {
  test(`gym rate != 90% (${name}): target = 10% of the PT’s expected income only; the gym and the platform are paid per session, untouched by the hold`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const r = rt(m, platform, pt, gym);
    const f = await paid(m, { price: 1_000_000, n: 10, rates: r, h: '0.10' });
    const ptExpected = Number(r.ptRate.mul(1_000_000));
    const target = ptExpected / 10;
    const perSession = ptExpected / 10;
    for (let i = 1; i <= 10; i++) {
      const before = await bal(m, f);
      const res = await deliver(m, f);
      const after = await bal(m, f);
      assert.equal(Number(after.ptAvailable.minus(before.ptAvailable)), i === 1 ? perSession - target : perSession, `S${i} PT available`);
      assert.equal(Number(res.released.gym), Number(r.gymRate.mul(100_000)), `S${i} gym released in full`);
      assert.equal(Number(after.revenue.minus(before.revenue)), Number(r.platformRate.mul(100_000)), `S${i} platform released in full`);
      assert.equal(Number(await heldOf(m, f)), target);
    }
    await terminate(m, f, 'COMPLETED');
    const b = await bal(m, f);
    assert.equal(Number(b.ptAvailable), ptExpected);
    assert.equal(Number(b.gymAvailable), Number(r.gymRate.mul(1_000_000)));
    assert.equal(Number(b.revenue), Number(r.platformRate.mul(1_000_000)));
    assert.equal(Number(b.ptHoldback), 0);
    await assertBooksSound(m, `rates ${name}`);
  });
}

test('VND rounding property: non-divisible prices, odd counts, several rate tables - PT total == the PT’s expected income to the dong, no dong lost or created, AVAILABLE never above what is earned, held <= target', skipOpts, async () => {
  const m = await load();
  const cases: Array<{ price: number; n: number; rates: Rates }> = [
    { price: 1_000_003, n: 7, rates: rt(m, '0.10', '0.90', '0') },
    { price: 999_999, n: 3, rates: rt(m, '0.10', '0.90', '0') },
    { price: 5_000_000, n: 12, rates: rt(m, '0.10', '0.55', '0.35') },
    { price: 777_777, n: 9, rates: rt(m, '0.15', '0.65', '0.20') },
    { price: 1_234_567, n: 11, rates: rt(m, '0.20', '0.80', '0') },
    { price: 100_001, n: 5, rates: rt(m, '0.10', '0.90', '0') },
    { price: 1_000_000, n: 1, rates: rt(m, '0.10', '0.55', '0.35') },
  ];
  for (const c of cases) {
    await resetLedger(m);
    const f = await paid(m, { price: c.price, n: c.n, rates: c.rates, h: '0.10' });
    const ptExpected = m.money.ptExpectedIncome(f.price, f.rates);
    const target = m.money.holdbackTarget(f.price, D(m, '0.10'), f.rates);
    assert.ok(target.lessThanOrEqualTo(ptExpected.mul('0.10')), 'target <= 10% of expected income');
    let earned = D(m, 0);
    const share = m.money.computeSessionRelease(f.price, c.n, f.rates).pt;
    for (let i = 1; i <= c.n; i++) {
      await deliver(m, f);
      earned = earned.plus(share);
      const b = await bal(m, f);
      const held = D(m, await heldOf(m, f));
      assert.ok(held.lessThanOrEqualTo(target), `${c.price}/${c.n} S${i}: held <= target`);
      assert.ok(held.lessThanOrEqualTo(earned), `${c.price}/${c.n} S${i}: held <= earned`);
      assert.ok(b.ptAvailable.lessThanOrEqualTo(earned), `${c.price}/${c.n} S${i}: AVAILABLE never above earned`);
      assert.equal(b.ptAvailable.plus(held).toFixed(0), earned.toFixed(0), `${c.price}/${c.n} S${i}: available + held == earned`);
    }
    await terminate(m, f, 'COMPLETED');
    const b = await bal(m, f);
    assert.equal(b.ptAvailable.toFixed(0), ptExpected.toFixed(0), `${c.price}/${c.n}: PT total == expected income`);
    assert.equal(b.ptHoldback.toFixed(0), '0');
    const whole = m.money.splitThreeWays(f.price, f.rates);
    assert.equal(b.revenue.toFixed(0), whole.platform.toFixed(0), `${c.price}/${c.n}: platform total`);
    assert.equal(b.gymAvailable.toFixed(0), whole.gym.toFixed(0), `${c.price}/${c.n}: gym total`);
    assert.equal(b.ptAvailable.plus(b.gymAvailable).plus(b.revenue).toFixed(0), String(c.price), `${c.price}/${c.n}: parties sum to the price`);
    await assertBooksSound(m, `rounding ${c.price}/${c.n}`);
  }
});

// ───────────────────────────── collection edge cases ─────────────────────────────

test('first session is a PT no-show (zero PT income): nothing is held for it; the next delivered session starts the hold', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 4, h: '0.10' });
  const ns = await noShow(m, f);
  assert.equal(ns.unpaid, '0.00');
  assert.equal(await heldOf(m, f), '0', 'a no-show earns the PT nothing, so nothing is held');
  assert.equal(str((await bal(m, f)).ptHoldback), '0');
  const r = await deliver(m, f);
  assert.equal(r.ptHoldback?.heldNow, '90000.00');
  assert.equal(r.released.pt, '135000.00');
  await deliver(m, f);
  await deliver(m, f);
  await terminate(m, f, 'COMPLETED');
  const b = await bal(m, f);
  assert.equal(await heldOf(m, f), '0');
  // the PT earned 3 of the 4 sessions: 3 x 225.000 = 675.000 (the no-show session was refunded to the client out of the contract’s own pending)
  assert.equal(str(b.ptAvailable), '675000');
  assert.equal(str(b.client), '250000');
  await assertBooksSound(m, 'first-session no-show');
});

test('D77 late arrival: the hold is computed on what the PT actually earns for the session (share after the deduction)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 4, h: '0.10' });
  const r = await deliver(m, f, true);
  // late-arrival compensation = half a session (125.000), the PT’s part 112.500 -> the session pays the PT 112.500: 90.000 held, 22.500 available
  assert.equal(r.released.pt, '22500.00');
  assert.equal(r.ptHoldback?.heldNow, '90000.00');
  await deliver(m, f);
  await deliver(m, f);
  await deliver(m, f);
  await terminate(m, f, 'COMPLETED');
  const b = await bal(m, f);
  assert.equal(str(b.ptAvailable), '787500', '900.000 - the 112.500 the PT bore for being late');
  assert.equal(str(b.client), '125000');
  assert.equal(await heldOf(m, f), '0');
  await assertBooksSound(m, 'D77');
});

test('a late-arrival entitlement smaller than the target is held in full and the hold keeps filling from the next sessions', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  // 400.000 / 10 sessions: unit 40.000, PT share 36.000; target 10% of 360.000 = 36.000. Late arrival deducts 18.000 x 0.9 = 18.000.
  const f = await paid(m, { price: 400_000, n: 10, h: '0.10' });
  const r1 = await deliver(m, f, true);
  assert.equal(r1.ptHoldback?.heldNow, '18000.00', 'the whole reduced entitlement is held');
  assert.equal(r1.released.pt, '0.00');
  const r2 = await deliver(m, f);
  assert.equal(r2.ptHoldback?.heldNow, '18000.00');
  assert.equal(r2.released.pt, '18000.00');
  assert.equal(await heldOf(m, f), '36000');
  await assertBooksSound(m, 'late smaller than target');
});

// ───────────────────────────── endings ─────────────────────────────

test('client cancels EARLY (before any session): nothing was held, 90% of the price is refunded, the forfeited 10% is split by the contract rates as before', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  const r = await terminate(m, f, 'CLIENT_CANCELLED');
  assert.equal(r.ptHoldback, undefined, 'no holdback field when nothing is held');
  const b = await bal(m, f);
  assert.equal(str(b.client), '900000');
  assert.equal(str(b.ptAvailable), '90000', 'the PT’s share (90%) of the 100.000 the client forfeits - unchanged behaviour');
  assert.equal(str(b.revenue), '10000');
  assert.equal(str(b.ptHoldback), '0', 'and nothing is held: the hold is never raised after an early end');
  await assertBooksSound(m, 'client cancel early');
});

test('client cancels LATE (after 3 sessions): all held money returns to the PT, no compensation; PT/ platform/ client split exactly', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  assert.equal(await heldOf(m, f), '90000');
  const r = await terminate(m, f, 'CLIENT_CANCELLED');
  assert.equal(r.ptHoldback?.held, '90000.00');
  assert.equal(r.ptHoldback?.compensation, '0.00');
  assert.equal(r.ptHoldback?.returnedToPt, '90000.00');
  assert.equal(r.ptHoldback?.stillHeld, '0.00');
  const b = await bal(m, f);
  // 3 sessions earned 270.000 + 10% of the 700.000 unused that the cancelling client forfeits is split 90/10 -> PT 63.000
  assert.equal(str(b.client), '630000');
  assert.equal(str(b.ptAvailable), '333000');
  assert.equal(str(b.revenue), '37000');
  assert.equal(await heldOf(m, f), '0');
  assert.equal(str(b.ptHoldback), '0', 'the hold is NOT raised to 10% of the original expected income: it was already filled and is simply returned');
  await assertBooksSound(m, 'client cancel late');
});

test('PT cancels (PT_CANCELLED) after 3 sessions: NOTHING is paid at the ending; 70.000 (10% of the 700.000 unused) is RESERVED; VERIFIED pays the client exactly it out of the hold, the other 20.000 went back to the PT at the ending', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  const before = await bal(m, f);
  const r = await terminate(m, f, 'PT_CANCELLED');
  assert.equal(r.ptHoldback?.compensation, '0.00');
  assert.equal(r.ptHoldback?.stillHeld, '70000.00');
  assert.equal(r.ptHoldback?.returnedToPt, '20000.00', '90.000 held - 70.000 reserved');
  assert.deepEqual(r.ptHoldback?.reserves.map((x) => [x.kind, x.reserve]), [['PT_FAULT', '70000.00']]);
  let b = await bal(m, f);
  assert.equal(str(b.client), '700000', 'the refund only: no compensation yet');
  assert.equal(str(b.ptAvailable.minus(before.ptAvailable)), '20000');
  assert.equal(str(b.ptHoldback), '70000');
  const rv = (await openReviews(m, f))[0];
  assert.equal(rv.reserve.toFixed(0), '70000');
  assert.ok(rv.reviewBy.getTime() > Date.now() + 13 * 24 * 3600 * 1000);
  const d = await decide(m, f, 'VERIFIED');
  assert.equal(d.paidToClient, '70000.00');
  b = await bal(m, f);
  assert.equal(str(b.client), '770000', 'refund 700.000 + 70.000 compensation');
  assert.equal(str(b.ptAvailable), '200000', '270.000 earned - 70.000 compensation');
  assert.equal(await heldOf(m, f), '0');
  await assertBooksSound(m, 'PT cancels');
});

test('PT-fault with LESS held than the ceiling: the reserve is min(ceiling, held); and a PT-cancelled contract that was NOT verified gives everything back to the PT', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  // 1.000.000 / 20 sessions: target 90.000, after 1 session only 45.000 is held; undelivered value 950.000 -> ceiling 95.000 -> reserve = held 45.000
  const f = await paid(m, { price: 1_000_000, n: 20, h: '0.10' });
  await deliver(m, f);
  const r = await terminate(m, f, 'PT_CANCELLED');
  assert.equal(r.ptHoldback?.held, '45000.00');
  assert.equal(r.ptHoldback?.stillHeld, '45000.00', 'less held than the ceiling: all of it is at risk, never more');
  assert.equal(r.ptHoldback?.returnedToPt, '0.00');
  const d = await decide(m, f, 'NOT_VERIFIED');
  assert.equal(d.status, 'NOT_VERIFIED');
  assert.equal(d.paidToClient, '0.00');
  assert.equal(d.releasedToPt, '45000.00', 'the PT is not responsible: the whole reserve returns to them');
  const b = await bal(m, f);
  assert.equal(str(b.client), '950000', 'only the refund');
  assert.equal(str(b.ptAvailable), '45000');
  assert.equal(await heldOf(m, f), '0');
  await assertBooksSound(m, 'PT cancels, not verified');
});

test('PT fault PARTIALLY verified: only the verified part is paid to the client, the rest of the reserve returns to the PT; a second decision is refused', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  await terminate(m, f, 'PT_CANCELLED'); // reserve 70.000
  const d = await decide(m, f, 'VERIFIED', '30000');
  assert.equal(d.status, 'SETTLED_PARTIAL');
  assert.equal(d.paidToClient, '30000.00');
  assert.equal(d.releasedToPt, '40000.00');
  const b = await bal(m, f);
  assert.equal(str(b.client), '730000');
  assert.equal(str(b.ptAvailable), '240000', '270.000 earned - 30.000 verified');
  assert.equal(await heldOf(m, f), '0');
  await assert.rejects(() => m.review.decideHoldbackReview({
    reviewId: d.reviewId, expectedReserve: '70000.00', expectedTransactionId: f.txnId, decision: 'VERIFIED', verifiedAmount: '10000',
    note: 'a second attempt on a decided review', actor: 'admin-a', approvedBy: 'admin-b', approvalRef: 'AP-LATE', dryRun: false,
  }), (e: any) => e.code === 'ALREADY_DECIDED');
  await assertBooksSound(m, 'partial');
});

test('PT_REPEATED_NO_SHOW: the reserve base includes the already-compensated sessions; still nothing automatic, and only the PT-borne verified part is ever paid', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  for (let i = 0; i < 3; i++) await noShow(m, f);
  const r = await terminate(m, f, 'PT_REPEATED_NO_SHOW');
  // base = remaining (4 x 100.000) + compensated (3 x 100.000) = 700.000 -> ceiling 70.000, held 90.000
  assert.equal(r.ptHoldback?.compensation, '0.00');
  assert.equal(r.ptHoldback?.stillHeld, '70000.00');
  assert.equal(r.ptHoldback?.returnedToPt, '20000.00');
  await decide(m, f, 'VERIFIED', '70000');
  assert.equal(await heldOf(m, f), '0');
  await assertBooksSound(m, 'repeated no-show');
});

for (const reason of ['PT_BANNED', 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION', 'SERVICE_DISCONTINUED_BY_PLATFORM', 'MUTUAL', 'EXPIRED'] as const) {
  test(`${reason} is NOT PT fault: no compensation from the held money, the whole hold returns to the PT, the client is refunded in full for the unused value${reason === 'EXPIRED' ? ' (nothing: expired)' : ''}`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
    for (let i = 0; i < 3; i++) await deliver(m, f);
    const r = await terminate(m, f, reason);
    assert.equal(r.ptHoldback?.compensation, '0.00', 'a ban / restriction / platform decision never pays the client out of the PT’s hold by itself');
    assert.equal(r.ptHoldback?.returnedToPt, '90000.00');
    const b = await bal(m, f);
    assert.equal(await heldOf(m, f), '0');
    if (reason === 'EXPIRED') {
      assert.equal(str(b.client), '0');
      assert.equal(str(b.ptAvailable), '900000', 'an expired contract: the PT keeps the whole share');
    } else {
      assert.equal(str(b.client), '700000', '100% of the 7 unused sessions');
      assert.equal(str(b.ptAvailable), '270000', 'what the PT earned, hold included');
    }
    assert.equal(await m.prisma.walletLedgerEntry.count({ where: { transactionId: f.txnId, description: { contains: 'compensation for' } } }), 0);
    await assertBooksSound(m, reason);
  });
}

test('PT_BANNED is no longer a PT-fault reason; SERVICE_DISCONTINUED_BY_PLATFORM prices exactly like MUTUAL', skipOpts, async () => {
  const m = await load();
  assert.equal(m.money.PT_FAULT_REASONS.has('PT_BANNED'), false);
  assert.equal(m.money.PT_FAULT_REASONS.has('SERVICE_DISCONTINUED_BY_PLATFORM'), false);
  assert.equal(m.money.PT_FAULT_REASONS.has('CLIENT_EXIT_DUE_TO_PT_RESTRICTION'), false);
  assert.equal(m.money.PT_FAULT_REASONS.has('PT_CANCELLED'), true);
  assert.equal(m.money.PT_FAULT_REASONS.has('PT_REPEATED_NO_SHOW'), true);
  const input = { price: D(m, 1_000_000), totalSessions: 10, usedSessions: 3, rates: rt(m, '0.10', '0.90', '0'), ptHoldbackRate: D(m, '0.10') };
  const a = m.money.computeTermination(input, 'SERVICE_DISCONTINUED_BY_PLATFORM');
  const b = m.money.computeTermination(input, 'MUTUAL');
  assert.equal(a.refund.toFixed(0), b.refund.toFixed(0));
  assert.equal(a.entitlement.pt.toFixed(0), b.entitlement.pt.toFixed(0));
  assert.equal(a.ptFaultCompensationTarget.toFixed(0), '0');
  assert.equal(m.money.computeTermination(input, 'PT_BANNED').ptFaultCompensationTarget.toFixed(0), '0');
});

// ───────────────────────────── disputed session, unresolved items, reconciliation ─────────────────────────────

test('DECISION 2 example: hold 90.000, unsecured PT risk 30.000 -> keep 30.000 (a review with a deadline), release 60.000 at the ending; the cause clears -> the sweep releases the rest, exactly once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  assert.equal(await heldOf(m, f), '90000');
  // TEST FIXTURE: an unfunded no-show of THIS contract: unpaid 33.334 -> PT-borne part floor(33.334 x 0.90) = 30.000
  const ob = await fixtureObligation(m, f, 33_334);
  const before = await bal(m, f);
  const r = await terminate(m, f, 'MUTUAL');
  assert.equal(r.ptHoldback?.held, '90000.00');
  assert.equal(r.ptHoldback?.stillHeld, '30000.00');
  assert.equal(r.ptHoldback?.returnedToPt, '60000.00');
  assert.deepEqual(r.ptHoldback?.reserves.map((x) => [x.kind, x.reserve]), [['OPEN_OBLIGATION', '30000.00']]);
  assert.equal(str((await bal(m, f)).ptAvailable.minus(before.ptAvailable)), '60000', 'the PT gets 60.000 now');
  assert.equal(await heldOf(m, f), '30000');
  const rv = (await openReviews(m, f))[0];
  assert.equal(rv.kind, 'OPEN_OBLIGATION');
  assert.equal(rv.relatedRef, ob.id);

  const sweep = (key = `HOLDBACK_RELEASE:${f.contractId}`) => m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: key });
  const early = await sweep();
  assert.equal(early.released, '0.00', 'the obligation is still owed: the 30.000 stays');
  assert.equal(early.reconciled, false);
  assert.equal(early.blockedBy?.openReviews[0]?.kind, 'OPEN_OBLIGATION');
  assert.equal(await heldOf(m, f), '30000');

  // the cause clears (FH-8: the owner waives / resolves it): the next sweep returns the reserve, once
  await m.prisma.contractUnpaidObligation.update({ where: { id: ob.id }, data: { status: 'WAIVED' } });
  const done = await sweep();
  assert.equal(done.released, '30000.00');
  assert.equal(done.reconciled, true);
  assert.deepEqual(await sweep(), done, 'the final answer replays');
  assert.equal((await sweep('HOLDBACK_RELEASE:other-key')).released, '0.00', 'a different key finds nothing left: no second release');
  assert.equal(str((await bal(m, f)).ptAvailable), '270000', '3 x 90.000 earned, nothing lost');
  assert.equal((await m.prisma.ptHoldbackReview.findUniqueOrThrow({ where: { id: rv.id } })).status, 'RELEASED_AUTO');
  await assertBooksSound(m, 'decision 2');
});

test('an OPEN obligation reserve decided VERIFIED pays the client from THIS contract’s hold AND reduces that obligation by the same amount in the same transaction (never paid twice); partially verified keeps the rest OPEN, never fronted', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  const ob = await fixtureObligation(m, f, 100_000); // PT-borne part 90.000 = the whole hold
  const r = await terminate(m, f, 'MUTUAL');
  assert.equal(r.ptHoldback?.stillHeld, '90000.00');
  assert.equal(r.ptHoldback?.returnedToPt, '0.00');
  const d = await decide(m, f, 'VERIFIED', '60000', 'OPEN_OBLIGATION');
  assert.equal(d.paidToClient, '60000.00');
  assert.equal(d.releasedToPt, '30000.00');
  const after = await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: ob.id } });
  assert.equal(after.unpaid.toFixed(2), '40000.00', '100.000 - 60.000 paid from the hold: no double counting');
  assert.equal(after.paid.toFixed(2), '60000.00');
  assert.equal(after.status, 'OPEN', 'the rest is still an OPEN obligation (the gym/platform part and what is not verified)');
  const ev = await m.prisma.contractUnpaidObligationEvent.count({ where: { obligationId: ob.id } });
  assert.equal(ev, 1);
  const b = await bal(m, f);
  assert.equal(str(b.client), '760000', '700.000 refund + the 60.000 verified');
  assert.equal(await m.prisma.partnerReceivable.count(), 0);
  assert.equal(await heldOf(m, f), '0');
  await assertBooksSound(m, 'obligation reserve verified');
});

test('multiple disputes: two open obligations make two reserves (the PT-borne part of each), kept within the hold; each is decided on its own', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  const o1 = await fixtureObligation(m, f, 50_000); // 45.000
  const o2 = await fixtureObligation(m, f, 100_000, 'LATE_ARRIVAL'); // 90.000 -> only 45.000 of the hold is left
  const r = await terminate(m, f, 'MUTUAL');
  assert.equal(r.ptHoldback?.stillHeld, '90000.00', 'never more than the hold');
  assert.deepEqual(r.ptHoldback?.reserves.map((x) => x.reserve), ['45000.00', '45000.00']);
  const rv = await openReviews(m, f);
  assert.equal(rv.length, 2);
  assert.deepEqual(rv.map((x) => x.relatedRef).sort(), [o1.id, o2.id].sort());
  const d1 = await m.review.decideHoldbackReview({
    reviewId: rv[0].id, expectedReserve: '45000.00', expectedTransactionId: f.txnId, decision: 'NOT_VERIFIED', note: 'the PT was not responsible for this one',
    actor: 'admin-a', approvedBy: 'admin-b', approvalRef: 'AP-M1', dryRun: false,
  });
  assert.equal(d1.releasedToPt, '45000.00');
  assert.equal(await heldOf(m, f), '45000', 'the second reserve is untouched');
  await assertBooksSound(m, 'multiple disputes');
});

test('a PENDING-secured dispute needs no holdback: the unresolved session value held in this contract’s pending covers the refund, so the whole hold is released at the ending', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  const r = await terminate(m, f, 'MUTUAL', { unresolved: 1 });
  assert.equal(r.ptHoldback?.stillHeld, '0.00');
  assert.equal(r.ptHoldback?.returnedToPt, '90000.00');
  assert.equal(await m.prisma.ptHoldbackReview.count({ where: { transactionId: f.txnId } }), 0);
  const res = await m.ledger.resolveUnresolvedSession({
    transactionId: f.txnId, price: f.price, totalSessions: f.n, rates: f.rates, parties: f.parties, label: `${f.contractId} s4`,
    idempotencyKey: `UNRESOLVED_SESSION:${f.contractId}:4`, outcome: 'NOT_DELIVERED', ...hArg(m, f),
  });
  assert.equal(res.moved.client, '100000.00', 'the client is refunded out of the session value held in pending');
  assert.equal(str((await bal(m, f)).ptAvailable), '270000', 'the PT keeps what it earned plus the returned hold');
  await assertBooksSound(m, 'pending-secured dispute');
});

test('an UNSECURED dispute (this contract’s pending cannot cover the PT share of the held session) reserves exactly the uncovered PT share, with a review; the rest is released', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  // TEST FIXTURE: this contract's PT pending was already spent elsewhere (an old over-release): only 40.000 of it is left, the held session needs 90.000.
  const pt = await m.wallet.getOrCreateWallet('PT', f.parties.ptUserId);
  const rev = await m.wallet.getRevenueWallet();
  await m.wallet.withWallets([pt.id, rev.id], f.txnId, async (ops) => {
    const drain = ops.balance(pt.id, 'PENDING').minus(40_000);
    await ops.debit(pt.id, drain, 'test fixture — pending spent (old over-release)', 'PENDING');
    await ops.credit(rev.id, drain, 'test fixture — booked to revenue', 'AVAILABLE');
  });
  const r = await terminate(m, f, 'MUTUAL', { unresolved: 1 });
  const kinds = r.ptHoldback?.reserves.map((x) => x.kind) ?? [];
  assert.ok(kinds.includes('UNSECURED_DISPUTE'), `reserves: ${JSON.stringify(r.ptHoldback?.reserves)}`);
  const un = r.ptHoldback!.reserves.find((x) => x.kind === 'UNSECURED_DISPUTE')!;
  assert.equal(un.reserve, '50000.00', '90.000 needed - 40.000 secured by pending');
  assert.equal(await heldOf(m, f), String(Number(r.ptHoldback!.stillHeld)));
  assert.equal(await m.prisma.partnerReceivable.count(), 0);
  await assertBooksSound(m, 'unsecured dispute');
});

test('risk NOT computable (a PT-fault ending without the holdback rate): the whole remaining hold is kept with the reason, a handler slot and a deadline; it surfaces as OVERDUE in the admin report once the deadline passes; an admin decision closes it', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const report = (await import('../services/admin-obligations.service')).buildObligationsReport;
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  const params = termParams(m, f, 'PT_CANCELLED');
  delete (params as { ptHoldbackRate?: unknown }).ptHoldbackRate; // the caller did not send the rate: the potential amount cannot be sized
  const r = await m.ledger.terminateContract(params);
  assert.equal(r.ptHoldback?.stillHeld, '90000.00', 'up to the whole remaining hold of THIS contract');
  assert.equal(r.ptHoldback?.returnedToPt, '0.00');
  const rv = (await openReviews(m, f))[0];
  assert.equal(rv.kind, 'UNCOMPUTABLE');
  assert.match(rv.reason, /could not be computed/);
  assert.ok(rv.reviewBy.getTime() > Date.now());
  assert.equal(rv.handler, 'ADMIN_FINANCE_QUEUE', 'a handling queue is recorded: no reserve is ownerless');
  let rep = await report({ lookupTargetStatus: null });
  assert.equal(rep.summary.ptHoldback.overdue.count, 0);
  const row = rep.ptHoldbacks.find((x) => x.transactionId === f.txnId)!;
  assert.deepEqual(row.reviewKinds, ['UNCOMPUTABLE']);
  assert.equal(row.reserved, '90000.00');
  assert.equal(row.overdue, false);
  // the deadline passes (TEST FIXTURE: the review-by date is moved into the past)
  await m.prisma.ptHoldbackReview.update({ where: { id: rv.id }, data: { reviewBy: new Date(Date.now() - 24 * 3600 * 1000) } });
  rep = await report({ lookupTargetStatus: null });
  assert.equal(rep.summary.ptHoldback.overdue.count, 1, 'the overdue reserve is surfaced');
  assert.equal(rep.summary.ptHoldback.overdue.reserved, '90000.00');
  assert.equal(rep.ptHoldbacks.find((x) => x.transactionId === f.txnId)!.overdue, true);
  const sweep = await m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` });
  assert.equal(sweep.released, '0.00', 'the sweep never decides a review: even overdue it waits for the admin');
  assert.equal(sweep.blockedBy?.openReviews[0]?.overdue, true);
  const d = await decide(m, f, 'VERIFIED', '40000', 'UNCOMPUTABLE');
  assert.equal(d.paidToClient, '40000.00');
  assert.equal(d.releasedToPt, '50000.00');
  assert.equal((await report({ lookupTargetStatus: null })).summary.ptHoldback.overdue.count, 0);
  await assertBooksSound(m, 'uncomputable');
});

test('the decision operation: dry-run writes nothing; four-eyes, CAS, the cap, replay with the same approval, one key per approval', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  await terminate(m, f, 'PT_CANCELLED'); // reserve 70.000
  const rv = (await openReviews(m, f))[0];
  const base = { reviewId: rv.id, expectedReserve: '70000.00', expectedTransactionId: f.txnId, decision: 'VERIFIED' as const, verifiedAmount: '70000', note: 'checked the evidence of this contract', actor: 'admin-a', approvedBy: 'admin-b', approvalRef: 'AP-D1' };
  const rows = await m.prisma.walletLedgerEntry.count();
  const dry = await m.review.decideHoldbackReview({ ...base, dryRun: true });
  assert.equal(dry.outcome, 'DRY_RUN');
  assert.equal(dry.paidToClient, '70000.00');
  assert.equal(await m.prisma.walletLedgerEntry.count(), rows, 'a dry run writes nothing');
  assert.equal((await m.prisma.ptHoldbackReview.findUniqueOrThrow({ where: { id: rv.id } })).status, 'OPEN');
  await assert.rejects(() => m.review.decideHoldbackReview({ ...base, approvedBy: 'ADMIN-A', dryRun: false }), (e: any) => e.code === 'FOUR_EYES');
  await assert.rejects(() => m.review.decideHoldbackReview({ ...base, expectedReserve: '69999.00', dryRun: false }), (e: any) => e.code === 'CAS_MISMATCH');
  await assert.rejects(() => m.review.decideHoldbackReview({ ...base, expectedTransactionId: 'other', dryRun: false }), (e: any) => e.code === 'CAS_MISMATCH');
  await assert.rejects(() => m.review.decideHoldbackReview({ ...base, verifiedAmount: '70001', dryRun: false }), (e: any) => e.code === 'VERIFIED_EXCEEDS_RESERVE');
  await assert.rejects(() => m.review.decideHoldbackReview({ ...base, note: 'short', dryRun: false }), (e: any) => e.code === 'INVALID_INPUT');
  assert.equal(await m.prisma.walletLedgerEntry.count(), rows, 'every refusal wrote nothing');
  const first = await m.review.decideHoldbackReview({ ...base, dryRun: false });
  assert.equal(first.outcome, 'APPLIED');
  const again = await m.review.decideHoldbackReview({ ...base, dryRun: false });
  assert.equal(again.outcome, 'REPLAYED', 'the same approval reference replays');
  assert.equal(again.paidToClient, '70000.00');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: first.key } }), 1);
  assert.match(first.key, /^HOLDBACK_FAULT_COMP:contract-[0-9a-f]{8}:AP-D1$/);
  assert.equal(await m.prisma.ptHoldbackReviewEvent.count({ where: { reviewId: rv.id } }), 1, 'one append-only event');
  await assert.rejects(() => m.prisma.$executeRawUnsafe('UPDATE pt_holdback_review_events SET note = \'x\''), /append-only/);
  const clientTotal = (await bal(m, f)).client;
  assert.equal(str(clientTotal), '770000', 'paid exactly once');
  await assertBooksSound(m, 'decision op');
});

test('RACE: a verified decision, the sweep and a retry run at the same moment on one contract: the client is paid once, the PT gets the rest once, nothing is released twice', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  await terminate(m, f, 'PT_CANCELLED'); // reserve 70.000, 20.000 already released
  const rv = (await openReviews(m, f))[0];
  const mk = (ref: string) => m.review.decideHoldbackReview({
    reviewId: rv.id, expectedReserve: '70000.00', expectedTransactionId: f.txnId, decision: 'VERIFIED', verifiedAmount: '50000',
    note: 'checked the evidence of this contract', actor: 'admin-a', approvedBy: 'admin-b', approvalRef: ref, dryRun: false,
  }).catch((e: any) => ({ error: e.code as string }));
  const sweep = () => m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` });
  const res = await Promise.all([mk('AP-R1'), mk('AP-R1'), mk('AP-R2'), sweep(), sweep()]);
  const applied = new Set(res.filter((x: any) => x.outcome === 'APPLIED').map((x: any) => x.key));
  assert.equal(applied.size, 1, 'exactly one decision is applied (the same reference replays its own stored answer, the other reference is refused)');
  const refused = res.filter((x: any) => x.error);
  assert.ok(refused.every((x: any) => x.error === 'ALREADY_DECIDED'));
  const b = await bal(m, f);
  assert.equal(str(b.client), '750000', '700.000 refund + 50.000, once');
  assert.equal(str(b.ptAvailable), '220000', '270.000 earned - 50.000 verified');
  assert.equal(await heldOf(m, f), '0');
  assert.equal(await m.prisma.walletLedgerEntry.count({ where: { transactionId: f.txnId, bucket: 'HOLDBACK', entryType: 'DEBIT', description: { contains: 'used for compensation' } } }), 1);
  await assertBooksSound(m, 'race');
});

test('shortfall: a no-show the contract’s own pending cannot fund becomes an OPEN obligation (nothing fronted); the hold stays intact at the end except the PT-borne reserve; a verified decision pays from the hold and reduces the obligation; the rest stays OPEN', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 4, h: '0.10' });
  await deliver(m, f); // held 90.000, PT pending 675.000
  const ns: Awaited<ReturnType<typeof noShow>>[] = [];
  for (let i = 0; i < 4; i++) ns.push(await noShow(m, f));
  const short = ns.filter((x) => Number(x.unpaid) > 0);
  assert.ok(short.length >= 1, 'at least one no-show could not be fully funded');
  const unpaid = short.reduce((a, x) => a + Number(x.unpaid), 0);
  assert.ok(short.every((x) => x.obligationId), 'each shortfall is an OPEN obligation');
  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no PartnerReceivable');
  assert.equal(await heldOf(m, f), '90000', 'the held money was NOT drawn to cover the shortfall');
  assert.equal(str((await bal(m, f)).ptAvailable), '135000', 'and neither was the PT’s available money');

  const r = await terminate(m, f, 'MUTUAL');
  const ptBorne = Math.floor(unpaid * 0.9);
  const keep = Math.min(90000, ptBorne);
  assert.equal(Number(r.ptHoldback?.stillHeld), keep, 'only the PT-borne part of the open obligations is reserved');
  assert.equal(Number(r.ptHoldback?.returnedToPt), 90000 - keep);
  const rel = () => m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` });
  assert.equal((await rel()).released, '0.00', 'open obligation: the reserve waits');
  if (keep > 0) {
    const rvs = await openReviews(m, f);
    const first = rvs[0];
    const d = await m.review.decideHoldbackReview({
      reviewId: first.id, expectedReserve: first.reserve.toFixed(2), expectedTransactionId: f.txnId, decision: 'VERIFIED', verifiedAmount: first.reserve.toFixed(0),
      note: 'verified: the PT did not attend', actor: 'admin-a', approvedBy: 'admin-b', approvalRef: 'AP-S1', dryRun: false,
    });
    assert.equal(d.paidToClient, first.reserve.toFixed(2));
    const ob = await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: first.relatedRef! } });
    assert.ok(ob.paid.greaterThanOrEqualTo(first.reserve), 'the obligation was reduced by the verified payment');
  }
  await assertBooksSound(m, 'shortfall obligation');
});

test('never early: release on a RUNNING contract moves nothing and says why; a late session call after the ending never raises the hold', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 4, h: '0.10' });
  await deliver(m, f);
  const early = await m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` });
  assert.equal(early.released, '0.00');
  assert.equal(early.ended, false);
  assert.equal(early.blockedBy?.notEnded, true);
  assert.equal(await heldOf(m, f), '90000');
  // early end after 1 session, then a slow release-session of session 2 arrives late (it must not hold anything)
  await terminate(m, f, 'MUTUAL');
  const late = await m.ledger.releaseSession({
    transactionId: f.txnId, price: f.price, totalSessions: f.n, rates: f.rates, parties: f.parties, label: 'late',
    idempotencyKey: `SESSION_RELEASE:${f.contractId}:late`, ...hArg(m, f),
  });
  assert.equal(late.ptHoldback, undefined, 'no hold is raised after the ending');
  assert.equal(await heldOf(m, f), '0');
  await assertBooksSound(m, 'never early');
});

test('two concurrent releases release once (and a mix of keys too); the amount equals the contract’s hold exactly', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  // an open obligation keeps the whole hold at the ending
  await m.prisma.contractUnpaidObligation.create({
    data: { key: `fixture:${f.contractId}`, transactionId: f.txnId, contractRef: f.contractId, kind: 'NO_SHOW', party: 'CLIENT', owed: 500000, paid: 0, unpaid: 500000 },
  });
  const r = await terminate(m, f, 'MUTUAL');
  assert.equal(r.ptHoldback?.stillHeld, '90000.00');
  await m.prisma.contractUnpaidObligation.updateMany({ where: { transactionId: f.txnId }, data: { status: 'WAIVED' } });
  const call = (key: string) => m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: key });
  const keys = ['HOLDBACK_RELEASE:a', 'HOLDBACK_RELEASE:a', 'HOLDBACK_RELEASE:b', 'HOLDBACK_RELEASE:c'];
  const results = await Promise.all(keys.map(call));
  // a repeated key replays its own stored answer: count each key once
  const total = results.filter((_, i) => keys.indexOf(keys[i]) === i).reduce((s, x) => s + Number(x.released), 0);
  assert.equal(total, 90000, 'exactly the hold, once');
  assert.equal(await heldOf(m, f), '0');
  const rows = await m.prisma.walletLedgerEntry.count({ where: { transactionId: f.txnId, bucket: 'HOLDBACK', entryType: 'DEBIT', description: { contains: 'released to available' } } });
  assert.equal(rows, 1, 'a single release row');
  assert.equal(str((await bal(m, f)).ptAvailable), '270000');
  await assertBooksSound(m, 'concurrent releases');
});

test('Z4: the ending released everything unrelated INSIDE the termination; a sweep that arrives afterwards finds nothing and credits nothing twice', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 4, h: '0.10' });
  for (let i = 0; i < 4; i++) await deliver(m, f);
  await terminate(m, f, 'COMPLETED'); // the contract ended before "the next sweep"
  const before = await bal(m, f);
  const sweep = await m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` });
  assert.equal(sweep.released, '0.00');
  assert.equal(sweep.reconciled, true);
  const after = await bal(m, f);
  assert.equal(str(after.ptAvailable), str(before.ptAvailable), 'AVAILABLE not credited a second time');
  assert.equal(str(after.ptAvailable), '900000');
  await assertBooksSound(m, 'Z4');
});

test('termination replays post nothing further (same key): no second release, compensation or top-up', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  const first = await terminate(m, f, 'PT_CANCELLED');
  const rowsBefore = await m.prisma.walletLedgerEntry.count();
  const second = await terminate(m, f, 'PT_CANCELLED');
  assert.deepEqual(second, first);
  assert.equal(await m.prisma.walletLedgerEntry.count(), rowsBefore);
  await assertBooksSound(m, 'replay');
});

// ───────────────────────────── isolation: per contract, never other money ─────────────────────────────

test('funds stay within ONE contract: two held contracts of one PT; ending/compensating one leaves the other’s hold and money untouched', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const ptUserId = `pt-shared-${randomUUID().slice(0, 6)}`;
  const a = await paid(m, { price: 1_000_000, n: 10, h: '0.10', ptUserId });
  const b = await paid(m, { price: 2_000_000, n: 10, h: '0.10', ptUserId });
  for (let i = 0; i < 3; i++) await deliver(m, a);
  for (let i = 0; i < 3; i++) await deliver(m, b);
  assert.equal(await heldOf(m, a), '90000');
  assert.equal(await heldOf(m, b), '180000', 'B’s target is 10% of ITS expected 1.800.000');
  const bBefore = { held: await heldOf(m, b), rows: await m.prisma.walletLedgerEntry.count({ where: { transactionId: b.txnId } }) };
  const pt = await m.wallet.getOrCreateWallet('PT', ptUserId);
  assert.equal(str(pt.holdbackBalance), '270000', 'the wallet’s bucket is the sum over the PT’s contracts');
  const r = await terminate(m, a, 'PT_CANCELLED');
  assert.equal(r.ptHoldback?.stillHeld, '70000.00');
  const dA = await decide(m, a, 'VERIFIED');
  assert.equal(dA.paidToClient, '70000.00');
  assert.equal(await heldOf(m, b), bBefore.held, 'B’s hold is untouched');
  assert.equal(await m.prisma.walletLedgerEntry.count({ where: { transactionId: b.txnId } }), bBefore.rows, 'no row was written for B');
  const pt2 = await m.wallet.getOrCreateWallet('PT', ptUserId);
  assert.equal(str(pt2.holdbackBalance), '180000');
  // A’s client never received a cent from B’s money
  assert.equal(str((await bal(m, a)).client), '770000');
  await assertBooksSound(m, 'two contracts');
});

test('a compensation shortfall of contract A is never taken from the hold of contract B (and not from AVAILABLE): it is an OPEN obligation', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const ptUserId = `pt-shared-${randomUUID().slice(0, 6)}`;
  const a = await paid(m, { price: 1_000_000, n: 2, h: '0.10', ptUserId });
  const b = await paid(m, { price: 2_000_000, n: 10, h: '0.10', ptUserId });
  for (let i = 0; i < 3; i++) await deliver(m, b);
  await deliver(m, a);
  const heldB = await heldOf(m, b);
  const availBefore = (await bal(m, a)).ptAvailable;
  const outcomes = [];
  for (let i = 0; i < 4; i++) outcomes.push(await noShow(m, a));
  assert.ok(outcomes.some((x) => Number(x.unpaid) > 0), 'A could not fund everything');
  assert.equal(await heldOf(m, b), heldB, 'B’s hold untouched');
  assert.equal(str((await bal(m, a)).ptAvailable), str(availBefore), 'PT available untouched');
  assert.equal(await m.prisma.partnerReceivable.count(), 0);
  await assertBooksSound(m, 'no cross-contract draw');
});

test('the hold is never withdrawable; a PENDING withdrawal racing with a hold / release / termination stays race-safe and the books balance', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  await deliver(m, f);
  await deliver(m, f); // AVAILABLE 90.000, held 90.000
  const pt = f.parties.ptUserId;
  await assert.rejects(() => m.withdrawals.requestWithdrawal('PT', pt, '100000', 'Bank ABC'), (e: any) => e.code === 'EXCEEDS_WITHDRAWABLE_BALANCE', 'the held 90.000 cannot be withdrawn');
  const req = await m.withdrawals.requestWithdrawal('PT', pt, '90000', 'Bank ABC');
  // now sessions, a termination and the release race with the approval of that request
  const ops = [
    m.withdrawals.approve(req.id, 'admin-1'),
    deliver(m, f),
    deliver(m, f),
  ];
  await Promise.all(ops);
  await Promise.all([terminate(m, f, 'MUTUAL'), m.ledger.releasePtHoldback({ transactionId: f.txnId, parties: f.parties, label: f.contractId, idempotencyKey: `HOLDBACK_RELEASE:${f.contractId}` })]);
  const w = await m.wallet.getOrCreateWallet('PT', pt);
  assert.equal(str(w.lockedBalance), '90000', 'the approved withdrawal keeps its reservation');
  assert.equal(str(w.availableBalance.plus(w.lockedBalance)), '360000', '4 sessions x 90.000 earned, hold included, nothing lost');
  assert.equal(await heldOf(m, f), '0');
  await assertBooksSound(m, 'withdrawal race');
});

// ───────────────────────────── old contracts and the snapshot ─────────────────────────────

test('old contracts are not affected: no rate (or rate 0) never writes a HOLDBACK row and the PT is paid in full per session', skipOpts, async () => {
  const m = await load();
  for (const hh of [undefined, '0', '0.0000']) {
    await resetLedger(m);
    const f = await paid(m, { price: 1_000_000, n: 4, h: hh });
    const r = await deliver(m, f);
    assert.equal(r.released.pt, '225000.00');
    assert.equal(r.ptHoldback, undefined);
    await deliver(m, f);
    await deliver(m, f);
    await deliver(m, f);
    const t = await terminate(m, f, 'COMPLETED');
    assert.equal(t.ptHoldback, undefined);
    assert.equal(await m.prisma.walletLedgerEntry.count({ where: { bucket: 'HOLDBACK' } }), 0, 'no HOLDBACK row ever');
    assert.equal(str((await bal(m, f)).ptAvailable), '900000');
    await assertBooksSound(m, `old contract h=${hh}`);
  }
});

test('turning the policy off later does not lose held money: a termination that no longer carries the rate still returns what the LEDGER holds', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  for (let i = 0; i < 3; i++) await deliver(m, f);
  assert.equal(await heldOf(m, f), '90000');
  const params = termParams(m, f, 'MUTUAL');
  delete (params as { ptHoldbackRate?: unknown }).ptHoldbackRate; // the caller stopped sending the rate
  const r = await m.ledger.terminateContract(params);
  assert.equal(r.ptHoldback?.returnedToPt, '90000.00');
  assert.equal(await heldOf(m, f), '0');
  assert.equal(str((await bal(m, f)).ptAvailable), '270000');
  await assertBooksSound(m, 'policy off later');
});

// ───────────────────────────── ledger totals before/after ─────────────────────────────

test('ledger totals balance before and after every step of a PT-fault ending; the printed table is the evidence', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 4, h: '0.10' });
  const lines: string[] = [];
  const snap = async (label: string) => {
    const b = await bal(m, f);
    const report = await m.reconcile.assertInvariant(label);
    lines.push(`${label.padEnd(18)} escrow=${str(b.escrow)} ptPending=${str(b.ptPending)} ptAvail=${str(b.ptAvailable)} ptHold=${str(b.ptHoldback)} platform=${str(b.revenue.plus(b.revenuePending))} client=${str(b.client)} drift=${report.drift}`);
    assert.equal(report.drift, '0.00');
  };
  await snap('paid');
  await deliver(m, f); await snap('S1');
  await deliver(m, f); await snap('S2');
  await terminate(m, f, 'PT_CANCELLED'); await snap('PT_CANCELLED');
  console.log(['FH9-TABLE 1.000.000/4 PT_CANCELLED after 2', ...lines].join('\n'));
  await assertBooksSound(m, 'totals');
});

// ───────────────────────────── snapshot on the transaction, PT view, admin report ─────────────────────────────

test('the ledger keeps its own copy of the hold rate/target on the payment transaction; a later call with a different rate is refused and posts nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10' });
  await deliver(m, f);
  const txn = await m.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: f.txnId } });
  const meta = txn.metadata as { rates?: unknown; ptHoldback?: { rate: string; target: string; policy: number } };
  assert.deepEqual(meta.ptHoldback, { rate: '0.1', target: '90000', policy: 1 });
  assert.ok(meta.rates, 'the rate/party snapshot frozen at checkout is preserved (JSON merge, not replace)');
  const rows = await m.prisma.walletLedgerEntry.count();
  await assert.rejects(
    () => m.ledger.releaseSession({
      transactionId: f.txnId, price: f.price, totalSessions: f.n, rates: f.rates, parties: f.parties, label: 'x',
      idempotencyKey: `SESSION_RELEASE:${f.contractId}:other`, ptHoldbackRate: D(m, '0.20'),
    }),
    /does not match the snapshot/,
  );
  assert.equal(await m.prisma.walletLedgerEntry.count(), rows, 'nothing was posted');
  await assertBooksSound(m, 'snapshot guard');
});

test('PT view per contract: pending / earned / held / available-from-contract / release state, from the ledger only; the wallet-level numbers agree', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const view = (await import('../services/pt-wallet-contracts.service')).buildPtWalletContractsView;
  const ptUserId = `pt-view-${randomUUID().slice(0, 6)}`;
  const f = await paid(m, { price: 1_000_000, n: 10, h: '0.10', ptUserId });
  const old = await paid(m, { price: 500_000, n: 5, ptUserId }); // an old contract of the same PT: no holdback
  await deliver(m, f);
  await deliver(m, f);
  await deliver(m, old);
  let v = await view(ptUserId);
  const row = v.contracts.find((c) => c.transactionId === f.txnId)!;
  assert.equal(row.contractValue, '1000000.00');
  assert.equal(row.expectedIncome, '900000.00');
  assert.equal(row.holdbackTarget, '90000.00');
  assert.equal(row.pending, '720000.00', '8 sessions of 90.000 not yet earned');
  assert.equal(row.held, '90000.00');
  assert.equal(row.availableFromContract, '90000.00', 'S2 paid 90.000 (S1 was held)');
  assert.equal(row.earned, '180000.00', 'earned = paid to available + held');
  assert.equal(row.release.state, 'RUNNING');
  assert.equal(row.release.ended, false);
  assert.equal(row.compensationPaid, '0.00');
  assert.equal(D(m, row.pending).plus(row.earned).toFixed(0), '900000', 'pending + earned == the PT expected income while nothing was refunded');
  const oldRow = v.contracts.find((c) => c.transactionId === old.txnId)!;
  assert.equal(oldRow.release.state, 'NO_HOLDBACK');
  assert.equal(oldRow.held, '0.00');
  assert.equal(oldRow.holdbackTarget, '0.00');
  assert.equal(v.wallet.held, '90000.00');
  assert.equal(v.totals.held, '90000.00');
  assert.equal(v.totals.contractsHolding, 1);

  // PT-fault ending: part of the hold is the contract's own verified compensation
  await terminate(m, f, 'PT_CANCELLED');
  v = await view(ptUserId);
  let after = v.contracts.find((c) => c.transactionId === f.txnId)!;
  assert.equal(after.release.ended, true);
  assert.equal(after.release.state, 'WAITING_RECONCILIATION', 'a potential PT-fault amount waits for an admin decision');
  assert.equal(after.held, '80000.00');
  assert.equal(after.release.reserved, '80000.00');
  assert.equal(after.release.pendingFaultReview, true);
  assert.ok(after.release.reviewBy && !after.release.reviewOverdue);
  assert.equal(after.compensationPaid, '0.00', 'nothing paid before the decision');
  await decide(m, f, 'VERIFIED');
  v = await view(ptUserId);
  after = v.contracts.find((c) => c.transactionId === f.txnId)!;
  assert.equal(after.release.state, 'RELEASED');
  assert.equal(after.held, '0.00');
  assert.equal(after.compensationPaid, '80000.00');
  assert.equal(v.wallet.held, '0.00');
  assert.equal(v.totals.contractsHolding, 0);
  // another PT sees nothing of it
  const other = await view('someone-else');
  assert.deepEqual(other.contracts, []);
});

test('an ended contract that waits for its own open obligation shows the hold as WAITING_RECONCILIATION with the reason; the admin report lists running / waiting / stuck apart', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const view = (await import('../services/pt-wallet-contracts.service')).buildPtWalletContractsView;
  const report = (await import('../services/admin-obligations.service')).buildObligationsReport;
  const ptUserId = `pt-adm-${randomUUID().slice(0, 6)}`;
  const running = await paid(m, { price: 1_000_000, n: 10, h: '0.10', ptUserId });
  await deliver(m, running);
  const waiting = await paid(m, { price: 1_000_000, n: 4, h: '0.10', ptUserId });
  await deliver(m, waiting);
  for (let i = 0; i < 4; i++) await noShow(m, waiting);
  await terminate(m, waiting, 'MUTUAL');
  const w = (await view(ptUserId)).contracts.find((c) => c.transactionId === waiting.txnId)!;
  assert.equal(w.release.state, 'WAITING_RECONCILIATION');
  assert.equal(w.release.heldDueToDispute, true);
  assert.ok(Number(w.release.openObligations) > 0);
  assert.ok(Number(w.held) > 0 && Number(w.held) <= 90000);

  const r = await report({ lookupTargetStatus: null });
  assert.equal(r.summary.ptHoldback.contractsHolding, 2);
  assert.equal(r.summary.ptHoldback.waitingReconciliation.count, 1);
  assert.equal(r.summary.ptHoldback.stuck.count, 0);
  assert.equal(D(m, r.summary.ptHoldback.totalHeld).toFixed(0), String(90000 + Number(w.held)));
  const byTx = new Map(r.ptHoldbacks.map((x) => [x.transactionId, x]));
  assert.equal(byTx.get(running.txnId)?.state, 'RUNNING');
  assert.equal(byTx.get(waiting.txnId)?.state, 'WAITING_RECONCILIATION');
  assert.ok(Number(byTx.get(waiting.txnId)!.openObligations) > 0);
  assert.equal(r.truncated.ptHoldbacks, false);

  // TEST FIXTURE: the obligation is closed but the sweep has NOT run yet: the reserve still waits (the sweep closes it), it is not 'stuck'
  await m.prisma.contractUnpaidObligation.updateMany({ where: { transactionId: waiting.txnId }, data: { status: 'WAIVED' } });
  assert.equal((await report({ lookupTargetStatus: null })).summary.ptHoldback.stuck.count, 0);
  // TEST FIXTURE: an ended contract that holds money with NO reserve waiting (its review row is gone) is the Z4 'stuck' state
  await m.prisma.ptHoldbackReview.deleteMany({ where: { transactionId: waiting.txnId } });
  const r2 = await report({ lookupTargetStatus: null });
  assert.equal(r2.summary.ptHoldback.stuck.count, 1, 'visible to the owner until the sweep releases it');
  await m.ledger.releasePtHoldback({ transactionId: waiting.txnId, parties: waiting.parties, label: 'sweep', idempotencyKey: `HOLDBACK_RELEASE:${waiting.contractId}` });
  const r3 = await report({ lookupTargetStatus: null });
  assert.equal(r3.summary.ptHoldback.stuck.count, 0);
  assert.equal(r3.summary.ptHoldback.contractsHolding, 1);
  await assertBooksSound(m, 'admin report');
});

test('source scan: the HOLDBACK bucket is only written by contract-ledger.service; the other modules that name it only read it', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  const root = path.resolve(__dirname, '..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'generated' || e.name === '__tests__' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (full.endsWith('.ts')) out.push(full);
    }
    return out;
  };
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const naming = walk(root)
    .filter((f) => /['"]HOLDBACK['"]/.test(strip(fs.readFileSync(f, 'utf8'))))
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
  const allowed = [
    'services/contract-ledger.service.ts',
    'services/wallet.service.ts',
    'services/ledger-state-checks.ts',
    'services/pt-wallet-contracts.service.ts',
    'services/admin-obligations.service.ts',
    'services/obligations-inventory.ts',
  ];
  assert.deepEqual(naming.filter((f) => !allowed.includes(f) && f !== 'services/holdback-review.service.ts'), []);
  // and only the ledger service and the audited review decision ever debit/credit it
  const writers = naming.filter((f) => /\.(debit|credit)\([^)]*'HOLDBACK'/.test(strip(fs.readFileSync(path.join(root, f), 'utf8'))));
  assert.deepEqual(writers, ['services/contract-ledger.service.ts', 'services/holdback-review.service.ts']);
});
