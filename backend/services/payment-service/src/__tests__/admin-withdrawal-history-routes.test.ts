/**
 * G-08 - route-level contract of GET /admin/payments/withdrawal-history.
 *   evidence label: BACKEND INTEGRATION without a database (auth-service is a TEST FIXTURE; the read service is replaced,
 *   so nothing here reaches Postgres).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { prisma } from '../repositories/prisma';
import { adminWithdrawalHistoryService } from '../services/admin-withdrawal-history.service';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4151';

const calls: unknown[] = [];
adminWithdrawalHistoryService.list = (async (q: unknown) => {
  calls.push(q);
  return { total: 0, limit: 25, offset: 0, hasMore: false, items: [] };
}) as typeof adminWithdrawalHistoryService.list;

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
  await new Promise<void>((r) => authServer.listen(4151, '127.0.0.1', r));

  const { default: routes } = await import('../routes/admin-withdrawal-history.routes');
  const app = express();
  app.use(express.json());
  app.use('/admin/payments/withdrawal-history', routes);
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

const get = (qs: string, headers: Record<string, string> = ADMIN) =>
  fetch(`${baseUrl}/admin/payments/withdrawal-history${qs}`, { headers });

test('no token -> 401', async () => {
  assert.equal((await get('?status=PAID', {})).status, 401);
});

test('non-admin (CUSTOMER) -> 403 and the service is not called', async () => {
  calls.length = 0;
  assert.equal((await get('?status=PAID', { Authorization: 'Bearer real-customer-token' })).status, 403);
  assert.equal(calls.length, 0);
});

test('defaults reach the service (limit 25, offset 0)', async () => {
  calls.length = 0;
  const res = await get('?status=REJECTED');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { total: 0, limit: 25, offset: 0, hasMore: false, items: [] });
  const q = calls[0] as Record<string, unknown>;
  assert.equal(q.status, 'REJECTED');
  assert.equal(q.limit, 25);
  assert.equal(q.offset, 0);
  assert.equal(q.q, undefined);
});

test('a valid full query is parsed (trimmed q, enums, dates as Date, numbers as numbers)', async () => {
  calls.length = 0;
  const res = await get('?status=PAID&ownerType=PT&q=%20abc%20&from=2026-11-01&to=2026-11-10T00:00:00Z&limit=100&offset=100000');
  assert.equal(res.status, 200);
  const q = calls[0] as Record<string, unknown>;
  assert.equal(q.status, 'PAID');
  assert.equal(q.ownerType, 'PT');
  assert.equal(q.q, 'abc');
  assert.ok(q.from instanceof Date && q.to instanceof Date);
  assert.equal(q.limit, 100);
  assert.equal(q.offset, 100000);
});

const BAD_QUERIES: Array<[string, string]> = [
  ['', 'status missing'],
  ['status=PENDING', 'status PENDING (open requests are not history)'],
  ['status=APPROVED', 'status APPROVED'],
  ['status=WRONG', 'unknown status'],
  ['status=PAID&ownerType=WRONG', 'unknown ownerType'],
  ['status=PAID&limit=0', 'limit below 1'],
  ['status=PAID&limit=101', 'limit above 100'],
  ['status=PAID&limit=1.5', 'limit not an integer'],
  ['status=PAID&offset=-1', 'negative offset'],
  ['status=PAID&offset=100001', 'offset above 100000'],
  ['status=PAID&foo=bar', 'unknown key'],
  ['status=PAID&from=not-a-date', 'bad from'],
  ['status=PAID&from=2026-11-10&to=2026-11-01', 'from after to'],
  ['status=PAID&q=', 'empty q'],
  ['status=PAID&q=%20%20', 'blank q'],
  [`status=PAID&q=${'x'.repeat(101)}`, 'q over 100 chars'],
  ['status=PAID&status=REJECTED', 'repeated key (array)'],
];
for (const [qs, why] of BAD_QUERIES) {
  test(`${why} -> 400 INVALID_QUERY`, async () => {
    calls.length = 0;
    const res = await get(qs ? `?${qs}` : '');
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(body.code, 'INVALID_QUERY');
    assert.ok(body.error.length > 0);
    assert.equal(calls.length, 0, 'service must not be called for an invalid query');
  });
}

test('a service failure -> 500 with a stable code and no internal message leak', async () => {
  const original = adminWithdrawalHistoryService.list;
  adminWithdrawalHistoryService.list = (async () => {
    throw new Error('secret internal detail');
  }) as typeof adminWithdrawalHistoryService.list;
  try {
    const res = await get('?status=PAID');
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes('secret internal detail'));
    assert.equal((JSON.parse(text) as { code: string }).code, 'WITHDRAWAL_HISTORY_FAILED');
  } finally {
    adminWithdrawalHistoryService.list = original;
  }
});
