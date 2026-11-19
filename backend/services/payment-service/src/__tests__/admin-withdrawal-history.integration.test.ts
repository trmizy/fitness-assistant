import { guardedTest as test } from './support/test-db-guard'; // runs only on a database whose name ends with _test
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

/**
 * G-08 - GET /admin/payments/withdrawal-history against the REAL service and the isolated *_test database.
 * The admin identity check goes to a TEST FIXTURE auth-service on 127.0.0.1:4152.
 *
 *   evidence label: BACKEND INTEGRATION (real express router + real Prisma + isolated *_test DB; auth-service = TEST FIXTURE).
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     npx tsx --test --test-concurrency=1 src/__tests__/admin-withdrawal-history.integration.test.ts
 *
 * Rows are marked: ids start with W5-, owner ids with W5-OWN-, payoutInfo with W5-SECRET-PAYOUT. Only those rows are
 * deleted afterwards. Dates sit in 2033 (a window no other suite uses).
 */

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4152';
const D = (n: number | string) => new Prisma.Decimal(n);
const T = (iso: string) => new Date(iso);

const SECRET = 'W5-SECRET-PAYOUT';
const ownerPt = 'W5-OWN-PT';
const ownerClient = 'W5-OWN-CLIENT';
const walletPt = 'W5-WALLET-PT';
const walletClient = 'W5-WALLET-CLIENT';

const paid1 = 'W5-WD-PAID-1'; // paidAt 2033-03-01
const paid2 = 'W5-WD-PAID-2'; // 2033-03-05 (newest)
const paid3a = 'W5-WD-PAID-3A'; // 2033-03-03
const paid3b = 'W5-WD-PAID-3B'; // 2033-03-03 (same paidAt as 3A: id asc tie-break)
const rej1 = 'W5-WD-REJ-1'; // reviewedAt 2033-03-02
const rej2 = 'W5-WD-REJ-2'; // reviewedAt 2033-03-04 (newest)
const pending = 'W5-WD-PENDING';
const approved = 'W5-WD-APPROVED';
const allIds = [paid1, paid2, paid3a, paid3b, rej1, rej2, pending, approved];

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';
const ADMIN = { Authorization: 'Bearer real-admin-token' };

async function getJson(qs: string) {
  const res = await fetch(`${baseUrl}/admin/payments/withdrawal-history${qs}`, { headers: ADMIN });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as any };
}
// Window that only contains this file's rows (a shared _test DB may hold other rows).
const base = '&from=2033-03-01&to=2033-04-01';
const mine = (items: any[]) => items.filter((i) => String(i.id).startsWith('W5-'));

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      if (String(req.headers.authorization || '') === 'Bearer real-admin-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: { id: 'admin-w5-1', email: 'a@example.com', role: 'ADMIN' } }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4152, '127.0.0.1', r));
  const { default: routes } = await import('../routes/admin-withdrawal-history.routes');
  const app = express();
  app.use(express.json());
  app.use('/admin/payments/withdrawal-history', routes);
  testApp = http.createServer(app);
  await new Promise<void>((r) => testApp.listen(0, '127.0.0.1', r));
  const address = testApp.address();
  if (!address || typeof address === 'string') throw new Error('failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;

  await prisma.wallet.create({ data: { id: walletPt, ownerType: 'PT', ownerId: ownerPt, availableBalance: D('1234567.89') } });
  await prisma.wallet.create({ data: { id: walletClient, ownerType: 'CLIENT', ownerId: ownerClient, availableBalance: D('10.50') } });

  const mk = (id: string, walletId: string, ownerType: 'PT' | 'CLIENT', ownerId: string, amount: string, status: any, extra: object) =>
    prisma.withdrawalRequest.create({
      data: { id, walletId, ownerType, ownerId, amount: D(amount), status, payoutInfo: `${SECRET}-${id}`, createdAt: T('2033-02-20T00:00:00Z'), ...extra },
    });
  await mk(paid1, walletPt, 'PT', ownerPt, '299999.80', 'PAID', {
    bankReference: 'W5-REF-1', reviewedBy: 'admin-w5-1', reviewedAt: T('2033-03-01T01:00:00Z'), paidAt: T('2033-03-01T02:00:00Z'),
    rejectionReason: 'should-not-show-on-paid',
  });
  await mk(paid2, walletPt, 'PT', ownerPt, '5000000.00', 'PAID', {
    bankReference: 'W5-REF-2', reviewedBy: 'admin-w5-1', reviewedAt: T('2033-03-05T01:00:00Z'), paidAt: T('2033-03-05T02:00:00Z'),
  });
  await mk(paid3a, walletClient, 'CLIENT', ownerClient, '100000.01', 'PAID', {
    bankReference: 'W5-REF-3A', reviewedBy: 'admin-w5-2', reviewedAt: T('2033-03-03T01:00:00Z'), paidAt: T('2033-03-03T02:00:00Z'),
  });
  await mk(paid3b, walletClient, 'CLIENT', ownerClient, '100000.02', 'PAID', {
    bankReference: 'W5-REF-3B', reviewedBy: 'admin-w5-2', reviewedAt: T('2033-03-03T01:00:00Z'), paidAt: T('2033-03-03T02:00:00Z'),
  });
  await mk(rej1, walletPt, 'PT', ownerPt, '200000.00', 'REJECTED', {
    rejectionReason: 'W5-REASON-1', reviewedBy: 'admin-w5-1', reviewedAt: T('2033-03-02T03:00:00Z'), bankReference: 'should-not-show-on-rejected',
  });
  await mk(rej2, walletClient, 'CLIENT', ownerClient, '50000.50', 'REJECTED', {
    rejectionReason: 'W5-REASON-2', reviewedBy: 'admin-w5-2', reviewedAt: T('2033-03-04T03:00:00Z'),
  });
  await mk(pending, walletPt, 'PT', ownerPt, '1.00', 'PENDING', {});
  await mk(approved, walletPt, 'PT', ownerPt, '2.00', 'APPROVED', { reviewedBy: 'admin-w5-1', reviewedAt: T('2033-03-02T00:00:00Z') });
});

