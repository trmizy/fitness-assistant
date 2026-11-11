/**
 * G-13 - error mapping of POST /admin/payments/withdrawals/:id/{approve,reject,mark-paid}.
 *   evidence label: BACKEND INTEGRATION without a database (auth-service is a TEST FIXTURE; withdrawalService is replaced,
 *   so nothing here reaches Postgres).
 *
 * Covers: wallet errors -> 409 with a stable code and a fixed Vietnamese message, known {status, code} service errors keep
 * their code, an unknown error (Prisma-like, TypeError) -> 500 INTERNAL_ERROR with a fixed message and NEVER err.message,
 * and the envelope is exactly { success:false, error:{ code, message? } }.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { prisma } from '../repositories/prisma';
import { withdrawalService } from '../services/withdrawal.service';
import { InsufficientBalanceError, WalletNotActiveError } from '../services/wallet.service';
import {
  ADMIN_INTERNAL_ERROR_MESSAGE,
  ADMIN_INSUFFICIENT_BALANCE_MESSAGE,
  ADMIN_WALLET_NOT_ACTIVE_MESSAGE,
  mapAdminWriteError,
} from '../utils/admin-error';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4152';

const SECRET_ENGLISH = 'Invalid prisma.wallet.update() invocation: secret-table-detail-W10';
let nextError: unknown = null;
const svc = withdrawalService as unknown as Record<string, unknown>;
for (const fn of ['approve', 'reject', 'markPaid']) {
  svc[fn] = async () => {
    throw nextError;
  };
}

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';
const ADMIN = { Authorization: 'Bearer real-admin-token', 'Content-Type': 'application/json' };

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const ok = String(req.headers.authorization || '') === 'Bearer real-admin-token';
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { user: { id: 'u-admin', email: 'x@example.com', role: 'ADMIN' } } : { error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4152, '127.0.0.1', r));
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

const ENDPOINTS: Array<[string, unknown]> = [
  ['approve', {}],
  ['reject', { reason: 'W10 test' }],
  ['mark-paid', { bankReference: 'W10-REF' }],
];

async function call(action: string, body: unknown) {
  const res = await fetch(`${baseUrl}/admin/payments/withdrawals/00000000-0000-4000-8000-000000000001/${action}`, {
    method: 'POST',
    headers: ADMIN,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as { success: boolean; error: { code: string; message?: string } } };
}

for (const [action, body] of ENDPOINTS) {
  test(`${action}: InsufficientBalanceError -> 409 INSUFFICIENT_BALANCE, fixed Vietnamese message, no raw English`, async () => {
    nextError = new InsufficientBalanceError('wallet-secret-id-W10');
    const r = await call(action, body);
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { success: false, error: { code: 'INSUFFICIENT_BALANCE', message: ADMIN_INSUFFICIENT_BALANCE_MESSAGE } });
    assert.doesNotMatch(r.text, /wallet-secret-id-W10|Insufficient balance/);
  });

  test(`${action}: WalletNotActiveError -> 409 WALLET_NOT_ACTIVE, fixed Vietnamese message`, async () => {
    nextError = new WalletNotActiveError('wallet-secret-id-W10');
    const r = await call(action, body);
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { success: false, error: { code: 'WALLET_NOT_ACTIVE', message: ADMIN_WALLET_NOT_ACTIVE_MESSAGE } });
    assert.doesNotMatch(r.text, /wallet-secret-id-W10|not ACTIVE/);
  });

  test(`${action}: known service error {status, code} keeps its status, code and own message`, async () => {
    nextError = Object.assign(new Error('Không thể duyệt yêu cầu ở trạng thái PAID'), { status: 409, code: 'INVALID_STATUS' });
    const r = await call(action, body);
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { success: false, error: { code: 'INVALID_STATUS', message: 'Không thể duyệt yêu cầu ở trạng thái PAID' } });
  });

  test(`${action}: FOUR_EYES_REQUIRED (409) and NOT_FOUND (404) pass through`, async () => {
    nextError = Object.assign(new Error('cần một quản trị viên khác'), { status: 409, code: 'FOUR_EYES_REQUIRED' });
    assert.equal((await call(action, body)).json.error.code, 'FOUR_EYES_REQUIRED');
    nextError = Object.assign(new Error('Yêu cầu không tồn tại'), { status: 404, code: 'NOT_FOUND' });
    const r = await call(action, body);
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'NOT_FOUND');
  });

  test(`${action}: unknown error (Prisma-like / TypeError) -> 500 INTERNAL_ERROR, fixed message, err.message never leaks`, async () => {
    for (const e of [
      Object.assign(new Error(SECRET_ENGLISH), { code: 'P2002' }),
      new TypeError(SECRET_ENGLISH),
      Object.assign(new Error(SECRET_ENGLISH), { status: 500, code: 'SOMETHING' }),
      'a plain string ' + SECRET_ENGLISH,
      null,
    ]) {
      nextError = e;
      const r = await call(action, body);
      assert.equal(r.status, 500);
      assert.deepEqual(r.json, { success: false, error: { code: 'INTERNAL_ERROR', message: ADMIN_INTERNAL_ERROR_MESSAGE } });
      assert.doesNotMatch(r.text, /secret-table-detail-W10|prisma|P2002|SOMETHING/i);
    }
  });
}

test('mapAdminWriteError: the envelope has exactly success + error{code,message}', () => {
  const m = mapAdminWriteError(new InsufficientBalanceError('w'));
  assert.deepEqual(Object.keys(m.body).sort(), ['error', 'success']);
  assert.deepEqual(Object.keys(m.body.error).sort(), ['code', 'message']);
  assert.match(ADMIN_INTERNAL_ERROR_MESSAGE, /[ăâđêôơư]/);
});

test('reject without a reason / mark-paid without bankReference stay 400 (route validation unchanged)', async () => {
  nextError = null;
  const a = await call('reject', {});
  assert.equal(a.status, 400);
  assert.equal(a.json.error.code, 'REASON_REQUIRED');
  const b = await call('mark-paid', {});
  assert.equal(b.status, 400);
  assert.equal(b.json.error.code, 'VALIDATION_ERROR');
});
