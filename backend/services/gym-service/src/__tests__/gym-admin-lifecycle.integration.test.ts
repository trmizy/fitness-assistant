/**
 * FIX2-ADMIN (15/11/2026) Q5 - admin suspend / lift / temporarily close / reopen ONE branch: PATCH /admin/gyms/:id/lifecycle.
 *
 * BACKEND INTEGRATION: REAL HTTP into the real gym-service app + real service code on the isolated *_test database.
 * TEST FIXTURE: gym / partner rows and the auth token table.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../repositories/prisma';
import { call, cleanup, installStubs, makeGym, newAdmin, removeStubs, skip, startApp, stopApp, token } from './complaint-case.test-helpers';

test.before(async () => {
  if (skip) return;
  installStubs();
  await startApp();
});
test.after(async () => {
  removeStubs();
  try {
    if (!skip) await cleanup();
  } finally {
    await stopApp();
    await prisma.$disconnect();
  }
});

const lifecycle = (gymId: string, tok: string, body: unknown) => call('PATCH', `/admin/gyms/${gymId}/lifecycle`, tok, body);
const audit = (partnerId: string) => prisma.partnerAuditLog.findMany({ where: { partnerId, action: 'GYM_ADMIN_STATUS_CHANGED' }, orderBy: { createdAt: 'asc' } });

test('Q5: SUSPEND needs a reason of at least 10 characters; it moves APPROVED -> SUSPENDED and writes an audit row with the reason; LIFT_SUSPENSION restores APPROVED', { skip }, async () => {
  const g = await makeGym();
  const admin = newAdmin();

  for (const body of [{ action: 'SUSPEND' }, { action: 'SUSPEND', reason: '  ngắn  ' }, { action: 'SUSPEND', reason: '' }]) {
    const r = await lifecycle(g.gym.id, admin.tok, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, 'REASON_REQUIRED');
  }
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: g.gym.id } })).status, 'APPROVED');

  const reason = 'Có nhiều báo cáo về vệ sinh phòng tập';
  const ok = await lifecycle(g.gym.id, admin.tok, { action: 'SUSPEND', reason });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.status, 'SUSPENDED');
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: g.gym.id } })).status, 'SUSPENDED');

  // twice -> 409, nothing changes
  const again = await lifecycle(g.gym.id, admin.tok, { action: 'SUSPEND', reason });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'INVALID_TRANSITION');

  const lifted = await lifecycle(g.gym.id, admin.tok, { action: 'LIFT_SUSPENSION' });
  assert.equal(lifted.status, 200, JSON.stringify(lifted.body));
  assert.equal(lifted.body.data.status, 'APPROVED');
  assert.equal((await lifecycle(g.gym.id, admin.tok, { action: 'LIFT_SUSPENSION' })).status, 409, 'lifting a branch that is not suspended is refused');

  const rows = await audit(g.partner.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].reason, reason);
  assert.equal(rows[0].actorUserId, admin.id);
  const m0 = rows[0].metadata as any;
  assert.deepEqual({ axis: m0.axis, from: m0.from, to: m0.to }, { axis: 'MODERATION', from: 'APPROVED', to: 'SUSPENDED' });
  assert.equal(rows[1].reason, null);
  assert.equal((rows[1].metadata as any).to, 'APPROVED');
});

test('Q5: CLOSE_TEMPORARILY needs a reason, stores reason / admin / optional reopen date; REOPEN clears them; permanently closed is untouchable here', { skip }, async () => {
  const g = await makeGym();
  const admin = newAdmin();

  assert.equal((await lifecycle(g.gym.id, admin.tok, { action: 'CLOSE_TEMPORARILY', reason: 'ngắn' })).body.error.code, 'REASON_REQUIRED');
  const past = await lifecycle(g.gym.id, admin.tok, { action: 'CLOSE_TEMPORARILY', reason: 'Sửa chữa hệ thống điện', expectedReopenAt: new Date(Date.now() - 86_400_000).toISOString() });
  assert.equal(past.status, 400);
  assert.equal(past.body.error.code, 'REOPEN_DATE_IN_PAST');

  const reopenAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const closed = await lifecycle(g.gym.id, admin.tok, { action: 'CLOSE_TEMPORARILY', reason: 'Sửa chữa hệ thống điện', expectedReopenAt: reopenAt });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  let row = await prisma.gym.findUniqueOrThrow({ where: { id: g.gym.id } });
  assert.equal(row.operationalStatus, 'TEMPORARILY_CLOSED');
  assert.equal(row.closureReason, 'Sửa chữa hệ thống điện');
  assert.equal(row.closedBy, admin.id);
  assert.equal(row.expectedReopenAt?.toISOString(), reopenAt);
  assert.equal(row.status, 'APPROVED', 'the moderation switch is untouched');

  assert.equal((await lifecycle(g.gym.id, admin.tok, { action: 'CLOSE_TEMPORARILY', reason: 'Sửa chữa hệ thống điện' })).status, 409);

  const open = await lifecycle(g.gym.id, admin.tok, { action: 'REOPEN', reason: 'Đã sửa xong' });
  assert.equal(open.status, 200, JSON.stringify(open.body));
  row = await prisma.gym.findUniqueOrThrow({ where: { id: g.gym.id } });
  assert.equal(row.operationalStatus, 'OPEN');
  assert.equal(row.closureReason, null);
  assert.equal(row.closedBy, null);
  assert.equal(row.expectedReopenAt, null);
  assert.ok(row.reopenedAt);
  assert.equal((await lifecycle(g.gym.id, admin.tok, { action: 'REOPEN' })).status, 409, 'an open branch cannot be reopened');

  const rows = await audit(g.partner.id);
  assert.equal(rows.length, 2);
  assert.equal((rows[0].metadata as any).axis, 'OPERATIONAL');
  assert.equal(rows[0].reason, 'Sửa chữa hệ thống điện');

  // PERMANENTLY_CLOSED is the owner's one-way decision: the admin route refuses to touch it
  await prisma.gym.update({ where: { id: g.gym.id }, data: { operationalStatus: 'PERMANENTLY_CLOSED' } });
  const perm = await lifecycle(g.gym.id, admin.tok, { action: 'REOPEN' });
  assert.equal(perm.status, 409);
  assert.equal(perm.body.error.code, 'GYM_PERMANENTLY_CLOSED');
});

test('Q5: only an admin may call it; unknown action / extra keys / unknown branch / a branch not yet approved are refused', { skip }, async () => {
  const g = await makeGym();
  const admin = newAdmin();
  const okBody = { action: 'SUSPEND', reason: 'Lý do đủ dài để qua kiểm tra' };
  assert.equal((await lifecycle(g.gym.id, token(g.ownerId, 'GYM_OWNER'), okBody)).status, 403);
  assert.equal((await lifecycle(g.gym.id, token('someone', 'CUSTOMER'), okBody)).status, 403);
  assert.equal((await call('PATCH', `/admin/gyms/${g.gym.id}/lifecycle`, null, okBody)).status, 401);
  for (const body of [{ action: 'BOGUS' }, {}, { action: 'REOPEN', extra: 1 }, { action: 'CLOSE_TEMPORARILY', reason: 'Sửa chữa hệ thống', expectedReopenAt: 'tomorrow' }]) {
    assert.equal((await lifecycle(g.gym.id, admin.tok, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await lifecycle('00000000-0000-4000-8000-000000000000', admin.tok, { action: 'REOPEN' })).status, 404);
  await prisma.gym.update({ where: { id: g.gym.id }, data: { status: 'PENDING_REVIEW' } });
  assert.equal((await lifecycle(g.gym.id, admin.tok, okBody)).status, 409, 'a branch that was never approved is in review, not suspended');
  assert.equal((await lifecycle(g.gym.id, admin.tok, { action: 'CLOSE_TEMPORARILY', reason: 'Lý do đủ dài để qua kiểm tra' })).status, 409);
});
