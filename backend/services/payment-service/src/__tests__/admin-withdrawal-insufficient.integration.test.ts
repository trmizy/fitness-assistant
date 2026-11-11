/**
 * G-13 - approve / mark-paid of a withdrawal whose wallet no longer has the balance -> 409 INSUFFICIENT_BALANCE
 * (was 500 with the raw English message), and the money tables do not move.
 *
 *   evidence label: BACKEND INTEGRATION (real admin router + real withdrawalService + real *_test database;
 *   auth-service is a TEST FIXTURE). Rows are seeded with a W10- marker and only those rows are deleted.
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     npx tsx --test --test-concurrency=1 src/__tests__/admin-withdrawal-insufficient.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';
import { Prisma } from '../generated/prisma';

const canUseIntegrationDb = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const skipOpts = { skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4153';
const MARK = `W10-${randomUUID().slice(0, 8)}`;
const walletIds: string[] = [];
const fundingTxnIds: string[] = [];
let escrowIntake = new Prisma.Decimal(0); // what this file credited to the shared ESCROW wallet; taken back in cleanup
const requestIds: string[] = [];

let authServer: http.Server;
let testApp: http.Server;
let baseUrl = '';
type Deps = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  walletService: (typeof import('../services/wallet.service'))['walletService'];
  withdrawalService: (typeof import('../services/withdrawal.service'))['withdrawalService'];
};
let d: Deps;

test.before(async () => {
  if (!canUseIntegrationDb) return;
  d = {
    prisma: (await import('../repositories/prisma')).prisma,
    walletService: (await import('../services/wallet.service')).walletService,
    withdrawalService: (await import('../services/withdrawal.service')).withdrawalService,
  };
  authServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const ok = String(req.headers.authorization || '') === 'Bearer real-admin-token';
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { user: { id: `${MARK}-admin`, email: 'x@example.com', role: 'ADMIN' } } : { error: 'invalid token' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(4153, '127.0.0.1', r));
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
  if (!d?.prisma) return;
  // Only the rows this file created (ids collected above + the payout transactions keyed WITHDRAWAL:<our request id>).
  const payoutKeys = requestIds.map((id) => `WITHDRAWAL:${id}`);
  const payoutTxns = await d.prisma.paymentTransaction.findMany({ where: { idempotencyKey: { in: payoutKeys } }, select: { id: true } });
  const txnIds = [...fundingTxnIds, ...payoutTxns.map((t) => t.id)];
  await d.prisma.walletLedgerEntry.deleteMany({ where: { OR: [{ walletId: { in: walletIds } }, { transactionId: { in: txnIds } }] } });
  await d.prisma.withdrawalRequest.deleteMany({ where: { id: { in: requestIds } } });
  await d.prisma.paymentTransaction.deleteMany({ where: { id: { in: txnIds } } });
  await d.prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  // The partner wallets are gone, so take back exactly the escrow intake we added, or the shared ledger invariant drifts.
  if (escrowIntake.greaterThan(0)) {
    const escrow = await d.walletService.getEscrowWallet();
    await d.prisma.wallet.update({ where: { id: escrow.id }, data: { availableBalance: { decrement: escrowIntake } } });
  }
  await new Promise<void>((resolve, reject) => testApp.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => authServer.close((e) => (e ? reject(e) : resolve())));
  await d.prisma.$disconnect();
});

/** A PENDING request of 150,000 whose wallet balance was then drained to zero (like a clawback that outran it). */
async function pendingRequestWithDrainedWallet() {
  const ownerId = `${MARK}-${randomUUID()}`;
  const wallet = await d.walletService.getOrCreateWallet('PT', ownerId);
  walletIds.push(wallet.id);
  const escrow = await d.walletService.getEscrowWallet();
  const txn = await d.prisma.paymentTransaction.create({
    data: {
      id: randomUUID(),
      payerId: randomUUID(),
      purpose: 'PT_CONTRACT',
      amount: new Prisma.Decimal('150000'),
      idempotencyKey: `test:${MARK}:${randomUUID()}`,
      status: 'PAID',
    },
  });
  fundingTxnIds.push(txn.id);
  await d.walletService.withWallets([wallet.id, escrow.id], txn.id, async (ops) => {
    await ops.credit(wallet.id, new Prisma.Decimal('150000'), `${MARK} earnings`);
    await ops.credit(escrow.id, new Prisma.Decimal('150000'), `${MARK} escrow intake`);
  });
  escrowIntake = escrowIntake.plus('150000');
  const req = await d.withdrawalService.requestWithdrawal('PT', ownerId, '150000', `${MARK} Bank`);
  requestIds.push(req.id);
  await d.prisma.wallet.update({ where: { id: wallet.id }, data: { availableBalance: new Prisma.Decimal(0) } });
  return { req, wallet };
}

