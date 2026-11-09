/**
 * I5 = A + C1 (Ngai, 31/10/2026) - BACKEND INTEGRATION, real ledger, isolated *_test database.
 *
 *   A   a session that had a D77 late-arrival compensation L AND is then ruled PT no-show is owed V IN TOTAL (L lies INSIDE V). The no-show step adds only
 *       V - (L paid + L still owed). Never V + L. Nothing is taken from another session's money. In whichever ORDER the two steps arrive, the client's total
 *       for the session is V; the second step finds the first one in the same ledger transaction and does not pay again.
 *   C1  a COMPLETED session with an unsettled / OPEN L: L is deducted from the session's OWN money before the parties are paid (V - L in total, each party
 *       its own rate share of L - gym included). The share that corresponds to an OPEN L is not paid to anyone (DESIGN REQUIRED: no ledger route pays an
 *       obligation), it stays in the contract's own pending and the obligation stays OPEN.
 *
 * Numbers: 1.000.000 / 4 sessions => V = 250.000, L = 125.000. No gym: PT 90% / platform 10%. Gym contract: PT 55% / gym 35% / platform 10%.
 * "OPEN L" is made two honest ways: record-only (what the ending writes when payment-service never performed the step) and a REAL SHORTAGE
 * (the contract's own pending already spent by real no-show compensations, then one more late arrival on a session that has nothing left to fund it).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables), through the guarded preload.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = { skip: isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.' };
// Fail-closed ledger switch (services/late-open-settlement-flag.ts): these cases PAY an OPEN L, so the suite turns it on in-process (the database already ends _test; nothing else is changed).
process.env.NODE_ENV = 'test';
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = 'true';

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
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
      reconcile: await import('../services/reconcile.service'),
      wallet: (await import('../services/wallet.service')).walletService,
    };
  }
  return mods;
}
test.after(async () => {
  if (mods) await mods.prisma.$disconnect();
});

type Dec = InstanceType<Mods['Prisma']['Decimal']>;
type Rates = import('../services/contract-money').RateTable;
type OwnerType = 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM';

async function reset(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
}

interface Contract {
  id: string;
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: Dec;
  total: number;
  rates: Rates;
}

async function paidContract(m: Mods, id: string, o: { gym?: boolean } = {}): Promise<Contract> {
  const D = (v: string) => new m.Prisma.Decimal(v);
  const clientUserId = `client-${id}`;
  const parties = { ptUserId: 'pt-i5', gymId: o.gym ? 'gym-i5' : null, clientUserId };
  const rates: Rates = o.gym
    ? { platformRate: D('0.10'), ptRate: D('0.55'), gymRate: D('0.35') }
    : { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientUserId, purpose: 'PT_CONTRACT', amount: 1_000_000, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${randomUUID()}`, idempotencyKey: `checkout-${id}-${randomUUID()}`, relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: id, activationStatus: 'PENDING', sourceService: 'integration-test',
    },
  });
  const c: Contract = { id, txnId: txn.id, parties, price: D('1000000'), total: 4, rates };
  await m.ledger.settleContractPayment({ transactionId: c.txnId, price: c.price, rates: c.rates, parties: c.parties, label: `PT_CONTRACT ${id}` });
  return c;
}

const base = (c: Contract) => ({ transactionId: c.txnId, price: c.price, totalSessions: c.total, rates: c.rates, parties: c.parties });
const late = (m: Mods, c: Contract, s: string) =>
  m.ledger.compensateLateArrival({ ...base(c), label: `Contract ${c.id} late ${s}`, idempotencyKey: `PT_LATE_ARRIVAL:${c.id}:${s}` });
const noShow = (m: Mods, c: Contract, s: string) =>
  m.ledger.compensateNoShow({ ...base(c), label: `Contract ${c.id} no-show ${s}`, idempotencyKey: `PT_NO_SHOW:${c.id}:${s}`, settleLateOpen: true });
const release = (m: Mods, c: Contract, s: string) =>
  m.ledger.releaseSession({ ...base(c), label: `Contract ${c.id} session ${s}`, idempotencyKey: `SESSION_RELEASE:${c.id}:${s}`, settleLateOpen: true });
const recordLate = (m: Mods, c: Contract, s: string) =>
  m.ledger.recordLateArrivalObligation({ ...base(c), label: `Contract ${c.id} late ${s}`, idempotencyKey: `PT_LATE_ARRIVAL:${c.id}:${s}`, reason: 'ending: D77 never performed' });

async function wallet(m: Mods, t: OwnerType, id: string) {
  const w = await m.wallet.getOrCreateWallet(t, id);
  return { pending: Number(w.pendingBalance), available: Number(w.availableBalance) };
}
/** What this contract's pending (PT + gym + platform) still holds, read from the wallets (one contract in the database). */
async function contractPending(m: Mods, c: Contract) {
  const pt = (await wallet(m, 'PT', c.parties.ptUserId)).pending;
  const gym = c.parties.gymId ? (await wallet(m, 'GYM', c.parties.gymId)).pending : 0;
  const plat = (await wallet(m, 'PLATFORM', 'REVENUE')).pending;
  return { pt, gym, plat, total: pt + gym + plat };
}
const clientAvailable = async (m: Mods, c: Contract) => (await wallet(m, 'CLIENT', c.parties.clientUserId)).available;
async function obligations(m: Mods) {
  const rows = await m.prisma.contractUnpaidObligation.findMany({ orderBy: [{ createdAt: 'asc' }, { key: 'asc' }] });
  return rows.map((r) => ({ key: r.key, kind: r.kind as string, status: r.status as string, owed: Number(r.owed), paid: Number(r.paid), unpaid: Number(r.unpaid) }));
}
async function assertBooksSound(m: Mods, context: string) {
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.drift, '0.00', `${context}: no drift`);
  assert.equal(report.negativeWallets.length, 0, `${context}: no negative wallet`);
  assert.equal(await m.prisma.partnerReceivable.count(), 0, `${context}: no PT debt, nothing fronted`);
}

