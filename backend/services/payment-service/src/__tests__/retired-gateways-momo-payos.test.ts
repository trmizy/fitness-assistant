/**
 * MOMO and PAYOS are retired gateways (owner decision 2026-11-11), the same way MOCK was: the PaymentProviderType enum
 * values stay so old rows remain readable, the provider code is gone, and every entry point refuses them.
 *
 *   evidence label: BACKEND INTEGRATION without a test database - the real routers are served over real HTTP, DATABASE_URL
 *   points at an unreachable host, and the webhook / transaction repositories are replaced by spies that FAIL the test if
 *   anything touches them. auth-service is a TEST FIXTURE (a stub that verifies one token).
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

process.env.DATABASE_URL = 'postgresql://u:p@retired-gw.internal-host.invalid:5432/db?schema=public&connect_timeout=3';
process.env.INTERNAL_SERVICE_SECRET = 'retired-gw-internal-secret';
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4154';
process.env.VNPAY_TMN_CODE = 'RGTMN';
process.env.VNPAY_HASH_SECRET = 'retired-gw-hash-secret';
// Even fully configured, a retired gateway must stay refused: the credentials are not what gates it.
process.env.MOMO_PARTNER_CODE = 'X';
process.env.MOMO_ACCESS_KEY = 'X';
process.env.MOMO_SECRET_KEY = 'X';
process.env.PAYOS_CLIENT_ID = 'X';
process.env.PAYOS_API_KEY = 'X';
process.env.PAYOS_CHECKSUM_KEY = 'X';

import { logger } from '@gym-coach/shared';
import { getProvider, providerConfigStatus, isRemovedProvider } from '../services/payment.service';
import { pollAndSettle } from '../services/webhook.service';
import { webhookRepository } from '../repositories/webhook.repository';
import { transactionRepository } from '../repositories/transaction.repository';
import { prisma } from '../repositories/prisma';
import { failureMessage } from '../utils/safe-error';

const SERVICE = { 'x-service-secret': 'retired-gw-internal-secret', 'Content-Type': 'application/json' };
const CLIENT = { Authorization: 'Bearer retired-gw-token', 'Content-Type': 'application/json' };
const RETIRED = ['MOMO', 'PAYOS'] as const;

const warnings: string[] = [];
mock.method(logger, 'warn', (...a: unknown[]) => void warnings.push(JSON.stringify(a)));
const dbTouches: string[] = [];
const trap = (name: string) => async () => {
  dbTouches.push(name);
  throw new Error(`DB touched: ${name}`);
};
mock.method(webhookRepository, 'upsert', trap('webhookRepository.upsert'));
mock.method(transactionRepository, 'findByProviderTransactionId', trap('transactionRepository.findByProviderTransactionId'));
mock.method(transactionRepository, 'findByIdempotencyKey', trap('transactionRepository.findByIdempotencyKey'));
mock.method(transactionRepository, 'create', trap('transactionRepository.create'));

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const ok = String(req.headers.authorization || '') === 'Bearer retired-gw-token';
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { user: { id: 'RG-user', email: 'rg@example.com', role: 'CLIENT' } } : { error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4154, '127.0.0.1', r));
  const { default: internalRoutes } = await import('../routes/internal.routes');
  const { default: paymentRoutes } = await import('../routes/payment.routes');
  const { default: webhookRoutes } = await import('../routes/webhook.routes');
  const app = express();
  // The real mount order of app.ts: the webhook door gets the raw body, everything else JSON.
  app.use('/payments/webhook', express.raw({ type: '*/*' }), webhookRoutes);
  app.use(express.json());
  app.use('/me/payments', paymentRoutes);
  app.use('/internal', internalRoutes);
  testApp = http.createServer(app);
  await new Promise<void>((r) => testApp.listen(0, '127.0.0.1', r));
  const address = testApp.address();
  if (!address || typeof address === 'string') throw new Error('failed to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((e) => (e ? reject(e) : resolve())));
  await prisma.$disconnect().catch(() => undefined);
});

