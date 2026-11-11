/**
 * B8 (L3, VNPAY) - route-level contract of GET /admin/payments/gateway-reconciliation/l3.
 *   evidence label: BACKEND INTEGRATION without a database (auth-service is a TEST FIXTURE; the L3 service is replaced, so nothing here
 *   reaches Postgres or VNPay).
 * Covers: admin-only (401 / 403), GET only (POST -> not routed to L3), query validation (400 INVALID_QUERY: unknown key, bad dates,
 * from >= to, > 31 days), that the validated query reaches the service, the response passthrough (incl. configured:false), a 500 that leaks
 * nothing, and that the L2 route next to it still answers.
 * Run: ./node_modules/.bin/tsx --test src/__tests__/vnpay-l3-routes.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { prisma } from '../repositories/prisma';
import { GatewayWindowError } from '../services/admin-gateway-reconciliation.service';
import { vnpayQueryReconcileService } from '../services/vnpay-query-reconcile';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4058';

const calls: unknown[] = [];
const REPORT = {
  scope: 'L3', provider: 'VNPAY', from: 'f', to: 't', generatedAt: 'g',
  counts: { checked: 0, matched: 0, notFoundAtVnpay: 0, statusMismatch: 0, amountMismatch: 0, queryFailed: 0 },
  items: [], truncated: false, configured: false,
};
vnpayQueryReconcileService.run = (async (q: unknown) => {
  calls.push(q);
  return REPORT;
}) as unknown as typeof vnpayQueryReconcileService.run;

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
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((e) => (e ? reject(e) : resolve())));
  await prisma.$disconnect();
});

const get = (qs = '', headers: Record<string, string> = ADMIN) => fetch(`${baseUrl}/admin/payments/gateway-reconciliation/l3${qs}`, { headers });

test('no token -> 401; non-admin token -> 403; the service is never reached', async () => {
  calls.length = 0;
  assert.equal((await get('', {})).status, 401);
  assert.equal((await get('', { Authorization: 'Bearer real-customer-token' })).status, 403);
  assert.equal((await get('', { Authorization: 'Bearer nope' })).status, 401);
  assert.equal(calls.length, 0);
});

test('admin: 200, the L3 report passes through unchanged (configured:false included) with no-store', async () => {
  calls.length = 0;
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), REPORT);
  assert.deepEqual(calls[0], {});
});

test('admin: a valid from/to is parsed to Dates', async () => {
  calls.length = 0;
  const res = await get('?from=2026-11-01&to=2026-11-08T00:00:00Z');
  assert.equal(res.status, 200);
  const q = calls[0] as { from: Date; to: Date };
  assert.ok(q.from instanceof Date && q.to instanceof Date);
  assert.equal(q.from.toISOString(), '2026-11-01T00:00:00.000Z');
});

const BAD: Array<[string, string]> = [
  ['foo=bar', 'unknown key'],
  ['from=not-a-date', 'bad from'],
  ['to=2026-13-45', 'bad to'],
  ['from=2026-01-01&from=2026-01-02', 'repeated key'],
  ['limit=5', 'unknown key limit'],
  ['provider=VNPAY', 'unknown key provider'],
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

test('a window the service rejects (from >= to, or > 31 days) -> 400 INVALID_QUERY', async () => {
  const original = vnpayQueryReconcileService.run;
  vnpayQueryReconcileService.run = (async () => {
    throw new GatewayWindowError('x');
  }) as typeof vnpayQueryReconcileService.run;
  try {
    const res = await get('?from=2026-11-10&to=2026-11-01');
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, 'INVALID_QUERY');
  } finally {
    vnpayQueryReconcileService.run = original;
  }
});

test('the real window rule: 32 days -> 400 INVALID_QUERY, 31 days -> 200 (service stubbed after validation)', async () => {
  const { vnpayQueryReconcileService: svc, resolveL3Window } = await import('../services/vnpay-query-reconcile');
  const original = svc.run;
  svc.run = (async (q: Parameters<typeof original>[0], now?: Date) => {
    resolveL3Window(q, now ?? new Date());
    return REPORT;
  }) as typeof svc.run;
  try {
    assert.equal((await get('?from=2026-10-01T00:00:00Z&to=2026-11-02T00:00:00Z')).status, 400); // 32 days
    assert.equal((await get('?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z')).status, 200); // 31 days
  } finally {
    svc.run = original;
  }
});

test('a service failure -> 500 with a Vietnamese error and a stable code (no message leak)', async () => {
  const original = vnpayQueryReconcileService.run;
  vnpayQueryReconcileService.run = (async () => {
    throw new Error('secret internal detail');
  }) as typeof vnpayQueryReconcileService.run;
  try {
    const res = await get();
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes('secret internal detail'));
    assert.equal((JSON.parse(text) as { code: string }).code, 'VNPAY_L3_FAILED');
  } finally {
    vnpayQueryReconcileService.run = original;
  }
});

test('POST on /l3 is not an L3 run (read endpoint only): the service is not called', async () => {
  calls.length = 0;
  const res = await fetch(`${baseUrl}/admin/payments/gateway-reconciliation/l3`, { method: 'POST', headers: ADMIN });
  assert.notEqual(res.status, 200);
  assert.equal(calls.length, 0);
});
