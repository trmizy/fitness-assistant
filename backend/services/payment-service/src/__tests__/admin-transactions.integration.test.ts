import { guardedTest as test } from './support/test-db-guard'; // runs only on a database whose name ends with _test
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { adminTransactionsService } from '../services/admin-transactions.service';

/**
 * BE-1 (G-04 / G-05 / G-14) - GET /admin/payments/transactions and /transactions/:id against the REAL service and the
 * isolated *_test database. The admin identity check goes to a TEST FIXTURE auth-service on 127.0.0.1:4048.
 *
 *   evidence label: BACKEND INTEGRATION (real express router + real Prisma + isolated *_test DB; auth-service = TEST FIXTURE).
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     npx tsx --test src/__tests__/admin-transactions.integration.test.ts
 *
 * Every row is created here with fresh uuids and dated in 2032 (a window no other suite uses), and removed afterwards.
 */

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4048';
const D = (n: number | string) => new Prisma.Decimal(n);

const FORBIDDEN_KEYS = [
  'extraData',
  'metadata',
  'idempotencyKey',
  'requestFingerprint',
  'result',
  'payload',
  'payoutInfo',
  'payerWalletId',
  'receiverWalletId',
  'initiatedBy',
];
const SECRET_MARKERS = ['SECRET-EXTRA-DATA', 'SECRET-METADATA', 'SECRET-OP-RESULT', 'SECRET-WEBHOOK-PAYLOAD', 'SECRET-FINGERPRINT'];

const payerId = randomUUID();
const providerRef = `PROV-${randomUUID()}`;
const mainId = randomUUID();
const refundId = randomUUID();
const failedId = randomUUID();
const tieA = randomUUID();
const tieB = randomUUID();
const contractId = randomUUID();
const tieKey = randomUUID(); // the shared gymId of the tie rows
const walletA = randomUUID();
const walletB = randomUUID();
const ownerA = randomUUID();
const ownerB = randomUUID();
const opKey = `TEST_OP:${randomUUID()}`;
const createdWalletIds = [walletA, walletB];
const allTxnIds = [mainId, refundId, failedId, tieA, tieB];

const T = (iso: string) => new Date(iso);

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';
const ADMIN = { Authorization: 'Bearer real-admin-token' };

async function getJson(path: string, headers: Record<string, string> = ADMIN) {
  const res = await fetch(`${baseUrl}/admin/payments${path}`, { headers });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as any };
}

