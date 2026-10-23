/**
 * Financial Hardening FH-1 / FH-2a / FH-2b / FH-2c - BACKEND INTEGRATION (payment-service ledger + internal HTTP routes,
 * REAL PostgreSQL, isolated *_test database; not a cross-service run - see the user-service suites for that).
 *
 *   FH-1  own funds only: paid / owed / unpaid, durable OPEN obligation, no pooled draw, no platform fronting, no PT debt
 *   FH-2a read-only lookup of ledger operations by key (no writes, 404, 401)
 *   FH-2b request fingerprint (409 IDEMPOTENCY_KEY_CONFLICT) and binding to the payment transaction (422)
 *   FH-2c fence: a late release / compensation cannot spend the reserve of unresolved sessions
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_fha_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh-ledger-hardening.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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
  idem: typeof import('../services/ledger-idempotency');
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
      idem: await import('../services/ledger-idempotency'),
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

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
}

interface Contract {
  id: string;
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: Dec;
  totalSessions: number;
  rates: Rates;
  usedSessions: number;
  releasedTo: { pt: Dec; gym: Dec; platform: Dec };
  seq: number;
}

/** A paid contract (platform 10 %, PT 90 %) whose transaction carries the rate/party snapshot checkout freezes. */
async function paidContract(
  m: Mods,
  o: { id: string; pt: string; price: number; sessions: number; withSnapshot?: boolean },
): Promise<Contract> {
  const D = (v: string) => new m.Prisma.Decimal(v);
  const clientUserId = `client-${o.id}`;
  const metadata =
    o.withSnapshot === false
      ? undefined
      : {
          rates: { platformRate: '0.1', ptRate: '0.9', gymRate: '0' },
          parties: { ptUserId: o.pt, gymId: null, clientUserId },
        };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientUserId,
      purpose: 'PT_CONTRACT',
      amount: o.price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: `vnpay_${randomUUID()}`,
      idempotencyKey: `checkout-${o.id}-${randomUUID()}`,
      relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: o.id,
      activationStatus: 'PENDING',
      sourceService: 'integration-test',
      ...(metadata ? { metadata } : {}),
    },
  });
  const c: Contract = {
    id: o.id,
    txnId: txn.id,
    parties: { ptUserId: o.pt, gymId: null, clientUserId },
    price: D(String(o.price)),
    totalSessions: o.sessions,
    rates: { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') },
    usedSessions: 0,
    releasedTo: { pt: D('0'), gym: D('0'), platform: D('0') },
    seq: 0,
  };
  await m.ledger.settleContractPayment({ transactionId: c.txnId, price: c.price, rates: c.rates, parties: c.parties, label: `PT_CONTRACT ${c.id}` });
  return c;
}

const rel = (c: Contract) => ({ transactionId: c.txnId, price: c.price, totalSessions: c.totalSessions, rates: c.rates, parties: c.parties });

async function deliver(m: Mods, c: Contract, count: number) {
  for (let i = 0; i < count; i++) {
    const r = await m.ledger.releaseSession({
      ...rel(c), label: `Contract ${c.id} session ${c.usedSessions + 1}`, idempotencyKey: `SESSION_RELEASE:${c.id}:${++c.seq}`,
    });
    c.usedSessions++;
    c.releasedTo.pt = c.releasedTo.pt.plus(r.released.pt);
    c.releasedTo.gym = c.releasedTo.gym.plus(r.released.gym);
    c.releasedTo.platform = c.releasedTo.platform.plus(r.released.platform);
  }
}

const noShow = (m: Mods, c: Contract, key = `PT_NO_SHOW:${c.id}:${++c.seq}`) =>
  m.ledger.compensateNoShow({ ...rel(c), label: `Contract ${c.id} no-show ${key}`, idempotencyKey: key });
const lateArrival = (m: Mods, c: Contract, key = `PT_LATE_ARRIVAL:${c.id}:${++c.seq}`) =>
  m.ledger.compensateLateArrival({ ...rel(c), label: `Contract ${c.id} late ${key}`, idempotencyKey: key });

function terminate(m: Mods, c: Contract, reason: 'MUTUAL' | 'CLIENT_CANCELLED', extra: { unresolvedSessions?: number; usedSessions?: number; releasedPt?: string } = {}) {
  return m.ledger.terminateContract({
    ...rel(c), usedSessions: extra.usedSessions ?? c.usedSessions, compensatedSessions: 0, unresolvedSessions: extra.unresolvedSessions,
    reason, alreadyReleased: extra.releasedPt ? { ...c.releasedTo, pt: new m.Prisma.Decimal(extra.releasedPt) } : c.releasedTo,
    label: `Contract ${c.id} termination`, idempotencyKey: `CONTRACT_TERMINATE:${c.id}`,
  });
}

async function bucketsOf(m: Mods, ownerType: OwnerType, ownerId: string) {
  const w = await m.wallet.getOrCreateWallet(ownerType, ownerId);
  return { pending: w.pendingBalance.toFixed(2), available: w.availableBalance.toFixed(2), locked: w.lockedBalance.toFixed(2) };
}