for (const name of RETIRED) {
  test(`${name}: getProvider throws 400, isRemovedProvider is true, providerConfigStatus is configured:false (even with credentials set)`, () => {
    assert.throws(
      () => getProvider(name),
      (e: any) => e.status === 400 && /has been removed — use VNPAY or ZALOPAY/.test(e.message),
    );
    assert.throws(() => getProvider(name.toLowerCase()), (e: any) => e.status === 400);
    assert.equal(isRemovedProvider(name), true);
    const status = providerConfigStatus(name);
    assert.equal(status.configured, false);
    assert.match(status.missing.join(' '), /has been removed/);
  });
}

test('the live gateways are not marked removed', () => {
  assert.equal(isRemovedProvider('VNPAY'), false);
  assert.equal(isRemovedProvider('ZALOPAY'), false);
});

test('GET /me/payments/methods lists no MOMO and no PAYOS; VNPAY and ZALOPAY remain', async () => {
  const res = await fetch(`${baseUrl}/me/payments/methods`, { headers: CLIENT });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: { methods: Array<{ provider: string }>; defaultProvider: string | null } };
  const providers = body.data.methods.map((m) => m.provider);
  assert.deepEqual(providers, ['VNPAY', 'ZALOPAY']);
  assert.notEqual(body.data.defaultProvider, 'MOMO');
  assert.notEqual(body.data.defaultProvider, 'PAYOS');
});

const CHECKOUT_BODY = {
  purpose: 'GYM_MEMBERSHIP',
  relatedEntityType: 'GYM_MEMBERSHIP',
  relatedEntityId: 'RG-membership',
  amount: 100000,
  rates: { platformRate: '0.1000', ptRate: '0', gymRate: '0.9000' },
  parties: { ptUserId: 'RG-gym', gymId: 'RG-gym', clientUserId: 'RG-client' },
  idempotencyKey: 'RG-checkout-key',
  initiatedBy: 'RG-client',
  sourceService: 'gym-service',
};

for (const name of RETIRED) {
  test(`internal checkout with provider ${name} -> 400 PROVIDER_NOT_CONFIGURED, fixed message, no DB access`, async () => {
    dbTouches.length = 0;
    const res = await fetch(`${baseUrl}/internal/payments/checkout`, {
      method: 'POST',
      headers: SERVICE,
      body: JSON.stringify({ ...CHECKOUT_BODY, provider: name }),
    });
    assert.equal(res.status, 400);
    const json = (await res.json()) as { success: boolean; error: { code: string; message: string } };
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'PROVIDER_NOT_CONFIGURED');
    assert.equal(json.error.message, failureMessage('PROVIDER_NOT_CONFIGURED'));
    assert.deepEqual(dbTouches, []);
  });
}

for (const name of RETIRED) {
  for (const spelling of [name, name.toLowerCase()]) {
    test(`POST /payments/webhook/${spelling} is refused (404 UNKNOWN_WEBHOOK_PROVIDER), logged, and the DB is not touched`, async () => {
      dbTouches.length = 0;
      warnings.length = 0;
      const res = await fetch(`${baseUrl}/payments/webhook/${spelling}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'x', resultCode: 0, amount: 100000, code: '00', data: { amount: 100000 } }),
      });
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { success: false, error: { code: 'UNKNOWN_WEBHOOK_PROVIDER' } });
      assert.deepEqual(dbTouches, []);
      assert.ok(warnings.some((w) => w.includes(`retired gateway ${name}`)), 'the stray callback was not logged');
    });
  }
}

for (const name of RETIRED) {
  test(`pollAndSettle on a stray open ${name} row answers UNSUPPORTED instead of throwing (jobs/sync never crash on it)`, async () => {
    const stray = {
      id: 'RG-stray',
      status: 'PENDING',
      provider: name,
      providerTransactionId: 'RG-ref',
      amount: 1000,
      createdAt: new Date(),
      metadata: null,
    } as never;
    assert.equal(await pollAndSettle(stray), 'UNSUPPORTED');
    assert.deepEqual(dbTouches, []);
  });
}
