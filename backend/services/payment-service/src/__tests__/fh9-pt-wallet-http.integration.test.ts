/**
 * FH-9 - REAL HTTP/API: the PT's money per contract and the admin report, through the real Express routers, a real token check against
 * a stub auth-service (the one fixture), and the isolated *_test database.
 *
 *   GET /me/pt-wallet            the wallet now carries holdbackBalance (earned, held back, not withdrawable)
 *   GET /me/pt-wallet/contracts  per contract: value, expected income, pending, earned, held, available, release state
 *   GET /admin/payments/obligations   summary.ptHoldback + ptHoldbacks
 *   POST /me/withdrawals         cannot withdraw the held money
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://<user>:<pw>@localhost:55433/gymcoach_payment_fh9_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh9-pt-wallet-http.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';

const skipOpts = { skip: isTestDatabaseUrl(process.env.DATABASE_URL) ? false : 'Requires DATABASE_URL pointing at a *_test database.' };
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4061';

const PT_ID = `pt-http-${randomUUID().slice(0, 6)}`;
let authServer: http.Server;
let app: http.Server;
let base = '';
type Mods = { prisma: any; Prisma: any; ledger: typeof import('../services/contract-ledger.service') };
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/contract-ledger.service'),
    };
  }
  return mods;
}

test.before(async () => {
  if (skipOpts.skip) return;
  authServer = http.createServer((req, res) => {
    const a = String(req.headers.authorization || '');
    res.setHeader('Content-Type', 'application/json');
    const who: Record<string, { id: string; role: string }> = {
      'Bearer pt': { id: PT_ID, role: 'PT' },
      'Bearer pt2': { id: 'pt-other', role: 'PT' },
      'Bearer customer': { id: 'cust-1', role: 'CUSTOMER' },
      'Bearer admin': { id: 'admin-1', role: 'ADMIN' },
    };
    const u = who[a];
    if (req.method === 'POST' && req.url === '/auth/verify' && u) res.end(JSON.stringify({ user: { ...u, email: `${u.id}@example.com` } }));
    else {
      res.statusCode = 401;
      res.end('{}');
    }
  });
  await new Promise<void>((r) => authServer.listen(4061, '127.0.0.1', r));
  const server = express();
  server.use(express.json());
  server.use('/me', (await import('../routes/wallet.routes')).default);
  server.use('/admin/payments/obligations', (await import('../routes/admin-obligations.routes')).default);
  app = http.createServer(server);
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.address() as any).port}`;
});

test.after(async () => {
  if (skipOpts.skip) return;
  await new Promise<void>((r) => app.close(() => r()));
  await new Promise<void>((r) => authServer.close(() => r()));
  if (mods) await mods.prisma.$disconnect();
});

const get = (path: string, token?: string) => fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('REAL HTTP: /me/pt-wallet/contracts - 401 without a token, 403 for a non-PT, a PT sees only their own contracts, exact numbers from the ledger', skipOpts, async () => {
  const m = await load();
  await m.prisma.$executeRawUnsafe('TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations, contract_unpaid_obligations RESTART IDENTITY CASCADE');
  const D = (v: string | number) => new m.Prisma.Decimal(v);
  const rates = { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') };
  const mkContract = async (ptUserId: string, price: number, n: number) => {
    const sfx = randomUUID().slice(0, 8);
    const parties = { ptUserId, gymId: null, clientUserId: `client-${sfx}` };
    const txn = await m.prisma.paymentTransaction.create({
      data: {
        payerId: parties.clientUserId, purpose: 'PT_CONTRACT', amount: price, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
        providerTransactionId: `vnpay_${sfx}`, idempotencyKey: `c-${sfx}`, relatedEntityType: 'PT_CONTRACT', relatedEntityId: `contract-${sfx}`,
        activationStatus: 'PENDING', sourceService: 'integration-test',
        metadata: { rates: { platformRate: '0.10', ptRate: '0.90', gymRate: '0' }, parties },
      },
    });
    await m.ledger.settleContractPayment({ transactionId: txn.id, price: D(price), rates, parties, label: `c-${sfx}` });
    const release = (i: number) =>
      m.ledger.releaseSession({
        transactionId: txn.id, price: D(price), totalSessions: n, rates, parties, label: `s${i}`,
        idempotencyKey: `SESSION_RELEASE:${sfx}:${i}`, ptHoldbackRate: D('0.10'),
      });
    return { txn, release, parties, contractId: `contract-${sfx}`, n, price };
  };
  const mine = await mkContract(PT_ID, 1_000_000, 10);
  await mine.release(1);
  await mine.release(2);
  const other = await mkContract('pt-other', 2_000_000, 10);
  await other.release(1);

  assert.equal((await get('/me/pt-wallet/contracts')).status, 401);
  assert.equal((await get('/me/pt-wallet/contracts', 'customer')).status, 403);
  assert.equal((await get('/me/pt-wallet/contracts', 'nonsense')).status, 401);

  const res = await get('/me/pt-wallet/contracts', 'pt');
  assert.equal(res.status, 200);
  const d = ((await res.json()) as any).data;
  assert.equal(d.contracts.length, 1, 'only this PT’s contract');
  const c = d.contracts[0];
  assert.equal(c.contractId, mine.contractId);
  assert.deepEqual(
    { value: c.contractValue, expected: c.expectedIncome, target: c.holdbackTarget, pending: c.pending, earned: c.earned, held: c.held, avail: c.availableFromContract, state: c.release.state },
    { value: '1000000.00', expected: '900000.00', target: '90000.00', pending: '720000.00', earned: '180000.00', held: '90000.00', avail: '90000.00', state: 'RUNNING' },
  );
  assert.equal(d.wallet.held, '90000.00');
  assert.equal(d.wallet.available, '90000.00');
  assert.equal(d.totals.contractsHolding, 1);
  assert.ok(!JSON.stringify(d).includes('pt-other'), 'nothing of another PT’s money');

  // the wallet itself carries the new bucket
  const w = ((await (await get('/me/pt-wallet', 'pt')).json()) as any).data;
  assert.equal(w.holdbackBalance, '90000');
  assert.equal(w.availableBalance, '90000');
});

test('REAL HTTP: the held money cannot be withdrawn through the API', skipOpts, async () => {
  const wd = (amount: string, token: string) =>
    fetch(`${base}/me/withdrawals`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ amount, payoutInfo: 'Bank ABC 123' }) });
  const tooMuch = await wd('150000', 'pt'); // available 90.000, held 90.000: 150.000 would need the held money
  assert.equal(tooMuch.status, 400);
  assert.equal(((await tooMuch.json()) as any).error.code, 'EXCEEDS_WITHDRAWABLE_BALANCE');
  const ok = await wd('90000', 'pt');
  assert.equal(ok.status, 201, await ok.clone().text());
});

test('REAL HTTP: the admin obligations report carries the holdback section (ADMIN only)', skipOpts, async () => {
  assert.equal((await get('/admin/payments/obligations', 'customer')).status, 403);
  const res = await get('/admin/payments/obligations', 'admin');
  assert.equal(res.status, 200);
  const d = ((await res.json()) as any).data;
  assert.equal(d.summary.ptHoldback.contractsHolding, 2, 'this PT’s and the other PT’s contract');
  assert.equal(d.summary.ptHoldback.totalHeld, '270000.00', '90.000 + 180.000');
  assert.equal(d.summary.ptHoldback.stuck.count, 0);
  assert.equal(d.ptHoldbacks.length, 2);
  assert.ok(d.ptHoldbacks.every((r: any) => r.state === 'RUNNING' && r.pt.length <= 8), 'no full personal id in the report');
});