// ── A: D77 settled, then PT no-show ──────────────────────────────────────────

test('I5/A late (paid) THEN no-show: the client gets V in total (L 125.000 + 125.000 more), the parties get 0 for the session, other sessions\' pending is untouched, replays change nothing', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const l = await late(m, A, 's1');
  assert.equal(l.paid, '125000.00');
  const n = await noShow(m, A, 's1');
  assert.deepEqual([n.owed, n.paid, n.unpaid], ['125000.00', '125000.00', '0.00'], 'the no-show adds V - L, not V');
  assert.deepEqual(n.charged, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
  assert.deepEqual((n as any).d77, { sessionValue: '250000.00', lateArrivalPaid: '125000.00', lateArrivalOpen: '0.00', additional: '125000.00' });
  assert.equal(await clientAvailable(m, A), 250_000, 'the client received exactly V for the session');
  const p = await contractPending(m, A);
  assert.equal(p.total, 750_000, 'pending of the 3 other sessions untouched');
  assert.deepEqual(await obligations(m), []);
  // replay: same result, no new money
  const again = await noShow(m, A, 's1');
  assert.deepEqual(again, n);
  assert.equal(await clientAvailable(m, A), 250_000);
  await assertBooksSound(m, 'late then no-show');
});

test('I5/A the other ORDER: no-show THEN late: the late step finds the no-show in the same ledger and pays nothing more (idempotent "already inside V")', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const n = await noShow(m, A, 's1');
  assert.deepEqual([n.owed, n.paid, (n as any).d77], ['250000.00', '250000.00', undefined], 'no D77 on the books: the whole V');
  const l = await late(m, A, 's1');
  assert.deepEqual([l.owed, l.paid, l.unpaid, l.compensation], ['0.00', '0.00', '0.00', '0.00']);
  assert.equal((l as any).d77.coveredByNoShow, true);
  assert.equal(await clientAvailable(m, A), 250_000, 'V in total, not V + L');
  assert.equal((await contractPending(m, A)).total, 750_000);
  assert.deepEqual(await obligations(m), []);
  assert.deepEqual(await late(m, A, 's1'), l, 'replay');
  await assertBooksSound(m, 'no-show then late');
});

// POLICY CHANGE D77 FINAL (phuong an A, 01/11/2026). Before: the OPEN L stayed OPEN and 125.000 stayed in pending. Now: the no-show pays the OPEN L too, inside its own transaction (flag settleLateOpen).
test('I5/A + A OPEN L (record-only) THEN no-show: the no-show pays L (125.000) AND the rest (125.000) in cash = V; L closed PAID_VIA_LEDGER; no duplicate obligation; nothing held back', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  const n = await noShow(m, A, 's1');
  assert.deepEqual([n.owed, n.paid, n.unpaid], ['250000.00', '250000.00', '0.00']);
  assert.deepEqual((n as any).d77, { sessionValue: '250000.00', lateArrivalPaid: '125000.00', lateArrivalOpen: '0.00', additional: '125000.00' });
  assert.equal(await clientAvailable(m, A), 250_000);
  const ob = await obligations(m);
  assert.equal(ob.length, 1, 'only the original L obligation exists');
  assert.deepEqual([ob[0].kind, ob[0].status, ob[0].owed, ob[0].paid, ob[0].unpaid], ['LATE_ARRIVAL', 'PAID_VIA_LEDGER', 125_000, 125_000, 0]);
  assert.equal((await contractPending(m, A)).total, 750_000, 'only the 3 other sessions are left in pending: nothing held back');
  await assertBooksSound(m, 'open late then no-show');
});

