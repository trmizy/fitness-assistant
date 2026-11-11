/**
 * BE-1 (G-04 / G-05 / G-14) - route-level contract of GET /admin/payments/transactions and /transactions/:id.
 *   evidence label: BACKEND INTEGRATION without a database (auth-service is a TEST FIXTURE; the read service is replaced,
 *   so nothing here reaches Postgres).
 *
 * Covers: admin-only (401 / 403), query validation (400 INVALID_QUERY), id validation (400 INVALID_ID),
 * 404 TRANSACTION_NOT_FOUND, that the validated query reaches the service with the documented defaults, and that the
 * static paths are not shadowed by the '/:id/...' POST routes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { prisma } from '../repositories/prisma';
import { adminTransactionsService } from '../services/admin-transactions.service';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4047';

const GOOD_ID = '11111111-1111-4111-8111-111111111111';
const calls: { list: unknown[]; detail: unknown[] } = { list: [], detail: [] };

adminTransactionsService.list = (async (q: unknown) => {
  calls.list.push(q);
  return { total: 0, limit: 25, offset: 0, hasMore: false, items: [] };
}) as typeof adminTransactionsService.list;
adminTransactionsService.detail = (async (id: string) => {
  calls.detail.push(id);
  return id === GOOD_ID ? ({ transaction: { id } } as never) : null;
}) as typeof adminTransactionsService.detail;

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';
const ADMIN = { Authorization: 'Bearer real-admin-token' };

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const a = String(req.headers.authorization || '');
      const role = a === 'Bearer real-admin-token' ? 'ADMIN' : a === 'Bearer real-customer-token' ? 'CUSTOMER' : null;
      if (role) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: { id: `u-${role}`, email: 'x@example.com', role } }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4047, '127.0.0.1', r));

  const { default: adminRoutes } = await import('../routes/admin.routes');
  const app = express();
  app.use(express.json());
  app.use('/admin/payments', adminRoutes);
  testApp = http.createServer(app);
  await new Promise<void>((r) => testApp.listen(0, '127.0.0.1', r));
  const address = testApp.address();
  if (!address || typeof address === 'string') throw new Error('failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((e) => (e ? reject(e) : resolve())));
  await prisma.$disconnect();
});

const get = (path: string, headers: Record<string, string> = ADMIN) => fetch(`${baseUrl}/admin/payments${path}`, { headers });

test('no token -> 401 on both routes', async () => {
  assert.equal((await get('/transactions', {})).status, 401);
  assert.equal((await get(`/transactions/${GOOD_ID}`, {})).status, 401);
});

test('non-admin (CUSTOMER) token -> 403 on both routes', async () => {
  const customer = { Authorization: 'Bearer real-customer-token' };
  assert.equal((await get('/transactions', customer)).status, 403);
  assert.equal((await get(`/transactions/${GOOD_ID}`, customer)).status, 403);
});

test('list: defaults reach the service (limit 25, offset 0); the static path is not shadowed', async () => {
  calls.list.length = 0;
  const res = await get('/transactions');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { total: 0, limit: 25, offset: 0, hasMore: false, items: [] });
  assert.equal(calls.list.length, 1);
  const q = calls.list[0] as Record<string, unknown>;
  assert.equal(q.limit, 25);
  assert.equal(q.offset, 0);
  assert.equal(q.q, undefined);
});

test('list: a valid full query is parsed (trimmed q, enums, dates as Date, numbers as numbers)', async () => {
  calls.list.length = 0;
  const res = await get(
    '/transactions?q=%20abc%20&status=PAID&provider=VNPAY&purpose=PT_CONTRACT&from=2026-11-01&to=2026-11-10T00:00:00Z&limit=100&offset=100000',
  );
  assert.equal(res.status, 200);
  const q = calls.list[0] as Record<string, unknown>;
  assert.equal(q.q, 'abc');
  assert.equal(q.status, 'PAID');
  assert.equal(q.provider, 'VNPAY');
  assert.equal(q.purpose, 'PT_CONTRACT');
  assert.ok(q.from instanceof Date && q.to instanceof Date);
  assert.equal(q.limit, 100);
  assert.equal(q.offset, 100000);
});

const BAD_QUERIES: Array<[string, string]> = [
  ['limit=0', 'limit below 1'],
  ['limit=101', 'limit above 100'],
  ['limit=abc', 'limit not a number'],
  ['limit=1.5', 'limit not an integer'],
  ['offset=-1', 'negative offset'],
  ['offset=100001', 'offset above 100000'],
  ['foo=bar', 'unknown key'],
  ['from=not-a-date', 'bad from'],
  ['to=2026-13-45', 'bad to'],
  ['from=2026-11-10&to=2026-11-01', 'from after to'],
  ['status=WRONG', 'unknown status'],
  ['provider=WRONG', 'unknown provider'],
  ['purpose=WRONG', 'unknown purpose'],
  ['q=', 'empty q'],
  ['q=%20%20', 'blank q'],
  [`q=${'x'.repeat(101)}`, 'q over 100 chars'],
  ['status=PAID&status=FAILED', 'repeated key (array)'],
];
for (const [qs, why] of BAD_QUERIES) {
  test(`list: ${why} (?${qs.length > 40 ? qs.slice(0, 40) + '...' : qs}) -> 400 INVALID_QUERY`, async () => {
    calls.list.length = 0;
    const res = await get(`/transactions?${qs}`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(body.code, 'INVALID_QUERY');
    assert.ok(body.error.length > 0);
    assert.equal(calls.list.length, 0, 'service must not be called for an invalid query');
  });
}

test('detail: a non-uuid id -> 400 INVALID_ID and the service is not called', async () => {
  calls.detail.length = 0;
  for (const bad of ['abc', '123', 'not-a-uuid-at-all', `${GOOD_ID}x`]) {
    const res = await get(`/transactions/${bad}`);
    assert.equal(res.status, 400, bad);
    assert.equal(((await res.json()) as { code: string }).code, 'INVALID_ID');
  }
  assert.equal(calls.detail.length, 0);
});

test('detail: unknown uuid -> 404 TRANSACTION_NOT_FOUND; known uuid -> 200', async () => {
  const miss = await get('/transactions/22222222-2222-4222-8222-222222222222');
  assert.equal(miss.status, 404);
  const body = (await miss.json()) as { error: string; code: string };
  assert.equal(body.code, 'TRANSACTION_NOT_FOUND');
  assert.ok(body.error.length > 0);

  const hit = await get(`/transactions/${GOOD_ID}`);
  assert.equal(hit.status, 200);
  assert.deepEqual(await hit.json(), { transaction: { id: GOOD_ID } });
});

test('a service failure -> 500 with a Vietnamese error and a stable code (no stack/message leak)', async () => {
  const original = adminTransactionsService.list;
  adminTransactionsService.list = (async () => {
    throw new Error('secret internal detail');
  }) as typeof adminTransactionsService.list;
  try {
    const res = await get('/transactions');
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes('secret internal detail'));
    assert.equal((JSON.parse(text) as { code: string }).code, 'TRANSACTIONS_LIST_FAILED');
  } finally {
    adminTransactionsService.list = original;
  }
});
