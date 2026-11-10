/**
 * B8 (L2) - route-level contract of GET /admin/payments/gateway-reconciliation.
 *   evidence label: BACKEND INTEGRATION without a database (auth-service is a TEST FIXTURE; the report service is replaced,
 *   so nothing here reaches Postgres).
 *
 * Covers: admin-only (401 / 403), query validation (400 INVALID_QUERY: unknown key, bad dates, from >= to, > 92 days),
 * that the validated query reaches the service, that a window error from the service is a 400, and a 500 that leaks nothing.
 * The router is mounted BEFORE the generic admin router exactly like app.ts, so this also proves it is not shadowed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { prisma } from '../repositories/prisma';
import {
  adminGatewayReconciliationService,
  GatewayWindowError,
  resolveGatewayWindow,
} from '../services/admin-gateway-reconciliation.service';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4057';

const calls: unknown[] = [];
adminGatewayReconciliationService.report = (async (q: unknown) => {
  calls.push(q);
  return { scope: 'L2', from: 'f', to: 't', generatedAt: 'g', counts: {}, categories: [] };
}) as unknown as typeof adminGatewayReconciliationService.report;

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
  await new Promise<void>((r) => authServer.listen(4057, '127.0.0.1', r));

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
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((e) => (e ? reject(e) : resolve())));
  await prisma.$disconnect();
});

const get = (qs = '', headers: Record<string, string> = ADMIN) => fetch(`${baseUrl}/admin/payments/gateway-reconciliation${qs}`, { headers });

test('no token -> 401; non-admin token -> 403', async () => {
  assert.equal((await get('', {})).status, 401);
  assert.equal((await get('', { Authorization: 'Bearer real-customer-token' })).status, 403);
  assert.equal((await get('', { Authorization: 'Bearer nope' })).status, 401);
});

test('admin: 200, and with no query the service receives an empty (defaulted later) query', async () => {
  calls.length = 0;
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { scope: string }).scope, 'L2');
  assert.deepEqual(calls[0], {});
});

test('admin: a valid from/to is parsed to Dates', async () => {
  calls.length = 0;
  const res = await get('?from=2026-10-01&to=2026-11-01T00:00:00Z');
  assert.equal(res.status, 200);
  const q = calls[0] as { from: Date; to: Date };
  assert.ok(q.from instanceof Date && q.to instanceof Date);
  assert.equal(q.from.toISOString(), '2026-10-01T00:00:00.000Z');
});

const BAD: Array<[string, string]> = [
  ['foo=bar', 'unknown key'],
  ['from=not-a-date', 'bad from'],
  ['to=2026-13-45', 'bad to'],
  ['from=2026-01-01&from=2026-01-02', 'repeated key'],
  ['limit=5', 'unknown key limit'],
];
for (const [qs, why] of BAD) {
  test(`${why} (?${qs}) -> 400 INVALID_QUERY and the service is not called`, async () => {
    calls.length = 0;
    const res = await get(`?${qs}`);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, 'INVALID_QUERY');
    assert.equal(calls.length, 0);
  });
}

test('a window the service rejects (from >= to, or > 92 days) -> 400 INVALID_QUERY', async () => {
  const original = adminGatewayReconciliationService.report;
  adminGatewayReconciliationService.report = (async () => {
    throw new GatewayWindowError('x');
  }) as typeof adminGatewayReconciliationService.report;
  try {
    const res = await get('?from=2026-11-10&to=2026-11-01');
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, 'INVALID_QUERY');
  } finally {
    adminGatewayReconciliationService.report = original;
  }
});

test('a service failure -> 500 with a Vietnamese error and a stable code (no message leak)', async () => {
  const original = adminGatewayReconciliationService.report;
  adminGatewayReconciliationService.report = (async () => {
    throw new Error('secret internal detail');
  }) as typeof adminGatewayReconciliationService.report;
  try {
    const res = await get();
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes('secret internal detail'));
    assert.equal((JSON.parse(text) as { code: string }).code, 'GATEWAY_RECONCILIATION_FAILED');
  } finally {
    adminGatewayReconciliationService.report = original;
  }
});

test('resolveGatewayWindow: default = last 30 days ending now; max 92 days; from must precede to', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const d = resolveGatewayWindow({}, now);
  assert.equal(d.to.toISOString(), now.toISOString());
  assert.equal(d.from.toISOString(), '2026-10-11T12:00:00.000Z');
  assert.doesNotThrow(() => resolveGatewayWindow({ from: new Date('2026-08-10T12:00:00Z'), to: now }, now)); // exactly 92 days
  assert.throws(() => resolveGatewayWindow({ from: new Date('2026-08-09T12:00:00Z'), to: now }, now), GatewayWindowError);
  assert.throws(() => resolveGatewayWindow({ from: now, to: now }, now), GatewayWindowError);
  assert.throws(() => resolveGatewayWindow({ from: new Date('2026-11-11T00:00:00Z') }, now), GatewayWindowError);
});