test('I5/A REAL SHORTAGE: the contract\'s pending was really spent by earlier no-shows, so L cannot be paid (OPEN), then the no-show of that session: nothing duplicated, total = V', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  for (const s of ['n1', 'n2', 'n3', 'n4']) await noShow(m, A, s); // 4 x 250.000: the contract's pending is spent
  assert.equal((await contractPending(m, A)).total, 0);
  const l = await late(m, A, 'x'); // a fifth session (over-booked in the fixture) has nothing to fund its L
  assert.deepEqual([l.owed, l.paid, l.unpaid], ['125000.00', '0.00', '125000.00']);
  const cashBefore = await clientAvailable(m, A);
  const n = await noShow(m, A, 'x');
  assert.deepEqual([n.owed, n.paid, n.unpaid], ['250000.00', '0.00', '250000.00'], 'the step owes the whole V (L open 125k + V - L 125k); nothing left to fund it -> both stay OPEN, nothing is faked');
  const ob = (await obligations(m)).filter((o) => o.key.endsWith(':x'));
  assert.deepEqual(ob.map((o) => [o.kind, o.owed, o.unpaid]).sort(), [['LATE_ARRIVAL', 125_000, 125_000], ['NO_SHOW', 125_000, 125_000]].sort());
  assert.equal(ob.reduce((s, o) => s + o.unpaid, 0), 250_000, 'the client is owed V for the session in total, not V + L');
  assert.equal(await clientAvailable(m, A), cashBefore, 'no cash moved');
  await assertBooksSound(m, 'real shortage');
});

test('I5/A with a gym (55/35/10): the added V - L is split by the same rates, gym included', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const G = await paidContract(m, 'G', { gym: true });
  const l = await late(m, G, 's1');
  assert.deepEqual(l.charged, { pt: '68750.00', gym: '43750.00', platform: '12500.00' });
  const n = await noShow(m, G, 's1');
  assert.deepEqual(n.charged, { pt: '68750.00', gym: '43750.00', platform: '12500.00' });
  assert.equal(await clientAvailable(m, G), 250_000);
  assert.equal((await contractPending(m, G)).total, 750_000);
  await assertBooksSound(m, 'gym late then no-show');
});

test('a no-show with NO D77 on the session is exactly what it always was (V, no d77 block)', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const n = await noShow(m, A, 's1');
  assert.deepEqual([n.owed, n.paid, n.unpaid, n.charged], ['250000.00', '250000.00', '0.00', { pt: '225000.00', gym: '0.00', platform: '25000.00' }]);
  assert.equal((n as any).d77, undefined);
  assert.equal(await clientAvailable(m, A), 250_000);
  await assertBooksSound(m, 'plain no-show');
});

// ── C1: COMPLETED with an OPEN or unsettled L ────────────────────────────────

