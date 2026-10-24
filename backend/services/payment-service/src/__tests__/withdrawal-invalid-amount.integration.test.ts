/**
 * B28 — a non-numeric withdrawal amount ("abc") used to reach Prisma.Decimal inside
 * withdrawalService.requestWithdrawal and surface as HTTP 500 [DecimalError]. The route layer now
 * answers 400 INVALID_AMOUNT before the service is called.
 *
 *   evidence label: BACKEND INTEGRATION (real express routers; the auth-service that wallet.routes
 *   verifies tokens against is a stub). The rejected requests never reach the database.
 *
 * Run THIS FILE ALONE (siblings write to the shared ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/withdrawal-invalid-amount.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';

const canRun = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const skipOpts = { skip: canRun ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4024';

let authServer: http.Server;
let appServer: http.Server;
let baseUrl = '';
let prisma: (typeof import('../repositories/prisma'))['prisma'];

test.before(async () => {
  if (!canRun) return;
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: { id: 'pt-invalid-amount', email: 'pt@example.com', role: 'PT' } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => authServer.listen(4024, '127.0.0.1', resolve));
  prisma = (await import('../repositories/prisma')).prisma;
  const walletRoutes = (await import('../routes/wallet.routes')).default;
  const internalRoutes = (await import('../routes/internal.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/me', walletRoutes);
  app.use('/internal', internalRoutes);
  appServer = http.createServer(app);
  await new Promise<void>((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const address = appServer.address();
  if (!address || typeof address === 'string') throw new Error('failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (appServer) await new Promise<void>((resolve) => appServer.close(() => resolve()));
  if (authServer) await new Promise<void>((resolve) => authServer.close(() => resolve()));
  if (prisma) await prisma.$disconnect();
});

async function post(path: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const SERVICE_SECRET = { 'x-service-secret': 'dev_internal_service_secret_change_in_production' };

for (const bad of ['abc', '12abc', 'Infinity', 'NaN', '  ']) {
  test(`POST /me/withdrawals with amount ${JSON.stringify(bad)} -> 400 INVALID_AMOUNT (not 500)`, skipOpts, async () => {
    const r = await post('/me/withdrawals', { amount: bad, payoutInfo: 'Bank ABC 0123' }, { authorization: 'Bearer tok' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'INVALID_AMOUNT');
  });
}

test('POST /internal/withdrawals/gym/:gymId with amount "abc" -> 400 INVALID_AMOUNT too', skipOpts, async () => {
  const r = await post('/internal/withdrawals/gym/gym-invalid-amount', { amount: 'abc', payoutInfo: 'Bank ABC 0123' }, SERVICE_SECRET);
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'INVALID_AMOUNT');
});
