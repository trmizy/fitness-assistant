/**
 * FIX-PAY (14/11/2026), withdrawals:
 *   N13F-02  the stale-PROCESSING sweep must NOT mark FAILED the payout transaction of a withdrawal that legitimately waits for a person
 *            (an APPROVED >= 5,000,000 request waiting for the second admin); it still sweeps a payout whose request is REJECTED and every
 *            other stale non-top-up transaction. The approved request is then paid by the second admin exactly once.
 *   Q7       paying straight from PENDING below the four-eyes threshold also records the approval (reviewedBy / reviewedAt = that admin,
 *            shown as approvedBy in the history); >= the threshold is unchanged (409 FOUR_EYES_REQUIRED, nothing recorded).
 *   Q9       notices through user-service POST /internal/notifications: the owner on approved / paid / rejected (Vietnamese, amount like the
 *            rest of the app), every OTHER active admin when a large request waits for a second admin; one notice per real transition
 *            (a replay sends nothing); a notification outage never fails or rolls back the withdrawal.
 *
 *   evidence label: BACKEND INTEGRATION (real withdrawalService + real reconciliation job + real *_test database; auth-service and
 *   user-service are TEST FIXTURE HTTP servers).
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_fixpay_test?schema=public" \
 *     FITNESS_DISABLE_REDIS=true ./node_modules/.bin/tsx --test src/__tests__/withdrawal-sweep-q7-notifications.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'node:net';
import { isTestDatabaseUrl } from './support/test-db-guard';
import { Prisma } from '../generated/prisma';

const canUseIntegrationDb = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const skipOpts = { skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

const ADMIN_A = randomUUID();
const ADMIN_B = randomUUID();
const ADMIN_C = randomUUID();

type Notice = { path: string; secret: string | undefined; body: any };
const notices: Notice[] = [];
let notificationsStatus = 200;
let authServer: http.Server;
let userServer: http.Server;

type Deps = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  walletService: (typeof import('../services/wallet.service'))['walletService'];
  withdrawalService: (typeof import('../services/withdrawal.service'))['withdrawalService'];
  recon: typeof import('../services/reconciliation.service');
  txRepo: (typeof import('../repositories/transaction.repository'))['transactionRepository'];
  notify: typeof import('../services/withdrawal-notification.service');
  history: (typeof import('../services/admin-withdrawal-history.service'))['adminWithdrawalHistoryService'];
  historySchema: (typeof import('../services/admin-withdrawal-history.service'))['adminWithdrawalHistoryQuerySchema'];
};
let d: Deps;

test.before(async () => {
  if (!canUseIntegrationDb) return;
  authServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/auth/internal/admins') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ admins: [{ id: ADMIN_A }, { id: ADMIN_B }, { id: ADMIN_C }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  userServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      notices.push({ path: req.url ?? '', secret: req.headers['x-service-secret'] as string | undefined, body });
      res.writeHead(notificationsStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  });
  await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => userServer.listen(0, '127.0.0.1', r));
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authServer.address() as AddressInfo).port}`;
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${(userServer.address() as AddressInfo).port}`;
  delete process.env.USER_LAMBDA_NAME;
  delete process.env.AUTH_LAMBDA_NAME;
  const hist = await import('../services/admin-withdrawal-history.service');
  d = {
    prisma: (await import('../repositories/prisma')).prisma,
    walletService: (await import('../services/wallet.service')).walletService,
    withdrawalService: (await import('../services/withdrawal.service')).withdrawalService,
    recon: await import('../services/reconciliation.service'),
    txRepo: (await import('../repositories/transaction.repository')).transactionRepository,
    notify: await import('../services/withdrawal-notification.service'),
    history: hist.adminWithdrawalHistoryService,
    historySchema: hist.adminWithdrawalHistoryQuerySchema,
  };
});

test.after(async () => {
  if (!canUseIntegrationDb) return;
  await new Promise<void>((r) => authServer.close(() => r()));
  await new Promise<void>((r) => userServer.close(() => r()));
  await d.prisma.$disconnect();
});

test.beforeEach(() => {
  notices.length = 0;
  notificationsStatus = 200;
});

async function fund(ownerType: 'PT' | 'CLIENT', ownerId: string, amount: string) {
  const wallet = await d.walletService.getOrCreateWallet(ownerType, ownerId);
  const escrow = await d.walletService.getEscrowWallet();
  const txn = await d.prisma.paymentTransaction.create({
    data: { id: randomUUID(), payerId: randomUUID(), purpose: 'PT_CONTRACT', amount: new Prisma.Decimal(amount), idempotencyKey: `test:${randomUUID()}`, status: 'PAID', activationStatus: 'ACTIVATED' },
  });
  await d.walletService.withWallets([wallet.id, escrow.id], txn.id, async (ops) => {
    await ops.credit(wallet.id, new Prisma.Decimal(amount), 'test earnings');
    await ops.credit(escrow.id, new Prisma.Decimal(amount), 'escrow intake for test earnings');
  });
  return wallet;
}

async function pendingRequest(amount: string, ownerType: 'PT' | 'CLIENT' = 'PT') {
  const ownerId = randomUUID();
  const wallet = await fund(ownerType, ownerId, amount);
  const req = await d.withdrawalService.requestWithdrawal(ownerType, ownerId, amount, 'Bank ABC 0123');
  return { req, wallet, ownerId };
}

function codeIs(code: string) {
  return (e: unknown) => (e as { code?: string }).code === code;
}

async function ageTransaction(id: string, minutes: number) {
  await d.prisma.$executeRaw`UPDATE payment_transactions SET updated_at = NOW() - (${minutes} || ' minutes')::INTERVAL WHERE id = ${id}`;
}
const payoutKey = (requestId: string) => `WITHDRAWAL:${requestId}`;
async function payoutTxn(requestId: string) {
  return d.prisma.paymentTransaction.findUniqueOrThrow({ where: { idempotencyKey: payoutKey(requestId) } });
}

// ---- N13F-02 ------------------------------------------------------------------------------------------------------------------------------

test('N13F-02: an APPROVED >= 5M withdrawal waiting for the second admin keeps a non-FAILED payout transaction after the stale sweep, then pays exactly once', skipOpts, async () => {
  const { req, wallet } = await pendingRequest('6000000');
  await d.withdrawalService.approve(req.id, ADMIN_A);
  const txn = await payoutTxn(req.id);
  assert.equal(txn.status, 'PENDING');

  // control: an unrelated stale non-top-up transaction (an abandoned purchase) - the sweep must still pick THIS kind up
  const abandoned = await d.prisma.paymentTransaction.create({
    data: { payerId: randomUUID(), purpose: 'PT_CONTRACT', amount: new Prisma.Decimal(100000), status: 'PENDING', idempotencyKey: `abandoned:${randomUUID()}` },
  });
  await ageTransaction(txn.id, 30);
  await ageTransaction(abandoned.id, 30);

  const stale = (await d.txRepo.findStaleProcessing('non-topup', 10)).map((r) => r.id);
  assert.ok(!stale.includes(txn.id), 'the waiting payout is not stale');
  assert.ok(stale.includes(abandoned.id), 'an abandoned purchase still is');

  await d.recon.runReconciliation();

  assert.equal((await payoutTxn(req.id)).status, 'PENDING', 'payout transaction untouched by the sweep');
  assert.equal((await d.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: abandoned.id } })).status, 'FAILED', 'the abandoned purchase was swept');
  assert.equal((await d.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } })).status, 'APPROVED');

  const ledgerBefore = await d.prisma.walletLedgerEntry.count({ where: { walletId: wallet.id } });
  const paid = await d.withdrawalService.markPaid(req.id, ADMIN_B, 'VCB-SWEEP-1');
  assert.equal(paid.status, 'PAID');
  const afterPay = await payoutTxn(req.id);
  assert.equal(afterPay.status, 'PAID');
  assert.ok(afterPay.paidAt);
  assert.equal(afterPay.failedAt, null, 'never marked failed along the way');

  // exactly once: a second confirmation (same or another admin) is refused 409 INVALID_STATUS, debits nothing more
  const ledgerAfterPay = await d.prisma.walletLedgerEntry.count({ where: { walletId: wallet.id } });
  const paidDebits = await d.prisma.walletLedgerEntry.count({ where: { walletId: wallet.id, entryType: 'DEBIT', description: { contains: 'paid' } } });
  assert.equal(paidDebits, 1);
  await assert.rejects(() => d.withdrawalService.markPaid(req.id, ADMIN_C, 'VCB-SWEEP-1'), codeIs('INVALID_STATUS'));
  assert.equal(await d.prisma.walletLedgerEntry.count({ where: { walletId: wallet.id } }), ledgerAfterPay, 'second markPaid adds no ledger entry');
  assert.ok(ledgerAfterPay > ledgerBefore);
  const w = await d.prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  assert.equal(w.availableBalance.toFixed(2), '0.00');
  assert.equal(w.lockedBalance.toFixed(2), '0.00');
});

test('N13F-02: a REJECTED withdrawal\'s payout transaction is still swept (only waiting-on-a-person payouts are protected)', skipOpts, async () => {
  const { req } = await pendingRequest('6000000');
  await d.withdrawalService.approve(req.id, ADMIN_A);
  await d.withdrawalService.reject(req.id, ADMIN_B, 'Sai thông tin tài khoản');
  const txn = await payoutTxn(req.id);
  assert.equal(txn.status, 'PENDING');
  await ageTransaction(txn.id, 30);
  assert.ok((await d.txRepo.findStaleProcessing('non-topup', 10)).some((r) => r.id === txn.id));
  await d.recon.runReconciliation();
  assert.equal((await payoutTxn(req.id)).status, 'FAILED');
});

test('N13F-02: a withdrawal that is still PENDING (a payout row exists but nobody finished) is not swept either', skipOpts, async () => {
  const { req } = await pendingRequest('1000000');
  // approve() creates the payout row first; simulate the "row exists, request still PENDING" window
  await d.prisma.paymentTransaction.create({
    data: { payerId: req.ownerId, purpose: 'WITHDRAWAL', amount: req.amount, status: 'PENDING', idempotencyKey: payoutKey(req.id), sourceService: 'payment-service' },
  });
  const txn = await payoutTxn(req.id);
  await ageTransaction(txn.id, 30);
  assert.ok(!(await d.txRepo.findStaleProcessing('non-topup', 10)).some((r) => r.id === txn.id));
});

// ---- Q7 -----------------------------------------------------------------------------------------------------------------------------------

test('Q7: below the threshold, mark-paid straight from PENDING records the approval (reviewedBy / reviewedAt = the paying admin) and the history shows approvedBy', skipOpts, async () => {
  const { req, wallet } = await pendingRequest('1000000');
  const before = await d.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(before.reviewedBy, null);

  const paid = await d.withdrawalService.markPaid(req.id, ADMIN_A, 'REF-Q7-1');
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.reviewedBy, ADMIN_A);
  assert.ok(paid.reviewedAt, 'approval time recorded');
  assert.ok(paid.paidAt);
  assert.ok(paid.reviewedAt!.getTime() <= paid.paidAt!.getTime() + 1000);

  const row = await d.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(row.reviewedBy, ADMIN_A);
  const items = await d.history.list(d.historySchema.parse({ status: 'PAID', ownerType: 'PT', limit: '100' }));
  const item = (items as { items?: Array<{ id: string; approvedBy: string | null }> }).items?.find((i) => i.id === req.id);
  assert.ok(item, 'the paid withdrawal is in the history');
  assert.equal(item!.approvedBy, ADMIN_A, 'history shows who approved it');

  // same ledger trail as a normal approve + pay: the lock move happened in the same transaction
  const lockEntries = await d.prisma.walletLedgerEntry.count({ where: { walletId: wallet.id, description: { contains: 'locked for payout' } } });
  assert.equal(lockEntries, 2, 'LOCK debit + credit recorded');
});

test('Q7: an earlier approval is kept (approved by A, paid by B below the threshold -> approver stays A)', skipOpts, async () => {
  const { req } = await pendingRequest('1000000');
  await d.withdrawalService.approve(req.id, ADMIN_A);
  const paid = await d.withdrawalService.markPaid(req.id, ADMIN_B, 'REF-Q7-2');
  assert.equal(paid.reviewedBy, ADMIN_A);
});

test('Q7: at or above the threshold nothing changes - straight from PENDING is still 409 FOUR_EYES_REQUIRED and records no approval', skipOpts, async () => {
  const { req } = await pendingRequest('5000000');
  await assert.rejects(() => d.withdrawalService.markPaid(req.id, ADMIN_A, 'REF-Q7-3'), codeIs('FOUR_EYES_REQUIRED'));
  const row = await d.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(row.status, 'PENDING');
  assert.equal(row.reviewedBy, null);
  assert.equal(row.reviewedAt, null);
});

// ---- Q9 -----------------------------------------------------------------------------------------------------------------------------------

const ownerNotices = (ownerId: string) => notices.filter((n) => n.body.userId === ownerId);

test('Q9: large request - approved by A: the owner gets "approved", the OTHER admins (B, C - not A) get "waiting for a second admin"; a repeated approve is refused and sends nothing; B pays -> owner gets "paid"', skipOpts, async () => {
  const { req, ownerId } = await pendingRequest('6000000');
  await d.withdrawalService.approve(req.id, ADMIN_A);
  await d.notify.drainWithdrawalNotifications();

  assert.ok(notices.every((n) => n.path === '/internal/notifications' && n.secret));
  const owner = ownerNotices(ownerId);
  assert.equal(owner.length, 1);
  assert.equal(owner[0].body.eventType, 'WITHDRAWAL_APPROVED');
  assert.equal(owner[0].body.entityType, 'WITHDRAWAL_REQUEST');
  assert.equal(owner[0].body.entityId, req.id);
  assert.equal(owner[0].body.link, '/pt/wallet');
  assert.match(owner[0].body.text, /Yêu cầu rút 6\.000\.000đ của bạn đã được duyệt/);

  const admins = notices.filter((n) => n.body.eventType === 'WITHDRAWAL_AWAITING_SECOND_ADMIN');
  assert.deepEqual(admins.map((n) => n.body.userId).sort(), [ADMIN_B, ADMIN_C].sort());
  for (const n of admins) {
    assert.equal(n.body.entityId, req.id);
    assert.equal(n.body.link, '/admin/finance/withdrawals');
    assert.match(n.body.text, /Khoản rút 6\.000\.000đ .*chờ một quản trị viên khác xác nhận đã chi/);
  }
  assert.equal(notices.length, 3);

  // replay of an already-approved request changes nothing and tells nobody
  await assert.rejects(() => d.withdrawalService.approve(req.id, ADMIN_C), codeIs('INVALID_STATUS'));
  await d.notify.drainWithdrawalNotifications();
  assert.equal(notices.length, 3, 'no new notice on replay');

  notices.length = 0;
  await d.withdrawalService.markPaid(req.id, ADMIN_B, 'VCB-Q9-1');
  await d.notify.drainWithdrawalNotifications();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].body.userId, ownerId);
  assert.equal(notices[0].body.eventType, 'WITHDRAWAL_PAID');
  assert.match(notices[0].body.text, /Yêu cầu rút 6\.000\.000đ của bạn đã được chuyển khoản \(mã tham chiếu VCB-Q9-1\)/);

  await assert.rejects(() => d.withdrawalService.markPaid(req.id, ADMIN_C, 'VCB-Q9-1'), codeIs('INVALID_STATUS'));
  await d.notify.drainWithdrawalNotifications();
  assert.equal(notices.length, 1, 'no second "paid" notice on replay');
});

test('Q9: a CLIENT owner is sent to the client wallet, a PT to the PT wallet', skipOpts, async () => {
  const client = randomUUID();
  const pt = randomUUID();
  await d.notify.notifyWithdrawalOwner('PAID', { id: randomUUID(), ownerType: 'CLIENT', ownerId: client, amount: new Prisma.Decimal(100000) }, { bankReference: 'R1' });
  await d.notify.notifyWithdrawalOwner('PAID', { id: randomUUID(), ownerType: 'PT', ownerId: pt, amount: new Prisma.Decimal(100000) }, { bankReference: 'R2' });
  assert.deepEqual(notices.map((n) => [n.body.userId, n.body.link]), [[client, '/client/wallet'], [pt, '/pt/wallet']]);
});

test('Q9: below the threshold, approve notifies only the owner; straight PENDING -> PAID notifies "paid"', skipOpts, async () => {
  const a = await pendingRequest('1500000');
  await d.withdrawalService.approve(a.req.id, ADMIN_A);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].body.eventType, 'WITHDRAWAL_APPROVED');
  assert.equal(notices[0].body.userId, a.ownerId);
  assert.equal(notices.filter((n) => n.body.eventType === 'WITHDRAWAL_AWAITING_SECOND_ADMIN').length, 0);

  notices.length = 0;
  const b = await pendingRequest('1500000');
  await d.withdrawalService.markPaid(b.req.id, ADMIN_A, 'REF-Q9-2');
  assert.deepEqual(notices.map((n) => [n.body.userId, n.body.eventType]), [[b.ownerId, 'WITHDRAWAL_PAID']]);
});

test('Q9: reject -> the owner gets "rejected" with the reason; a replayed reject sends nothing', skipOpts, async () => {
  const { req, ownerId } = await pendingRequest('2000000');
  await d.withdrawalService.reject(req.id, ADMIN_A, 'Số tài khoản không khớp tên');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].body.userId, ownerId);
  assert.equal(notices[0].body.eventType, 'WITHDRAWAL_REJECTED');
  assert.match(notices[0].body.text, /Yêu cầu rút 2\.000\.000đ của bạn đã bị từ chối\. Lý do: Số tài khoản không khớp tên\. Số tiền vẫn nằm trong ví của bạn\./);
  await d.withdrawalService.reject(req.id, ADMIN_B, 'again'); // idempotent: already REJECTED returns the same row
  await d.notify.drainWithdrawalNotifications();
  assert.equal(notices.length, 1);
});

test('Q9: a refused markPaid (four-eyes) or an invalid state sends no notice', skipOpts, async () => {
  const { req } = await pendingRequest('6000000');
  await d.withdrawalService.approve(req.id, ADMIN_A);
  notices.length = 0;
  await assert.rejects(() => d.withdrawalService.markPaid(req.id, ADMIN_A, 'REF-Q9-3'), codeIs('FOUR_EYES_REQUIRED'));
  assert.equal(notices.length, 0);
});

test('Q9: user-service answering 500 never fails or rolls back the withdrawal (best-effort)', skipOpts, async () => {
  notificationsStatus = 500;
  const { req } = await pendingRequest('6000000');
  const approved = await d.withdrawalService.approve(req.id, ADMIN_A);
  assert.equal(approved.status, 'APPROVED');
  const paid = await d.withdrawalService.markPaid(req.id, ADMIN_B, 'REF-Q9-4');
  assert.equal(paid.status, 'PAID');
  assert.equal((await d.prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: req.id } })).status, 'PAID');
});

test('Q9: a GYM owner (ownerId is a gym id, not a user) gets no user notice', skipOpts, async () => {
  await d.notify.notifyWithdrawalOwner('APPROVED', { id: randomUUID(), ownerType: 'GYM', ownerId: randomUUID(), amount: new Prisma.Decimal(100000) });
  assert.equal(notices.length, 0);
});

test('Q9: notice texts format the amount like the rest of the app (dot-grouped đồng, no decimals)', () => {
  assert.match(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../services/withdrawal-notification.service').withdrawalOwnerNoticeText('APPROVED', '12345678.00'),
    /12\.345\.678đ/,
  );
});
