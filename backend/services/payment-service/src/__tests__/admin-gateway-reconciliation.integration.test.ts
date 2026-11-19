import { guardedTest as test } from './support/test-db-guard'; // runs only on a database whose name ends with _test
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';

/**
 * B8 (L2) - GET /admin/payments/gateway-reconciliation against the REAL service and the isolated *_test database.
 * The admin identity check goes to a TEST FIXTURE auth-service on 127.0.0.1:4058.
 *
 *   evidence label: BACKEND INTEGRATION (real express router + real Prisma + isolated *_test DB; auth-service = TEST FIXTURE).
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     npx tsx --test src/__tests__/admin-gateway-reconciliation.integration.test.ts
 *
 * Seeds one example per category (and the exclusions that must NOT be classified), dated in May / July 2001 (a window no
 * other suite uses), plus one row dated "now" for the 10-minute grace. Every row is removed afterwards.
 */
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4058';
const D = (n: number | string) => new Prisma.Decimal(n);
const T = (iso: string) => new Date(iso);
const ref = () => `GWR-${randomUUID()}`;

const FROM = '2001-05-01T00:00:00Z';
const TO = '2001-06-01T00:00:00Z';
const CAP_FROM = '2001-07-01T00:00:00Z';
const CAP_TO = '2001-08-01T00:00:00Z';
const SECRET = 'SECRET-WEBHOOK-PAYLOAD';

const payerId = randomUUID();
const txnIds: string[] = [];
const refs: string[] = [];
const ids: Record<string, string> = {};