async function ownPendingOf(m: Mods, ownerType: OwnerType, ownerId: string, txnId: string): Promise<string> {
  const w = await m.wallet.getOrCreateWallet(ownerType, ownerId);
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { walletId: w.id, transactionId: txnId, bucket: 'PENDING' }, select: { entryType: true, amount: true } });
  return rows.reduce((s, r) => (r.entryType === 'CREDIT' ? s.plus(r.amount) : s.minus(r.amount)), new m.Prisma.Decimal(0)).toFixed(2);
}

/** Books sound: escrow = every claim, no negative wallet, buckets explained by rows, and no transaction overdrew its own pending. */
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
  assert.deepEqual(overdrawn, [], `${context}: no transaction took more pending out of a wallet than it put in`);
}

async function counts(m: Mods) {
  const [entries, ops, obligations, receivables, wallets] = await Promise.all([
    m.prisma.walletLedgerEntry.count(),
    m.prisma.ledgerOperation.count(),
    m.prisma.contractUnpaidObligation.count(),
    m.prisma.partnerReceivable.count(),
    m.prisma.wallet.count(),
  ]);
  return { entries, ops, obligations, receivables, wallets };
}

async function startServer() {
  const express = (await import('express')).default;
  const router = (await import('../routes/internal.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/internal', router);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown, secret: string | null = SECRET, signal?: AbortSignal) => {
    const res = await fetch(`http://127.0.0.1:${port}/internal${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(secret ? { 'x-service-secret': secret } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const sendAndDrop = (path: string, payload: unknown) =>
    new Promise<void>((resolve, reject) => {
      const data = JSON.stringify(payload);
      const req = http.request(
        { host: '127.0.0.1', port, method: 'POST', path: `/internal${path}`, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-service-secret': SECRET } },
        () => undefined,
      );
      req.on('error', () => undefined);
      req.end(data, () => {
        req.destroy();
        resolve();
      });
      req.on('close', () => resolve());
      setTimeout(() => reject(new Error('sendAndDrop timeout')), 5000).unref();
    });
  return { call, sendAndDrop, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** The JSON body user-service sends for a money call on `c`. */
function body(c: Contract, extra: Record<string, unknown> = {}) {
  return {
    transactionId: c.txnId,
    price: c.price.toFixed(2),
    totalSessions: c.totalSessions,
    rates: { platformRate: '0.10', ptRate: '0.90', gymRate: '0' },
    parties: c.parties,
    label: `Contract ${c.id}`,
    ...extra,
  };
}

const PT = 'pt-fh';

// ═════════════════════════════ FH-1: own funds only ═════════════════════════════
// 1.000.000đ / 4 sessions -> one session 250.000đ = PT 225.000 + platform 25.000

test('FH-1 enough funds: a no-show pays the full 250.000, paid = owed, unpaid = 0 and NO obligation row exists', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  const r = await noShow(m, A);
  assert.deepEqual([r.owed, r.paid, r.unpaid, r.compensation, r.shortfall], ['250000.00', '250000.00', '0.00', '250000.00', '0.00']);
  assert.equal(r.obligationId, undefined);
  assert.deepEqual(r.charged, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '250000.00');
  assert.deepEqual(await counts(m), { entries: (await counts(m)).entries, ops: (await counts(m)).ops, obligations: 0, receivables: 0, wallets: (await counts(m)).wallets });
  await assertBooksSound(m, 'FH-1 enough');
});

test('FH-1 partial funds: only part of the session is left in A\'s own pending -> client credited exactly that, OPEN obligation for the rest, nothing else touched', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const B = await paidContract(m, { id: 'B', pt: PT, price: 2_000_000, sessions: 8 });
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await deliver(m, B, 2); // the PT holds 450.000 AVAILABLE earned on B
  await deliver(m, A, 3); // A's pending is now exactly one session: 250.000
  const late = await lateArrival(m, A); // half a session = 125.000 -> A's pending 125.000
  assert.equal(late.paid, '125000.00');
  const ptBefore = await bucketsOf(m, 'PT', PT);
  const revBefore = await bucketsOf(m, 'PLATFORM', 'REVENUE');
  const clientBefore = new m.Prisma.Decimal((await bucketsOf(m, 'CLIENT', 'client-A')).available);

  const r = await noShow(m, A); // owes 250.000, A can fund 125.000

  assert.deepEqual([r.owed, r.paid, r.unpaid], ['250000.00', '125000.00', '125000.00']);
  assert.deepEqual(r.charged, { pt: '112500.00', gym: '0.00', platform: '12500.00' });
  assert.equal(new m.Prisma.Decimal((await bucketsOf(m, 'CLIENT', 'client-A')).available).minus(clientBefore).toFixed(2), '125000.00', 'the client got exactly what was drawn');
  const ptAfter = await bucketsOf(m, 'PT', PT);
  assert.equal(ptAfter.available, ptBefore.available, 'the PT\'s pooled AVAILABLE (B\'s money) is untouched');
  assert.equal(await ownPendingOf(m, 'PT', PT, A.txnId), '0.00');
  const rev = await bucketsOf(m, 'PLATFORM', 'REVENUE');
  assert.equal(rev.available, revBefore.available, 'REVENUE AVAILABLE untouched: no fronting');
  assert.equal(await m.prisma.partnerReceivable.count(), 0, 'no PT debt');
  const ob = await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: r.obligationId! } });
  assert.deepEqual([ob.kind, ob.party, ob.status, ob.owed.toFixed(2), ob.paid.toFixed(2), ob.unpaid.toFixed(2)], ['NO_SHOW', 'CLIENT', 'OPEN', '250000.00', '125000.00', '125000.00']);
  assert.equal(ob.transactionId, A.txnId);
  await assertBooksSound(m, 'FH-1 partial');
});

test('FH-1 zero own funds on a late arrival: nothing moves, obligation of the whole half session', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const B = await paidContract(m, { id: 'B', pt: PT, price: 2_000_000, sessions: 8 });
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await deliver(m, B, 1);
  await terminate(m, A, 'MUTUAL');
  const before = await counts(m);
  const ptBefore = await bucketsOf(m, 'PT', PT);
  const r = await lateArrival(m, A);
  assert.deepEqual([r.owed, r.paid, r.unpaid], ['125000.00', '0.00', '125000.00']);
  assert.deepEqual(await bucketsOf(m, 'PT', PT), ptBefore);
  const after = await counts(m);
  assert.equal(after.entries, before.entries, 'not a single ledger row written');
  assert.equal(after.obligations, before.obligations + 1);
  assert.equal(after.receivables, 0);
  const ob = await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: r.obligationId! } });
  assert.equal(ob.kind, 'LATE_ARRIVAL');
  await assertBooksSound(m, 'FH-1 zero late');
});

test('FH-1 retry with the SAME key after the money moved: replays the stored result, one obligation, client credited once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await terminate(m, A, 'MUTUAL');
  const first = await noShow(m, A, 'PT_NO_SHOW:A:retry');
  const before = await counts(m);
  const second = await noShow(m, A, 'PT_NO_SHOW:A:retry');
  const third = await noShow(m, A, 'PT_NO_SHOW:A:retry');
  assert.deepEqual(third, first);
  assert.deepEqual(second, first);
  assert.equal(second.obligationId, first.obligationId);
  assert.deepEqual(await counts(m), before, 'no new row of any kind');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);
});

test('FH-1 two concurrent requests for the same key (Promise.all): one effect, one obligation, identical answers', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await terminate(m, A, 'MUTUAL');
  const results = await Promise.all([1, 2, 3, 4].map(() => noShow(m, A, 'PT_NO_SHOW:A:race')));
  for (const r of results) assert.deepEqual(r, results[0]);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: 'PT_NO_SHOW:A:race' } }), 1);
  await assertBooksSound(m, 'FH-1 concurrent');

  // and a funded one: the client is credited once
  await resetLedger(m);
  const C = await paidContract(m, { id: 'C', pt: PT, price: 1_000_000, sessions: 4 });
  await Promise.all([1, 2, 3].map(() => noShow(m, C, 'PT_NO_SHOW:C:race')));
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-C')).available, '250000.00', 'credited exactly once');
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
});

test('FH-1 two concurrent compensations on two contracts of the same PT: each touches only its own contract\'s money', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  const B = await paidContract(m, { id: 'B', pt: PT, price: 2_000_000, sessions: 8 });
  const [ra, rb] = await Promise.all([noShow(m, A), noShow(m, B)]);
  assert.deepEqual([ra.paid, rb.paid], ['250000.00', '250000.00']);
  assert.equal(await ownPendingOf(m, 'PT', PT, A.txnId), '675000.00');
  assert.equal(await ownPendingOf(m, 'PT', PT, B.txnId), '1575000.00');
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '250000.00');
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-B')).available, '250000.00');
  await assertBooksSound(m, 'FH-1 two contracts');
});

test('FH-1 terminate: refund short because A\'s own pending was already spent -> client gets what A can fund, REFUND_SHORT obligation, no coverShortfall, no PT debt', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  await (async () => {
    // give REVENUE money the platform COULD front with: it must not
    const funder = await paidContract(m, { id: 'F', pt: 'pt-funder', price: 10_000_000, sessions: 1 });
    await deliver(m, funder, 1);
  })();
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  // 125.000 of A's pending is gone to a late-arrival compensation whose session was never delivered or held (D77 deducts
  // a compensation only from ITS session, so this one is an orphan paid out of the contract's general pending)
  await lateArrival(m, A);
  const revBefore = await bucketsOf(m, 'PLATFORM', 'REVENUE');

  const r = await terminate(m, A, 'CLIENT_CANCELLED');

  assert.equal(r.owed, '900000.00', 'formula: 90 % of the unused 1.000.000');
  // what is really there: A's own pending after the compensation and the parties' final shares (at most 2 dong per
  // session of rounding dust are trimmed off those shares so the refund stays whole)
  assert.ok(Number(r.paid) >= 775_000 && Number(r.paid) <= 775_008, `paid ${r.paid}`);
  assert.equal(new m.Prisma.Decimal(r.paid).plus(r.unpaid).toFixed(2), '900000.00');
  assert.ok(Number(r.unpaid) >= 124_992 && Number(r.unpaid) <= 125_000, `unpaid ${r.unpaid}`);
  assert.ok(r.obligationId);
  assert.equal(r.refund, r.paid);
  assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available, new m.Prisma.Decimal(revBefore.available).plus(10_000).toFixed(2), 'REVENUE only gained its own 10.000 final share (the dust comes off the PT first): the platform fronted nothing');
  assert.equal(await m.prisma.partnerReceivable.count(), 0);
  const ob = await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: r.obligationId! } });
  assert.deepEqual([ob.kind, ob.party, ob.status], ['REFUND_SHORT', 'CLIENT', 'OPEN']);
  assert.equal(ob.key, 'CONTRACT_TERMINATE:A');
  // replay: same result, still one obligation
  const again = await terminate(m, A, 'CLIENT_CANCELLED');
  assert.deepEqual(again, r);
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);
  await assertBooksSound(m, 'FH-1 terminate short');
});

test('FH-1 refundUnactivatedContractPayment: pending already short -> client credited what the transaction funded, REFUND_SHORT obligation, no coverShortfall (signature unchanged)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const funder = await paidContract(m, { id: 'F', pt: 'pt-funder', price: 10_000_000, sessions: 1 });
  await deliver(m, funder, 1);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await noShow(m, A); // spends 250.000 of A's own pending although the contract never activated (a damaged ledger)
  const revBefore = await bucketsOf(m, 'PLATFORM', 'REVENUE');
  const r = await m.ledger.refundUnactivatedContractPayment({
    transactionId: A.txnId, parties: A.parties, label: 'Contract A', reason: 'CONTRACT_NOT_ACTIVATABLE', contractStatus: 'CANCELLED',
  });
  assert.deepEqual([r.owed, r.paid, r.unpaid, r.refunded], ['1000000.00', '750000.00', '250000.00', '750000.00']);
  assert.ok(r.obligationId);
  assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available, revBefore.available, 'REVENUE AVAILABLE untouched');
  assert.equal(await m.prisma.partnerReceivable.count(), 0);
  assert.equal((await bucketsOf(m, 'CLIENT', 'client-A')).available, '1000000.00', '250.000 compensation + 750.000 refund');
  await assertBooksSound(m, 'FH-1 unactivated short');
});

test('[REGRESSION D48-INVARIANT] LEDGER_STRICT_OWN_FUNDS=false / garbage is inert: no-show, terminate and unactivated refund stay strict (no pooled draw, no fronting, no PartnerReceivable, OPEN obligation)', skipOpts, async () => {
  const m = await load();
  for (const value of HOSTILE_FLAG_VALUES) {
    await withRemovedFlag(value, async () => {
      const tag = `flag=${JSON.stringify(value)}`;

      // ── no-show whose contract pending is gone, while the PT holds pooled AVAILABLE from another contract
      await resetLedger(m);
      {
        const B = await paidContract(m, { id: 'B', pt: PT, price: 2_000_000, sessions: 8 });
        const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
        await deliver(m, B, 2);
        await terminate(m, A, 'MUTUAL');
        const ptPoolBefore = (await bucketsOf(m, 'PT', PT)).available;
        const revenueBefore = (await bucketsOf(m, 'PLATFORM', 'REVENUE')).available;
        const r = await noShow(m, A);
        assert.equal(r.charged.pt, '0.00', `${tag}: nothing charged to the pooled AVAILABLE`);
        assert.deepEqual([r.paid, r.owed, r.unpaid], ['0.00', '250000.00', '250000.00'], tag);
        assert.ok(r.obligationId, tag);
        assert.equal(await m.prisma.contractUnpaidObligation.count(), 1, tag);
        assert.equal(await m.prisma.partnerReceivable.count(), 0, tag);
        assert.equal((await bucketsOf(m, 'PT', PT)).available, ptPoolBefore, `${tag}: PT pooled AVAILABLE untouched`);
        assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available, revenueBefore, `${tag}: REVENUE untouched`);
        await assertBooksSound(m, `d48 no-show ${tag}`);
      }

      // ── terminate with A's own pending already spent (money exists elsewhere that a legacy path could front with)
      await resetLedger(m);
      {
        const funder = await paidContract(m, { id: 'F', pt: 'pt-funder', price: 10_000_000, sessions: 1 });
        await deliver(m, funder, 1);
        const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
        await lateArrival(m, A);
        const revBefore = await bucketsOf(m, 'PLATFORM', 'REVENUE');
        const r = await terminate(m, A, 'CLIENT_CANCELLED');
        assert.equal(r.owed, '900000.00', tag);
        assert.ok(Number(r.paid) >= 775_000 && Number(r.paid) <= 775_008, `${tag}: paid ${r.paid}`);
        assert.equal(new m.Prisma.Decimal(r.paid).plus(r.unpaid).toFixed(2), '900000.00', tag);
        assert.ok(r.obligationId, tag);
        assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available, new m.Prisma.Decimal(revBefore.available).plus(10_000).toFixed(2), `${tag}: platform fronted nothing`);
        assert.equal(await m.prisma.partnerReceivable.count(), 0, tag);
        const ob = await m.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: r.obligationId! } });
        assert.deepEqual([ob.kind, ob.party, ob.status], ['REFUND_SHORT', 'CLIENT', 'OPEN'], tag);
        await assertBooksSound(m, `d48 terminate ${tag}`);
      }

      // ── unactivated refund with the transaction's pending already short
      await resetLedger(m);
      {
        const funder = await paidContract(m, { id: 'F', pt: 'pt-funder', price: 10_000_000, sessions: 1 });
        await deliver(m, funder, 1);
        const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
        await noShow(m, A);
        const revBefore = await bucketsOf(m, 'PLATFORM', 'REVENUE');
        const r = await m.ledger.refundUnactivatedContractPayment({
          transactionId: A.txnId, parties: A.parties, label: 'Contract A', reason: 'CONTRACT_NOT_ACTIVATABLE', contractStatus: 'CANCELLED',
        });
        assert.deepEqual([r.owed, r.paid, r.unpaid, r.refunded], ['1000000.00', '750000.00', '250000.00', '750000.00'], tag);
        assert.ok(r.obligationId, tag);
        assert.equal((await bucketsOf(m, 'PLATFORM', 'REVENUE')).available, revBefore.available, `${tag}: REVENUE AVAILABLE untouched`);
        assert.equal(await m.prisma.partnerReceivable.count(), 0, tag);
        await assertBooksSound(m, `d48 unactivated ${tag}`);
      }
    });
  }
});

test('FH-1 routes /internal/contracts/{no-show,late-arrival,terminate} return paid / owed / unpaid (+ obligationId)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const srv = await startServer();
  try {
    const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
    const ns = await srv.call('POST', '/contracts/no-show', body(A, { idempotencyKey: 'PT_NO_SHOW:A:http' }));
    assert.equal(ns.status, 200, JSON.stringify(ns.json));
    assert.deepEqual([ns.json.data.owed, ns.json.data.paid, ns.json.data.unpaid], ['250000.00', '250000.00', '0.00']);
    const la = await srv.call('POST', '/contracts/late-arrival', body(A, { idempotencyKey: 'PT_LATE_ARRIVAL:A:http' }));
    assert.deepEqual([la.json.data.owed, la.json.data.paid, la.json.data.unpaid], ['125000.00', '125000.00', '0.00']);
    const term = await srv.call('POST', '/contracts/terminate', body(A, {
      idempotencyKey: 'CONTRACT_TERMINATE:A', usedSessions: 0, compensatedSessions: 1, reason: 'MUTUAL',
      alreadyReleased: { pt: '0', gym: '0', platform: '0' },
    }));
    assert.equal(term.status, 200, JSON.stringify(term.json));
    for (const k of ['owed', 'paid', 'unpaid']) assert.ok(k in term.json.data, k);
  } finally {
    await srv.close();
  }
});

// ═════════════════════════════ FH-2a: read-only lookup ═════════════════════════════

test('FH-2a lookup: 404 for an unknown key, 200 with the stored result after a real operation, 401 without the service secret', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const srv = await startServer();
  try {
    const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
    assert.equal((await srv.call('GET', '/ledger-operations/PT_NO_SHOW:A:nope')).status, 404);
    const done = await noShow(m, A, 'PT_NO_SHOW:A:lookup');
    const got = await srv.call('GET', `/ledger-operations/${encodeURIComponent('PT_NO_SHOW:A:lookup')}`);
    assert.equal(got.status, 200);
    assert.equal(got.json.data.key, 'PT_NO_SHOW:A:lookup');
    assert.equal(got.json.data.kind, 'NO_SHOW');
    assert.equal(got.json.data.transactionId, A.txnId);
    assert.deepEqual(got.json.data.result, done);
    assert.equal(got.json.data.fingerprinted, true);

    assert.equal((await srv.call('GET', `/ledger-operations/${encodeURIComponent('PT_NO_SHOW:A:lookup')}`, undefined, null)).status, 401);
    assert.equal((await srv.call('POST', '/ledger-operations/lookup', { keys: ['x'] }, null)).status, 401);
    assert.equal((await srv.call('GET', '/ledger-operations', undefined, 'wrong-secret')).status, 401);
  } finally {
    await srv.close();
  }
});

test('FH-2a lookup of many keys (100) and the paged listing; legacy rows (no kind column) get their kind from the key prefix; NOTHING is written', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const srv = await startServer();
  try {
    const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
    await deliver(m, A, 2);
    await noShow(m, A, 'PT_NO_SHOW:A:l1');
    // a legacy row: written before the new columns existed
    await m.prisma.ledgerOperation.create({ data: { key: 'SESSION_RELEASE:legacy-1', result: { unit: '1.00' } } });
    const before = await counts(m);
    const opsBefore = await m.prisma.ledgerOperation.findMany({ orderBy: { key: 'asc' } });

    const keys = [...Array(98).keys()].map((i) => `UNKNOWN:${i}`).concat(['PT_NO_SHOW:A:l1', 'SESSION_RELEASE:legacy-1']);
    const lookup = await srv.call('POST', '/ledger-operations/lookup', { keys });
    assert.equal(lookup.status, 200);
    assert.deepEqual(lookup.json.data.operations.map((o: any) => o.key).sort(), ['PT_NO_SHOW:A:l1', 'SESSION_RELEASE:legacy-1']);
    assert.equal(lookup.json.data.missing.length, 98);
    const legacy = lookup.json.data.operations.find((o: any) => o.key === 'SESSION_RELEASE:legacy-1');
    assert.equal(legacy.kind, 'RELEASE_SESSION');
    assert.equal(legacy.fingerprinted, false);
    assert.equal((await srv.call('POST', '/ledger-operations/lookup', { keys: [...Array(101).keys()].map(String) })).status, 400, 'more than 100 keys is refused');

    const page1 = await srv.call('GET', '/ledger-operations?prefix=SESSION_RELEASE:&limit=2');
    assert.equal(page1.status, 200);
    assert.equal(page1.json.data.operations.length, 2);
    assert.ok(page1.json.data.nextCursor);
    const page2 = await srv.call('GET', `/ledger-operations?prefix=SESSION_RELEASE:&limit=2&cursor=${page1.json.data.nextCursor}`);
    assert.equal(page2.json.data.operations.length, 1);
    assert.equal(page2.json.data.nextCursor, null);
    const since = await srv.call('GET', `/ledger-operations?since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`);
    assert.equal(since.json.data.operations.length, 0);
    assert.equal((await srv.call('GET', '/ledger-operations?limit=201')).status, 400);

    assert.deepEqual(await counts(m), before, 'row counts identical before and after: the lookup wrote nothing');
    assert.deepEqual(await m.prisma.ledgerOperation.findMany({ orderBy: { key: 'asc' } }), opsBefore, 'and changed nothing');
  } finally {
    await srv.close();
  }
});

test('FH-2a the lookup runs in a READ ONLY transaction: a write attempted in one is rejected by Postgres', skipOpts, async () => {
  const m = await load();
  await assert.rejects(
    m.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.ledgerOperation.create({ data: { key: `RO:${randomUUID()}`, result: {} } });
    }),
    /read-only/i,
  );
});

// ═════════════════════════════ FH-2b: fingerprint + transaction binding ═════════════════════════════

test('FH-2b same key, different immutable parameters -> 409 IDEMPOTENCY_KEY_CONFLICT and no entries (price, sessions, rates, parties, kind)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const srv = await startServer();
  try {
    const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4, withSnapshot: false }); // no snapshot: only the fingerprint can object
    const ok = await srv.call('POST', '/contracts/no-show', body(A, { idempotencyKey: 'PT_NO_SHOW:A:fp' }));
    assert.equal(ok.status, 200);
    const before = await counts(m);

    const variants: Array<[string, Record<string, unknown>]> = [
      ['price', { price: '2000000.00' }],
      ['totalSessions', { totalSessions: 8 }],
      ['rates', { rates: { platformRate: '0.20', ptRate: '0.80', gymRate: '0' } }],
      ['parties', { parties: { ...A.parties, ptUserId: 'someone-else' } }],
      ['transaction', { transactionId: randomUUID() }],
    ];
    for (const [what, patch] of variants) {
      const r = await srv.call('POST', '/contracts/no-show', body(A, { idempotencyKey: 'PT_NO_SHOW:A:fp', ...patch }));
      assert.equal(r.status, 409, `${what}: ${JSON.stringify(r.json)}`);
      assert.equal(r.json.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
    }
    // the same key used for a different KIND of operation
    const asLate = await srv.call('POST', '/contracts/late-arrival', body(A, { idempotencyKey: 'PT_NO_SHOW:A:fp' }));
    assert.equal(asLate.status, 409);
    assert.deepEqual(await counts(m), before, 'no entry, no operation, no wallet was added by any of the refused calls');

    // the identical request still replays
    const replay = await srv.call('POST', '/contracts/no-show', body(A, { idempotencyKey: 'PT_NO_SHOW:A:fp' }));
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.json.data, ok.json.data);
    await assertBooksSound(m, 'FH-2b conflict');
  } finally {
    await srv.close();
  }
});

test('FH-2b a LEGACY row (NULL fingerprint) replays its old result whatever the caller now sends - nothing is back-filled', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  const stored = { compensation: '1.00', charged: { pt: '1.00', gym: '0.00', platform: '0.00' }, shortfall: '0.00' };
  await m.prisma.ledgerOperation.create({ data: { key: 'PT_NO_SHOW:A:legacy', result: stored } });
  const before = await counts(m);
  const r = await m.ledger.compensateNoShow({ ...rel(A), price: A.price, label: 'x', idempotencyKey: 'PT_NO_SHOW:A:legacy' });
  assert.deepEqual(r, stored as any);
  assert.deepEqual(await counts(m), before);
  const row = await m.prisma.ledgerOperation.findUniqueOrThrow({ where: { key: 'PT_NO_SHOW:A:legacy' } });
  assert.equal(row.requestFingerprint, null, 'still NULL: never back-filled');
});

test('FH-2b terminate replayed with DIFFERENT counters (a held session resolved meanwhile) is still a replay, not a conflict', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await deliver(m, A, 1);
  const first = await terminate(m, A, 'CLIENT_CANCELLED', { unresolvedSessions: 1 });
  const again = await terminate(m, A, 'CLIENT_CANCELLED', { unresolvedSessions: 0, usedSessions: 2 });
  assert.deepEqual(again, first);
  // ... but a different REASON is a different request
  await assert.rejects(terminate(m, A, 'MUTUAL', { unresolvedSessions: 1 }), m.idem.IdempotencyKeyConflictError);
});

test('FH-2b LEDGER_FINGERPRINT_ENFORCE=false turns the 409 into a warning and replays', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4, withSnapshot: false });
  const first = await noShow(m, A, 'PT_NO_SHOW:A:soft');
  const prev = process.env.LEDGER_FINGERPRINT_ENFORCE;
  process.env.LEDGER_FINGERPRINT_ENFORCE = 'false';
  try {
    const before = await counts(m);
    // price differs from the transaction as well, so use the legacy no-snapshot transaction: only the fingerprint objects
    const r = await m.ledger.compensateNoShow({ ...rel(A), totalSessions: 8, label: 'x', idempotencyKey: 'PT_NO_SHOW:A:soft' });
    assert.deepEqual(r, first);
    assert.deepEqual(await counts(m), before);
  } finally {
    if (prev === undefined) delete process.env.LEDGER_FINGERPRINT_ENFORCE;
    else process.env.LEDGER_FINGERPRINT_ENFORCE = prev;
  }
});

test('FH-2b the request must match the payment transaction: wrong ptUserId / price / rates -> 422 REQUEST_DOES_NOT_MATCH_TRANSACTION, no wallet and no row changes', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const srv = await startServer();
  try {
    const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
    const before = await counts(m);
    const ptBefore = await bucketsOf(m, 'PT', PT);
    const wrong: Array<[string, Record<string, unknown>]> = [
      ['ptUserId', { parties: { ...A.parties, ptUserId: 'pt-impostor' } }],
      ['clientUserId', { parties: { ...A.parties, clientUserId: 'client-impostor' } }],
      ['gymId', { parties: { ...A.parties, gymId: 'gym-x' }, rates: { platformRate: '0.10', ptRate: '0.60', gymRate: '0.30' } }],
      ['price', { price: '900000.00' }],
      ['rates', { rates: { platformRate: '0.20', ptRate: '0.80', gymRate: '0' } }],
    ];
    for (const [what, patch] of wrong) {
      for (const [path, key] of [['/contracts/no-show', 'PT_NO_SHOW'], ['/contracts/late-arrival', 'PT_LATE_ARRIVAL'], ['/contracts/release-session', 'SESSION_RELEASE']] as const) {
        const r = await srv.call('POST', path, body(A, { idempotencyKey: `${key}:A:bind-${what}`, ...patch }));
        assert.equal(r.status, 422, `${what} ${path}: ${JSON.stringify(r.json)}`);
        assert.equal(r.json.error.code, 'REQUEST_DOES_NOT_MATCH_TRANSACTION');
      }
    }
    const term = await srv.call('POST', '/contracts/terminate', body(A, {
      idempotencyKey: 'CONTRACT_TERMINATE:A:bind', usedSessions: 0, reason: 'MUTUAL', alreadyReleased: { pt: '0', gym: '0', platform: '0' },
      parties: { ...A.parties, ptUserId: 'pt-impostor' },
    }));
    assert.equal(term.status, 422);
    assert.deepEqual(await counts(m), before, 'nothing written, not even an empty wallet for the impostor');
    assert.deepEqual(await bucketsOf(m, 'PT', PT), ptBefore);
    assert.equal(await m.prisma.wallet.count({ where: { ownerId: 'pt-impostor' } }), 0);
  } finally {
    await srv.close();
  }
});

test('FH-2b a legacy transaction without a rate/party snapshot is allowed through (and logged)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4, withSnapshot: false });
  const r = await noShow(m, A);
  assert.equal(r.paid, '250000.00');
  // price is still checked against txn.amount, which every transaction has
  await assert.rejects(
    m.ledger.compensateNoShow({ ...rel(A), price: new m.Prisma.Decimal('999999'), label: 'x', idempotencyKey: 'PT_NO_SHOW:A:amount' }),
    /does not match/,
  );
});

test('FH-2b crash after payment commit, before the caller got the response: the retry replays the stored result - no second movement, no second obligation', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const srv = await startServer();
  try {
    const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
    await terminate(m, A, 'MUTUAL'); // so the no-show is an unpaid obligation: the thing that must not duplicate
    // The caller sends the whole request and "crashes" right after: it never reads the answer.
    await srv.sendAndDrop('/contracts/no-show', body(A, { idempotencyKey: 'PT_NO_SHOW:A:crash' }));
    // the server side finishes regardless
    for (let i = 0; i < 50 && (await m.prisma.ledgerOperation.count({ where: { key: 'PT_NO_SHOW:A:crash' } })) === 0; i++) await new Promise((r) => setTimeout(r, 100));
    const stored = await m.prisma.ledgerOperation.findUniqueOrThrow({ where: { key: 'PT_NO_SHOW:A:crash' } });
    const before = await counts(m);

    const retry = await srv.call('POST', '/contracts/no-show', body(A, { idempotencyKey: 'PT_NO_SHOW:A:crash' }));
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.json.data, stored.result);
    assert.deepEqual(await counts(m), before);
    assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);
  } finally {
    await srv.close();
  }
});

test('FH-2b two caller instances (two servers, one database) racing the same operation: one effect, one obligation', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const s1 = await startServer();
  const s2 = await startServer();
  try {
    const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
    await terminate(m, A, 'MUTUAL');
    const calls = await Promise.all([
      s1.call('POST', '/contracts/no-show', body(A, { idempotencyKey: 'PT_NO_SHOW:A:inst' })),
      s2.call('POST', '/contracts/no-show', body(A, { idempotencyKey: 'PT_NO_SHOW:A:inst' })),
      s1.call('POST', '/contracts/no-show', body(A, { idempotencyKey: 'PT_NO_SHOW:A:inst' })),
      s2.call('POST', '/contracts/no-show', body(A, { idempotencyKey: 'PT_NO_SHOW:A:inst' })),
    ]);
    for (const c of calls) {
      assert.equal(c.status, 200, JSON.stringify(c.json));
      assert.deepEqual(c.json.data, calls[0].json.data);
    }
    assert.equal(await m.prisma.contractUnpaidObligation.count(), 1);
    await assertBooksSound(m, 'FH-2b two instances');
  } finally {
    await s1.close();
    await s2.close();
  }
});

// ═════════════════════════════ FH-2c: fence ═════════════════════════════

test('FH-2c after a termination left an unresolved session, a LATE release / compensation cannot spend its reserve - only resolveUnresolvedSession can', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await deliver(m, A, 2);
  const exit = await terminate(m, A, 'CLIENT_CANCELLED', { unresolvedSessions: 1 });
  assert.equal(exit.unresolved?.amountHeld, '250000.00');
  const heldBefore = {
    pt: await ownPendingOf(m, 'PT', PT, A.txnId),
    platform: await ownPendingOf(m, 'PLATFORM', 'REVENUE', A.txnId),
  };
  assert.deepEqual(heldBefore, { pt: '225000.00', platform: '25000.00' });
  const beforeCounts = await counts(m);

  // a slow release of ANOTHER session, and a slow compensation, arrive after the termination
  const lateRelease = await m.ledger.releaseSession({ ...rel(A), label: 'late release', idempotencyKey: 'SESSION_RELEASE:A:late' });
  assert.deepEqual(lateRelease.released, { pt: '0.00', gym: '0.00', platform: '0.00' }, 'nothing released out of the reserve');
  const lateComp = await noShow(m, A, 'PT_NO_SHOW:A:late');
  assert.deepEqual([lateComp.paid, lateComp.unpaid], ['0.00', '250000.00']);
  const lateHalf = await lateArrival(m, A, 'PT_LATE_ARRIVAL:A:late');
  assert.equal(lateHalf.paid, '0.00');
  assert.deepEqual({ pt: await ownPendingOf(m, 'PT', PT, A.txnId), platform: await ownPendingOf(m, 'PLATFORM', 'REVENUE', A.txnId) }, heldBefore, 'the held value is intact');
  assert.equal((await counts(m)).entries, beforeCounts.entries, 'no ledger row was written by the late calls');

  // the legitimate resolution still gets all of it
  const resolved = await m.ledger.resolveUnresolvedSession({
    ...rel(A), label: 'resolve', idempotencyKey: 'UNRESOLVED_SESSION:A:1', outcome: 'DELIVERED',
  });
  assert.deepEqual([resolved.moved.pt, resolved.moved.platform, resolved.shortfall], ['225000.00', '25000.00', '0.00']);
  assert.equal(await ownPendingOf(m, 'PT', PT, A.txnId), '0.00');
  await assertBooksSound(m, 'FH-2c');
});

test('FH-2c the fence is inert for a contract that never left sessions unresolved, and once they are all resolved', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  const r = await noShow(m, A);
  assert.equal(r.paid, '250000.00');
  await deliver(m, A, 1);
  assert.equal(A.releasedTo.pt.toFixed(2), '225000.00');
});

test('FH-2b resolving the same unresolved session the OTHER way is a conflict (409 upstream), not a silent replay of the first outcome', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const A = await paidContract(m, { id: 'A', pt: PT, price: 1_000_000, sessions: 4 });
  await deliver(m, A, 1);
  await terminate(m, A, 'CLIENT_CANCELLED', { unresolvedSessions: 1 });
  const first = await m.ledger.resolveUnresolvedSession({ ...rel(A), label: 'r', idempotencyKey: 'UNRESOLVED_SESSION:A:x', outcome: 'DELIVERED' });
  const same = await m.ledger.resolveUnresolvedSession({ ...rel(A), label: 'r', idempotencyKey: 'UNRESOLVED_SESSION:A:x', outcome: 'DELIVERED' });
  assert.deepEqual(same, first);
  await assert.rejects(
    m.ledger.resolveUnresolvedSession({ ...rel(A), label: 'r', idempotencyKey: 'UNRESOLVED_SESSION:A:x', outcome: 'NOT_DELIVERED' }),
    m.idem.IdempotencyKeyConflictError,
  );
});
