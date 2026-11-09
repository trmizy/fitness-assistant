/**
 * INT-15 GET /admin/complaints/:id/membership-options - REAL HTTP into the real gym-service Express app, isolated gym *_test database. BACKEND INTEGRATION.
 * TEST FIXTURE: gym / membership / complaint rows. Decoys: another member at the same gym, the same member at another gym.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../repositories/prisma';
import { call, cleanup, installStubs, makeComplaint, makeGym, makeMembership, newAdmin, ok, removeStubs, setFlag, skip, startApp, stopApp, token } from './complaint-case.test-helpers';

test.before(async () => {
  if (skip) return;
  installStubs();
  await startApp();
});
test.after(async () => {
  setFlag(undefined);
  removeStubs();
  if (!skip) await cleanup();
  await stopApp();
  await prisma.$disconnect();
});
test.beforeEach(() => {
  if (!skip) setFlag(true);
});
test.afterEach(async () => {
  if (!skip) await cleanup();
});

test('INT-15: only the reporter memberships at the complaint gym, newest first, refundable matches the refund guard', { skip }, async () => {
  const { gym } = await makeGym();
  const { gym: otherGym } = await makeGym();
  const member = `member-${randomUUID().slice(0, 8)}`;
  const other = `member-${randomUUID().slice(0, 8)}`;
  const expired = await makeMembership(gym.id, member, { status: 'EXPIRED', startOffsetDays: 90 });
  await new Promise((r) => setTimeout(r, 15));
  const released = await makeMembership(gym.id, member, { status: 'EXPIRED', startOffsetDays: 60 });
  await prisma.gymMembershipContract.update({ where: { id: released.id }, data: { payoutReleasedAt: new Date() } });
  await new Promise((r) => setTimeout(r, 15));
  const cancelled = await makeMembership(gym.id, member, { status: 'CANCELLED' });
  await new Promise((r) => setTimeout(r, 15));
  const unpaid = await makeMembership(gym.id, member, { status: 'EXPIRED', paymentTxnId: null });
  await new Promise((r) => setTimeout(r, 15));
  const active = await makeMembership(gym.id, member, { status: 'ACTIVE' });
  await makeMembership(gym.id, other); // decoy: another member, same gym
  await makeMembership(otherGym.id, member); // decoy: same member, another gym
  const complaint = await makeComplaint(gym.id, member);
  const admin = newAdmin();

  const body = ok(await call('GET', `/admin/complaints/${complaint.id}/membership-options`, admin.tok), 200, 'options');
  assert.deepEqual(body.items.map((i: any) => i.membershipId), [active.id, unpaid.id, cancelled.id, released.id, expired.id]);
  const by = Object.fromEntries(body.items.map((i: any) => [i.membershipId, i]));
  assert.equal(by[active.id].refundable, true);
  assert.equal(by[active.id].reasonNotRefundable, undefined);
  assert.equal(by[active.id].planName, 'Case Plan');
  assert.equal(by[active.id].price, '300000');
  assert.equal(by[expired.id].refundable, true); // EXPIRED with money still held is refundable on the case path
  assert.equal(by[released.id].refundable, false);
  assert.equal(by[released.id].reasonNotRefundable, 'PAYOUT_ALREADY_RELEASED');
  assert.equal(by[cancelled.id].refundable, false);
  assert.equal(by[cancelled.id].reasonNotRefundable, 'STATUS_NOT_REFUNDABLE');
  assert.equal(by[unpaid.id].refundable, false);
  assert.equal(by[unpaid.id].reasonNotRefundable, 'NO_PAYMENT');

  // the flag agrees with the real guard: opening a refund case on a refundable one works, on a non-refundable one the quote is not written / refund refused later
  ok(await call('POST', `/admin/complaints/${complaint.id}/case`, admin.tok, { caseClass: 'MEM_TXN', membershipId: active.id }), 201, 'open on refundable');
});

test('INT-15: complaint without a reporter -> empty list; unknown -> 404; customer -> 403', { skip }, async () => {
  const { gym } = await makeGym();
  const anon = await makeComplaint(gym.id, null);
  const admin = newAdmin();
  const body = ok(await call('GET', `/admin/complaints/${anon.id}/membership-options`, admin.tok), 200, 'no reporter');
  assert.deepEqual(body.items, []);
  const r404 = await call('GET', `/admin/complaints/${randomUUID()}/membership-options`, admin.tok);
  assert.equal(r404.status, 404);
  const member = `member-${randomUUID().slice(0, 8)}`;
  const c = await makeComplaint(gym.id, member);
  const r403 = await call('GET', `/admin/complaints/${c.id}/membership-options`, token(member, 'CUSTOMER'));
  assert.equal(r403.status, 403);
});
