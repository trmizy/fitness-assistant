/**
 * W11 - POST /admin/payments/:transactionId/retry-activation must not put the raw downstream/internal error text in the JSON body.
 *   evidence label: BACKEND INTEGRATION without a database (auth-service and the gym/user downstream are TEST FIXTURES; the
 *   transaction repository is replaced, so nothing here reaches Postgres).
 *
 * Covers: 502 RETRY_FAILED keeps status + code + envelope, the message is the fixed Vietnamese sentence, the raw message
 * (an axios "Request failed with status code 500" + the downstream's own English text) is absent from the body, and it is
 * still logged. Also: the success envelope and the 400/404 branches are unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { transactionRepository } from '../repositories/transaction.repository';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4068';
process.env.GYM_SERVICE_URL = 'http://127.0.0.1:4069';
process.env.USER_SERVICE_URL = 'http://127.0.0.1:4069';
delete process.env.GYM_LAMBDA_NAME;
delete process.env.USER_LAMBDA_NAME;

const FIXED_MESSAGE = 'Chưa thử lại được khoản hoàn tiền. Hãy tải lại và kiểm tra trạng thái trước khi thử lại.';
const RAW_DOWNSTREAM = 'ECONNRESET internal-host.cluster.local:5432 stack at Object.<anonymous>';

const baseTxn = {
  status: 'PAID',
  activationStatus: 'FAILED',
  purpose: 'REFUND',
  refundOfTransactionId: 'W11-orig',
  relatedEntityType: 'GYM_MEMBERSHIP',
  relatedEntityId: 'W11-ent',
};
const txns: Record<string, Record<string, unknown>> = {
  'W11-refund-gym': { id: 'W11-refund-gym', ...baseTxn },
  'W11-activate-user': { id: 'W11-activate-user', ...baseTxn, purpose: 'MEMBERSHIP', relatedEntityType: 'COACH_SESSION' },
  'W11-refund-ok': { id: 'W11-refund-ok', ...baseTxn, relatedEntityId: 'W11-ok' },
  'W11-done': { id: 'W11-done', ...baseTxn, activationStatus: 'ACTIVATED' },
};
const activated: string[] = [];
(transactionRepository as any).findById = async (id: string) => txns[id] ?? null;
(transactionRepository as any).markActivated = async (id: string) => {
  activated.push(id);
};

const logged: unknown[] = [];
const origError = logger.error.bind(logger);
(logger as any).error = (...args: unknown[]) => {
  logged.push(args);
};

let authServer: http.Server;
let downstream: http.Server;
let testApp: http.Server;
let baseUrl = '';
const ADMIN = { Authorization: 'Bearer real-admin-token' };

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const ok = String(req.headers.authorization || '') === 'Bearer real-admin-token';
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { user: { id: 'u-ADMIN', email: 'x@example.com', role: 'ADMIN' } } : { error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4068, '127.0.0.1', r));

  downstream = http.createServer((req, res) => {
    if (req.url?.includes('W11-ok')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: RAW_DOWNSTREAM }));
  });
  await new Promise<void>((r) => downstream.listen(4069, '127.0.0.1', r));

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
  (logger as any).error = origError;
  await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve) => downstream.close(() => resolve()));
  await new Promise<void>((resolve) => authServer.close(() => resolve()));
  await prisma.$disconnect();
});

const retry = (id: string) => fetch(`${baseUrl}/admin/payments/${id}/retry-activation`, { method: 'POST', headers: ADMIN });

for (const id of ['W11-refund-gym', 'W11-activate-user']) {
  test(`${id}: downstream 500 -> 502 RETRY_FAILED with the fixed Vietnamese message, raw text only in the log`, async () => {
    logged.length = 0;
    const res = await retry(id);
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { success: false, error: { code: 'RETRY_FAILED', message: FIXED_MESSAGE } });
    assert.ok(!text.includes('Request failed'), 'axios message must not leak');
    assert.ok(!text.includes('status code'), 'axios message must not leak');
    assert.ok(!text.includes('ECONNRESET') && !text.includes('internal-host'), 'downstream text must not leak');
    assert.ok(activated.indexOf(id) === -1, 'a failed retry must not mark the transaction activated');
    assert.ok(JSON.stringify(logged).includes('Request failed with status code 500'), 'the raw message is still logged');
  });
}

test('downstream 200 -> 200 { success: true } and the transaction is marked activated (envelope unchanged)', async () => {
  const res = await retry('W11-refund-ok');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true });
  assert.deepEqual(activated, ['W11-refund-ok']);
});

test('other branches unchanged: unknown id -> 404 NOT_FOUND, already activated -> 400 NOTHING_TO_RETRY', async () => {
  const nf = await retry('W11-nope');
  assert.equal(nf.status, 404);
  assert.deepEqual(await nf.json(), { success: false, error: { code: 'NOT_FOUND' } });
  const done = await retry('W11-done');
  assert.equal(done.status, 400);
  assert.deepEqual(await done.json(), { success: false, error: { code: 'NOTHING_TO_RETRY' } });
});
