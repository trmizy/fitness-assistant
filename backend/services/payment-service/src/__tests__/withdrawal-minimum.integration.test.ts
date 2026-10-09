/**
 * Minimum withdrawal (10,000đ by default): a request below it is refused with HTTP 400 and a
 * machine-readable code, for EVERY wallet type that can request a withdrawal, through EVERY
 * entry point.
 *
 *   evidence label: BACKEND INTEGRATION (real express routers + real test DB; the auth-service
 *   that wallet.routes verifies tokens against is a stub, as in auth-header-spoofing.test.ts).
 *
 * Entry points (all end in withdrawalService.requestWithdrawal):
 *   - POST /me/withdrawals            (wallet.routes.ts)  — CLIENT and PT, identity from the JWT
 *   - POST /internal/withdrawals/gym/:gymId (internal.routes.ts) — the proxy gym-service calls
 *
 * Run THIS FILE ALONE (it writes to the shared ledger tables like its siblings):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/withdrawal-minimum.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';

const databaseUrl = process.env.DATABASE_URL || '';
const canUseIntegrationDb = /_test/i.test(databaseUrl);
const skipOpts = {
  skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4023';

let authServer: http.Server;
let appServer: http.Server;
let baseUrl = '';
let prisma: (typeof import('../repositories/prisma'))['prisma'];
let walletService: (typeof import('../services/wallet.service'))['walletService'];
let withdrawalService: (typeof import('../services/withdrawal.service'))['withdrawalService'];
let MIN_WITHDRAWAL_AMOUNT: (typeof import('../services/withdrawal.service'))['MIN_WITHDRAWAL_AMOUNT'];
let PrismaNs: (typeof import('../generated/prisma'))['Prisma'];

// Tokens the stub auth-service accepts, mapped to who they are.
const users: Record<string, { id: string; role: string }> = {
  'tok-pt': { id: randomUUID(), role: 'PT' },
  'tok-client': { id: randomUUID(), role: 'CUSTOMER' },
};

test.before(async () => {
  if (!canUseIntegrationDb) return;
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const token = String(req.headers.authorization || '').replace('Bearer ', '');
      const u = users[token];
      if (u) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: { id: u.id, email: `${u.id}@example.com`, role: u.role } }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => authServer.listen(4023, '127.0.0.1', resolve));

  prisma = (await import('../repositories/prisma')).prisma;
  PrismaNs = (await import('../generated/prisma')).Prisma;
  walletService = (await import('../services/wallet.service')).walletService;
  const wsvc = await import('../services/withdrawal.service');
  withdrawalService = wsvc.withdrawalService;
  MIN_WITHDRAWAL_AMOUNT = wsvc.MIN_WITHDRAWAL_AMOUNT;
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
  if (appServer) await new Promise<void>((resolve, reject) => appServer.close((err) => (err ? reject(err) : resolve())));
  if (authServer) await new Promise<void>((resolve, reject) => authServer.close((err) => (err ? reject(err) : resolve())));
  if (prisma) await prisma.$disconnect();
});

/** Puts `amount` in a wallet's AVAILABLE bucket, with escrow gaining the same (as a real intake would). */
async function fund(ownerType: 'PT' | 'GYM' | 'CLIENT', ownerId: string, amount: string, description: string) {
  const wallet = await walletService.getOrCreateWallet(ownerType, ownerId);
  const escrow = await walletService.getEscrowWallet();
  const txn = await prisma.paymentTransaction.create({
    data: {
      id: randomUUID(),
      payerId: randomUUID(),
      purpose: 'PT_CONTRACT',
      amount: new PrismaNs.Decimal(amount),
      idempotencyKey: `test:${randomUUID()}`,
      status: 'PAID',
    },
  });
  await walletService.withWallets([wallet.id, escrow.id], txn.id, async (ops) => {
    await ops.credit(wallet.id, new PrismaNs.Decimal(amount), description);
    await ops.credit(escrow.id, new PrismaNs.Decimal(amount), `escrow intake for ${description}`);
  });
}

async function post(path: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const SERVICE_SECRET = { 'x-service-secret': 'dev_internal_service_secret_change_in_production' };

test('the default minimum is 10,000đ', skipOpts, () => {
  assert.equal(MIN_WITHDRAWAL_AMOUNT.toString(), '10000');
});

test('PT via POST /me/withdrawals: 9,999đ is refused with 400 WITHDRAWAL_BELOW_MINIMUM, 10,000đ is accepted', skipOpts, async () => {
  const pt = users['tok-pt'];
  await fund('PT', pt.id, '500000', 'test earnings');
  const auth = { authorization: 'Bearer tok-pt' };

  const low = await post('/me/withdrawals', { amount: '9999', payoutInfo: 'Bank ABC 0123' }, auth);
  assert.equal(low.status, 400);
  assert.equal(low.json.error.code, 'WITHDRAWAL_BELOW_MINIMUM');
  assert.match(low.json.error.message, /tối thiểu/);
  assert.match(low.json.error.message, /10\.000đ/);

  const ok = await post('/me/withdrawals', { amount: '10000', payoutInfo: 'Bank ABC 0123' }, auth);
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.status, 'PENDING');
});

test('CLIENT via POST /me/withdrawals: 1,000đ of refund money is refused, 10,000đ is accepted', skipOpts, async () => {
  const client = users['tok-client'];
  await fund('CLIENT', client.id, '250000', 'Contract xyz — refund (CLIENT_CANCELLED)');
  const auth = { authorization: 'Bearer tok-client' };

  const low = await post('/me/withdrawals', { amount: '1000', payoutInfo: 'Bank XYZ' }, auth);
  assert.equal(low.status, 400);
  assert.equal(low.json.error.code, 'WITHDRAWAL_BELOW_MINIMUM');

  const ok = await post('/me/withdrawals', { amount: '10000', payoutInfo: 'Bank XYZ' }, auth);
  assert.equal(ok.status, 201);
});

test('GYM via the internal proxy POST /internal/withdrawals/gym/:gymId: below the minimum is 400, the minimum is 201', skipOpts, async () => {
  const gymId = randomUUID();
  await fund('GYM', gymId, '800000', 'test gym earnings');

  const low = await post(`/internal/withdrawals/gym/${gymId}`, { amount: '9999.99', payoutInfo: 'Bank GYM' }, SERVICE_SECRET);
  assert.equal(low.status, 400);
  assert.equal(low.json.error.code, 'WITHDRAWAL_BELOW_MINIMUM');

  const ok = await post(`/internal/withdrawals/gym/${gymId}`, { amount: '10000', payoutInfo: 'Bank GYM' }, SERVICE_SECRET);
  assert.equal(ok.status, 201);
});

test('a refused request leaves no WithdrawalRequest behind and the zero/negative check still wins first', skipOpts, async () => {
  const ptId = randomUUID();
  await fund('PT', ptId, '500000', 'test earnings');
  const wallet = await walletService.getOrCreateWallet('PT', ptId);

  await assert.rejects(
    () => withdrawalService.requestWithdrawal('PT', ptId, '5000', 'Bank ABC'),
    (e: unknown) => (e as { code?: string; status?: number }).code === 'WITHDRAWAL_BELOW_MINIMUM' && (e as { status?: number }).status === 400,
  );
  await assert.rejects(
    () => withdrawalService.requestWithdrawal('PT', ptId, '0', 'Bank ABC'),
    (e: unknown) => (e as { code?: string }).code === 'INVALID_AMOUNT',
  );
  assert.equal(await prisma.withdrawalRequest.count({ where: { walletId: wallet.id } }), 0);
});
