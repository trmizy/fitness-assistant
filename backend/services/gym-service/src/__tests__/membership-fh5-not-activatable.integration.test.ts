/**
 * FH-5 / R2 - gym-service half. A client cancels a PENDING_PAYMENT gym membership (cancelPending), THEN the gateway's
 * PAID callback reaches payment-service, which (having already put the price in escrow) calls
 * POST /internal/gym-memberships/:id/activate.
 *
 * Before: activateViaTransaction returned the CANCELLED row (`before.status !== 'PENDING_PAYMENT'` -> `return before`) and
 * the controller answered 200 -> payment-service marked the transaction ACTIVATED and the money sat in escrow forever.
 * Now: 409 { error: { code: 'NOT_ACTIVATABLE' } }, which payment-service turns into a full refund
 * (payment-service/src/__tests__/fh5-cancelled-target-refund.integration.test.ts pins that side).
 *
 * BACKEND INTEGRATION against the isolated gym test DB, the REAL internalController behind a real express app; only the
 * payment-service client is stubbed (it is the other service). Run (from backend/services/gym-service):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_gym_fhc_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/membership-fh5-not-activatable.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';

const dbName = (() => {
  try {
    return decodeURIComponent(new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\/+/, ''));
  } catch {
    return '';
  }
})();
const skipOpts = { skip: /_test$/.test(dbName) ? false : `Refusing to touch a database not ending in _test (got "${dbName || '<unset>'}")` };

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  membershipService: (typeof import('../services/membership.service'))['membershipService'];
  paymentClient: (typeof import('../clients/payment.client'))['paymentClient'];
};
let mods: Mods | undefined;
let server: http.Server | undefined;
let baseUrl = '';
const releaseCalls: any[] = [];
const forfeitCalls: any[] = [];

async function load(): Promise<Mods> {
  if (mods) return mods;
  const { internalController } = await import('../controllers/internal.controller');
  mods = {
    prisma: (await import('../repositories/prisma')).prisma,
    membershipService: (await import('../services/membership.service')).membershipService,
    paymentClient: (await import('../clients/payment.client')).paymentClient,
  };
  const app = express();
  app.use(express.json());
  app.post('/internal/gym-memberships/:id/activate', internalController.activate);
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const pc = mods.paymentClient as any;
  pc.getTransaction = async (transactionId: string) => ({
    id: transactionId,
    status: 'PAID',
    relatedEntityType: 'GYM_MEMBERSHIP',
    relatedEntityId: transactionId.replace('mock-txn-', ''),
  });
  pc.releaseMembershipPending = async (body: any) => { releaseCalls.push(body); return { released: {}, refunded: body.refundToClient }; };
  pc.forfeitMembershipOnCancel = async (body: any) => { forfeitCalls.push(body); return {}; };
  return mods;
}

test.after(async () => {
  server?.close();
  if (mods) await mods.prisma.$disconnect();
});

async function activateOverHttp(membershipId: string, transactionId: string) {
  const res = await fetch(`${baseUrl}/internal/gym-memberships/${membershipId}/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transactionId }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function makePendingMembership(m: Mods, o: { gymStatus?: 'APPROVED' | 'SUSPENDED' } = {}) {
  const ownerId = randomUUID();
  const brand = await m.prisma.gymBrand.create({ data: { id: randomUUID(), ownerId, name: 'FH5 Brand' } });
  const gym = await m.prisma.gym.create({
    data: { id: randomUUID(), ownerId, brandId: brand.id, name: 'FH5 Gym', address: '1 Test St', status: o.gymStatus ?? 'APPROVED' },
  });
  const plan = await m.prisma.gymMembershipPlan.create({
    data: { id: randomUUID(), brandId: brand.id, name: 'FH5 Plan', price: 500_000, durationDays: 30 },
  });
  const clientId = randomUUID();
  const membership = await m.prisma.gymMembershipContract.create({
    data: { id: randomUUID(), gymId: gym.id, planId: plan.id, clientId, status: 'PENDING_PAYMENT', priceAtPurchase: 500_000, durationDaysSnapshot: 30 },
  });
  return { membership, clientId, txn: `mock-txn-${membership.id}` };
}

const reread = (m: Mods, id: string) => m.prisma.gymMembershipContract.findUniqueOrThrow({ where: { id } });

test('cancelled while PENDING_PAYMENT, then paid: 409 NOT_ACTIVATABLE (not 200), stays CANCELLED, no payment recorded', skipOpts, async () => {
  const m = await load();
  const { membership, clientId, txn } = await makePendingMembership(m);
  await m.membershipService.cancelPending(membership.id, clientId);

  const res = await activateOverHttp(membership.id, txn);

  assert.equal(res.status, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'NOT_ACTIVATABLE');
  assert.equal(res.body.error.currentStatus, 'CANCELLED');
  const row = await reread(m, membership.id);
  assert.equal(row.status, 'CANCELLED', 'must not resurrect a cancelled membership');
  assert.equal(row.paymentTxnId, null, 'a refused payment is not recorded as the membership\'s payment');

  // payment-service retry / a concurrent callback: the same definite answer.
  const [a, b] = await Promise.all([activateOverHttp(membership.id, txn), activateOverHttp(membership.id, txn)]);
  assert.deepEqual([a.status, b.status], [409, 409]);
  assert.equal(releaseCalls.filter((c) => c.idempotencyKey === `MEMBERSHIP_RELEASE:${membership.id}`).length, 0, 'gym-service does not refund by itself here');
});

test('normal payment: 200 ACTIVE with the payment recorded; a redelivered callback is an idempotent 200', skipOpts, async () => {
  const m = await load();
  const { membership, txn } = await makePendingMembership(m);

  const first = await activateOverHttp(membership.id, txn);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.status, 'ACTIVE');
  assert.equal((await reread(m, membership.id)).paymentTxnId, txn);

  const replay = await activateOverHttp(membership.id, txn);
  assert.equal(replay.status, 200, 'replay of the same activation is not a "no"');
  assert.equal(replay.body.data.status, 'ACTIVE');
});

test('a SECOND, different payment for an already ACTIVE membership: 409 (refund it), the first payment stays the membership\'s', skipOpts, async () => {
  const m = await load();
  const { membership, txn } = await makePendingMembership(m);
  assert.equal((await activateOverHttp(membership.id, txn)).status, 200);

  // A genuinely different transaction id for the same membership.
  const other = `other-${randomUUID()}`;
  (m.paymentClient as any).getTransaction = async (id: string) => ({ id, status: 'PAID', relatedEntityType: 'GYM_MEMBERSHIP', relatedEntityId: membership.id });
  const res = await activateOverHttp(membership.id, other);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'NOT_ACTIVATABLE');
  assert.equal((await reread(m, membership.id)).paymentTxnId, txn, 'first payment untouched');
  (m.paymentClient as any).getTransaction = async (id: string) => ({ id, status: 'PAID', relatedEntityType: 'GYM_MEMBERSHIP', relatedEntityId: id.replace('mock-txn-', '') });
});

test('gym unavailable at payment time (PENDING_ISSUE refund path): 200 and its CANCELLED replay is NOT a "no" - no second refund', skipOpts, async () => {
  const m = await load();
  const { membership, txn } = await makePendingMembership(m, { gymStatus: 'SUSPENDED' });
  releaseCalls.length = 0;

  const first = await activateOverHttp(membership.id, txn);
  assert.equal(first.status, 200, 'the existing PENDING_ISSUE flow (gym-service releases via payment-service) is unchanged');
  const row = await reread(m, membership.id);
  assert.equal(row.status, 'CANCELLED');
  assert.equal(row.paymentTxnId, txn);
  assert.equal(releaseCalls.length, 1);

  const replay = await activateOverHttp(membership.id, txn);
  assert.equal(replay.status, 200, 'CANCELLED with THIS payment recorded = already handled, not NOT_ACTIVATABLE');
  assert.equal(releaseCalls.length, 1, 'no second release/refund');
});

test('membership that does not exist / transaction that does not verify: NOT a definite "no" (retryable, never refunded)', skipOpts, async () => {
  const m = await load();
  const missing = await activateOverHttp(randomUUID(), 'mock-txn-x');
  assert.equal(missing.status, 400, 'unverifiable transaction'); // getTransaction echoes a different entity id
  assert.notEqual(missing.body.error?.code, 'NOT_ACTIVATABLE');

  const id = randomUUID();
  const gone = await activateOverHttp(id, `mock-txn-${id}`);
  assert.equal(gone.status, 404);
  assert.notEqual(gone.body.error?.code, 'NOT_ACTIVATABLE');
  void m;
});

// ── FH-5: cancel vs activate race, interleaved deterministically (both orders) + Promise.all ──────────────────

/** Money invariant: CANCELLED => payment-service was told 409 NOT_ACTIVATABLE (it refunds); otherwise ACTIVE by this payment. */
function assertNeverCancelledWithoutRefund(row: { status: string; paymentTxnId: string | null }, txn: string, activation: { status: number }) {
  if (row.status === 'CANCELLED') {
    assert.equal(activation.status, 409, 'cancelled => the paid callback must have been answered 409 NOT_ACTIVATABLE (=> refund)');
    assert.equal(row.paymentTxnId, null);
  } else {
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.paymentTxnId, txn);
    assert.equal(activation.status, 200);
  }
}

