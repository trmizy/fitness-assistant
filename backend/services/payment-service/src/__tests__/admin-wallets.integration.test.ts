import { guardedTest as test } from './support/test-db-guard'; // runs only on a database whose name ends with _test
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

/**
 * G-09 / G-10 - GET /admin/payments/wallets and /wallets/:id against the REAL service and the isolated *_test database.
 * The admin identity check goes to a TEST FIXTURE auth-service on 127.0.0.1:4068.
 *
 *   evidence label: BACKEND INTEGRATION (real express router + real Prisma + isolated *_test DB; auth-service = TEST FIXTURE).
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     npx tsx --test --test-concurrency=1 src/__tests__/admin-wallets.integration.test.ts
 *
 * Every row carries the worker marker "W6-" (owner ids / idempotency keys), is dated in 2033 and is removed afterwards;
 * only rows created here are deleted.
 */

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4068';
const D = (n: number | string) => new Prisma.Decimal(n);
const T = (iso: string) => new Date(iso);

const OWNER = `W6-owner-${randomUUID()}`; // shared by the four wallets below (unique key is ownerType + ownerId)
const wClient = randomUUID();
const wPt = randomUUID();
const wGym = randomUUID();
const wPlatform = randomUUID();
const wEmpty = randomUUID(); // a wallet with no entries
const emptyOwner = `W6-empty-${randomUUID()}`;
const walletIds = [wClient, wPt, wGym, wPlatform, wEmpty];

const txPt = randomUUID();
const txRefund = randomUUID();
const txRefundLegacyPurpose = randomUUID(); // purpose PT_CONTRACT but refundOfTransactionId set -> kind REFUND
const txWithdrawal = randomUUID();
const txTopup = randomUUID();
const txOther = randomUUID();
const txIds = [txPt, txRefund, txRefundLegacyPurpose, txWithdrawal, txTopup, txOther];

const entryTieA = randomUUID();
const entryTieB = randomUUID();
const SECRET_DESC = 'W6-SECRET-DESCRIPTION';

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';
const ADMIN = { Authorization: 'Bearer real-admin-token' };

async function getJson(path: string, headers: Record<string, string> = ADMIN) {
  const res = await fetch(`${baseUrl}/admin/payments/wallets${path}`, { headers });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as any };
}

const txn = (id: string, purpose: string, over: Record<string, unknown> = {}) =>
  prisma.paymentTransaction.create({
    data: {
      id,
      payerId: `W6-payer-${id}`,
      purpose: purpose as never,
      status: 'PAID',
      provider: 'MOCK',
      amount: D('1000'),
      idempotencyKey: `W6-${id}`,
      createdAt: T('2033-01-01T00:00:00Z'),
      ...over,
    },
  });

