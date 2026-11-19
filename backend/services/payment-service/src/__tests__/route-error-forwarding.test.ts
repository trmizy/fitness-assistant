/**
 * N13F-05 - an async route that rejects (a Prisma "too many connections" while an admin opens the finance overview) must NOT crash
 * the process: it is forwarded to the error middleware -> 503 SERVICE_BUSY for a Prisma connection error, 500 INTERNAL_ERROR (fixed
 * Vietnamese sentence, never err.message) for anything else, and the server keeps serving the next request.
 * N13F-04 - admin refund of a gateway-paid contract/membership transaction answers a Vietnamese reason and a specific code (still 400).
 *
 *   evidence label: BACKEND INTEGRATION without a database - the REAL app (src/app.ts, so the real route forwarding + error middleware)
 *   over real HTTP; auth-service and user-service are TEST FIXTURE servers; the Prisma client / repository methods are replaced to throw.
 *   Before the fix the first rejecting request below made node:test itself fail with an unhandled rejection (== the process crash).
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DATABASE_URL = 'postgresql://u:p@route-errors.invalid:5432/db?schema=public&connect_timeout=2';
process.env.INTERNAL_SERVICE_SECRET = 'route-errors-secret';
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4171';

import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { transactionRepository } from '../repositories/transaction.repository';
import { isPrismaConnectionError, SERVICE_BUSY_MESSAGE } from '../middleware/error-handler';
import { GENERIC_FAILURE_MESSAGE } from '../utils/safe-error';
import { noWalletRefundRefusal } from '../utils/refund-refusal';

mock.method(logger, 'error', () => undefined);
mock.method(logger, 'warn', () => undefined);

const prismaError = (code: string, message = `prisma failure ${code} secret-host:5432`) => Object.assign(new Error(message), { code, name: 'PrismaClientKnownRequestError' });

let authServer: http.Server;
let userServer: http.Server;
let appServer: http.Server;
let base = '';
const ADMIN = { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' };

test.before(async () => {
  authServer = http.createServer((req, res) => {
    const ok = req.method === 'POST' && req.url === '/auth/verify' && req.headers.authorization === 'Bearer admin-token';
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { user: { id: 'u-admin', email: 'a@test.local', role: 'ADMIN' } } : {}));
  });
  await new Promise<void>((r) => authServer.listen(4171, '127.0.0.1', r));
  userServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { allowed: true } }));
  });
  await new Promise<void>((r) => userServer.listen(0, '127.0.0.1', r));
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${(userServer.address() as AddressInfo).port}`;
  delete process.env.USER_LAMBDA_NAME;
  const { default: app } = await import('../app');
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
});

test.after(async () => {
  for (const s of [appServer, authServer, userServer]) await new Promise<void>((r) => s.close(() => r()));
  await prisma.$disconnect().catch(() => undefined);
});

async function get(path: string) {
  const res = await fetch(`${base}${path}`, { headers: ADMIN });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

test('isPrismaConnectionError: P1001 / P1017 / P2024 / P2037 (code or errorCode) yes; other Prisma codes and plain errors no', () => {
  for (const c of ['P1001', 'P1017', 'P2024', 'P2037']) {
    assert.equal(isPrismaConnectionError(prismaError(c)), true, c);
    assert.equal(isPrismaConnectionError({ errorCode: c }), true, `errorCode ${c}`);
  }
  for (const c of ['P2002', 'P2025', 'P2034']) assert.equal(isPrismaConnectionError(prismaError(c)), false, c);
  assert.equal(isPrismaConnectionError(new Error('boom')), false);
  assert.equal(isPrismaConnectionError(null), false);
  assert.equal(isPrismaConnectionError('P2037'), false);
});

test('GET /admin/payments/finance-overview, /reconciliation, /commissions with Prisma P2037 -> 503 SERVICE_BUSY (Vietnamese), server keeps serving', async () => {
  const q = mock.method(prisma, '$queryRaw', async () => { throw prismaError('P2037'); });
  const commissions = mock.method(transactionRepository, 'findRecentCommissions', async () => { throw prismaError('P2037'); });
  try {
    for (const path of ['/admin/payments/finance-overview', '/admin/payments/reconciliation', '/admin/payments/commissions']) {
      const r = await get(path);
      assert.equal(r.status, 503, `${path} -> ${r.text}`);
      const body = JSON.parse(r.text);
      assert.deepEqual(body, { success: false, error: { code: 'SERVICE_BUSY', message: SERVICE_BUSY_MESSAGE } });
      assert.equal(r.headers.get('retry-after'), '5');
      assert.doesNotMatch(r.text, /prisma|secret-host|P2037/i, 'no internals in the body');
      // the process is alive and the very next request is answered
      const health = await fetch(`${base}/health`);
      assert.equal(health.status, 200, `/health after ${path}`);
    }
  } finally {
    q.mock.restore();
    commissions.mock.restore();
  }
});

test('a real unreachable database (PrismaClientInitializationError, P1001) on the finance overview -> 503, not a crash', async () => {
  const r = await get('/admin/payments/finance-overview');
  assert.equal(r.status, 503, r.text);
  assert.equal(JSON.parse(r.text).error.code, 'SERVICE_BUSY');
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test('any other error in an async route -> 500 INTERNAL_ERROR with the fixed sentence, never err.message', async () => {
  const m = mock.method(transactionRepository, 'findRecentCommissions', async () => { throw new Error('SQL secret-table-detail-N13F05'); });
  try {
    const r = await get('/admin/payments/commissions');
    assert.equal(r.status, 500);
    assert.deepEqual(JSON.parse(r.text), { success: false, error: { code: 'INTERNAL_ERROR', message: GENERIC_FAILURE_MESSAGE } });
    assert.doesNotMatch(r.text, /secret-table-detail/);
  } finally {
    m.mock.restore();
  }
});

test('a service-owned 4xx { status, code, message } thrown from an async route keeps its status, code and Vietnamese message', async () => {
  const m = mock.method(transactionRepository, 'findRecentCommissions', async () => { throw Object.assign(new Error('Yêu cầu không tồn tại'), { status: 404, code: 'NOT_FOUND' }); });
  try {
    const r = await get('/admin/payments/commissions');
    assert.equal(r.status, 404);
    assert.deepEqual(JSON.parse(r.text), { success: false, error: { code: 'NOT_FOUND', message: 'Yêu cầu không tồn tại' } });
  } finally {
    m.mock.restore();
  }
});

test('malformed JSON body -> 400 REQUEST_ERROR envelope (was the framework default HTML page)', async () => {
  const res = await fetch(`${base}/admin/payments/some-id/refund`, { method: 'POST', headers: ADMIN, body: '{"reason":' });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).error.code, 'REQUEST_ERROR');
});

test('the server keeps answering after ten concurrent failing requests (no process death)', async () => {
  const m = mock.method(prisma, '$queryRaw', async () => { throw prismaError('P2037'); });
  try {
    const all = await Promise.all(Array.from({ length: 10 }, () => get('/admin/payments/reconciliation')));
    assert.deepEqual(all.map((r) => r.status), Array(10).fill(503));
  } finally {
    m.mock.restore();
  }
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

// ---- N13F-04 ----

test('noWalletRefundRefusal: contract / membership / top-up / other each get a Vietnamese reason and a specific code', () => {
  const contract = noWalletRefundRefusal({ purpose: 'PT_CONTRACT', relatedEntityType: 'PT_CONTRACT' });
  assert.equal(contract.code, 'NOT_REFUNDABLE_CONTRACT_PAYMENT');
  assert.match(contract.message, /hợp đồng PT.*kết thúc hợp đồng.*khiếu nại/);
  assert.equal(noWalletRefundRefusal({ purpose: 'GYM_MEMBERSHIP', relatedEntityType: 'GYM_MEMBERSHIP' }).code, 'NOT_REFUNDABLE_MEMBERSHIP_PAYMENT');
  assert.match(noWalletRefundRefusal({ purpose: 'WALLET_TOPUP' }).message, /nạp ví/);
  assert.equal(noWalletRefundRefusal({ purpose: 'WALLET_TOPUP' }).code, 'NOT_REFUNDABLE');
  assert.equal(noWalletRefundRefusal({ purpose: 'WITHDRAWAL' }).code, 'NOT_REFUNDABLE');
  for (const r of [contract, noWalletRefundRefusal({}), noWalletRefundRefusal({ purpose: 'WALLET_TOPUP' })]) {
    assert.doesNotMatch(r.message, /likely|top-up|Original/i, 'no English text');
  }
});

test('POST /admin/payments/:id/refund on a gateway-paid (no wallet) contract transaction -> 400 with the Vietnamese contract reason, nothing written', async () => {
  const find = mock.method(transactionRepository, 'findById', async () => ({
    id: 'txn-gateway-contract',
    status: 'PAID',
    purpose: 'PT_CONTRACT',
    relatedEntityType: 'PT_CONTRACT',
    relatedEntityId: 'contract-1',
    payerWalletId: null,
    receiverWalletId: null,
  }) as never);
  const create = mock.method(transactionRepository, 'create', async () => { throw new Error('must not create a refund transaction'); });
  try {
    const res = await fetch(`${base}/admin/payments/txn-gateway-contract/refund`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ reason: 'test' }) });
    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_REFUNDABLE_CONTRACT_PAYMENT');
    assert.match(body.error.message, /hợp đồng PT/);
    assert.equal(create.mock.callCount(), 0);
  } finally {
    find.mock.restore();
    create.mock.restore();
  }
});