function assertNoForbidden(text: string, where: string) {
  const obj = JSON.parse(text);
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(!FORBIDDEN_KEYS.includes(k), `${where}: forbidden key "${k}" at ${path}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(obj, '$');
  for (const m of SECRET_MARKERS) assert.ok(!text.includes(m), `${where}: secret marker ${m} leaked`);
}

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      if (String(req.headers.authorization || '') === 'Bearer real-admin-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: { id: 'admin-int-1', email: 'a@example.com', role: 'ADMIN' } }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4048, '127.0.0.1', r));
  const { default: adminRoutes } = await import('../routes/admin.routes');
  const app = express();
  app.use(express.json());
  app.use('/admin/payments', adminRoutes);
  testApp = http.createServer(app);
  await new Promise<void>((r) => testApp.listen(0, '127.0.0.1', r));
  const address = testApp.address();
  if (!address || typeof address === 'string') throw new Error('failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;

  // --- seed -------------------------------------------------------------------------------------------------------------
  await prisma.wallet.create({ data: { id: walletA, ownerType: 'CLIENT', ownerId: ownerA } });
  await prisma.wallet.create({ data: { id: walletB, ownerType: 'PT', ownerId: ownerB } });

  await prisma.paymentTransaction.create({
    data: {
      id: mainId, payerId, purpose: 'PT_CONTRACT', status: 'PAID', provider: 'VNPAY', amount: D('299999.84'),
      ptId: ownerB, ptContractId: contractId, providerTransactionId: providerRef, paymentMethod: 'ATM',
      idempotencyKey: `test:${randomUUID()}`, requestFingerprint: 'SECRET-FINGERPRINT', extraData: 'SECRET-EXTRA-DATA',
      metadata: { note: 'SECRET-METADATA' }, payerWalletId: walletA, receiverWalletId: walletB,
      activationStatus: 'ACTIVATED', paidAt: T('2032-01-03T00:05:00Z'), createdAt: T('2032-01-03T00:00:00Z'),
    },
  });
  await prisma.paymentTransaction.create({
    data: {
      id: refundId, payerId, purpose: 'REFUND', status: 'PAID', provider: 'VNPAY', amount: D('299999.80'),
      ptContractId: contractId, refundOfTransactionId: mainId, idempotencyKey: `test:${randomUUID()}`,
      metadata: { reason: 'SECRET-METADATA' }, createdAt: T('2032-01-04T00:00:00Z'),
    },
  });
  await prisma.paymentTransaction.create({
    data: {
      id: failedId, payerId, purpose: 'GYM_MEMBERSHIP', status: 'FAILED', provider: 'MOMO', amount: D('1000'),
      idempotencyKey: `test:${randomUUID()}`, failedAt: T('2032-01-02T00:01:00Z'), createdAt: T('2032-01-02T00:00:00Z'),
    },
  });
  // Two rows with the SAME createdAt: the list must break the tie by id ascending.
  for (const id of [tieA, tieB]) {
    await prisma.paymentTransaction.create({
      data: { id, payerId: randomUUID(), gymId: tieKey, purpose: 'GYM_MEMBERSHIP', status: 'PENDING', amount: D('5'), idempotencyKey: `test:${randomUUID()}`, createdAt: T('2032-02-01T00:00:00Z') },
    });
  }

  await prisma.walletLedgerEntry.create({
    data: { walletId: walletA, transactionId: mainId, entryType: 'DEBIT', bucket: 'AVAILABLE', amount: D('299999.84'), balanceBefore: D('300000.00'), balanceAfter: D('0.16'), description: 'thanh toán', createdAt: T('2032-01-03T00:06:00Z') },
  });
  await prisma.walletLedgerEntry.create({
    data: { walletId: walletB, transactionId: mainId, entryType: 'CREDIT', bucket: 'PENDING', amount: D('299999.84'), balanceBefore: D('0'), balanceAfter: D('299999.84'), description: null, createdAt: T('2032-01-03T00:07:00Z') },
  });
  await prisma.ledgerOperation.create({
    data: { key: opKey, result: { secret: 'SECRET-OP-RESULT' }, requestFingerprint: 'SECRET-FINGERPRINT', transactionId: mainId, kind: 'RELEASE_SESSION', createdAt: T('2032-01-03T01:00:00Z') },
  });
  await prisma.paymentWebhookEvent.create({
    data: { provider: 'VNPAY', providerEventId: `EVT-${randomUUID()}`, providerTransactionId: providerRef, payload: { secret: 'SECRET-WEBHOOK-PAYLOAD' }, processedAt: T('2032-01-03T00:05:01Z'), retryCount: 2, createdAt: T('2032-01-03T00:05:00Z') },
  });
  // Same providerTransactionId but ANOTHER provider: must not be attached to the main transaction.
  await prisma.paymentWebhookEvent.create({
    data: { provider: 'MOMO', providerEventId: `EVT-${randomUUID()}`, providerTransactionId: providerRef, payload: { secret: 'SECRET-WEBHOOK-PAYLOAD' }, createdAt: T('2032-01-03T00:05:30Z') },
  });
  await prisma.platformCommission.create({
    data: { paymentTransactionId: mainId, partnerType: 'PT', partnerId: ownerB, grossAmount: D('299999.84'), platformFeeAmount: D('29999.98'), partnerPayoutAmount: D('269999.86'), commissionRate: D('0.1'), createdAt: T('2032-01-03T00:08:00Z') },
  });
  await prisma.contractUnpaidObligation.create({
    data: { key: `TEST_OBL:${randomUUID()}`, transactionId: mainId, kind: 'NO_SHOW', party: 'CLIENT', owed: D('100.50'), paid: D('0'), unpaid: D('100.50'), createdAt: T('2032-01-03T02:00:00Z') },
  });
  await prisma.ptHoldbackReview.create({
    data: { key: `HBR:${mainId}:UNCOMPUTABLE`, transactionId: mainId, kind: 'UNCOMPUTABLE', reserve: D('29999.98'), reason: 'SECRET internal reason', reviewBy: T('2032-02-01T00:00:00Z'), createdAt: T('2032-01-03T03:00:00Z') },
  });
});

test.after(async () => {
  try {
    await prisma.ptHoldbackReview.deleteMany({ where: { transactionId: { in: allTxnIds } } });
    await prisma.contractUnpaidObligation.deleteMany({ where: { transactionId: { in: allTxnIds } } });
    await prisma.platformCommission.deleteMany({ where: { paymentTransactionId: { in: allTxnIds } } });
    await prisma.paymentWebhookEvent.deleteMany({ where: { providerTransactionId: providerRef } });
    await prisma.ledgerOperation.deleteMany({ where: { key: opKey } });
    await prisma.walletLedgerEntry.deleteMany({ where: { transactionId: { in: allTxnIds } } });
    await prisma.paymentTransaction.deleteMany({ where: { id: { in: [refundId, failedId, tieA, tieB] } } });
    await prisma.paymentTransaction.deleteMany({ where: { id: mainId } });
    await prisma.wallet.deleteMany({ where: { id: { in: createdWalletIds } } });
  } catch (e) {
    console.warn('cleanup skipped:', (e as Error).message);
  }
  await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((e) => (e ? reject(e) : resolve())));
  await prisma.$disconnect();
});

test('list: q matches EXACTLY providerTransactionId, payerId, ptContractId, ptId, gymId, id - and a prefix matches nothing', async () => {
  const byProvider = await getJson(`/transactions?q=${encodeURIComponent(providerRef)}`);
  assert.equal(byProvider.status, 200);
  assert.deepEqual(byProvider.body.items.map((i: any) => i.id), [mainId]);

  const byPayer = await getJson(`/transactions?q=${payerId}`);
  assert.equal(byPayer.body.total, 3);
  assert.deepEqual(byPayer.body.items.map((i: any) => i.id), [refundId, mainId, failedId], 'createdAt desc');

  assert.equal((await getJson(`/transactions?q=${contractId}`)).body.total, 2);
  assert.equal((await getJson(`/transactions?q=${ownerB}`)).body.total, 1);
  assert.equal((await getJson(`/transactions?q=${tieKey}`)).body.total, 2);
  assert.deepEqual((await getJson(`/transactions?q=${failedId}`)).body.items.map((i: any) => i.id), [failedId]);

  assert.equal((await getJson(`/transactions?q=${payerId.slice(0, 12)}`)).body.total, 0, 'prefix is not a match (no LIKE scan)');
  assert.equal((await getJson(`/transactions?q=${providerRef.toLowerCase()}`)).body.total, 0, 'case-sensitive exact match');
});

test('list: status / provider / purpose / from / to filters combine with q', async () => {
  const paid = await getJson(`/transactions?q=${payerId}&status=PAID`);
  assert.equal(paid.body.total, 2);
  assert.ok(paid.body.items.every((i: any) => i.status === 'PAID'));
  assert.deepEqual((await getJson(`/transactions?q=${payerId}&status=FAILED`)).body.items.map((i: any) => i.id), [failedId]);
  assert.deepEqual((await getJson(`/transactions?q=${payerId}&provider=MOMO`)).body.items.map((i: any) => i.id), [failedId]);
  assert.deepEqual((await getJson(`/transactions?q=${payerId}&purpose=REFUND`)).body.items.map((i: any) => i.id), [refundId]);

  // from is inclusive, to is exclusive (on createdAt)
  const win = await getJson(`/transactions?q=${payerId}&from=2032-01-03T00:00:00Z&to=2032-01-04T00:00:00Z`);
  assert.deepEqual(win.body.items.map((i: any) => i.id), [mainId], 'to=refund.createdAt excludes the refund; from=main.createdAt includes main');
  const onlyFrom = await getJson(`/transactions?q=${payerId}&from=2032-01-04`);
  assert.deepEqual(onlyFrom.body.items.map((i: any) => i.id), [refundId]);
});

test('list: paging (limit / offset / hasMore / total) and the createdAt desc, id asc tie-break', async () => {
  const p1 = await getJson(`/transactions?q=${payerId}&limit=2&offset=0`);
  assert.equal(p1.body.total, 3);
  assert.equal(p1.body.limit, 2);
  assert.equal(p1.body.offset, 0);
  assert.equal(p1.body.hasMore, true);
  assert.deepEqual(p1.body.items.map((i: any) => i.id), [refundId, mainId]);

  const p2 = await getJson(`/transactions?q=${payerId}&limit=2&offset=2`);
  assert.equal(p2.body.hasMore, false);
  assert.deepEqual(p2.body.items.map((i: any) => i.id), [failedId]);

  const beyond = await getJson(`/transactions?q=${payerId}&limit=2&offset=50`);
  assert.equal(beyond.body.hasMore, false);
  assert.deepEqual(beyond.body.items, []);
  assert.equal(beyond.body.total, 3);

  const tie = await getJson(`/transactions?q=${tieKey}`);
  assert.deepEqual(tie.body.items.map((i: any) => i.id), [tieA, tieB].sort(), 'same createdAt -> id ascending');

  const defaults = await getJson(`/transactions?q=${payerId}`);
  assert.equal(defaults.body.limit, 25);
  assert.equal(defaults.body.offset, 0);
});

test('list: item is exactly the TxnSummary whitelist; "299999.84" and "299999.80" come back unchanged; whole response has no forbidden key', async () => {
  const res = await getJson(`/transactions?q=${providerRef}`);
  assert.equal(res.status, 200);
  assertNoForbidden(res.text, 'list');
  const item = res.body.items[0];
  assert.deepEqual(Object.keys(item).sort(), [
    'activationStatus', 'amount', 'createdAt', 'currency', 'failedAt', 'gymId', 'id', 'membershipId', 'paidAt', 'payerId',
    'paymentMethod', 'provider', 'providerTransactionId', 'ptContractId', 'ptId', 'purpose', 'refundOfTransactionId',
    'refundedAt', 'status',
  ]);
  assert.equal(item.amount, '299999.84');
  assert.equal(item.currency, 'VND');
  assert.equal(item.provider, 'VNPAY');
  assert.equal(item.createdAt, '2032-01-03T00:00:00.000Z');
  assert.equal(item.paidAt, '2032-01-03T00:05:00.000Z');
  assert.equal(item.failedAt, null);
  assert.equal(item.activationStatus, 'ACTIVATED');

  const refund = (await getJson(`/transactions?q=${refundId}`)).body.items[0];
  assert.equal(refund.amount, '299999.80', 'trailing zero kept as stored (not 299999.8)');
  assert.equal(refund.refundOfTransactionId, mainId);
});

test('detail: joins (refunds, ledger entries asc with wallet owner, operations, commissions, obligations, holdback, webhook same-provider only)', async () => {
  const res = await getJson(`/transactions/${mainId}`);
  assert.equal(res.status, 200);
  const b = res.body;
  assert.deepEqual(Object.keys(b).sort(), [
    'commissions', 'holdbackReviews', 'ledgerEntries', 'ledgerOperations', 'obligations', 'refundOf', 'refunds', 'transaction', 'webhookEvents',
  ]);
  assert.equal(b.transaction.id, mainId);
  assert.equal(b.transaction.amount, '299999.84');
  assert.equal(b.refundOf, null);
  assert.deepEqual(b.refunds.map((r: any) => r.id), [refundId]);
  assert.equal(b.refunds[0].amount, '299999.80');

  assert.equal(b.ledgerEntries.length, 2);
  assert.deepEqual(b.ledgerEntries.map((e: any) => e.entryType), ['DEBIT', 'CREDIT'], 'createdAt asc');
  assert.deepEqual(Object.keys(b.ledgerEntries[0]).sort(), [
    'amount', 'balanceAfter', 'balanceBefore', 'bucket', 'createdAt', 'description', 'entryType', 'id', 'walletId', 'walletOwnerId', 'walletOwnerType',
  ]);
  assert.equal(b.ledgerEntries[0].walletOwnerType, 'CLIENT');
  assert.equal(b.ledgerEntries[0].walletOwnerId, ownerA);
  assert.equal(b.ledgerEntries[0].amount, '299999.84');
  assert.equal(b.ledgerEntries[0].balanceBefore, '300000.00');
  assert.equal(b.ledgerEntries[0].balanceAfter, '0.16');
  assert.equal(b.ledgerEntries[1].walletOwnerType, 'PT');
  assert.equal(b.ledgerEntries[1].bucket, 'PENDING');
  assert.equal(b.ledgerEntries[1].description, null);

  assert.equal(b.ledgerOperations.length, 1);
  assert.deepEqual(Object.keys(b.ledgerOperations[0]).sort(), ['createdAt', 'id', 'key', 'kind']);
  assert.equal(b.ledgerOperations[0].key, opKey);
  assert.equal(b.ledgerOperations[0].kind, 'RELEASE_SESSION');

  assert.equal(b.commissions.length, 1);
  assert.deepEqual(Object.keys(b.commissions[0]).sort(), [
    'commissionRate', 'createdAt', 'grossAmount', 'id', 'partnerId', 'partnerPayoutAmount', 'partnerType', 'platformFeeAmount', 'settledAt', 'status',
  ]);
  assert.equal(b.commissions[0].platformFeeAmount, '29999.98');
  assert.equal(b.commissions[0].commissionRate, '0.1000');

  assert.equal(b.obligations.length, 1);
  assert.deepEqual(Object.keys(b.obligations[0]).sort(), [
    'contractRef', 'createdAt', 'id', 'kind', 'owed', 'paid', 'party', 'resolvedAt', 'status', 'unpaid', 'verifiedPaid',
  ]);
  assert.equal(b.obligations[0].owed, '100.50');
  assert.equal(b.obligations[0].status, 'OPEN');

  assert.equal(b.holdbackReviews.length, 1);
  assert.deepEqual(Object.keys(b.holdbackReviews[0]).sort(), [
    'createdAt', 'decidedAt', 'id', 'kind', 'releasedToPt', 'reserve', 'reviewBy', 'status', 'verifiedAmount',
  ]);
  assert.equal(b.holdbackReviews[0].reserve, '29999.98');
  assert.equal(b.holdbackReviews[0].verifiedAmount, null);

  assert.equal(b.webhookEvents.length, 1, 'the MOMO event with the same reference is not attached to a VNPAY transaction');
  assert.deepEqual(Object.keys(b.webhookEvents[0]).sort(), ['createdAt', 'id', 'processedAt', 'provider', 'providerEventId', 'retryCount']);
  assert.equal(b.webhookEvents[0].provider, 'VNPAY');
  assert.equal(b.webhookEvents[0].retryCount, 2);
  assert.equal(b.webhookEvents[0].processedAt, '2032-01-03T00:05:01.000Z');
});

test('detail: whitelist - no extraData / metadata / idempotencyKey / requestFingerprint / result / payload / payoutInfo anywhere, and none of the planted secrets', async () => {
  for (const id of [mainId, refundId]) {
    const res = await getJson(`/transactions/${id}`);
    assert.equal(res.status, 200);
    assertNoForbidden(res.text, `detail ${id}`);
  }
  assert.ok(!(await getJson(`/transactions/${mainId}`)).text.includes('SECRET internal reason'), 'holdback reason is not exposed');
});

test('detail: a refund row shows the original (refundOf) and has no children', async () => {
  const b = (await getJson(`/transactions/${refundId}`)).body;
  assert.equal(b.refundOf.id, mainId);
  assert.equal(b.refundOf.amount, '299999.84');
  assert.deepEqual(b.refunds, []);
  assert.deepEqual(b.ledgerEntries, []);
  assert.deepEqual(b.webhookEvents, [], 'no providerTransactionId -> no webhook lookup');
});

test('detail: 404 TRANSACTION_NOT_FOUND for an unknown uuid, 400 INVALID_ID for a non-uuid, 401 without a token', async () => {
  const miss = await getJson(`/transactions/${randomUUID()}`);
  assert.equal(miss.status, 404);
  assert.equal(miss.body.code, 'TRANSACTION_NOT_FOUND');
  const bad = await getJson('/transactions/not-a-uuid');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'INVALID_ID');
  assert.equal((await fetch(`${baseUrl}/admin/payments/transactions/${mainId}`)).status, 401);
});

test('service: detail(unknown) resolves null; list() on an empty window returns an empty page', async () => {
  assert.equal(await adminTransactionsService.detail(randomUUID()), null);
  const empty = await adminTransactionsService.list({ q: randomUUID(), limit: 25, offset: 0 } as never);
  assert.deepEqual(empty, { total: 0, limit: 25, offset: 0, hasMore: false, items: [] });
});