const entry = (walletId: string, transactionId: string, createdAt: string, over: Record<string, unknown> = {}) =>
  prisma.walletLedgerEntry.create({
    data: {
      walletId,
      transactionId,
      entryType: 'CREDIT',
      bucket: 'AVAILABLE',
      amount: D('100'),
      balanceBefore: D('0'),
      balanceAfter: D('100'),
      description: SECRET_DESC,
      createdAt: T(createdAt),
      ...over,
    } as never,
  });

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      if (String(req.headers.authorization || '') === 'Bearer real-admin-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: { id: 'admin-w6-1', email: 'a@example.com', role: 'ADMIN' } }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4068, '127.0.0.1', r));
  const { default: walletsRoutes } = await import('../routes/admin-wallets.routes');
  const app = express();
  app.use(express.json());
  app.use('/admin/payments/wallets', walletsRoutes);
  testApp = http.createServer(app);
  await new Promise<void>((r) => testApp.listen(0, '127.0.0.1', r));
  const address = testApp.address();
  if (!address || typeof address === 'string') throw new Error('failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;

  // --- seed -------------------------------------------------------------------------------------------------------------
  // updatedAt: client newest, pt next, gym + platform tie (id ascending decides).
  await prisma.wallet.create({
    data: { id: wClient, ownerType: 'CLIENT', ownerId: OWNER, availableBalance: D('299999.80'), pendingBalance: D('0.10'), lockedBalance: D('5.50'), holdbackBalance: D('7.25'), updatedAt: T('2033-03-03T00:00:00Z'), createdAt: T('2033-01-01T00:00:00Z') },
  });
  await prisma.wallet.create({ data: { id: wPt, ownerType: 'PT', ownerId: OWNER, status: 'FROZEN', updatedAt: T('2033-02-02T00:00:00Z') } });
  await prisma.wallet.create({ data: { id: wGym, ownerType: 'GYM', ownerId: OWNER, updatedAt: T('2033-01-15T00:00:00Z') } });
  await prisma.wallet.create({ data: { id: wPlatform, ownerType: 'PLATFORM', ownerId: OWNER, updatedAt: T('2033-01-15T00:00:00Z') } });
  await prisma.wallet.create({ data: { id: wEmpty, ownerType: 'CLIENT', ownerId: emptyOwner } });

  await txn(txPt, 'PT_CONTRACT');
  await txn(txRefund, 'REFUND', { refundOfTransactionId: txPt });
  await txn(txRefundLegacyPurpose, 'PT_CONTRACT', { refundOfTransactionId: txPt });
  await txn(txWithdrawal, 'WITHDRAWAL');
  await txn(txTopup, 'WALLET_TOPUP');
  await txn(txOther, 'GYM_MEMBERSHIP');

  // Client wallet: 7 entries, newest first by createdAt; the last two share a createdAt (id ascending breaks the tie).
  await entry(wClient, txTopup, '2033-01-01T10:00:00Z', { amount: D('299999.84'), balanceBefore: D('0'), balanceAfter: D('299999.84') });
  await entry(wClient, txPt, '2033-01-02T10:00:00Z', { entryType: 'DEBIT', amount: D('299999.80'), balanceBefore: D('299999.84'), balanceAfter: D('0.04') });
  await entry(wClient, txRefund, '2033-01-03T10:00:00Z', { bucket: 'PENDING' });
  await entry(wClient, txWithdrawal, '2033-01-04T10:00:00Z', { entryType: 'DEBIT', bucket: 'LOCKED' });
  await entry(wClient, txRefundLegacyPurpose, '2033-01-05T10:00:00Z', { bucket: 'HOLDBACK' });
  await entry(wClient, txOther, '2033-01-06T10:00:00Z', { id: entryTieA });
  await entry(wClient, txOther, '2033-01-06T10:00:00Z', { id: entryTieB });
  // Another wallet's entry: must never appear in the client wallet.
  await entry(wPt, txPt, '2033-01-07T10:00:00Z');
});

test.after(async () => {
  try {
    await prisma.walletLedgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
    await prisma.paymentTransaction.deleteMany({ where: { id: { in: [txRefund, txRefundLegacyPurpose] } } });
    await prisma.paymentTransaction.deleteMany({ where: { id: { in: txIds } } });
    await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  } catch (e) {
    console.warn('cleanup skipped:', (e as Error).message);
  }
  await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((e) => (e ? reject(e) : resolve())));
  await prisma.$disconnect();
});

test('auth: no token -> 401', async () => {
  assert.equal((await getJson('', {})).status, 401);
  assert.equal((await getJson(`/${wClient}`, {})).status, 401);
});

test('list: ownerId is an EXACT match - the four wallets of one owner id come back, a prefix / other case matches nothing', async () => {
  const all = await getJson(`?ownerId=${encodeURIComponent(OWNER)}`);
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 4);
  assert.equal((await getJson(`?ownerId=${encodeURIComponent(OWNER.slice(0, 14))}`)).body.total, 0, 'prefix is not a match (no LIKE scan)');
  assert.equal((await getJson(`?ownerId=${encodeURIComponent(OWNER.toUpperCase())}`)).body.total, 0, 'case-sensitive exact match');
});

test('list: ownerType narrows; ownerType + ownerId returns the single wallet; platform ownerId is kept as stored', async () => {
  const pt = await getJson(`?ownerType=PT&ownerId=${encodeURIComponent(OWNER)}`);
  assert.deepEqual(pt.body.items.map((i: any) => i.id), [wPt]);
  assert.equal(pt.body.items[0].status, 'FROZEN');
  const platform = await getJson(`?ownerType=PLATFORM&ownerId=${encodeURIComponent(OWNER)}`);
  assert.deepEqual(platform.body.items.map((i: any) => i.id), [wPlatform]);
  assert.equal(platform.body.items[0].ownerType, 'PLATFORM');
  assert.equal(platform.body.items[0].ownerId, OWNER, 'ownerId is returned untouched');
  assert.equal((await getJson(`?ownerType=CLIENT&ownerId=${encodeURIComponent(OWNER)}`)).body.total, 1);
});

