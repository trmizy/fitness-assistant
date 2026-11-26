/**
 * POST/GET /me/withdrawals accept an explicit `wallet: "CLIENT" | "PT"` selector. A PT is also a client: refunds and compensation land in
 * its CLIENT wallet, teaching income in its PT wallet; before the selector every withdrawal by a PT was checked and debited against the PT
 * wallet, so a PT's CLIENT money could never be withdrawn and the list never showed it.
 *
 *   evidence label: BACKEND INTEGRATION (real express router + real *_test DB; the auth-service the routes verify tokens against is a stub).
 *
 * Run this file alone:
 *   DATABASE_URL="postgresql://gymcoach_test:<password>@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/withdrawal-wallet-selector.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';

const canRun = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const skipOpts = { skip: canRun ? false : 'Requires DATABASE_URL pointing at a *_test database.' };
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4029';

// ── 1. unit: the selector rules (no DB network use; the module import needs the env above only) ──────────────────
test('resolveWithdrawalWallet: absent selector keeps the historical default (PT -> PT, others -> CLIENT)', skipOpts, async () => {
  const { resolveWithdrawalWallet } = await import('../routes/wallet.routes');
  for (const raw of [undefined, null, '']) {
    assert.deepEqual(resolveWithdrawalWallet('PT', raw), { ok: true, ownerType: 'PT' });
    assert.deepEqual(resolveWithdrawalWallet('CUSTOMER', raw), { ok: true, ownerType: 'CLIENT' });
  }
});

test('resolveWithdrawalWallet: PT may use PT or CLIENT; CUSTOMER only CLIENT (403 WALLET_NOT_ALLOWED); junk is 400 INVALID_WALLET', skipOpts, async () => {
  const { resolveWithdrawalWallet } = await import('../routes/wallet.routes');
  assert.deepEqual(resolveWithdrawalWallet('PT', 'CLIENT'), { ok: true, ownerType: 'CLIENT' });
  assert.deepEqual(resolveWithdrawalWallet('PT', 'PT'), { ok: true, ownerType: 'PT' });
  assert.deepEqual(resolveWithdrawalWallet('CUSTOMER', 'CLIENT'), { ok: true, ownerType: 'CLIENT' });
  const refused = resolveWithdrawalWallet('CUSTOMER', 'PT');
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.deepEqual([refused.status, refused.code], [403, 'WALLET_NOT_ALLOWED']);
  for (const junk of ['GYM', 'ESCROW', 'pt', 'client', 'ADMIN', 7, {}, ['PT']]) {
    const r = resolveWithdrawalWallet('PT', junk);
    assert.equal(r.ok, false, String(junk));
    if (!r.ok) assert.deepEqual([r.status, r.code], [400, 'INVALID_WALLET']);
  }
});

// ── 2. integration ────────────────────────────────────────────────────────────────────────────────────────────────
const users: Record<string, { id: string; role: string }> = {
  'tok-pt': { id: randomUUID(), role: 'PT' },
  'tok-pt2': { id: randomUUID(), role: 'PT' },
  'tok-pt3': { id: randomUUID(), role: 'PT' },
  'tok-customer': { id: randomUUID(), role: 'CUSTOMER' },
};

let authServer: http.Server;
let appServer: http.Server;
let baseUrl = '';
let prisma: (typeof import('../repositories/prisma'))['prisma'];
let walletService: (typeof import('../services/wallet.service'))['walletService'];
let withdrawalService: (typeof import('../services/withdrawal.service'))['withdrawalService'];
let PrismaNs: (typeof import('../generated/prisma'))['Prisma'];
let assertInvariant: (typeof import('../services/reconcile.service'))['assertInvariant'];

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
  await new Promise<void>((r) => authServer.listen(4029, '127.0.0.1', r));
  prisma = (await import('../repositories/prisma')).prisma;
  PrismaNs = (await import('../generated/prisma')).Prisma;
  walletService = (await import('../services/wallet.service')).walletService;
  withdrawalService = (await import('../services/withdrawal.service')).withdrawalService;
  assertInvariant = (await import('../services/reconcile.service')).assertInvariant;
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
  if (prisma) await prisma.$disconnect();
});

async function fund(ownerType: 'PT' | 'CLIENT', ownerId: string, amount: string, description: string) {
  const wallet = await walletService.getOrCreateWallet(ownerType, ownerId);
  const escrow = await walletService.getEscrowWallet();
  const txn = await prisma.paymentTransaction.create({
    data: { id: randomUUID(), payerId: randomUUID(), purpose: 'PT_CONTRACT', amount: new PrismaNs.Decimal(amount), idempotencyKey: `test:${randomUUID()}`, status: 'PAID' },
  });
  await walletService.withWallets([wallet.id, escrow.id], txn.id, async (ops) => {
    await ops.credit(wallet.id, new PrismaNs.Decimal(amount), description);
    await ops.credit(escrow.id, new PrismaNs.Decimal(amount), `escrow intake for ${description}`);
  });
}
const REFUND = 'Contract xyz — refund (CLIENT_CANCELLED)';

async function call(tok: string, method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const balances = async (ownerType: 'PT' | 'CLIENT', ownerId: string) => {
  const w = await prisma.wallet.findFirst({ where: { ownerType, ownerId } });
  return { avail: w?.availableBalance.toFixed(0) ?? null, locked: w?.lockedBalance.toFixed(0) ?? null };
};
const dec = (v: string | null) => new PrismaNs.Decimal(v ?? '0');

test('a PT withdrawing with wallet=CLIENT is checked and recorded against the CLIENT wallet only; the PT wallet is untouched', skipOpts, async () => {
  const pt = users['tok-pt'];
  await fund('PT', pt.id, '500000', 'teaching income');
  await fund('CLIENT', pt.id, '200000', REFUND);
  const ptBefore = await balances('PT', pt.id);

  // Over the CLIENT refund money (200k) although the PT wallet could cover it: refused on the selected wallet.
  const over = await call('tok-pt', 'POST', '/me/withdrawals', { wallet: 'CLIENT', amount: '300000', payoutInfo: 'Bank A' });
  assert.equal(over.status, 400);
  assert.equal(over.json.error.code, 'EXCEEDS_WITHDRAWABLE_BALANCE');
  assert.match(over.json.error.message, /hoàn trả/, 'client-wallet wording');

  const ok = await call('tok-pt', 'POST', '/me/withdrawals', { wallet: 'CLIENT', amount: '150000', payoutInfo: 'Bank A' });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.ownerType, 'CLIENT');
  assert.equal(ok.json.data.ownerId, pt.id);
  const clientWallet = await prisma.wallet.findFirstOrThrow({ where: { ownerType: 'CLIENT', ownerId: pt.id } });
  assert.equal(ok.json.data.walletId, clientWallet.id);

  // A second request for 100k now exceeds the remaining 50k (pending reserved on the CLIENT wallet).
  const again = await call('tok-pt', 'POST', '/me/withdrawals', { wallet: 'CLIENT', amount: '100000', payoutInfo: 'Bank A' });
  assert.equal(again.status, 400);
  assert.equal(again.json.error.code, 'EXCEEDS_WITHDRAWABLE_BALANCE');

  assert.deepEqual(await balances('PT', pt.id), ptBefore, 'PT wallet untouched');
  assert.equal(await prisma.withdrawalRequest.count({ where: { ownerType: 'PT', ownerId: pt.id } }), 0);
});

test('admin approve + markPaid of that CLIENT request debits the CLIENT wallet (AVAILABLE -> LOCKED -> out) and escrow; invariant holds', skipOpts, async () => {
  const pt = users['tok-pt'];
  const req = await prisma.withdrawalRequest.findFirstOrThrow({ where: { ownerType: 'CLIENT', ownerId: pt.id, status: 'PENDING' } });
  const ptBefore = await balances('PT', pt.id);
  const clientBefore = await balances('CLIENT', pt.id);

  await withdrawalService.approve(req.id, 'admin-1');
  const approved = await balances('CLIENT', pt.id);
  assert.equal(dec(approved.avail).toFixed(0), dec(clientBefore.avail).minus(150000).toFixed(0));
  assert.equal(dec(approved.locked).toFixed(0), dec(clientBefore.locked).plus(150000).toFixed(0));

  await withdrawalService.markPaid(req.id, 'admin-1', 'BANKREF-1');
  const paid = await balances('CLIENT', pt.id);
  assert.equal(dec(paid.locked).toFixed(0), dec(clientBefore.locked).toFixed(0));
  assert.equal(dec(paid.avail).toFixed(0), dec(approved.avail).toFixed(0));
  assert.deepEqual(await balances('PT', pt.id), ptBefore, 'PT wallet still untouched');
  await assertInvariant();
});

test('a PT with NO selector keeps the old behaviour: the PT wallet is used (and the CLIENT wallet is not); lists are per selector', skipOpts, async () => {
  const pt = users['tok-pt2'];
  await fund('PT', pt.id, '300000', 'teaching income');
  await fund('CLIENT', pt.id, '100000', REFUND);
  const clientBefore = await balances('CLIENT', pt.id);

  const ok = await call('tok-pt2', 'POST', '/me/withdrawals', { amount: '250000', payoutInfo: 'Bank B' });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.ownerType, 'PT');
  const same = await call('tok-pt2', 'POST', '/me/withdrawals', { wallet: 'PT', amount: '10000', payoutInfo: 'Bank B' });
  assert.equal(same.status, 201);
  assert.equal(same.json.data.ownerType, 'PT');
  assert.deepEqual(await balances('CLIENT', pt.id), clientBefore);

  const def = await call('tok-pt2', 'GET', '/me/withdrawals');
  assert.equal(def.status, 200);
  assert.equal(def.json.data.length, 2);
  assert.ok(def.json.data.every((r: any) => r.ownerType === 'PT'));
  const client = await call('tok-pt2', 'GET', '/me/withdrawals?wallet=CLIENT');
  assert.equal(client.status, 200);
  assert.deepEqual(client.json.data, []);

  const c = await call('tok-pt2', 'POST', '/me/withdrawals', { wallet: 'CLIENT', amount: '50000', payoutInfo: 'Bank B' });
  assert.equal(c.status, 201);
  const lc = await call('tok-pt2', 'GET', '/me/withdrawals?wallet=CLIENT');
  assert.equal(lc.json.data.length, 1);
  assert.equal(lc.json.data[0].ownerType, 'CLIENT');
  const lp = await call('tok-pt2', 'GET', '/me/withdrawals?wallet=PT');
  assert.equal(lp.json.data.length, 2);
  assert.ok(lp.json.data.every((r: any) => r.ownerType === 'PT'));
  assert.equal((await call('tok-pt2', 'GET', '/me/withdrawals?wallet=GYM')).status, 400);
});

test('a PT with PT-wallet over-balance via wallet=PT is refused on the PT wallet (PT wording, not the refund wording)', skipOpts, async () => {
  const pt = users['tok-pt2'];
  const over = await call('tok-pt2', 'POST', '/me/withdrawals', { wallet: 'PT', amount: '900000', payoutInfo: 'Bank B' });
  assert.equal(over.status, 400);
  assert.equal(over.json.error.code, 'EXCEEDS_WITHDRAWABLE_BALANCE');
  assert.doesNotMatch(over.json.error.message, /hoàn trả/);
  assert.equal(await prisma.withdrawalRequest.count({ where: { ownerType: 'PT', ownerId: pt.id } }), 2);
});

test('a CUSTOMER asking wallet=PT is refused 403 WALLET_NOT_ALLOWED (POST and GET), nothing is written; wallet=CLIENT works', skipOpts, async () => {
  const c = users['tok-customer'];
  await fund('CLIENT', c.id, '100000', REFUND);
  const post = await call('tok-customer', 'POST', '/me/withdrawals', { wallet: 'PT', amount: '20000', payoutInfo: 'Bank C' });
  assert.equal(post.status, 403);
  assert.equal(post.json.error.code, 'WALLET_NOT_ALLOWED');
  const get = await call('tok-customer', 'GET', '/me/withdrawals?wallet=PT');
  assert.equal(get.status, 403);
  assert.equal(get.json.error.code, 'WALLET_NOT_ALLOWED');
  assert.equal(await prisma.withdrawalRequest.count({ where: { ownerId: c.id } }), 0);
  assert.equal(await prisma.wallet.count({ where: { ownerType: 'PT', ownerId: c.id } }), 0, 'no PT wallet created for a customer');

  const bad = await call('tok-customer', 'POST', '/me/withdrawals', { wallet: 'GYM', amount: '20000', payoutInfo: 'Bank C' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'INVALID_WALLET');

  const ok = await call('tok-customer', 'POST', '/me/withdrawals', { wallet: 'CLIENT', amount: '20000', payoutInfo: 'Bank C' });
  assert.equal(ok.status, 201);
  const noSel = await call('tok-customer', 'POST', '/me/withdrawals', { amount: '20000', payoutInfo: 'Bank C' });
  assert.equal(noSel.status, 201, 'customer without a selector keeps the CLIENT default');
  assert.equal((await call('tok-customer', 'GET', '/me/withdrawals')).json.data.length, 2);
});

test('idempotency unchanged on a CLIENT-selected request: paying twice in parallel debits and escrow-debits exactly once', skipOpts, async () => {
  const id = users['tok-pt3'].id;
  await fund('PT', id, '400000', 'teaching income');
  await fund('CLIENT', id, '100000', REFUND);
  const created = await call('tok-pt3', 'POST', '/me/withdrawals', { wallet: 'CLIENT', amount: '60000', payoutInfo: 'Bank D' });
  assert.equal(created.status, 201);
  const reqId = created.json.data.id as string;
  const before = await balances('CLIENT', id);
  await Promise.all([withdrawalService.markPaid(reqId, 'admin-1', 'REF-X'), withdrawalService.markPaid(reqId, 'admin-1', 'REF-X')].map((p) => p.catch(() => null)));
  const after = await balances('CLIENT', id);
  assert.equal(dec(before.avail).minus(after.avail ?? '0').toFixed(0), '60000', 'debited exactly once');
  assert.equal((await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: reqId } })).status, 'PAID');
  await assertInvariant();
});
