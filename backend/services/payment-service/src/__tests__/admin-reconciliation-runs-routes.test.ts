/**
 * G-06 - route-level contract of /admin/payments/reconciliation, GET + POST /reconciliation/runs that needs NO database.
 *   evidence label: BACKEND INTEGRATION without a database (auth-service is a TEST FIXTURE; nothing here reaches Postgres:
 *   every request below is refused (401 / 403 / 400) before the service is called).
 *
 * Covers: admin-only on all three routes (401 / 403), query validation of GET /runs (400 INVALID_QUERY, stable { error, code } body),
 * POST /runs refuses a non-empty body (400 INVALID_BODY) before touching the database, the pure query schema defaults/limits,
 * and the pure job-dedupe rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { prisma } from '../repositories/prisma';
import { reconciliationRunsQuerySchema, shouldRecordJobRun, JOB_HEARTBEAT_MS } from '../services/reconcile.service';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4059';

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
  await new Promise<void>((r) => authServer.listen(4059, '127.0.0.1', r));

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
const post = (path: string, headers: Record<string, string> = ADMIN, body?: string, contentType = 'application/json') =>
  fetch(`${baseUrl}/admin/payments${path}`, { method: 'POST', headers: body === undefined ? headers : { ...headers, 'Content-Type': contentType }, body });

test('no token -> 401 on the three reconciliation routes', async () => {
  assert.equal((await get('/reconciliation', {})).status, 401);
  assert.equal((await get('/reconciliation/runs', {})).status, 401);
  assert.equal((await post('/reconciliation/runs', {})).status, 401);
});

test('non-admin (CUSTOMER) token -> 403 on the three reconciliation routes', async () => {
  const customer = { Authorization: 'Bearer real-customer-token' };
  assert.equal((await get('/reconciliation', customer)).status, 403);
  assert.equal((await get('/reconciliation/runs', customer)).status, 403);
  assert.equal((await post('/reconciliation/runs', customer)).status, 403);
});

for (const [body, type, why] of [
  ['{"adminId":"someone-else"}', 'application/json', 'JSON object with a key'],
  ['[1]', 'application/json', 'JSON array'],
  ['please run', 'text/plain', 'text body'],
] as const) {
  test(`POST runs: ${why} -> 400 INVALID_BODY (before any database access)`, async () => {
    const res = await post('/reconciliation/runs', ADMIN, body, type);
    assert.equal(res.status, 400);
    const j = (await res.json()) as { error: string; code: string };
    assert.equal(j.code, 'INVALID_BODY');
    assert.ok(j.error.length > 0);
  });
}

test('job dedupe rule (pure): first / changed status / changed drift / heartbeat / unchanged', () => {
  const now = new Date('2026-11-11T10:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const bal = { status: 'BALANCED', drift: '0.00' };
  assert.deepEqual(shouldRecordJobRun(bal, null, null, now), { record: true, reason: 'FIRST' });
  assert.deepEqual(shouldRecordJobRun(bal, { status: 'DRIFT', drift: '-5.00' }, ago(60_000), now), { record: true, reason: 'CHANGED' });
  assert.deepEqual(shouldRecordJobRun({ status: 'DRIFT', drift: '-6.00' }, { status: 'DRIFT', drift: '-5.00' }, ago(60_000), now), { record: true, reason: 'CHANGED' });
  assert.deepEqual(shouldRecordJobRun({ status: 'ERROR', drift: null }, bal, ago(60_000), now), { record: true, reason: 'CHANGED' });
  assert.deepEqual(shouldRecordJobRun(bal, bal, ago(5 * 60_000), now), { record: false, reason: 'UNCHANGED' });
  assert.deepEqual(shouldRecordJobRun(bal, bal, ago(JOB_HEARTBEAT_MS), now), { record: false, reason: 'UNCHANGED' }, 'exactly 60 min is not yet older');
  assert.deepEqual(shouldRecordJobRun(bal, bal, ago(JOB_HEARTBEAT_MS + 1), now), { record: true, reason: 'HEARTBEAT' });
  assert.deepEqual(shouldRecordJobRun(bal, bal, null, now), { record: true, reason: 'HEARTBEAT' }, 'unchanged but no JOB run yet (latest was an admin run)');
  assert.deepEqual(shouldRecordJobRun({ status: 'ERROR', drift: null }, { status: 'ERROR', drift: null }, ago(60_000), now), { record: false, reason: 'UNCHANGED' });
});

const BAD_QUERIES: Array<[string, string]> = [
  ['limit=0', 'limit below 1'],
  ['limit=101', 'limit above 100'],
  ['limit=abc', 'limit not a number'],
  ['limit=1.5', 'limit not an integer'],
  ['offset=-1', 'negative offset'],
  ['offset=100001', 'offset above 100000'],
  ['status=WRONG', 'unknown status'],
  ['status=balanced', 'status is case-sensitive'],
  ['foo=bar', 'unknown key'],
  ['status=DRIFT&status=ERROR', 'repeated key (array)'],
];
for (const [qs, why] of BAD_QUERIES) {
  test(`runs: ${why} (?${qs}) -> 400 INVALID_QUERY`, async () => {
    const res = await get(`/reconciliation/runs?${qs}`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(body.code, 'INVALID_QUERY');
    assert.ok(body.error.length > 0);
  });
}

test('runs query schema: defaults (limit 20, offset 0, no status) and the allowed edges', () => {
  assert.deepEqual(reconciliationRunsQuerySchema.parse({}), { limit: 20, offset: 0 });
  assert.deepEqual(reconciliationRunsQuerySchema.parse({ limit: '1', offset: '0', status: 'BALANCED' }), { limit: 1, offset: 0, status: 'BALANCED' });
  assert.deepEqual(reconciliationRunsQuerySchema.parse({ limit: '100', offset: '100000', status: 'ERROR' }), { limit: 100, offset: 100000, status: 'ERROR' });
});