test('list: ordered updatedAt desc, id asc (tie); paging total / limit / offset / hasMore', async () => {
  const q = `ownerId=${encodeURIComponent(OWNER)}`;
  const tieOrder = [wGym, wPlatform].sort();
  const full = await getJson(`?${q}`);
  assert.deepEqual(full.body.items.map((i: any) => i.id), [wClient, wPt, ...tieOrder]);
  assert.equal(full.body.limit, 25);
  assert.equal(full.body.offset, 0);
  assert.equal(full.body.hasMore, false);

  const p1 = await getJson(`?${q}&limit=3`);
  assert.equal(p1.body.hasMore, true);
  assert.deepEqual(p1.body.items.map((i: any) => i.id), [wClient, wPt, tieOrder[0]]);
  const p2 = await getJson(`?${q}&limit=3&offset=3`);
  assert.equal(p2.body.hasMore, false);
  assert.deepEqual(p2.body.items.map((i: any) => i.id), [tieOrder[1]]);
  const beyond = await getJson(`?${q}&limit=3&offset=50`);
  assert.deepEqual(beyond.body.items, []);
  assert.equal(beyond.body.total, 4);
  assert.equal(beyond.body.hasMore, false);
});

test('list: item is exactly the wallet whitelist; balances are strings exactly as stored (trailing zeros kept)', async () => {
  const res = await getJson(`?ownerType=CLIENT&ownerId=${encodeURIComponent(OWNER)}`);
  const item = res.body.items[0];
  assert.deepEqual(Object.keys(item).sort(), [
    'availableBalance', 'createdAt', 'holdbackBalance', 'id', 'lockedBalance', 'ownerId', 'ownerType', 'pendingBalance', 'status', 'updatedAt',
  ]);
  assert.equal(item.availableBalance, '299999.80');
  assert.equal(item.pendingBalance, '0.10');
  assert.equal(item.lockedBalance, '5.50');
  assert.equal(item.holdbackBalance, '7.25');
  assert.equal(item.status, 'ACTIVE');
  assert.equal(item.createdAt, '2033-01-01T00:00:00.000Z');
  assert.equal(item.updatedAt, '2033-03-03T00:00:00.000Z');
});

test('detail: wallet + entries (newest first, id tie-break), whitelisted keys, NO description anywhere, amounts unchanged', async () => {
  const res = await getJson(`/${wClient}`);
  assert.equal(res.status, 200);
  assert.ok(!res.text.includes(SECRET_DESC), 'the raw description must never leave the API');
  assert.ok(!res.text.includes('description'), 'no description key at all');
  assert.deepEqual(Object.keys(res.body).sort(), ['entries', 'wallet']);
  assert.equal(res.body.wallet.id, wClient);
  assert.equal(res.body.wallet.availableBalance, '299999.80');
  assert.deepEqual(Object.keys(res.body.entries).sort(), ['hasMore', 'items', 'limit', 'offset', 'total']);
  assert.equal(res.body.entries.total, 7);
  assert.equal(res.body.entries.limit, 50);
  assert.equal(res.body.entries.offset, 0);
  assert.equal(res.body.entries.hasMore, false);

  const items = res.body.entries.items as any[];
  assert.deepEqual(Object.keys(items[0]).sort(), [
    'amount', 'balanceAfter', 'balanceBefore', 'bucket', 'createdAt', 'entryType', 'id', 'kind', 'transactionId',
  ]);
  const tie = [entryTieA, entryTieB].sort();
  assert.deepEqual(items.slice(0, 2).map((e) => e.id), tie, 'same createdAt -> id ascending');
  assert.deepEqual(items.slice(2).map((e) => e.createdAt), [
    '2033-01-05T10:00:00.000Z', '2033-01-04T10:00:00.000Z', '2033-01-03T10:00:00.000Z', '2033-01-02T10:00:00.000Z', '2033-01-01T10:00:00.000Z',
  ]);
  assert.ok(items.every((e) => [txTopup, txPt, txRefund, txWithdrawal, txRefundLegacyPurpose, txOther].includes(e.transactionId)));

  const byTx = (id: string) => items.find((e) => e.transactionId === id);
  const pay = byTx(txPt);
  assert.equal(pay.entryType, 'DEBIT');
  assert.equal(pay.amount, '299999.80', 'trailing zero kept as stored');
  assert.equal(pay.balanceBefore, '299999.84');
  assert.equal(pay.balanceAfter, '0.04');
  assert.equal(byTx(txTopup).amount, '299999.84');
});

