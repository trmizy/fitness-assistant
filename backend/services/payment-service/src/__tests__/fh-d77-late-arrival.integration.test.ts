/**
 * D77 (owner decision, final) - BACKEND INTEGRATION, real ledger, isolated *_test database.
 *
 * A late-arrival compensation is deducted from the value of THAT late session: each party (PT / gym / platform) is
 * released its share of the session minus exactly its portion of the compensation already paid to the client.
 *   - the session is identified from the keys every caller already uses: `PT_LATE_ARRIVAL:<s>` <-> `SESSION_RELEASE:<s>` /
 *     `UNRESOLVED_SESSION:<s>`; nothing is taken from the request body;
 *   - late then release / late then cancel / late then terminate with an unresolved session: no OPEN obligation, no
 *     fronting, no pooled draw, books exact; the preview (money-breakdown with the transaction id) equals what is credited;
 *   - a session released in full BEFORE the compensation, and compensations written before this rule existed, are left alone:
 *     nothing is clawed back and nothing new is recorded.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_fha_b_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh-d77-late-arrival.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { HOSTILE_FLAG_VALUES, withRemovedFlag } from './support/d48-flag';
import { isTestDatabaseUrl } from './support/test-db-guard';

const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = {
  skip: isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};
const SECRET = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

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

/** 1.000.000 / 4 sessions: a session is 250.000 = PT 225.000 + platform 25.000; a late arrival costs 125.000 = PT 112.500 + platform 12.500. */
async function paidContract(m: Mods, id: string, o: { price?: number; total?: number; gym?: boolean; pt?: string } = {}): Promise<Contract> {
  const D = (v: string) => new m.Prisma.Decimal(v);
  const price = o.price ?? 1_000_000;
  const total = o.total ?? 4;
  const clientUserId = `client-${id}`;
  const parties = { ptUserId: o.pt ?? 'pt-d77', gymId: o.gym ? 'gym-d77' : null, clientUserId };
  const rates: Rates = o.gym
    ? { platformRate: D('0.10'), ptRate: D('0.55'), gymRate: D('0.35') }
    : { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientUserId, purpose: 'PT_CONTRACT', amount: price, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${randomUUID()}`, idempotencyKey: `checkout-${id}-${randomUUID()}`, relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: id, activationStatus: 'PENDING', sourceService: 'integration-test',
    },
  });
  const c: Contract = { id, txnId: txn.id, parties, price: D(String(price)), total, rates };
  await m.ledger.settleContractPayment({ transactionId: c.txnId, price: c.price, rates: c.rates, parties: c.parties, label: `PT_CONTRACT ${id}` });
  return c;
}

const base = (c: Contract) => ({ transactionId: c.txnId, price: c.price, totalSessions: c.total, rates: c.rates, parties: c.parties });
const late = (m: Mods, c: Contract, s: string) =>
  m.ledger.compensateLateArrival({ ...base(c), label: `Contract ${c.id} late ${s}`, idempotencyKey: `PT_LATE_ARRIVAL:${c.id}:${s}` });
const release = (m: Mods, c: Contract, s: string) =>
  m.ledger.releaseSession({ ...base(c), label: `Contract ${c.id} session ${s}`, idempotencyKey: `SESSION_RELEASE:${c.id}:${s}` });
const resolve = (m: Mods, c: Contract, s: string, outcome: 'DELIVERED' | 'NOT_DELIVERED') =>
  m.ledger.resolveUnresolvedSession({ ...base(c), label: `Contract ${c.id} unresolved ${s}`, idempotencyKey: `UNRESOLVED_SESSION:${c.id}:${s}`, outcome });

function terminate(m: Mods, c: Contract, o: { reason: 'CLIENT_CANCELLED' | 'MUTUAL' | 'COMPLETED'; used: number; unresolved?: number; releasedPt: string; releasedPlatform: string; releasedGym?: string }) {
  const D = (v: string) => new m.Prisma.Decimal(v);
  return m.ledger.terminateContract({
    ...base(c), usedSessions: o.used, compensatedSessions: 0, unresolvedSessions: o.unresolved, reason: o.reason,
    alreadyReleased: { pt: D(o.releasedPt), gym: D(o.releasedGym ?? '0'), platform: D(o.releasedPlatform) },
    label: `Contract ${c.id} termination`, idempotencyKey: `CONTRACT_TERMINATE:${c.id}`,
  });
}

async function bucketsOf(m: Mods, ownerType: OwnerType, ownerId: string) {
  const w = await m.wallet.getOrCreateWallet(ownerType, ownerId);
  return { pending: w.pendingBalance.toFixed(2), available: w.availableBalance.toFixed(2) };
}

async function assertBooksSound(m: Mods, context: string) {
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.drift, '0.00', `${context}: no drift`);
  assert.equal(report.negativeWallets.length, 0, `${context}: no negative wallet`);
  const overdrawn = await m.prisma.$queryRawUnsafe<{ owner: string }[]>(`
    SELECT w.owner_type::text || ' ' || w.owner_id AS owner
      FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id
     WHERE e.bucket::text = 'PENDING'
     GROUP BY w.owner_type, w.owner_id, e.transaction_id
    HAVING SUM(CASE WHEN e.entry_type::text = 'CREDIT' THEN e.amount ELSE -e.amount END) < 0`);
  assert.deepEqual(overdrawn, [], `${context}: no transaction overdrew its own pending`);
}

async function noObligationsNoDebt(m: Mods, context: string) {
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0, `${context}: no obligation`);
  assert.equal(await m.prisma.partnerReceivable.count(), 0, `${context}: no PT debt`);
}

// ── late, then release ───────────────────────────────────────────────────────

test('D77 late then release: the PT gets 225.000 - 112.500 once (platform 25.000 - 12.500), the result says what was deducted, a retry changes nothing', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const comp = await late(m, A, 's1');
  assert.deepEqual([comp.owed, comp.paid, comp.unpaid], ['125000.00', '125000.00', '0.00']);

  const r = await release(m, A, 's1');
  assert.deepEqual(r.released, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
  assert.deepEqual(r.lateArrivalDeducted, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
  assert.equal((await bucketsOf(m, 'PT', 'pt-d77')).available, '112500.00');

  const before = await m.prisma.walletLedgerEntry.count();
  const again = await release(m, A, 's1');
  assert.deepEqual(again, r, 'a retry replays the stored result');
  assert.equal(await m.prisma.walletLedgerEntry.count(), before, 'and posts nothing');

  // a different session of the same contract is not affected
  const other = await release(m, A, 's2');
  assert.deepEqual(other.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  assert.equal(other.lateArrivalDeducted, undefined);
  await noObligationsNoDebt(m, 'late then release');
  await assertBooksSound(m, 'late then release');
});

test('D77 late then release with a gym: each party is reduced by its own portion of the compensation', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'G', { gym: true });
  const comp = await late(m, A, 's1');
  assert.equal(comp.unpaid, '0.00');
  const fullSession = m.money.computeSessionRelease(A.price, A.total, A.rates);
  const r = await release(m, A, 's1');
  const D = (v: string) => new m.Prisma.Decimal(v);
  assert.equal(D(r.released.pt).plus(r.released.gym).plus(r.released.platform).plus(comp.paid).toFixed(2), fullSession.unit.toFixed(2), 'client compensation + the three releases = one session, to the dong');
  for (const k of ['pt', 'gym', 'platform'] as const) {
    assert.equal(D(r.released[k]).toFixed(2), fullSession[k].minus(comp.charged[k]).toFixed(2), `${k}: share - its portion of the compensation`);
  }
  await noObligationsNoDebt(m, 'gym');
  await assertBooksSound(m, 'late then release (gym)');
});

test('D77 concurrency: the same release key raced (Promise.all) deducts once; the same late key raced pays once', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const comps = await Promise.all([1, 2, 3].map(() => late(m, A, 's1')));
  for (const c of comps) assert.deepEqual(c, comps[0]);
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '125000.00', 'the client was compensated once');
  const rels = await Promise.all([1, 2, 3, 4].map(() => release(m, A, 's1')));
  for (const r of rels) assert.deepEqual(r, rels[0]);
  assert.deepEqual(rels[0].released, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
  assert.equal((await bucketsOf(m, 'PT', 'pt-d77')).available, '112500.00', 'released once');
  await noObligationsNoDebt(m, 'concurrency');
  await assertBooksSound(m, 'concurrency');
});

// ── late, then the client cancels ─────────────────────────────────────────────

test('D77 late then client cancel: no obligation, the refund is the quoted one, and A\'s pending is spent exactly', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const B = await paidContract(m, 'B', { price: 2_000_000, total: 8 });
  const A = await paidContract(m, 'A');
  await late(m, A, 's1');
  const rel1 = await release(m, A, 's1');
  const ptBefore = (await bucketsOf(m, 'PT', 'pt-d77')).available;

  const out = await terminate(m, A, { reason: 'CLIENT_CANCELLED', used: 1, releasedPt: rel1.released.pt, releasedPlatform: rel1.released.platform });

  // 3 unused sessions x 250.000 x 90 % = 675.000
  assert.deepEqual([out.refund, out.owed, out.paid, out.unpaid, out.shortfall], ['675000.00', '675000.00', '675000.00', '0.00', '0.00']);
  assert.equal(out.obligationId, undefined);
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '800000.00', '125.000 compensation + 675.000 refund');
  assert.equal(await m.prisma.walletLedgerEntry.count({ where: { transactionId: A.txnId, description: { contains: 'over-released' } } }), 0);
  assert.equal((await bucketsOf(m, 'PT', 'pt-d77')).available > ptBefore, true, 'the PT still gets its final settlement');
  assert.equal((await bucketsOf(m, 'PT', 'pt-d77')).pending, '1800000.00', 'B\'s pending is whole');
  assert.ok(B.id);
  await noObligationsNoDebt(m, 'late then cancel');
  await assertBooksSound(m, 'late then cancel');
});

// ── late, then terminate with the late session unresolved ────────────────────

test('D77 late then terminate with the late session unresolved: the held value is share - compensation, the preview equals what is credited, DELIVERED and NOT_DELIVERED both balance', skipOpts, async () => {
  const m = await load();
  for (const outcome of ['DELIVERED', 'NOT_DELIVERED'] as const) {
    await reset(m);
    const A = await paidContract(m, 'A');
    await release(m, A, 'done1'); // one session taught and confirmed
    await late(m, A, 'held1'); // the PT was late on another one; reported delivered, not confirmed
    const D = (v: string) => new m.Prisma.Decimal(v);

    // the preview, asked with the transaction id, uses the very same ledger facts
    const lateArrival = await m.ledger.loadLateArrivalDeductions(m.prisma, A.txnId, 1);
    assert.deepEqual([lateArrival.open.pt.toFixed(2), lateArrival.open.platform.toFixed(2), lateArrival.settled.pt.toFixed(2)], ['112500.00', '12500.00', '0.00']);
    const preview = m.money.buildMoneyBreakdown(
      { price: A.price, totalSessions: 4, usedSessions: 1, unresolvedSessions: 1, rates: A.rates, lateArrival },
      'CLIENT_CANCELLED',
    );
    assert.equal(preview.unresolvedAmountHeld, '125000.00', 'the held session is worth 250.000 - 125.000 already paid');

    const clientBefore = D((await bucketsOf(m, 'CLIENT', 'client-A')).available);
    const out = await terminate(m, A, { reason: 'CLIENT_CANCELLED', used: 1, unresolved: 1, releasedPt: '225000', releasedPlatform: '25000' });
    assert.equal(D((await bucketsOf(m, 'CLIENT', 'client-A')).available).minus(clientBefore).toFixed(2), preview.refundIfCancelledNow, 'preview == credited');
    assert.equal(out.refund, preview.refundIfCancelledNow);
    assert.equal(out.unresolved?.amountHeld, preview.unresolvedAmountHeld, 'and the held amount is the quoted one');
    assert.deepEqual([out.unpaid, out.shortfall], ['0.00', '0.00']);
    assert.equal(out.obligationId, undefined);
    await assertBooksSound(m, `late + terminate (${outcome})`);

    const res = await resolve(m, A, 'held1', outcome);
    assert.equal(res.shortfall, '0.00', 'the held session is fully funded');
    assert.deepEqual(res.lateArrivalDeducted, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
    if (outcome === 'DELIVERED') {
      assert.deepEqual([res.moved.pt, res.moved.platform, res.moved.client], ['112500.00', '12500.00', '0.00']);
      // PT: 225.000 (first session) + 112.500 (late one) + final settlement of the unused 10 % share
      assert.equal(D((await bucketsOf(m, 'CLIENT', 'client-A')).available).toFixed(2), D('125000').plus(preview.refundIfCancelledNow).toFixed(2));
    } else {
      assert.deepEqual([res.moved.pt, res.moved.platform, res.moved.client], ['112500.00', '12500.00', '125000.00']);
      assert.equal(D((await bucketsOf(m, 'CLIENT', 'client-A')).available).toFixed(2), D('125000').plus(preview.refundIfCancelledNow).plus(125000).toFixed(2), 'the client ends with the whole value of the session: 125.000 + 125.000');
    }
    assert.equal((await bucketsOf(m, 'PT', 'pt-d77')).pending, '0.00', 'nothing is left pending');
    await noObligationsNoDebt(m, `late + terminate + resolve ${outcome}`);
    await assertBooksSound(m, `late + terminate + resolve ${outcome}`);
  }
});

test('D77 the money-breakdown route given the transaction id quotes the same refund and held amount as terminate credits', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const express = (await import('express')).default;
  const router = (await import('../routes/internal.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/internal', router);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const A = await paidContract(m, 'A', { price: 1_000_003, total: 3, gym: true });
    await release(m, A, 'a');
    await late(m, A, 'b');
    const askPreview = async (withTxn: boolean) =>
      (await (await fetch(`http://127.0.0.1:${port}/internal/contracts/money-breakdown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-secret': SECRET },
        body: JSON.stringify({
          price: '1000003', totalSessions: 3, usedSessions: 1, unresolvedSessions: 1, reason: 'CLIENT_CANCELLED',
          rates: { platformRate: '0.10', ptRate: '0.55', gymRate: '0.35' }, ...(withTxn ? { transactionId: A.txnId } : {}),
        }),
      })).json()) as any;
    const withTxn = await askPreview(true);
    const without = await askPreview(false);
    assert.notEqual(withTxn.data.unresolvedAmountHeld, without.data.unresolvedAmountHeld, 'without the transaction the late arrival is not known');
    const clientBefore = new m.Prisma.Decimal((await bucketsOf(m, 'CLIENT', 'client-A')).available);
    const out = await terminate(m, A, { reason: 'CLIENT_CANCELLED', used: 1, unresolved: 1, releasedPt: '183333', releasedGym: '116666', releasedPlatform: '33335' });
    assert.equal(new m.Prisma.Decimal((await bucketsOf(m, 'CLIENT', 'client-A')).available).minus(clientBefore).toFixed(2), withTxn.data.refundIfCancelledNow);
    assert.equal(out.unresolved?.amountHeld, withTxn.data.unresolvedAmountHeld);
    assert.equal(out.unpaid, '0.00');
    await noObligationsNoDebt(m, 'preview route');
    await assertBooksSound(m, 'preview route');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ── legacy: nothing is clawed back ───────────────────────────────────────────