test('race A: the client\'s cancel completes BETWEEN activation\'s read and its write -> activation 409 NOT_ACTIVATABLE, stays CANCELLED', skipOpts, async () => {
  const m = await load();
  const { membership, clientId, txn } = await makePendingMembership(m);
  const gymRepo = (await import('../repositories/gym.repository')).gymRepository as any;
  const realFindById = gymRepo.findById.bind(gymRepo);
  let first = true;
  gymRepo.findById = async (id: string) => {
    const g = await realFindById(id);
    if (first) { first = false; await m.membershipService.cancelPending(membership.id, clientId); } // runs to completion
    return g;
  };
  let res;
  try { res = await activateOverHttp(membership.id, txn); } finally { gymRepo.findById = realFindById; }
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'NOT_ACTIVATABLE');
  const row = await reread(m, membership.id);
  assert.equal(row.status, 'CANCELLED');
  assert.equal(row.paymentTxnId, null);
  assertNeverCancelledWithoutRefund(row, txn, res);
});

test('race B: activation completes BETWEEN the client\'s read and its cancel write -> cancel is refused 409 "đã thanh toán", membership stays ACTIVE', skipOpts, async () => {
  const m = await load();
  const { membership, clientId, txn } = await makePendingMembership(m);
  const repo = (await import('../repositories/membership.repository')).membershipRepository as any;
  const realCancel = repo.cancelIfPending.bind(repo);
  let first = true;
  repo.cancelIfPending = async (id: string) => {
    if (first) { first = false; assert.equal((await activateOverHttp(id, txn)).status, 200); } // payment lands after cancelPending's read
    return realCancel(id);
  };
  try {
    await assert.rejects(
      () => m.membershipService.cancelPending(membership.id, clientId),
      (e: any) => e.status === 409 && /thanh toán/.test(e.message),
    );
  } finally { repo.cancelIfPending = realCancel; }
  const row = await reread(m, membership.id);
  assert.equal(row.status, 'ACTIVE', 'a paid membership is never overwritten to CANCELLED');
  assert.equal(row.paymentTxnId, txn);
});