// POLICY CHANGE D77 FINAL (phuong an A): the 125.000 is no longer held back - the release pays it to the client (flag settleLateOpen).
test('I5/C1 + A OPEN L (record-only) THEN release: PT/platform get V - L (112.500 + 12.500), the client is PAID L (125.000), pending 750.000, the obligation is PAID_VIA_LEDGER', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  const r = await release(m, A, 's1');
  assert.deepEqual(r.released, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
  assert.deepEqual((r as any).lateArrivalDeducted, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
  assert.equal((await contractPending(m, A)).total, 750_000, 'only the 3 other sessions: nothing held back');
  assert.equal(await clientAvailable(m, A), 125_000);
  const ob = await obligations(m);
  assert.deepEqual(ob.map((o) => [o.kind, o.status, o.owed, o.paid, o.unpaid]), [['LATE_ARRIVAL', 'PAID_VIA_LEDGER', 125_000, 125_000, 0]]);
  assert.deepEqual(await release(m, A, 's1'), r, 'replay');
  await assertBooksSound(m, 'open late then release');
});

test('I5/C1 REAL SHORTAGE then release of that session: V - L still holds (PT/platform never get the whole V)', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  for (const s of ['n1', 'n2', 'n3']) await noShow(m, A, s); // 3 x 250.000 spent; 250.000 pending left = the 4th session's own value
  // an extra late arrival on a 5th session: the pending left is exactly the 4th session's value, so L (125.000) IS fundable here - spend it first
  await late(m, A, 'p'); // 125.000 paid from the 4th session's pending => 125.000 left
  await late(m, A, 'q'); // 125.000 paid => 0 left
  const l = await late(m, A, 'x'); // nothing left: OPEN, paid 0 (a real shortage)
  assert.deepEqual([l.paid, l.unpaid], ['0.00', '125000.00']);
  const r = await release(m, A, 'x');
  // nothing is pending, so nothing moves - but the deduction (V - L) is what the ledger would have paid, never V
  assert.deepEqual((r as any).lateArrivalDeducted, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
  assert.deepEqual(r.released, { pt: '0.00', gym: '0.00', platform: '0.00' }, 'no own money left -> nothing released (never another session\'s money)');
  await assertBooksSound(m, 'real shortage then release');
});

test('I5/C1 with a gym: the OPEN L is deducted per party by its own rate share (PT 68.750, gym 43.750, platform 12.500) - the parties get V - L = 68.750 / 43.750 / 12.500', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const G = await paidContract(m, 'G', { gym: true });
  await recordLate(m, G, 's1');
  const r = await release(m, G, 's1');
  assert.deepEqual(r.released, { pt: '68750.00', gym: '43750.00', platform: '12500.00' }, 'V (137.500 / 87.500 / 25.000) minus L (68.750 / 43.750 / 12.500)');
  assert.equal(Number(r.released.pt) + Number(r.released.gym) + Number(r.released.platform), 125_000);
  await assertBooksSound(m, 'gym open late then release');
});

test('I5/C1 a WAIVED L no longer reduces the session: the parties get the whole V (the obligation was extinguished by a recorded decision)', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  await m.prisma.contractUnpaidObligation.updateMany({ data: { status: 'WAIVED' } });
  const r = await release(m, A, 's1');
  assert.deepEqual(r.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  await assertBooksSound(m, 'waived');
});

// ── D77 after the release: never from another session ────────────────────────

test('I5/C1 D77 reaching the ledger AFTER the full release is recorded OPEN, nothing is taken from other sessions', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await release(m, A, 's1');
  const before = await contractPending(m, A);
  const l = await late(m, A, 's1');
  assert.deepEqual([l.paid, l.unpaid], ['0.00', '125000.00']);
  assert.deepEqual(await contractPending(m, A), before, 'not a dong of pending moved');
  assert.equal(await clientAvailable(m, A), 0);
  await assertBooksSound(m, 'late after release');
});

// ── concurrency ──────────────────────────────────────────────────────────────

test('concurrency: late and no-show of the same session raced (both orders, 6 rounds) -> the client always ends with exactly V, pending 750.000, no duplicate obligation', skipOpts, async () => {
  const m = await load();
  for (let round = 0; round < 6; round++) {
    await reset(m);
    const A = await paidContract(m, 'A');
    const calls = [() => late(m, A, 's1'), () => noShow(m, A, 's1')];
    if (round % 2) calls.reverse();
    await Promise.all(calls.map((f) => f()));
    assert.equal(await clientAvailable(m, A), 250_000, `round ${round}: V in total`);
    assert.equal((await contractPending(m, A)).total, 750_000, `round ${round}: other sessions untouched`);
    assert.deepEqual(await obligations(m), [], `round ${round}`);
    await assertBooksSound(m, `race ${round}`);
  }
});

test('concurrency: late and release of the same session raced -> never another session\'s pending: either V - L is paid and L is cash, or V is paid and L is OPEN', skipOpts, async () => {
  const m = await load();
  for (let round = 0; round < 6; round++) {
    await reset(m);
    const A = await paidContract(m, 'A');
    const calls = [() => late(m, A, 's1'), () => release(m, A, 's1')];
    if (round % 2) calls.reverse();
    await Promise.all(calls.map((f) => f()));
    const p = await contractPending(m, A);
    assert.equal(p.total, 750_000, `round ${round}: exactly the 3 other sessions\' value is left in pending`);
    const cash = await clientAvailable(m, A);
    const open = (await obligations(m)).reduce((s, o) => s + o.unpaid, 0);
    assert.ok((cash === 125_000 && open === 0) || (cash === 0 && open === 125_000), `round ${round}: cash ${cash} open ${open}`);
    await assertBooksSound(m, `race release ${round}`);
  }
});
