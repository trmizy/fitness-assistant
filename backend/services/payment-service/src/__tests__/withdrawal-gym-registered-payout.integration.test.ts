/**
 * Gym Owner handoff items 1, 3 and 7 (owner decisions 22/11/2026) on the payment-service side:
 *   item 1  a GYM withdrawal request stores WHO asked (requested_by_user_id) and that its destination is the registered payout account
 *           (payout_source); the internal route REFUSES a call that does not carry both (400), so no caller can reintroduce a free-text
 *           destination; PT / CLIENT requests are unchanged (columns stay NULL, the four-eyes rule and the old flow still work).
 *   item 7  GET /internal/wallets/GYM/:id returns withdrawable + reservedPending computed by the SAME function requestWithdrawal checks
 *           against: withdrawable accepted, withdrawable + 1 refused, a PENDING request lowers it.
 *   item 3  approve / reject (with the reason) / pay of a GYM request send one bell notice to each OWNER of the branch's partner (resolved
 *           from gym-service) plus the requester; gym-service down -> the requester alone; PT notices unchanged.
 *
 *   evidence label: BACKEND INTEGRATION (real routes, real withdrawalService, real ledger, real *_test database). gym-service and
 *   user-service are TEST FIXTURE HTTP servers.
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_wdreg_test?schema=public" \
 *     FITNESS_DISABLE_REDIS=true ./node_modules/.bin/tsx --test src/__tests__/withdrawal-gym-registered-payout.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';
import { Prisma } from '../generated/prisma';

const canUseIntegrationDb = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const skipOpts = { skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

const SECRET = 'wdreg-internal-secret';
const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const REQUESTER = OWNER_A;
const ADMIN_A = randomUUID();
const ADMIN_B = randomUUID();

type Notice = { path: string; body: any };
const notices: Notice[] = [];
let gymLookups: string[] = [];
let gymServiceDown = false;
let gymServer: http.Server;
let userServer: http.Server;
let appServer: http.Server;
let baseUrl = '';

type Deps = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  walletService: (typeof import('../services/wallet.service'))['walletService'];
  withdrawalService: (typeof import('../services/withdrawal.service'))['withdrawalService'];
  notify: typeof import('../services/withdrawal-notification.service');
  computeWithdrawable: (typeof import('../services/withdrawable-balance'))['computeWithdrawable'];
};
let d: Deps;

test.before(async () => {
  if (!canUseIntegrationDb) return;
  process.env.INTERNAL_SERVICE_SECRET = SECRET;
  gymServer = http.createServer((req, res) => {
    const m = /^\/internal\/gyms\/([^/]+)\/withdrawal-recipients$/.exec(req.url ?? '');
    if (req.method === 'POST' && m && req.headers['x-service-secret'] === SECRET && !gymServiceDown) {
      gymLookups.push(decodeURIComponent(m[1]));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { userIds: [OWNER_A, OWNER_B], gymName: 'Gym Quận 1' } }));
      return;
    }
    res.writeHead(gymServiceDown ? 503 : 404);
    res.end();
  });
  userServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      notices.push({ path: req.url ?? '', body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {} });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  });
  await new Promise<void>((r) => gymServer.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => userServer.listen(0, '127.0.0.1', r));
  process.env.GYM_SERVICE_URL = `http://127.0.0.1:${(gymServer.address() as AddressInfo).port}`;
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${(userServer.address() as AddressInfo).port}`;
  delete process.env.GYM_LAMBDA_NAME;
  delete process.env.USER_LAMBDA_NAME;

  const { default: internalRoutes } = await import('../routes/internal.routes');
  const app = express();
  app.use(express.json());
  app.use('/internal', internalRoutes);
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;

  d = {
    prisma: (await import('../repositories/prisma')).prisma,
    walletService: (await import('../services/wallet.service')).walletService,
    withdrawalService: (await import('../services/withdrawal.service')).withdrawalService,
    notify: await import('../services/withdrawal-notification.service'),
    computeWithdrawable: (await import('../services/withdrawable-balance')).computeWithdrawable,
  };
});

test.after(async () => {
  if (!canUseIntegrationDb) return;
  await new Promise<void>((r) => appServer.close(() => r()));
  await new Promise<void>((r) => gymServer.close(() => r()));
  await new Promise<void>((r) => userServer.close(() => r()));
  await d.prisma.$disconnect();
});

test.beforeEach(() => {
  notices.length = 0;
  gymLookups = [];
  gymServiceDown = false;
});

async function fund(ownerType: 'PT' | 'GYM', ownerId: string, amount: string) {
  const wallet = await d.walletService.getOrCreateWallet(ownerType, ownerId);
  const escrow = await d.walletService.getEscrowWallet();
  const txn = await d.prisma.paymentTransaction.create({
    data: { id: randomUUID(), payerId: randomUUID(), purpose: 'PT_CONTRACT', amount: new Prisma.Decimal(amount), idempotencyKey: `test:${randomUUID()}`, status: 'PAID', activationStatus: 'ACTIVATED' },
  });
  // a GYM credit repays gym debt from the REVENUE wallet, so ledger ops on a GYM wallet must lock it too.
  const revenue = await d.walletService.getRevenueWallet();
  await d.walletService.withWallets([wallet.id, escrow.id, revenue.id], txn.id, async (ops) => {
    await ops.credit(wallet.id, new Prisma.Decimal(amount), 'test earnings');
    await ops.credit(escrow.id, new Prisma.Decimal(amount), 'escrow intake for test earnings');
  });
  return wallet;
}

async function call(method: string, path: string, body?: unknown, secret: string | null = SECRET) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-service-secret': secret } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) as any };
}

const REGISTERED = { payoutSource: 'REGISTERED_ACCOUNT', requestedByUserId: REQUESTER };

test('internal GYM route: stores the requester and the registered-account marker; the row is what the admin queue returns', skipOpts, async () => {
  const gymId = randomUUID();
  await fund('GYM', gymId, '2000000');
  const r = await call('POST', `/internal/withdrawals/gym/${gymId}`, { amount: '500000', payoutInfo: 'Vietcombank — 0123456789 — NGUYEN VAN A', ...REGISTERED });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.requestedByUserId, REQUESTER);
  assert.equal(r.json.data.payoutSource, 'REGISTERED_ACCOUNT');
  assert.equal(r.json.data.payoutInfo, 'Vietcombank — 0123456789 — NGUYEN VAN A');
  const queue = await d.withdrawalService.listPending();
  const row = queue.find((q) => q.id === r.json.data.id);
  assert.ok(row, 'in the admin queue');
  assert.equal(row!.requestedByUserId, REQUESTER);
  assert.equal(row!.payoutSource, 'REGISTERED_ACCOUNT');
});

test('internal GYM route: a call without payoutSource or without requestedByUserId is refused 400 and writes nothing', skipOpts, async () => {
  const gymId = randomUUID();
  const wallet = await fund('GYM', gymId, '1000000');
  for (const body of [
    { amount: '100000', payoutInfo: 'Some bank typed by the client' },
    { amount: '100000', payoutInfo: 'x', payoutSource: 'REGISTERED_ACCOUNT' },
    { amount: '100000', payoutInfo: 'x', requestedByUserId: REQUESTER },
    { amount: '100000', payoutInfo: 'x', payoutSource: 'FREE_TEXT', requestedByUserId: REQUESTER },
  ]) {
    const r = await call('POST', `/internal/withdrawals/gym/${gymId}`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(await d.prisma.withdrawalRequest.count({ where: { walletId: wallet.id } }), 0);
  assert.equal((await call('POST', `/internal/withdrawals/gym/${gymId}`, { amount: '100000', payoutInfo: 'x', ...REGISTERED }, null)).status, 401);
});

test('PT request is unchanged: requested_by_user_id and payout_source stay NULL, the old flow and four-eyes rule still work', skipOpts, async () => {
  const ptId = randomUUID();
  await fund('PT', ptId, '7000000');
  const req = await d.withdrawalService.requestWithdrawal('PT', ptId, '6000000', 'Bank ABC 0123');
  assert.equal(req.requestedByUserId, null);
  assert.equal(req.payoutSource, null);
  await d.withdrawalService.approve(req.id, ADMIN_A);
  await assert.rejects(() => d.withdrawalService.markPaid(req.id, ADMIN_A, 'REF-1'), (e: any) => e.code === 'FOUR_EYES_REQUIRED');
  const paid = await d.withdrawalService.markPaid(req.id, ADMIN_B, 'REF-2');
  assert.equal(paid.status, 'PAID');
  await d.notify.drainWithdrawalNotifications();
  const toPt = notices.filter((n) => n.body.userId === ptId);
  assert.deepEqual(toPt.map((n) => n.body.eventType).sort(), ['WITHDRAWAL_APPROVED', 'WITHDRAWAL_PAID']);
  assert.ok(toPt.every((n) => n.body.link === '/pt/wallet'));
  assert.equal(gymLookups.length, 0, 'a PT withdrawal never asks gym-service');
});

test('item 7: GET wallet returns withdrawable + reservedPending = the number requestWithdrawal enforces (boundary accepted, +1 refused)', skipOpts, async () => {
  const gymId = randomUUID();
  await fund('GYM', gymId, '1000000');
  let w = (await call('GET', `/internal/wallets/GYM/${gymId}`)).json.data;
  assert.equal(Number(w.withdrawable), 1000000);
  assert.equal(Number(w.reservedPending), 0);

  // a PENDING request lowers "Có thể rút" while availableBalance still shows the old number — the exact mismatch of the handoff.
  await d.withdrawalService.requestWithdrawal('GYM', gymId, '300000', 'Bank — 111 — A', REGISTERED);
  w = (await call('GET', `/internal/wallets/GYM/${gymId}`)).json.data;
  assert.equal(Number(w.availableBalance), 1000000 - 0, 'PENDING does not move money yet');
  assert.equal(Number(w.reservedPending), 300000);
  assert.equal(Number(w.withdrawable), 700000);

  const w2 = await d.computeWithdrawable('GYM', gymId, (await d.walletService.getOrCreateWallet('GYM', gymId)));
  assert.equal(w2.withdrawable.toFixed(2), w.withdrawable, 'the DTO and the helper are the same number');

  await assert.rejects(
    () => d.withdrawalService.requestWithdrawal('GYM', gymId, '700001', 'Bank — 111 — A', REGISTERED),
    (e: any) => e.code === 'EXCEEDS_WITHDRAWABLE_BALANCE',
  );
  const ok = await d.withdrawalService.requestWithdrawal('GYM', gymId, String(w.withdrawable).replace(/\.00$/, ''), 'Bank — 111 — A', REGISTERED);
  assert.equal(ok.status, 'PENDING');
  w = (await call('GET', `/internal/wallets/GYM/${gymId}`)).json.data;
  assert.equal(Number(w.withdrawable), 0);
  assert.equal(Number(w.reservedPending), 1000000);
});

test('item 7: a PT wallet DTO is unchanged (no withdrawable field)', skipOpts, async () => {
  const ptId = randomUUID();
  await fund('PT', ptId, '100000');
  const w = (await call('GET', `/internal/wallets/PT/${ptId}`)).json.data;
  assert.equal(w.withdrawable, undefined);
});

test('item 3: approve / reject with reason / pay of a GYM request each notify BOTH owners of the partner (from gym-service) once, incl. the requester, with the reason', skipOpts, async () => {
  const gymId = randomUUID();
  await fund('GYM', gymId, '3000000');
  const a = await d.withdrawalService.requestWithdrawal('GYM', gymId, '500000', 'Bank — 1 — A', { requestedByUserId: REQUESTER, payoutSource: 'REGISTERED_ACCOUNT' });
  const b = await d.withdrawalService.requestWithdrawal('GYM', gymId, '600000', 'Bank — 1 — A', { requestedByUserId: REQUESTER, payoutSource: 'REGISTERED_ACCOUNT' });

  await d.withdrawalService.approve(a.id, ADMIN_A);
  await d.notify.drainWithdrawalNotifications();
  let mine = notices.filter((n) => n.body.entityId === a.id);
  assert.deepEqual(mine.map((n) => n.body.userId).sort(), [OWNER_A, OWNER_B].sort(), 'requester is an owner here, so no duplicate');
  assert.ok(mine.every((n) => n.body.eventType === 'WITHDRAWAL_APPROVED' && n.path === '/internal/notifications' && n.body.entityType === 'WITHDRAWAL_REQUEST'));
  assert.ok(mine.every((n) => n.body.link === `/gym-owner/gyms/${gymId}`));
  assert.ok(mine.every((n) => /của chi nhánh Gym Quận 1/.test(n.body.text)));
  assert.deepEqual(gymLookups, [gymId], 'the lookup is by the branch id (the wallet owner id)');

  await d.withdrawalService.markPaid(a.id, ADMIN_B, 'VCB-777');
  await d.notify.drainWithdrawalNotifications();
  mine = notices.filter((n) => n.body.entityId === a.id && n.body.eventType === 'WITHDRAWAL_PAID');
  assert.equal(mine.length, 2);
  assert.ok(mine.every((n) => /mã tham chiếu VCB-777/.test(n.body.text)));

  notices.length = 0;
  await d.withdrawalService.reject(b.id, ADMIN_A, 'Tên chủ tài khoản không khớp');
  await d.notify.drainWithdrawalNotifications();
  mine = notices.filter((n) => n.body.entityId === b.id);
  assert.equal(mine.length, 2);
  assert.ok(mine.every((n) => n.body.eventType === 'WITHDRAWAL_REJECTED' && /Lý do: Tên chủ tài khoản không khớp/.test(n.body.text)));

  // a replay changes nothing and tells nobody
  notices.length = 0;
  await d.withdrawalService.reject(b.id, ADMIN_B, 'again');
  await d.notify.drainWithdrawalNotifications();
  assert.equal(notices.length, 0);
});

test('item 3: a requester who is not among the owners is told as well; an old row without a requester still reaches the owners', skipOpts, async () => {
  const gymId = randomUUID();
  await fund('GYM', gymId, '2000000');
  const stranger = randomUUID();
  const withRequester = await d.withdrawalService.requestWithdrawal('GYM', gymId, '100000', 'B — 1 — A', { requestedByUserId: stranger, payoutSource: 'REGISTERED_ACCOUNT' });
  const oldRow = await d.withdrawalService.requestWithdrawal('GYM', gymId, '110000', 'free text from before the migration');
  assert.equal(oldRow.requestedByUserId, null);

  await d.withdrawalService.reject(withRequester.id, ADMIN_A, 'r1');
  await d.notify.drainWithdrawalNotifications();
  assert.deepEqual(notices.filter((n) => n.body.entityId === withRequester.id).map((n) => n.body.userId).sort(), [OWNER_A, OWNER_B, stranger].sort());

  notices.length = 0;
  await d.withdrawalService.reject(oldRow.id, ADMIN_A, 'r2');
  await d.notify.drainWithdrawalNotifications();
  assert.deepEqual(notices.filter((n) => n.body.entityId === oldRow.id).map((n) => n.body.userId).sort(), [OWNER_A, OWNER_B].sort());
});

test('item 3: gym-service down -> the requester alone is told and the withdrawal decision still succeeds', skipOpts, async () => {
  const gymId = randomUUID();
  await fund('GYM', gymId, '1000000');
  const req = await d.withdrawalService.requestWithdrawal('GYM', gymId, '200000', 'B — 1 — A', { requestedByUserId: REQUESTER, payoutSource: 'REGISTERED_ACCOUNT' });
  gymServiceDown = true;
  const rejected = await d.withdrawalService.reject(req.id, ADMIN_A, 'sai tài khoản');
  assert.equal(rejected.status, 'REJECTED');
  await d.notify.drainWithdrawalNotifications();
  assert.deepEqual(notices.filter((n) => n.body.entityId === req.id).map((n) => n.body.userId), [REQUESTER]);
});