test('detail: kind comes from the linked transaction purpose / refundOfTransactionId; bucket + entryType are the raw enums', async () => {
  const items = (await getJson(`/${wClient}`)).body.entries.items as any[];
  const by = (id: string) => items.find((e) => e.transactionId === id);
  assert.equal(by(txTopup).kind, 'WALLET_TOPUP');
  assert.equal(by(txPt).kind, 'PT_CONTRACT');
  assert.equal(by(txRefund).kind, 'REFUND');
  assert.equal(by(txRefundLegacyPurpose).kind, 'REFUND', 'refundOfTransactionId wins over purpose');
  assert.equal(by(txWithdrawal).kind, 'WITHDRAWAL');
  assert.equal(by(txOther).kind, 'GYM_MEMBERSHIP');
  assert.equal(by(txRefund).bucket, 'PENDING');
  assert.equal(by(txWithdrawal).bucket, 'LOCKED');
  assert.equal(by(txRefundLegacyPurpose).bucket, 'HOLDBACK');
  assert.equal(by(txTopup).bucket, 'AVAILABLE');
  assert.equal(by(txWithdrawal).entryType, 'DEBIT');
});

test('detail: entries paging (entriesLimit / entriesOffset / hasMore / total) and the from/to window (from inclusive, to exclusive)', async () => {
  const p1 = await getJson(`/${wClient}?entriesLimit=3`);
  assert.equal(p1.body.entries.total, 7);
  assert.equal(p1.body.entries.limit, 3);
  assert.equal(p1.body.entries.hasMore, true);
  assert.equal(p1.body.entries.items.length, 3);
  const p3 = await getJson(`/${wClient}?entriesLimit=3&entriesOffset=6`);
  assert.equal(p3.body.entries.hasMore, false);
  assert.equal(p3.body.entries.items.length, 1);
  assert.equal(p3.body.entries.items[0].transactionId, txTopup, 'the oldest entry is last');
  const beyond = await getJson(`/${wClient}?entriesOffset=500`);
  assert.deepEqual(beyond.body.entries.items, []);
  assert.equal(beyond.body.entries.total, 7);

  const win = await getJson(`/${wClient}?from=2033-01-02T10:00:00Z&to=2033-01-04T10:00:00Z`);
  assert.equal(win.body.entries.total, 2, 'Jan 2 10:00 (inclusive) and Jan 3 10:00; Jan 4 10:00 is excluded');
  assert.deepEqual(win.body.entries.items.map((e: any) => e.transactionId), [txRefund, txPt]);
  const onlyFrom = await getJson(`/${wClient}?from=2033-01-06`);
  assert.equal(onlyFrom.body.entries.total, 2);
});

test('detail: another wallet\'s entries never leak in; a wallet with no entries has an empty page; 404 / 400', async () => {
  const pt = await getJson(`/${wPt}`);
  assert.equal(pt.body.entries.total, 1);
  assert.equal(pt.body.entries.items[0].transactionId, txPt);
  assert.equal(pt.body.wallet.status, 'FROZEN');

  const empty = await getJson(`/${wEmpty}`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.entries, { total: 0, limit: 50, offset: 0, hasMore: false, items: [] });

  const miss = await getJson(`/${randomUUID()}`);
  assert.equal(miss.status, 404);
  assert.equal(miss.body.code, 'WALLET_NOT_FOUND');
  assert.equal((await getJson('/ESCROW')).body.code, 'INVALID_ID');
  assert.equal((await getJson(`/${wClient}?entriesLimit=201`)).body.code, 'INVALID_QUERY');
});

test('read only: reading never changes a wallet row (updatedAt and balances identical before / after)', async () => {
  const before = await prisma.wallet.findUnique({ where: { id: wClient } });
  await getJson(`/${wClient}`);
  await getJson(`?ownerId=${encodeURIComponent(OWNER)}`);
  const after = await prisma.wallet.findUnique({ where: { id: wClient } });
  assert.equal(after!.updatedAt.getTime(), before!.updatedAt.getTime());
  assert.equal(after!.availableBalance.toFixed(2), before!.availableBalance.toFixed(2));
});