async function mkTxn(
  name: string,
  data: {
    provider: 'VNPAY' | 'ZALOPAY' | 'PAYOS' | 'MOMO' | 'MOCK';
    status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
    amount: string;
    purpose?: 'PT_CONTRACT' | 'GYM_MEMBERSHIP' | 'REFUND';
    createdAt: string;
    paidAt?: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  const id = randomUUID();
  const r = ref();
  refs.push(r);
  ids[name] = id;
  txnIds.push(id);
  await prisma.paymentTransaction.create({
    data: {
      id,
      payerId,
      purpose: data.purpose ?? 'PT_CONTRACT',
      status: data.status,
      provider: data.provider,
      amount: D(data.amount),
      providerTransactionId: r,
      idempotencyKey: `test:${randomUUID()}`,
      createdAt: T(data.createdAt),
      paidAt: data.paidAt ? T(data.paidAt) : null,
      metadata: data.metadata,
    },
  });
  return { id, ref: r };
}

async function mkEvent(
  name: string,
  data: {
    provider: 'VNPAY' | 'ZALOPAY' | 'PAYOS' | 'MOMO';
    providerTransactionId: string | null;
    eventId?: string;
    payload: Prisma.InputJsonValue;
    createdAt: string | Date;
    processed?: boolean;
    retryCount?: number;
  },
) {
  const created = typeof data.createdAt === 'string' ? T(data.createdAt) : data.createdAt;
  const row = await prisma.paymentWebhookEvent.create({
    data: {
      provider: data.provider,
      providerEventId: data.eventId ?? `${data.provider.toLowerCase()}_${randomUUID()}`,
      providerTransactionId: data.providerTransactionId,
      payload: data.payload,
      processedAt: data.processed ? new Date(created.getTime() + 1000) : null,
      retryCount: data.retryCount ?? 0,
      createdAt: created,
    },
  });
  ids[`evt:${name}`] = row.id;
  return row;
}

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';
const ADMIN = { Authorization: 'Bearer real-admin-token' };

async function report(from: string, to: string) {
  const res = await fetch(`${baseUrl}/admin/payments/gateway-reconciliation?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    headers: ADMIN,
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return { text, body: JSON.parse(text) as any };
}
const cat = (body: any, code: string) => body.categories.find((c: any) => c.code === code);
const itemFor = (c: any, key: string, by: 'transactionId' | 'webhookEventId') => c.items.find((i: any) => i[by] === ids[key]);

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      if (String(req.headers.authorization || '') === 'Bearer real-admin-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: { id: 'admin-gwr-1', email: 'a@example.com', role: 'ADMIN' } }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4058, '127.0.0.1', r));
  const { default: gatewayRoutes } = await import('../routes/admin-gateway-reconciliation.routes');
  const { default: adminRoutes } = await import('../routes/admin.routes');
  const app = express();
  app.use(express.json());
  app.use('/admin/payments/gateway-reconciliation', gatewayRoutes);
  app.use('/admin/payments', adminRoutes);
  testApp = http.createServer(app);
  await new Promise<void>((r) => testApp.listen(0, '127.0.0.1', r));
  const address = testApp.address();
  if (!address || typeof address === 'string') throw new Error('failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;

  // A. WEBHOOK_UNPROCESSED: matching transaction, event never processed, retried 3 times.
  const a = await mkTxn('A', { provider: 'VNPAY', status: 'PENDING', amount: '150000.00', createdAt: '2001-05-02T00:00:00Z' });
  await mkEvent('A', {
    provider: 'VNPAY', providerTransactionId: a.ref, eventId: `vnpay_ipn:${randomUUID()}`,
    payload: { vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_Amount: '15000000', note: SECRET },
    createdAt: '2001-05-02T00:01:00Z', retryCount: 3,
  });

  // B. WEBHOOK_ORPHAN: ZaloPay callback for a reference no transaction has.
  const orphanRef = ref();
  refs.push(orphanRef);
  await mkEvent('B', {
    provider: 'ZALOPAY', providerTransactionId: orphanRef, payload: { app_trans_id: orphanRef, amount: 20000, note: SECRET },
    createdAt: '2001-05-03T00:00:00Z', processed: true,
  });
  // B2. A MoMo event whose reference belongs to a PayOS transaction: still an orphan (never matches across providers).
  const b2 = await mkTxn('B2', { provider: 'PAYOS', status: 'PAID', amount: '5000.00', createdAt: '2001-05-03T00:00:00Z', paidAt: '2001-05-03T00:01:00Z' });
  await mkEvent('B2', { provider: 'MOMO', providerTransactionId: b2.ref, payload: { resultCode: 0, amount: 5000 }, createdAt: '2001-05-03T00:02:00Z', processed: true });
  await mkEvent('B2ok', { provider: 'PAYOS', providerTransactionId: b2.ref, payload: { code: '00', amount: 5000 }, createdAt: '2001-05-03T00:02:00Z', processed: true });

  // C. GATEWAY_SUCCESS_NOT_PAID: MoMo says resultCode 0 for the exact price, transaction still PENDING.
  const c = await mkTxn('C', { provider: 'MOMO', status: 'PENDING', amount: '50000.00', createdAt: '2001-05-04T00:00:00Z' });
  await mkEvent('C', { provider: 'MOMO', providerTransactionId: c.ref, payload: { resultCode: 0, amount: 50000, transId: 1, note: SECRET }, createdAt: '2001-05-04T00:05:00Z', processed: true });

  // D. REPORTED_AMOUNT_MISMATCH: PayOS says code 00 for 90000, the (PAID, unflagged) transaction is 100000.
  const d = await mkTxn('D', { provider: 'PAYOS', status: 'PAID', amount: '100000.00', createdAt: '2001-05-05T00:00:00Z', paidAt: '2001-05-05T00:01:00Z' });
  await mkEvent('D', { provider: 'PAYOS', providerTransactionId: d.ref, payload: { code: '00', amount: 90000, orderCode: 1 }, createdAt: '2001-05-05T00:01:00Z', processed: true });

  // E. Already flagged by gateway-discrepancies: ZaloPay for the wrong amount, transaction FAILED + metadata.gatewayDiscrepancy.
  const e = await mkTxn('E', {
    provider: 'ZALOPAY', status: 'FAILED', amount: '70000.00', createdAt: '2001-05-06T00:00:00Z',
    metadata: { gatewayDiscrepancy: { kind: 'AMOUNT_MISMATCH', resolved: false } },
  });
  await mkEvent('E', { provider: 'ZALOPAY', providerTransactionId: e.ref, payload: { app_trans_id: e.ref, amount: 1000 }, createdAt: '2001-05-06T00:01:00Z', processed: true });

  // F. PAID_WITHOUT_GATEWAY_EVENT: nothing stored at all.
  await mkTxn('F', { provider: 'VNPAY', status: 'PAID', amount: '250000.00', createdAt: '2001-05-07T00:00:00Z', paidAt: '2001-05-07T00:01:00Z' });
  // G. ... only an active-poll record (its payload is the QUERY response: must never be parsed as success/amount).
  const g = await mkTxn('G', { provider: 'PAYOS', status: 'PAID', amount: '60000.00', createdAt: '2001-05-08T00:00:00Z', paidAt: '2001-05-08T00:01:00Z' });
  await mkEvent('G', { provider: 'PAYOS', providerTransactionId: g.ref, eventId: `poll_${g.id}_1`, payload: { code: '00', amount: 1, status: 'PAID' }, createdAt: '2001-05-08T00:01:00Z', processed: true });
  // H. Exclusions that must NOT be flagged: MOCK provider, REFUND purpose, PAID outside the window.
  await mkTxn('H-mock', { provider: 'MOCK', status: 'PAID', amount: '1000.00', createdAt: '2001-05-09T00:00:00Z', paidAt: '2001-05-09T00:01:00Z' });
  await mkTxn('H-refund', { provider: 'VNPAY', status: 'PAID', amount: '1000.00', purpose: 'REFUND', createdAt: '2001-05-09T00:00:00Z', paidAt: '2001-05-09T00:01:00Z' });
  await mkTxn('H-out', { provider: 'VNPAY', status: 'PAID', amount: '1000.00', createdAt: '2001-04-01T00:00:00Z', paidAt: '2001-04-01T00:01:00Z' });

  // I. VNPay (x100): success, 300000 reported (30000000) vs a 200000 price; J: a failed VNPay notice must not classify.
  const i = await mkTxn('I', { provider: 'VNPAY', status: 'PAID', amount: '200000.00', createdAt: '2001-05-10T00:00:00Z', paidAt: '2001-05-10T00:01:00Z' });
  await mkEvent('I', {
    provider: 'VNPAY', providerTransactionId: i.ref, eventId: `vnpay_ipn:${randomUUID()}`,
    payload: { vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_Amount: '30000000' }, createdAt: '2001-05-10T00:01:00Z', processed: true,
  });
  const j = await mkTxn('J', { provider: 'VNPAY', status: 'FAILED', amount: '80000.00', createdAt: '2001-05-11T00:00:00Z' });
  await mkEvent('J', {
    provider: 'VNPAY', providerTransactionId: j.ref, eventId: `vnpay_ipn:${randomUUID()}`,
    payload: { vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_Amount: '1' }, createdAt: '2001-05-11T00:01:00Z', processed: true,
  });
  // K. Unreadable amounts are never flagged: a fractional VNPay figure and a non-numeric PayOS amount.
  const k1 = await mkTxn('K1', { provider: 'VNPAY', status: 'PAID', amount: '10000.00', createdAt: '2001-05-12T00:00:00Z', paidAt: '2001-05-12T00:01:00Z' });
  await mkEvent('K1', {
    provider: 'VNPAY', providerTransactionId: k1.ref, eventId: `vnpay_return:${randomUUID()}`,
    payload: { vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_Amount: '1000050' }, createdAt: '2001-05-12T00:01:00Z', processed: true,
  });
  const k2 = await mkTxn('K2', { provider: 'PAYOS', status: 'PAID', amount: '10000.00', createdAt: '2001-05-12T00:00:00Z', paidAt: '2001-05-12T00:01:00Z' });
  await mkEvent('K2', { provider: 'PAYOS', providerTransactionId: k2.ref, payload: { code: '00', amount: 'abc' }, createdAt: '2001-05-12T00:01:00Z', processed: true });

  // L. Cap: 101 orphans in July 2001.
  const capRows = Array.from({ length: 101 }, (_, n) => {
    const r = ref();
    refs.push(r);
    return {
      provider: 'ZALOPAY' as const,
      providerEventId: `zalopay_${randomUUID()}`,
      providerTransactionId: r,
      payload: { app_trans_id: r, amount: 1 },
      processedAt: T('2001-07-02T00:00:01Z'),
      createdAt: new Date(T('2001-07-02T00:00:00Z').getTime() + n * 1000),
    };
  });
  await prisma.paymentWebhookEvent.createMany({ data: capRows });

  // M. 10-minute grace: an unprocessed event created just now with a matching transaction is NOT yet reported.
  const m = await mkTxn('M', { provider: 'VNPAY', status: 'PENDING', amount: '9000.00', createdAt: new Date().toISOString() });
  await mkEvent('M', {
    provider: 'VNPAY', providerTransactionId: m.ref, eventId: `vnpay_ipn:${randomUUID()}`,
    payload: { vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_Amount: '900000' }, createdAt: new Date(),
  });
});

test.after(async () => {
  try {
    await prisma.paymentWebhookEvent.deleteMany({ where: { providerTransactionId: { in: refs } } });
    await prisma.paymentTransaction.deleteMany({ where: { id: { in: txnIds } } });
  } catch (err) {
    console.warn('cleanup skipped:', (err as Error).message);
  }
  await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((e) => (e ? reject(e) : resolve())));
  await prisma.$disconnect();
});

test('shape: L2 scope, five categories in order, ISO window, no payload / secret anywhere', async () => {
  const { text, body } = await report(FROM, TO);
  assert.equal(body.scope, 'L2');
  assert.equal(body.from, '2001-05-01T00:00:00.000Z');
  assert.equal(body.to, '2001-06-01T00:00:00.000Z');
  assert.ok(!Number.isNaN(Date.parse(body.generatedAt)));
  assert.deepEqual(
    body.categories.map((c: any) => c.code),
    ['WEBHOOK_UNPROCESSED', 'WEBHOOK_ORPHAN', 'GATEWAY_SUCCESS_NOT_PAID', 'REPORTED_AMOUNT_MISMATCH', 'PAID_WITHOUT_GATEWAY_EVENT'],
  );
  assert.deepEqual(body.categories.map((c: any) => c.severity), ['danger', 'warning', 'danger', 'danger', 'info']);
  for (const c of body.categories) {
    assert.ok(c.label.length > 0);
    assert.equal(typeof c.truncated, 'boolean');
    for (const it of c.items) assert.ok(it.note.length > 0);
  }
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        assert.notEqual(k, 'payload', `payload key at ${path}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(body, '$');
  assert.ok(!text.includes(SECRET), 'webhook payload content leaked');
});

test('WEBHOOK_UNPROCESSED: only the old unprocessed event WITH a transaction; retry count in the note; the 10-minute grace holds', async () => {
  const { body } = await report(FROM, TO);
  const c = cat(body, 'WEBHOOK_UNPROCESSED');
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].webhookEventId, ids['evt:A']);
  assert.equal(c.items[0].transactionId, ids.A);
  assert.equal(c.items[0].provider, 'VNPAY');
  assert.equal(c.items[0].transactionStatus, 'PENDING');
  assert.equal(c.items[0].amount, '150000.00');
  assert.ok(c.items[0].note.includes('3 lần'));
  assert.equal(body.counts.webhookUnprocessed, 1);

  const now = Date.now();
  const recent = await report(new Date(now - 2 * 3600e3).toISOString(), new Date(now + 3600e3).toISOString());
  assert.equal(itemFor(cat(recent.body, 'WEBHOOK_UNPROCESSED'), 'M', 'transactionId'), undefined, 'an event younger than 10 minutes must not be reported');
  // ... and its VNPay success is not "not paid" yet either (same grace).
  assert.equal(itemFor(cat(recent.body, 'GATEWAY_SUCCESS_NOT_PAID'), 'M', 'transactionId'), undefined);
});

