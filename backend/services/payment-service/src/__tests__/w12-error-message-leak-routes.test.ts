/**
 * W12 - payment-service must never put a raw error message into an HTTP body.
 *   evidence label: BACKEND INTEGRATION without a test database. Two ways of making a handler fail, both without Postgres data:
 *   (a) DATABASE_URL points at an unreachable host whose NAME carries the sentinel, so the real Prisma failure text contains it;
 *   (b) the withdrawal / wallet / transaction singletons are replaced and throw the sentinel.
 *   auth-service is a TEST FIXTURE (a stub that verifies one token).
 *
 * For each spot: HTTP status and `code` are the ones the route always answered, the body never contains the sentinel
 * (nor driver / Prisma wording), the message is the fixed Vietnamese sentence, and the raw text reached the log.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

const SENTINEL = 'W12-SECRET internal-host:5432';
const SENTINEL_HOST = 'w12-secret.internal-host.invalid';
process.env.DATABASE_URL = `postgresql://u:p@${SENTINEL_HOST}:5432/db?schema=public&connect_timeout=3`;
process.env.INTERNAL_SERVICE_SECRET = 'w12-internal-secret';
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4153';
process.env.VNPAY_TMN_CODE = 'W12TMN';
process.env.VNPAY_HASH_SECRET = 'w12-hash-secret';

import { logger } from '@gym-coach/shared';
import { transactionRepository } from '../repositories/transaction.repository';
import { walletService, InsufficientBalanceError, WalletNotActiveError } from '../services/wallet.service';
import { withdrawalService } from '../services/withdrawal.service';
import { prisma } from '../repositories/prisma';
import { failureMessage, GENERIC_FAILURE_MESSAGE } from '../utils/safe-error';
import { ADMIN_INSUFFICIENT_BALANCE_MESSAGE, ADMIN_WALLET_NOT_ACTIVE_MESSAGE } from '../utils/admin-error';

const logged: string[] = [];
mock.method(logger, 'error', (...a: unknown[]) => void logged.push(JSON.stringify(a)));
mock.method(logger, 'warn', (...a: unknown[]) => void logged.push(JSON.stringify(a)));

const LEAK_MARKERS = [/w12-secret/i, /internal-host/i, /can.?t reach/i, /enotfound/i, /prisma/i, /getaddrinfo/i, /invocation/i];
const SERVICE = { 'x-service-secret': 'w12-internal-secret', 'Content-Type': 'application/json' };
const CLIENT = { Authorization: 'Bearer w12-client-token', 'Content-Type': 'application/json' };

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const ok = String(req.headers.authorization || '') === 'Bearer w12-client-token';
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { user: { id: 'W12-user', email: 'w12@example.com', role: 'CLIENT' } } : { error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4153, '127.0.0.1', r));
  const { default: internalRoutes } = await import('../routes/internal.routes');
  const { default: paymentRoutes } = await import('../routes/payment.routes');
  const { default: walletRoutes } = await import('../routes/wallet.routes');
  const app = express();
  app.use(express.json());
  app.use('/me/payments', paymentRoutes);
  app.use('/me', walletRoutes);
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

type Envelope = { success: boolean; error?: { code: string; message?: string }; data?: Record<string, unknown> };
async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Envelope };
}
function assertNoLeak(text: string, label: string) {
  for (const re of LEAK_MARKERS) assert.doesNotMatch(text, re, `${label}: body leaked ${re}`);
}

const RATES = { platformRate: '0.1000', ptRate: '0.9000', gymRate: '0.0000' };
const PARTIES = { ptUserId: 'W12-pt', gymId: null, clientUserId: 'W12-client' };
const LEDGER_BODY = { transactionId: 'W12-txn', price: '1000000', totalSessions: 10, rates: RATES, parties: PARTIES, label: 'W12', idempotencyKey: 'SESSION_RELEASE:W12-s1' };

// (a) real handlers, real Prisma failure text (host name = sentinel). One representative route per failure code family.
const DB_FAILURE_SPOTS: Array<{ name: string; path: string; body: unknown; status: number; code: string }> = [
  { name: 'release-session', path: '/internal/contracts/release-session', body: LEDGER_BODY, status: 500, code: 'RELEASE_FAILED' },
  { name: 'no-show', path: '/internal/contracts/no-show', body: { ...LEDGER_BODY, idempotencyKey: 'PT_NO_SHOW:W12-s1' }, status: 500, code: 'COMPENSATION_FAILED' },
  { name: 'late-arrival', path: '/internal/contracts/late-arrival', body: { ...LEDGER_BODY, idempotencyKey: 'PT_LATE_ARRIVAL:W12-s1' }, status: 500, code: 'COMPENSATION_FAILED' },
  { name: 'no-show-obligation', path: '/internal/contracts/no-show-obligation', body: { ...LEDGER_BODY, idempotencyKey: 'PT_NO_SHOW:W12-s1', reason: 'W12 reason text' }, status: 500, code: 'OBLIGATION_RECORD_FAILED' },
  { name: 'late-open-state', path: '/internal/contracts/late-open-state', body: { transactionId: 'W12-txn', lateKey: 'PT_LATE_ARRIVAL:W12-s1', parties: PARTIES }, status: 500, code: 'LATE_OPEN_STATE_FAILED' },
  { name: 'money-breakdown', path: '/internal/contracts/money-breakdown', body: { price: '1000000', totalSessions: 10, usedSessions: 1, rates: RATES, transactionId: 'W12-txn' }, status: 400, code: 'INVALID_INPUT' },
];

for (const spot of DB_FAILURE_SPOTS) {
  test(`internal ${spot.name}: ${spot.status} ${spot.code} keeps status and code, body has no raw message, raw text is logged`, async () => {
    logged.length = 0;
    const r = await call('POST', spot.path, SERVICE, spot.body);
    assert.equal(r.status, spot.status);
    assert.equal(r.json.success, false);
    assert.equal(r.json.error?.code, spot.code);
    assert.equal(r.json.error?.message, failureMessage(spot.code));
    assert.deepEqual(Object.keys(r.json.error ?? {}).sort(), ['code', 'message']);
    assertNoLeak(r.text, spot.name);
    assert.ok(logged.some((l) => l.toLowerCase().includes('w12-secret')), `${spot.name}: raw error was not logged`);
  });
}

// (b) checkout: GATEWAY_ERROR 502 (provider reachable, persisting the row fails) and INVALID_RATE_TABLE 400.
const CHECKOUT_BODY = {
  purpose: 'GYM_MEMBERSHIP',
  relatedEntityType: 'GYM_MEMBERSHIP',
  relatedEntityId: 'W12-membership',
  amount: 100000,
  rates: { platformRate: '0.1000', ptRate: '0', gymRate: '0.9000' },
  parties: { ptUserId: 'W12-gym', gymId: 'W12-gym', clientUserId: 'W12-client' },
  idempotencyKey: 'W12-checkout-key',
  initiatedBy: 'W12-client',
  sourceService: 'gym-service',
  provider: 'VNPAY',
};

test('internal checkout: 502 GATEWAY_ERROR keeps status and code, fixed Vietnamese message, raw text logged only', async () => {
  const repo = transactionRepository as unknown as Record<string, unknown>;
  const original = { find: repo.findByIdempotencyKey, create: repo.create };
  repo.findByIdempotencyKey = async () => null;
  repo.create = async () => {
    throw new Error(SENTINEL);
  };
  logged.length = 0;
  try {
    const r = await call('POST', '/internal/payments/checkout', SERVICE, CHECKOUT_BODY);
    assert.equal(r.status, 502);
    assert.equal(r.json.error?.code, 'GATEWAY_ERROR');
    assert.equal(r.json.error?.message, failureMessage('GATEWAY_ERROR'));
    assertNoLeak(r.text, 'checkout');
    assert.ok(logged.some((l) => l.includes('W12-SECRET')), 'raw error was not logged');
  } finally {
    repo.findByIdempotencyKey = original.find;
    repo.create = original.create;
  }
});

test('internal checkout: 400 INVALID_RATE_TABLE keeps status and code, fixed message instead of the validator text', async () => {
  logged.length = 0;
  const r = await call('POST', '/internal/payments/checkout', SERVICE, { ...CHECKOUT_BODY, rates: { platformRate: '0.5', ptRate: '0.9', gymRate: '0.9' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error?.code, 'INVALID_RATE_TABLE');
  assert.equal(r.json.error?.message, failureMessage('INVALID_RATE_TABLE'));
  assert.doesNotMatch(r.text, /must equal exactly 1|got \d/);
  assert.ok(logged.some((l) => l.includes('must equal exactly 1')), 'validator text was not logged');
});

test('internal checkout: 400 PROVIDER_NOT_CONFIGURED keeps status and code, no env-var names in the body, names logged', async () => {
  const saved = { t: process.env.VNPAY_TMN_CODE, h: process.env.VNPAY_HASH_SECRET, z: process.env.ZALOPAY_APP_ID };
  // VNPay reads its config at module load, so use a provider whose status is read at call time: ZALOPAY has no env set in this test
  delete process.env.ZALOPAY_APP_ID;
  logged.length = 0;
  try {
    const r = await call('POST', '/internal/payments/checkout', SERVICE, { ...CHECKOUT_BODY, provider: 'ZALOPAY' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error?.code, 'PROVIDER_NOT_CONFIGURED');
    assert.equal(r.json.error?.message, failureMessage('PROVIDER_NOT_CONFIGURED'));
    assert.doesNotMatch(r.text, /ZALOPAY_|missing env|VNPAY_/);
    assert.ok(logged.some((l) => l.includes('ZALOPAY_APP_ID')), 'missing env names were not logged');
  } finally {
    process.env.VNPAY_TMN_CODE = saved.t;
    process.env.VNPAY_HASH_SECRET = saved.h;
    if (saved.z === undefined) delete process.env.ZALOPAY_APP_ID; else process.env.ZALOPAY_APP_ID = saved.z;
  }
});

// (b) wallet-transfer FAILED: HTTP 200 with data.failureReason (a message in the body, not in `error`).
const TRANSFER_BODY = {
  payerOwnerType: 'CLIENT', payerOwnerId: 'W12-payer', receiverOwnerType: 'PT', receiverOwnerId: 'W12-receiver', amount: 1000,
  purpose: 'PT_CONTRACT', relatedEntityType: 'PT_CONTRACT', relatedEntityId: 'W12-contract', idempotencyKey: 'W12-transfer-key', initiatedBy: 'W12-payer', sourceService: 'user-service',
};
async function transferWith(thrown: Error) {
  const repo = transactionRepository as unknown as Record<string, unknown>;
  const wallets = walletService as unknown as Record<string, unknown>;
  const saved = { find: repo.findByIdempotencyKey, create: repo.create, failed: repo.markFailed, gw: wallets.getOrCreateWallet, tr: wallets.transferInternal };
  repo.findByIdempotencyKey = async () => null;
  repo.create = async () => ({ id: 'W12-txn-row' });
  repo.markFailed = async () => undefined;
  wallets.getOrCreateWallet = async (_t: string, id: string) => ({ id: `W12-wallet-${id}` });
  wallets.transferInternal = async () => {
    throw thrown;
  };
  logged.length = 0;
  try {
    return await call('POST', '/internal/payments/wallet-transfer', SERVICE, TRANSFER_BODY);
  } finally {
    repo.findByIdempotencyKey = saved.find;
    repo.create = saved.create;
    repo.markFailed = saved.failed;
    wallets.getOrCreateWallet = saved.gw;
    wallets.transferInternal = saved.tr;
  }
}

test('internal wallet-transfer: unknown error -> 200 FAILED with a fixed failureReason, raw text logged only', async () => {
  const r = await transferWith(new Error(SENTINEL));
  assert.equal(r.status, 200);
  assert.equal(r.json.data?.status, 'FAILED');
  assert.equal(r.json.data?.failureReason, GENERIC_FAILURE_MESSAGE);
  assertNoLeak(r.text, 'wallet-transfer');
  assert.ok(logged.some((l) => l.includes('W12-SECRET')));
});

test('internal wallet-transfer: InsufficientBalanceError / WalletNotActiveError -> 200 FAILED with fixed Vietnamese reasons (no wallet id)', async () => {
  const a = await transferWith(new InsufficientBalanceError('W12-wallet-id-secret'));
  assert.equal(a.status, 200);
  assert.equal(a.json.data?.status, 'FAILED');
  assert.equal(a.json.data?.failureReason, ADMIN_INSUFFICIENT_BALANCE_MESSAGE);
  assert.doesNotMatch(a.text, /W12-wallet-id-secret/);
  const b = await transferWith(new WalletNotActiveError('W12-wallet-id-secret'));
  assert.equal(b.json.data?.failureReason, ADMIN_WALLET_NOT_ACTIVE_MESSAGE);
  assert.doesNotMatch(b.text, /W12-wallet-id-secret/);
});

// (b) withdrawals on both surfaces (internal gym proxy and /me).
const WITHDRAW = { amount: '100000', payoutInfo: 'W12 bank' };
const WITHDRAW_SURFACES: Array<{ name: string; path: string; headers: Record<string, string> }> = [
  { name: 'internal /withdrawals/gym/:id', path: '/internal/withdrawals/gym/W12-gym', headers: SERVICE },
  { name: 'me /withdrawals', path: '/me/withdrawals', headers: CLIENT },
];
for (const s of WITHDRAW_SURFACES) {
  test(`${s.name}: unknown error -> 500 INTERNAL_ERROR with a fixed message; service-owned 4xx keeps its own Vietnamese message`, async () => {
    const svc = withdrawalService as unknown as Record<string, unknown>;
    const saved = svc.requestWithdrawal;
    try {
      svc.requestWithdrawal = async () => {
        throw new Error(SENTINEL);
      };
      logged.length = 0;
      const a = await call('POST', s.path, s.headers, WITHDRAW);
      assert.equal(a.status, 500);
      assert.equal(a.json.error?.code, 'INTERNAL_ERROR');
      assert.equal(a.json.error?.message, GENERIC_FAILURE_MESSAGE);
      assertNoLeak(a.text, s.name);
      assert.ok(logged.some((l) => l.includes('W12-SECRET')));

      svc.requestWithdrawal = async () => {
        throw Object.assign(new Error('Ví hiện không hoạt động'), { status: 409, code: 'WALLET_NOT_ACTIVE' });
      };
      const b = await call('POST', s.path, s.headers, WITHDRAW);
      assert.equal(b.status, 409);
      assert.deepEqual(b.json, { success: false, error: { code: 'WALLET_NOT_ACTIVE', message: 'Ví hiện không hoạt động' } });

      // a driver-style error: no status, an own `code` -> status 500 and the code are exactly what they were, the message is fixed
      svc.requestWithdrawal = async () => {
        throw Object.assign(new Error(SENTINEL), { code: 'P2002' });
      };
      const c = await call('POST', s.path, s.headers, WITHDRAW);
      assert.equal(c.status, 500);
      assert.equal(c.json.error?.code, 'P2002');
      assertNoLeak(c.text, `${s.name} coded`);
    } finally {
      svc.requestWithdrawal = saved;
    }
  });
}

// (b) POST /me/payments/:id/sync -> SYNC_FAILED.
test('me payments sync: failure -> SYNC_FAILED keeps status (500 and a thrown 400), fixed message, raw text logged only', async () => {
  const repo = transactionRepository as unknown as Record<string, unknown>;
  const saved = repo.findById;
  try {
    // unknown provider name that carries the sentinel: getProvider() throws `Unknown payment provider: <NAME>` (no status -> 500)
    repo.findById = async () => ({ id: 'W12-txn', payerId: 'W12-user', status: 'PENDING', provider: SENTINEL, amount: 1000, createdAt: new Date(), metadata: {} });
    logged.length = 0;
    const a = await call('POST', '/me/payments/W12-txn/sync', CLIENT);
    assert.equal(a.status, 500);
    assert.equal(a.json.error?.code, 'SYNC_FAILED');
    assert.equal(a.json.error?.message, failureMessage('SYNC_FAILED'));
    assertNoLeak(a.text, 'sync');
    assert.ok(logged.some((l) => l.toLowerCase().includes('w12-secret')));

    // a gateway poll that throws an error WITH status 400: that status is kept, the message is still fixed.
    // (A retired provider - MOCK / MOMO / PAYOS - no longer gets that far: pollAndSettle answers UNSUPPORTED for it.)
    const { VNPayProvider } = await import('../providers/vnpay.provider');
    const getProviderSpy = mock.method(VNPayProvider.prototype, 'queryGatewayResult', async () => {
      throw Object.assign(new Error('W12-SECRET gateway query failed'), { status: 400 });
    });
    repo.findById = async () => ({ id: 'W12-txn', payerId: 'W12-user', status: 'PENDING', provider: 'VNPAY', amount: 1000, createdAt: new Date(), metadata: {} });
    try {
      const b = await call('POST', '/me/payments/W12-txn/sync', CLIENT);
      assert.equal(b.status, 400);
      assert.equal(b.json.error?.code, 'SYNC_FAILED');
      assert.equal(b.json.error?.message, failureMessage('SYNC_FAILED'));
      assertNoLeak(b.text, 'sync 400');
    } finally {
      getProviderSpy.mock.restore();
    }

    // a stray row of a retired gateway is not an error any more: UNSUPPORTED, nothing thrown
    repo.findById = async () => ({ id: 'W12-txn', payerId: 'W12-user', status: 'PENDING', provider: 'MOMO', amount: 1000, createdAt: new Date(), metadata: {} });
    const c = await call('POST', '/me/payments/W12-txn/sync', CLIENT);
    assert.equal(c.status, 200);
    assert.equal((c.json.data as { gatewayResult?: string }).gatewayResult, 'UNSUPPORTED');
  } finally {
    repo.findById = saved;
  }
});