async function snapshot(walletId: string, requestId: string) {
  const w = await d.prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  const r = await d.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: requestId } });
  const ledger = await d.prisma.walletLedgerEntry.count({ where: { walletId } });
  return {
    available: w.availableBalance.toFixed(2),
    locked: w.lockedBalance.toFixed(2),
    pending: w.pendingBalance.toFixed(2),
    status: r.status,
    reviewedBy: r.reviewedBy,
    paidAt: r.paidAt,
    bankReference: r.bankReference,
    ledger,
  };
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}/admin/payments/withdrawals/${path}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer real-admin-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

test('approve of a request whose wallet lacks the balance -> 409 INSUFFICIENT_BALANCE, wallet / request / ledger unchanged', skipOpts, async () => {
  const { req, wallet } = await pendingRequestWithDrainedWallet();
  const before = await snapshot(wallet.id, req.id);
  const r = await post(`${req.id}/approve`, {});
  assert.equal(r.status, 409);
  assert.equal(r.json.success, false);
  assert.equal(r.json.error.code, 'INSUFFICIENT_BALANCE');
  assert.doesNotMatch(r.text, /Insufficient balance in wallet/);
  assert.deepEqual(await snapshot(wallet.id, req.id), before, 'nothing moved');
  assert.equal(before.status, 'PENDING');
});

test('mark-paid of a request whose wallet lacks the balance -> 409 INSUFFICIENT_BALANCE, wallet / request / ledger unchanged', skipOpts, async () => {
  const { req, wallet } = await pendingRequestWithDrainedWallet();
  const before = await snapshot(wallet.id, req.id);
  const r = await post(`${req.id}/mark-paid`, { bankReference: `${MARK}-REF` });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'INSUFFICIENT_BALANCE');
  assert.doesNotMatch(r.text, /Insufficient balance in wallet/);
  assert.deepEqual(await snapshot(wallet.id, req.id), before, 'nothing moved');
  assert.equal(before.status, 'PENDING');
  assert.equal(before.paidAt, null);
});

test('state conflicts are 409 with the same codes: approve / mark-paid of a REJECTED request -> INVALID_STATUS, reject of a PAID one -> ALREADY_PAID', skipOpts, async () => {
  const { req } = await pendingRequestWithDrainedWallet();
  const rejected = await post(`${req.id}/reject`, { reason: `${MARK} reason` });
  assert.equal(rejected.status, 200);
  const again = await post(`${req.id}/approve`, {});
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'INVALID_STATUS');
  const pay = await post(`${req.id}/mark-paid`, { bankReference: `${MARK}-REF` });
  assert.equal(pay.status, 409);
  assert.equal(pay.json.error.code, 'INVALID_STATUS');

  await d.prisma.withdrawalRequest.update({ where: { id: req.id }, data: { status: 'PAID', paidAt: new Date() } });
  const rej = await post(`${req.id}/reject`, { reason: `${MARK} reason` });
  assert.equal(rej.status, 409);
  assert.equal(rej.json.error.code, 'ALREADY_PAID');
});