test('WEBHOOK_ORPHAN: no transaction of the SAME provider + reference (another provider match does not count)', async () => {
  const { body } = await report(FROM, TO);
  const c = cat(body, 'WEBHOOK_ORPHAN');
  assert.equal(c.items.length, 2);
  const b = itemFor(c, 'evt:B', 'webhookEventId');
  assert.equal(b.transactionId, null);
  assert.equal(b.provider, 'ZALOPAY');
  assert.equal(b.amount, null);
  assert.equal(b.reportedAmount, '20000.00');
  assert.ok(itemFor(c, 'evt:B2', 'webhookEventId'), 'MoMo event whose reference belongs to a PayOS transaction');
  assert.equal(itemFor(c, 'evt:B2ok', 'webhookEventId'), undefined);
  assert.equal(body.counts.webhookOrphan, 2);
});

test('GATEWAY_SUCCESS_NOT_PAID: success event + transaction not PAID/REFUNDED + not already flagged', async () => {
  const { body } = await report(FROM, TO);
  const c = cat(body, 'GATEWAY_SUCCESS_NOT_PAID');
  assert.deepEqual(c.items.map((i: any) => i.transactionId), [ids.C]);
  assert.equal(c.items[0].transactionStatus, 'PENDING');
  assert.equal(c.items[0].reportedAmount, '50000.00');
  assert.equal(c.items[0].amount, '50000.00');
  // A (failed VNPay notice, PENDING), J (failed VNPay notice, FAILED) and E (flagged) must not be here.
  for (const k of ['A', 'J', 'E']) assert.equal(itemFor(c, k, 'transactionId'), undefined, k);
});

