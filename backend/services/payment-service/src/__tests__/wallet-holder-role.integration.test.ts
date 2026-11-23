/**
 * SECURITY_BUSINESS_HANDOFF item 8 — `/me/wallet`, `/me/wallet/transactions`, `/me/withdrawals` (GET + POST) must not create or serve a CLIENT
 * wallet for a GYM_OWNER (or any role other than CUSTOMER / PT). A PT and a CUSTOMER keep working.
 *
 *   evidence labels: part 1 CODE/UNIT (middleware only, no DB, no network); part 2 BACKEND INTEGRATION (real express router + real *_test DB; the
 *   auth-service the routes verify tokens against is a stub).
 *
 * Run this file alone:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/<name>_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/wallet-holder-role.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { canHoldClientWallet, requireWalletHolderRole } from '../middleware/wallet-holder.middleware';
import { isTestDatabaseUrl } from './support/test-db-guard';

// ── 1. unit ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('canHoldClientWallet: only CUSTOMER and PT; GYM_OWNER / ADMIN / unknown / missing -> false (fail-closed)', () => {
  assert.equal(canHoldClientWallet('CUSTOMER'), true);
  assert.equal(canHoldClientWallet('PT'), true);
  for (const r of ['GYM_OWNER', 'ADMIN', 'CLIENT', 'pt', '', undefined, null, 42, {}]) assert.equal(canHoldClientWallet(r), false, String(r));
});

test('requireWalletHolderRole answers 403 WALLET_ROLE_NOT_SUPPORTED without calling next for a GYM_OWNER, and calls next for PT / CUSTOMER', () => {
  const run = (role: string | undefined) => {
    let status = 0;
    let body: any;
    let nextCalled = false;
    const res: any = { status(s: number) { status = s; return this; }, json(b: unknown) { body = b; return this; } };
    requireWalletHolderRole({ user: role === undefined ? undefined : { userId: 'u', role, email: '' } } as any, res, () => { nextCalled = true; });
    return { status, body, nextCalled };
  };
  const owner = run('GYM_OWNER');
  assert.equal(owner.nextCalled, false);
  assert.equal(owner.status, 403);
  assert.equal(owner.body.error.code, 'WALLET_ROLE_NOT_SUPPORTED');
  assert.equal(run(undefined).nextCalled, false);
  assert.equal(run('PT').nextCalled, true);
  assert.equal(run('CUSTOMER').nextCalled, true);
});

// ── 2. integration ────────────────────────────────────────────────────────────────────────────────────────────────
const canRun = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const skipOpts = { skip: canRun ? false : 'Requires DATABASE_URL pointing at a *_test database.' };
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4027';

const users: Record<string, { id: string; role: string }> = {
  'tok-owner': { id: randomUUID(), role: 'GYM_OWNER' },
  'tok-pt': { id: randomUUID(), role: 'PT' },
  'tok-customer': { id: randomUUID(), role: 'CUSTOMER' },
  'tok-admin': { id: randomUUID(), role: 'ADMIN' },
};

let authServer: http.Server;
let appServer: http.Server;
let baseUrl = '';
let prisma: (typeof import('../repositories/prisma'))['prisma'];

test.before(async () => {
  if (!canRun) return;
  authServer = http.createServer((req, res) => {
    const u = users[String(req.headers.authorization || '').replace('Bearer ', '')];
    if (req.method === 'POST' && req.url === '/auth/verify' && u) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: { id: u.id, email: `${u.id}@example.com`, role: u.role } }));
      return;
    }
    res.writeHead(u ? 404 : 401);
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4027, '127.0.0.1', r));
  prisma = (await import('../repositories/prisma')).prisma;
  const walletRoutes = (await import('../routes/wallet.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/me', walletRoutes);
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
});

test.after(async () => {
  if (appServer) await new Promise<void>((r) => appServer.close(() => r()));
  if (authServer) await new Promise<void>((r) => authServer.close(() => r()));
  if (prisma) {
    await prisma.wallet.deleteMany({ where: { ownerId: { in: Object.values(users).map((u) => u.id) } } });
    await prisma.$disconnect();
  }
});

async function call(tok: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const walletCount = (id: string) => prisma.wallet.count({ where: { ownerId: id } });

test('GYM_OWNER: every /me wallet + withdrawal route is 403 and NO wallet row is created', skipOpts, async () => {
  const owner = users['tok-owner'];
  for (const [m, p, b] of [
    ['GET', '/me/wallet'], ['GET', '/me/wallet/transactions'], ['GET', '/me/withdrawals'],
    ['POST', '/me/withdrawals', { amount: '50000', payoutInfo: 'Bank 0123' }],
  ] as Array<[string, string, unknown?]>) {
    const r = await call('tok-owner', m, p, b);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.json.error.code, 'WALLET_ROLE_NOT_SUPPORTED');
  }
  assert.equal(await walletCount(owner.id), 0, 'no CLIENT wallet was created for the gym owner');
  assert.equal(await prisma.withdrawalRequest.count({ where: { ownerId: owner.id } }), 0);
});

test('ADMIN is refused too (not a wallet holder); CUSTOMER keeps GET /me/wallet (creates the CLIENT wallet) and PT keeps /me/wallet + /me/withdrawals', skipOpts, async () => {
  assert.equal((await call('tok-admin', 'GET', '/me/wallet')).status, 403);
  assert.equal(await walletCount(users['tok-admin'].id), 0);

  const c = await call('tok-customer', 'GET', '/me/wallet');
  assert.equal(c.status, 200);
  assert.equal(c.json.data.ownerType, 'CLIENT');
  assert.equal(await walletCount(users['tok-customer'].id), 1);
  assert.equal((await call('tok-customer', 'GET', '/me/wallet/transactions')).status, 200);
  assert.equal((await call('tok-customer', 'GET', '/me/withdrawals')).status, 200);

  const p = await call('tok-pt', 'GET', '/me/wallet');
  assert.equal(p.status, 200, 'a PT keeps the CLIENT wallet (dual PT + client use)');
  assert.equal(p.json.data.ownerType, 'CLIENT');
  assert.equal((await call('tok-pt', 'GET', '/me/withdrawals')).status, 200);
  // POST still reaches the service for a PT: an empty wallet is a business refusal (400/409), never the role 403.
  const w = await call('tok-pt', 'POST', '/me/withdrawals', { amount: '50000', payoutInfo: 'Bank 0123' });
  assert.notEqual(w.status, 403);
  assert.notEqual(w.json?.error?.code, 'WALLET_ROLE_NOT_SUPPORTED');
});
