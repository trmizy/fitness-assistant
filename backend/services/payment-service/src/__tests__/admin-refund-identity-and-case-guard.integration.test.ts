/**
 * E6 / F1 + F2 (Ngài, 05/11/2026) - POST /admin/payments/:id/refund.
 *   F1  the acting admin is the VERIFIED TOKEN's user; a body `adminId` (or any extra field) is refused 400; the refund transaction records the token's identity.
 *   F2  a refund must not bypass a dispute Case: the owning service is asked (read-only) BEFORE anything is written. Open Case / approved decision -> 409 with the owner's code, nothing written;
 *       the owner not answering (5xx, connection refused) -> 503 REFUND_GUARD_UNAVAILABLE, nothing written; an entity with no Case is refunded exactly as before.
 * Evidence label: BACKEND INTEGRATION (the real admin router + real ledger on an isolated *_test database; auth-service, user-service and gym-service are small TEST FIXTURE HTTP servers).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';

const skip = isTestDatabaseUrl(process.env.DATABASE_URL || '') ? false : 'Requires DATABASE_URL pointing at a *_test database.';

let authServer: http.Server;
let userServer: http.Server;
let gymServer: http.Server;
let app: http.Server;
let base = '';
const calls: Array<{ svc: 'user' | 'gym'; path: string }> = [];
/** entity id -> what its owner answers to the refund guard */
const behaviour = new Map<string, 'OPEN' | 'DECIDED' | 'DOWN'>();

const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as any).port)));
function ownerServer(svc: 'user' | 'gym', openCode: string, decidedCode: string) {
  return http.createServer((req, res) => {
    const m = /^\/internal\/(?:contracts|gym-memberships)\/([^/]+)\/(refund-guard|cancel-after-refund)$/.exec(req.url || '');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!m) {
      send(404, {});
      return;
    }
    calls.push({ svc, path: req.url! });
    if (m[2] === 'cancel-after-refund') {
      send(200, { success: true, data: {} });
      return;
    }
    const b = behaviour.get(decodeURIComponent(m[1]));
    if (b === 'OPEN') {
      send(409, { success: false, error: { code: openCode, message: 'có hồ sơ chưa kết thúc' } });
      return;
    }
    if (b === 'DECIDED') {
      send(409, { success: false, error: { code: decidedCode, message: 'có quyết định đã duyệt' } });
      return;
    }
    if (b === 'DOWN') {
      send(500, { success: false });
      return;
    }
    send(200, { success: true, data: { allowed: true } });
  });
}

test.before(async () => {
  if (skip) return;
  authServer = http.createServer((req, res) => {
    const tok = String(req.headers.authorization || '').replace('Bearer ', '');
    if (req.method === 'POST' && req.url === '/auth/verify' && tok === 'admin-token') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ user: { id: 'admin-from-token-1', email: 'a@test.local', role: 'ADMIN' } }));
      return;
    }
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{}');
  });
  userServer = ownerServer('user', 'CONTRACT_CASE_OPEN', 'CONTRACT_CASE_DECISION_EXISTS');
  gymServer = ownerServer('gym', 'GYM_CASE_OPEN', 'GYM_CASE_DECISION_EXISTS');
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${await listen(authServer)}`;
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${await listen(userServer)}`;
  process.env.GYM_SERVICE_URL = `http://127.0.0.1:${await listen(gymServer)}`;
  const { default: adminRoutes } = await import('../routes/admin.routes');
  const a = express();
  a.use(express.json());
  a.use('/admin/payments', adminRoutes);
  app = http.createServer(a);
  base = `http://127.0.0.1:${await listen(app)}`;
});
test.after(async () => {
  if (skip) return;
  for (const s of [app, authServer, userServer, gymServer]) await new Promise<void>((r) => s.close(() => r()));
  const { prisma } = await import('../repositories/prisma');
  await prisma.$disconnect();
});