test('REPORTED_AMOUNT_MISMATCH: PayOS plain VND and VNPay x100, exact decimal strings; flagged / unreadable / failed / poll are excluded', async () => {
  const { body } = await report(FROM, TO);
  const c = cat(body, 'REPORTED_AMOUNT_MISMATCH');
  assert.deepEqual(c.items.map((i: any) => i.transactionId).sort(), [ids.D, ids.I].sort());
  const d = itemFor(c, 'D', 'transactionId');
  assert.equal(d.amount, '100000.00');
  assert.equal(d.reportedAmount, '90000.00');
  const i = itemFor(c, 'I', 'transactionId');
  assert.equal(i.amount, '200000.00');
  assert.equal(i.reportedAmount, '300000.00');
  for (const k of ['E', 'J', 'K1', 'K2', 'G']) assert.equal(itemFor(c, k, 'transactionId'), undefined, k);
  assert.equal(body.counts.reportedAmountMismatch, 2);
  // E is covered by the existing gateway-discrepancies list and counted separately, never double-listed.
  assert.equal(body.counts.coveredByGatewayDiscrepancies, 1);
});

test('PAID_WITHOUT_GATEWAY_EVENT: none vs poll-only; MOCK / REFUND / outside the window / transactions with an event are excluded', async () => {
  const { body } = await report(FROM, TO);
  const c = cat(body, 'PAID_WITHOUT_GATEWAY_EVENT');
  assert.deepEqual(c.items.map((i: any) => i.transactionId).sort(), [ids.F, ids.G].sort());
  const f = itemFor(c, 'F', 'transactionId');
  assert.equal(f.webhookEventId, null);
  assert.equal(f.reportedAmount, null);
  assert.equal(f.amount, '250000.00');
  assert.equal(f.transactionStatus, 'PAID');
  assert.ok(f.note.includes('Chưa có bất kỳ sự kiện nào'));
  assert.ok(itemFor(c, 'G', 'transactionId').note.includes('truy vấn chủ động'));
  for (const k of ['H-mock', 'H-refund', 'H-out', 'D', 'I', 'B2']) assert.equal(itemFor(c, k, 'transactionId'), undefined, k);
  assert.equal(body.counts.paidWithoutGatewayEvent, 2);
  assert.ok(body.counts.webhookEventsInRange >= 10);
  assert.ok(body.counts.paidGatewayTransactionsInRange >= 6);
});