test('race A\': gym unavailable (PENDING_ISSUE branch) and the client\'s cancel wins the race -> 409 NOT_ACTIVATABLE, no release/refund by gym-service', skipOpts, async () => {
  const m = await load();
  const { membership, clientId, txn } = await makePendingMembership(m, { gymStatus: 'SUSPENDED' });
  releaseCalls.length = 0;
  const repo = (await import('../repositories/membership.repository')).membershipRepository as any;
  const realMark = repo.markPendingIssueIfPending.bind(repo);
  repo.markPendingIssueIfPending = async (id: string, t: string) => {
    await m.membershipService.cancelPending(membership.id, clientId); // cancel lands before the conditional write
    return realMark(id, t);
  };
  let res;
  try { res = await activateOverHttp(membership.id, txn); } finally { repo.markPendingIssueIfPending = realMark; }
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'NOT_ACTIVATABLE');
  assert.equal((await reread(m, membership.id)).status, 'CANCELLED');
  assert.equal(releaseCalls.length, 0, 'payment-service refunds on the 409; gym-service must not also release');
});

test('race C: Promise.all(cancel, activate) x 25 -> every outcome is "ACTIVE by this payment" or "CANCELLED + 409 (refund)"', skipOpts, async () => {
  const m = await load();
  const outcomes = { active: 0, cancelled: 0 };
  for (let i = 0; i < 25; i++) {
    const { membership, clientId, txn } = await makePendingMembership(m);
    const [cancel, act] = await Promise.all([
      m.membershipService.cancelPending(membership.id, clientId).then(() => 'ok', (e: any) => e.status as number),
      activateOverHttp(membership.id, txn),
    ]);
    const row = await reread(m, membership.id);
    assertNeverCancelledWithoutRefund(row, txn, act);
    if (row.status === 'ACTIVE') { assert.equal(cancel, 409, 'the losing cancel failed cleanly'); outcomes.active++; }
    else { assert.equal(cancel, 'ok'); outcomes.cancelled++; }
  }
  assert.equal(outcomes.active + outcomes.cancelled, 25);
  console.log(`race C outcomes over 25 runs: ${JSON.stringify(outcomes)}`);
});