type Kind = 'PT_CONTRACT' | 'GYM_MEMBERSHIP' | 'TRAINING_PACKAGE_PURCHASE';
/** TEST FIXTURE: a PAID purchase of 100 between a client wallet and a partner wallet (commission 10%), with wallet references, so the refund route can really reverse it. */
async function paidPurchase(kind: Kind) {
  const { prisma } = await import('../repositories/prisma');
  const { walletService } = await import('../services/wallet.service');
  const { Prisma } = await import('../generated/prisma');
  const sfx = randomUUID();
  const payerId = `rf-payer-${sfx}`;
  const receiverId = `rf-recv-${sfx}`;
  const entityId = `rf-entity-${sfx}`;
  const payer = await prisma.wallet.create({ data: { ownerType: 'CLIENT', ownerId: payerId, availableBalance: 1000 } });
  const receiver = await prisma.wallet.create({ data: { ownerType: kind === 'GYM_MEMBERSHIP' ? 'GYM' : 'PT', ownerId: receiverId, availableBalance: 0 } });
  const payment = await prisma.paymentTransaction.create({
    data: {
      payerId,
      ptId: kind === 'GYM_MEMBERSHIP' ? null : receiverId,
      gymId: kind === 'GYM_MEMBERSHIP' ? receiverId : null,
      purpose: kind === 'GYM_MEMBERSHIP' ? 'GYM_MEMBERSHIP' : 'PT_CONTRACT',
      amount: 100,
      status: 'PENDING',
      provider: 'MOCK',
      idempotencyKey: `pay-${sfx}`,
      payerWalletId: payer.id,
      receiverWalletId: receiver.id,
      relatedEntityType: kind,
      relatedEntityId: entityId,
    } as any,
  });
  await walletService.transferInternal({
    payerWalletId: payer.id,
    receiverWalletId: receiver.id,
    amount: new Prisma.Decimal(100),
    commissionRate: new Prisma.Decimal(0.1),
    transactionId: payment.id,
    partnerType: kind === 'GYM_MEMBERSHIP' ? 'GYM' : 'PT',
    partnerId: receiverId,
  } as any);
  return { payment, payer, receiver, entityId, prisma };
}
async function refund(txnId: string, body: unknown, token: string | null = 'admin-token') {
  const res = await fetch(`${base}/admin/payments/${txnId}/refund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
async function state(f: Awaited<ReturnType<typeof paidPurchase>>) {
  const w = await f.prisma.wallet.findMany({ where: { id: { in: [f.payer.id, f.receiver.id] } }, orderBy: { ownerId: 'asc' } });
  return {
    wallets: w.map((x) => `${x.ownerType}:${x.availableBalance.toString()}/${x.pendingBalance.toString()}`),
    original: (await f.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: f.payment.id } })).status,
    refunds: await f.prisma.paymentTransaction.count({ where: { refundOfTransactionId: f.payment.id } }),
  };
}

test('F1: a body adminId (or any extra field) is refused 400; nothing is written; the token identity is what the refund records', { skip }, async () => {
  const f = await paidPurchase('TRAINING_PACKAGE_PURCHASE'); // no Case concept: only identity is under test
  const before = await state(f);
  assert.equal(before.original, 'PAID');
  const spoof = await refund(f.payment.id, { adminId: 'attacker-admin', reason: 'forged identity' });
  assert.equal(spoof.status, 400);
  assert.equal(spoof.body.error.code, 'VALIDATION_ERROR');
  const extra = await refund(f.payment.id, { reason: 'ok', initiatedBy: 'attacker-admin' });
  assert.equal(extra.status, 400);
  assert.deepEqual(await state(f), before, 'a refused request wrote nothing');
  const ok = await refund(f.payment.id, { reason: 'khách yêu cầu, đã kiểm tra' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const refunds = await f.prisma.paymentTransaction.findMany({ where: { refundOfTransactionId: f.payment.id } });
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].initiatedBy, 'admin-from-token-1', 'the identity recorded is the verified token\'s user');
  assert.equal((await state(f)).original, 'REFUNDED');
});

test('F2 PT_CONTRACT: an open Case and an approved decision are refused 409 with the owner\'s code; the owner down is refused 503 (fail-closed); each writes NOTHING', { skip }, async () => {
  const f = await paidPurchase('PT_CONTRACT');
  const before = await state(f);
  for (const [b, code, status] of [
    ['OPEN', 'CONTRACT_CASE_OPEN', 409],
    ['DECIDED', 'CONTRACT_CASE_DECISION_EXISTS', 409],
    ['DOWN', 'REFUND_GUARD_UNAVAILABLE', 503],
  ] as const) {
    behaviour.set(f.entityId, b);
    const r = await refund(f.payment.id, { reason: 'thử hoàn tiền' });
    assert.deepEqual([r.status, r.body.error.code], [status, code], b);
    assert.deepEqual(await state(f), before, `${b}: nothing written`);
  }
  // the owner is not reachable at all (connection refused)
  const saved = process.env.USER_SERVICE_URL;
  process.env.USER_SERVICE_URL = 'http://127.0.0.1:9';
  behaviour.delete(f.entityId);
  try {
    const r = await refund(f.payment.id, { reason: 'thử hoàn tiền' });
    assert.deepEqual([r.status, r.body.error.code], [503, 'REFUND_GUARD_UNAVAILABLE']);
    assert.deepEqual(await state(f), before);
  } finally {
    process.env.USER_SERVICE_URL = saved;
  }
  // no Case: an independent refund works exactly as before (and the owner was asked)
  calls.length = 0;
  const ok = await refund(f.payment.id, { reason: 'hoàn tiền độc lập, không có hồ sơ' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(calls.some((c) => c.svc === 'user' && c.path.endsWith(`/contracts/${f.entityId}/refund-guard`)), 'user-service was asked');
  assert.equal((await state(f)).original, 'REFUNDED');
});

test('F2 GYM_MEMBERSHIP: the gym owner\'s guard decides the same way; no Case -> the refund works', { skip }, async () => {
  const f = await paidPurchase('GYM_MEMBERSHIP');
  const before = await state(f);
  behaviour.set(f.entityId, 'OPEN');
  const open = await refund(f.payment.id, { reason: 'thử hoàn tiền' });
  assert.deepEqual([open.status, open.body.error.code], [409, 'GYM_CASE_OPEN']);
  behaviour.set(f.entityId, 'DECIDED');
  const decided = await refund(f.payment.id, { reason: 'thử hoàn tiền' });
  assert.deepEqual([decided.status, decided.body.error.code], [409, 'GYM_CASE_DECISION_EXISTS']);
  behaviour.set(f.entityId, 'DOWN');
  const down = await refund(f.payment.id, { reason: 'thử hoàn tiền' });
  assert.deepEqual([down.status, down.body.error.code], [503, 'REFUND_GUARD_UNAVAILABLE']);
  assert.deepEqual(await state(f), before, 'nothing written by any refusal');
  behaviour.delete(f.entityId);
  calls.length = 0;
  const ok = await refund(f.payment.id, { reason: 'hoàn tiền độc lập, không có hồ sơ' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(calls.some((c) => c.svc === 'gym' && c.path.endsWith(`/gym-memberships/${f.entityId}/refund-guard`)));
});