test('D77 a session released in FULL before the compensation arrives keeps its outcome: nothing is clawed back, the compensation is paid from the contract\'s own pending as before', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const full = await release(m, A, 's1'); // released in full first
  assert.deepEqual(full.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  const comp = await late(m, A, 's1'); // the compensation arrives afterwards
  assert.equal(comp.paid, '125000.00');
  assert.equal((await bucketsOf(m, 'PT', 'pt-d77')).available, '225000.00', 'the PT keeps the full release: not a đồng clawed back');
  assert.equal(await m.prisma.walletLedgerEntry.count({ where: { description: { contains: 'clawed' } } }), 0);
  // a later termination does not pretend the compensation was deducted from that session
  const lateArrival = await m.ledger.loadLateArrivalDeductions(m.prisma, A.txnId, 0);
  assert.deepEqual([lateArrival.settled.pt.toFixed(2), lateArrival.open.pt.toFixed(2)], ['0.00', '0.00']);
  await noObligationsNoDebt(m, 'late after release');
  await assertBooksSound(m, 'late after release');
});

test('D77 a compensation recorded BEFORE this rule (no kind / transaction on its ledger row) is ignored: the session releases in full, nothing new is recorded', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  // exactly what an older payment-service wrote: key + result, no kind, no transaction id, no fingerprint
  await m.prisma.ledgerOperation.create({
    data: { key: `PT_LATE_ARRIVAL:${A.id}:old`, result: { compensation: '125000.00', charged: { pt: '112500.00', gym: '0.00', platform: '12500.00' }, shortfall: '0.00' } },
  });
  const r = await release(m, A, 'old');
  assert.deepEqual(r.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' }, 'released in full');
  assert.equal(r.lateArrivalDeducted, undefined);
  const counted = await m.ledger.loadLateArrivalDeductions(m.prisma, A.txnId, 1);
  assert.deepEqual([counted.settled.pt.toFixed(2), counted.open.pt.toFixed(2)], ['0.00', '0.00']);
  await noObligationsNoDebt(m, 'legacy late row');
});