test('cap: 101 orphans -> 100 items, truncated true, exact total in counts; the other categories are empty and not truncated', async () => {
  const { body } = await report(CAP_FROM, CAP_TO);
  const c = cat(body, 'WEBHOOK_ORPHAN');
  assert.equal(c.items.length, 100);
  assert.equal(c.truncated, true);
  assert.equal(body.counts.webhookOrphan, 101);
  assert.equal(body.counts.webhookEventsInRange, 101);
  for (const other of body.categories.filter((x: any) => x.code !== 'WEBHOOK_ORPHAN')) {
    assert.deepEqual(other.items, [], other.code);
    assert.equal(other.truncated, false);
  }
  const times = c.items.map((i: any) => Date.parse(i.createdAt));
  assert.deepEqual(times, [...times].sort((x, y) => y - x), 'newest first');
});

test('empty window: all categories empty, counts zero', async () => {
  const { body } = await report('2001-09-01T00:00:00Z', '2001-09-02T00:00:00Z');
  for (const c of body.categories) assert.deepEqual(c.items, []);
  const k = body.counts;
  assert.equal(k.webhookUnprocessed + k.webhookOrphan + k.gatewaySuccessNotPaid + k.reportedAmountMismatch + k.paidWithoutGatewayEvent, 0);
});

test('window validation reaches the client (to <= from, > 92 days -> 400 INVALID_QUERY) and the default window is 30 days', async () => {
  for (const qs of ['from=2001-05-02&to=2001-05-01', 'from=2001-01-01&to=2001-06-01']) {
    const res = await fetch(`${baseUrl}/admin/payments/gateway-reconciliation?${qs}`, { headers: ADMIN });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).code, 'INVALID_QUERY');
  }
  const res = await fetch(`${baseUrl}/admin/payments/gateway-reconciliation`, { headers: ADMIN });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(Date.parse(body.to) - Date.parse(body.from), 30 * 24 * 3600e3);
});