test.after(async () => {
  try {
    await prisma.withdrawalRequest.deleteMany({ where: { id: { in: allIds } } });
    await prisma.wallet.deleteMany({ where: { id: { in: [walletPt, walletClient] } } });
  } catch (e) {
    console.warn('cleanup skipped:', (e as Error).message);
  } finally {
    await new Promise<void>((resolve) => testApp?.close(() => resolve()));
    await new Promise<void>((resolve) => authServer?.close(() => resolve()));
    await prisma.$disconnect();
  }
});

test('PAID: only PAID rows, ordered paidAt desc then id asc, payoutInfo absent, amounts exact', async () => {
  const r = await getJson(`?status=PAID${base}`);
  assert.equal(r.status, 200);
  assert.deepEqual(mine(r.body.items).map((i) => i.id), [paid2, paid3a, paid3b, paid1]);
  assert.equal(r.body.total, 4);
  assert.ok(!r.text.includes(SECRET), 'payoutInfo leaked');
  assert.ok(!r.text.includes('payoutInfo'));
  const byId = Object.fromEntries(r.body.items.map((i: any) => [i.id, i]));
  assert.equal(byId[paid1].amount, '299999.80');
  assert.equal(byId[paid2].amount, '5000000.00');
  assert.equal(byId[paid3a].amount, '100000.01');
  assert.equal(byId[paid1].bankReference, 'W5-REF-1');
  assert.equal(byId[paid1].rejectionReason, null, 'rejectionReason must be absent on PAID');
  assert.equal(byId[paid1].approvedBy, 'admin-w5-1');
  assert.equal(byId[paid1].paidAt, '2033-03-01T02:00:00.000Z');
  assert.equal(byId[paid1].walletAvailableNow, '1234567.89');
  assert.equal(byId[paid3a].walletAvailableNow, '10.50');
  assert.equal(byId[paid1].ownerType, 'PT');
  assert.equal(byId[paid1].walletId, walletPt);
});

test('REJECTED: only REJECTED rows, ordered by reviewedAt desc, bankReference absent', async () => {
  const r = await getJson(`?status=REJECTED${base}`);
  assert.equal(r.status, 200);
  assert.deepEqual(mine(r.body.items).map((i) => i.id), [rej2, rej1]);
  assert.equal(r.body.total, 2);
  assert.ok(!r.text.includes(SECRET));
  const byId = Object.fromEntries(r.body.items.map((i: any) => [i.id, i]));
  assert.equal(byId[rej1].rejectionReason, 'W5-REASON-1');
  assert.equal(byId[rej1].bankReference, null, 'bankReference must be absent on REJECTED');
  assert.equal(byId[rej1].reviewedAt, '2033-03-02T03:00:00.000Z');
  assert.equal(byId[rej1].paidAt, null);
  assert.equal(byId[rej2].amount, '50000.50');
});