test('D77 a late compensation under another transaction is never applied to this contract\'s session', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  const Z = await paidContract(m, 'Z', { pt: 'pt-other' });
  await m.ledger.compensateLateArrival({ ...base(Z), label: 'z late', idempotencyKey: `PT_LATE_ARRIVAL:shared-session` });
  const r = await m.ledger.releaseSession({ ...base(A), label: 'a release', idempotencyKey: `SESSION_RELEASE:shared-session` });
  assert.deepEqual(r.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  assert.equal(r.lateArrivalDeducted, undefined);
});

test('[REGRESSION D48-INVARIANT] LEDGER_STRICT_OWN_FUNDS=false / garbage is inert: late arrival still deducts from its own session, never touches pooled AVAILABLE, no fronting, no PartnerReceivable', skipOpts, async () => {
  const m = await load();
  for (const value of HOSTILE_FLAG_VALUES) {
    await withRemovedFlag(value, async () => {
      const tag = `flag=${JSON.stringify(value)}`;
      await reset(m);
      // B gives the PT pooled AVAILABLE and REVENUE some money the old legacy path could have drawn / fronted with.
      const B = await paidContract(m, 'B', { price: 2_000_000, total: 8 });
      await m.ledger.releaseSession({ ...base(B), label: 'b release', idempotencyKey: 'SESSION_RELEASE:b1' });
      const A = await paidContract(m, 'A');

      // late-arrival compensation: funded by A's own pending only
      const comp = await late(m, A, 's1');
      assert.deepEqual([comp.owed, comp.paid, comp.unpaid], ['125000.00', '125000.00', '0.00'], tag);
      const ptAvailableBefore = (await bucketsOf(m, 'PT', 'pt-d77')).available;

      // the deduction is still applied to the session's release (the old legacy path skipped it)
      const r = await release(m, A, 's1');
      assert.deepEqual(r.released, { pt: '112500.00', gym: '0.00', platform: '12500.00' }, tag);
      assert.deepEqual(r.lateArrivalDeducted, { pt: '112500.00', gym: '0.00', platform: '12500.00' }, tag);
      assert.equal(new m.Prisma.Decimal((await bucketsOf(m, 'PT', 'pt-d77')).available).minus(ptAvailableBefore).toFixed(2), '112500.00', tag);

      // a second late arrival with the contract's remaining pending exhausted by other compensations: the shortfall is an
      // OPEN obligation, never fronted and never drawn from the PT's pooled AVAILABLE.
      const revenueBefore = (await bucketsOf(m, 'PLATFORM', 'REVENUE')).available;
      const ptPoolBefore = (await bucketsOf(m, 'PT', 'pt-d77')).available;
      let unpaidTotal = new m.Prisma.Decimal(0);
      for (let i = 0; i < 8; i++) {
        const c = await late(m, A, `x${i}`);
        unpaidTotal = unpaidTotal.plus(c.unpaid);
        assert.equal(new m.Prisma.Decimal(c.paid).plus(c.unpaid).toFixed(2), '125000.00', tag);
      }
      assert.ok(unpaidTotal.greaterThan(0), `${tag}: the contract's own pending ran out`);
      assert.equal(await m.prisma.partnerReceivable.count(), 0, `${tag}: no PartnerReceivable`);
      assert.equal((await bucketsOf(m, 'PT', 'pt-d77')).available, ptPoolBefore, `${tag}: PT pooled AVAILABLE untouched`);
      assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available, revenueBefore, `${tag}: REVENUE AVAILABLE untouched (nothing fronted)`);
      assert.ok(await m.prisma.contractUnpaidObligation.count({ where: { status: 'OPEN' } }) > 0, `${tag}: shortfall recorded as OPEN obligation`);
      await assertBooksSound(m, `d48 late ${tag}`);
    });
  }
});