test('ownerType filter', async () => {
  const pt = await getJson(`?status=PAID&ownerType=PT${base}`);
  assert.deepEqual(pt.body.items.map((i: any) => i.id), [paid2, paid1]);
  const cl = await getJson(`?status=PAID&ownerType=CLIENT${base}`);
  assert.deepEqual(cl.body.items.map((i: any) => i.id), [paid3a, paid3b]);
});

test('q matches exactly a withdrawal id or an ownerId, and nothing partial', async () => {
  const byId = await getJson(`?status=PAID&q=${paid2}`);
  assert.deepEqual(byId.body.items.map((i: any) => i.id), [paid2]);
  const byOwner = await getJson(`?status=PAID&q=${ownerClient}`);
  assert.deepEqual(byOwner.body.items.map((i: any) => i.id), [paid3a, paid3b]);
  const partial = await getJson('?status=PAID&q=W5-WD-PAID');
  assert.equal(partial.body.total, 0);
  assert.deepEqual(partial.body.items, []);
  // an id of another status never leaks into the other tab
  const wrongTab = await getJson(`?status=REJECTED&q=${paid2}`);
  assert.equal(wrongTab.body.total, 0);
});

test('PENDING and APPROVED rows never appear', async () => {
  for (const status of ['PAID', 'REJECTED']) {
    const r = await getJson(`?status=${status}&q=${ownerPt}`);
    assert.ok(!r.body.items.some((i: any) => i.id === pending || i.id === approved));
  }
});

test('date filter: PAID uses paidAt (from inclusive, to exclusive); REJECTED uses reviewedAt', async () => {
  const exactFrom = await getJson('?status=PAID&from=2033-03-03T02:00:00Z&to=2033-03-05T02:00:00Z');
  // paid3a/3b at exactly `from` are included, paid2 at exactly `to` is excluded
  assert.deepEqual(mine(exactFrom.body.items).map((i) => i.id), [paid3a, paid3b]);
  const rej = await getJson('?status=REJECTED&from=2033-03-03&to=2033-03-05');
  assert.deepEqual(mine(rej.body.items).map((i) => i.id), [rej2]);
  // a window that only matches createdAt returns nothing for either tab
  const none = await getJson('?status=REJECTED&from=2033-02-19&to=2033-02-21');
  assert.deepEqual(mine(none.body.items), []);
});

test('paging: limit / offset / hasMore / total are consistent', async () => {
  const p1 = await getJson(`?status=PAID&limit=3&offset=0${base}`);
  assert.equal(p1.body.total, 4);
  assert.equal(p1.body.limit, 3);
  assert.equal(p1.body.offset, 0);
  assert.equal(p1.body.hasMore, true);
  assert.deepEqual(p1.body.items.map((i: any) => i.id), [paid2, paid3a, paid3b]);
  const p2 = await getJson(`?status=PAID&limit=3&offset=3${base}`);
  assert.equal(p2.body.hasMore, false);
  assert.deepEqual(p2.body.items.map((i: any) => i.id), [paid1]);
  const beyond = await getJson(`?status=PAID&limit=3&offset=100${base}`);
  assert.equal(beyond.body.total, 4);
  assert.equal(beyond.body.hasMore, false);
  assert.deepEqual(beyond.body.items, []);
});

test('the DB rows are unchanged by reading (read-only)', async () => {
  const snap = async () =>
    (await prisma.withdrawalRequest.findMany({ where: { id: { in: allIds } }, orderBy: { id: 'asc' } })).map((r) => [
      r.id, r.amount.toFixed(2), r.status, r.bankReference, r.rejectionReason, r.reviewedBy, r.updatedAt.toISOString(),
    ]);
  const before = await snap();
  await getJson(`?status=PAID${base}`);
  await getJson(`?status=REJECTED${base}`);
  const after = await snap();
  assert.equal(after.length, 8);
  assert.deepEqual(after, before);
  assert.equal(after.find((r) => r[0] === paid1)![1], '299999.80');
});

test('response keys are exactly the whitelist', async () => {
  const r = await getJson(`?status=PAID&q=${paid1}`);
  assert.deepEqual(Object.keys(r.body.items[0]).sort(), [
    'amount', 'approvedBy', 'bankReference', 'createdAt', 'id', 'ownerId', 'ownerType', 'paidAt', 'rejectionReason',
    'reviewedAt', 'status', 'walletAvailableNow', 'walletId',
  ]);
});
