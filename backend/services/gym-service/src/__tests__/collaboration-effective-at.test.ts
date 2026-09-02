import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { collaborationService } from '../services/collaboration.service';

/**
 * Vòng 4 / Phase E3 — a notice-period termination for gym<->PT collaborations.
 * `collaboration.service.ts`'s terminate() used to always flip status -> TERMINATED (and
 * suspend the affiliation row) immediately, with no way to give either side notice. Now an
 * optional future `effectiveAt` leaves status ACCEPTED (so the PT keeps showing as affiliated)
 * until that date, while activeRates() — the one thing that actually gates NEW referral/rate
 * lookups — refuses the row starting the moment terminate() is called, regardless of the date.
 *
 * Real-DB integration tests (terminate()/activeRates()/listFor() all touch prisma directly,
 * same reasoning as checkin-gym-status-guard.integration.test.ts).
 */

async function makeGym() {
  return prisma.gym.create({
    data: { id: randomUUID(), ownerId: randomUUID(), name: 'Test Gym', address: '123 Test St', status: 'APPROVED' },
  });
}

async function makeAcceptedCollaboration(gymId: string, ptUserId: string, overrides: Record<string, any> = {}) {
  return prisma.gymPtCollaboration.create({
    data: {
      id: randomUUID(),
      gymId,
      ptUserId,
      proposedPtRate: '0.90',
      proposedGymRate: '0',
      platformRate: '0.10',
      status: 'ACCEPTED',
      proposedBy: 'PT',
      round: 1,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      acceptedAt: new Date(),
      ...overrides,
    },
  });
}

async function makeAffiliation(gymId: string, ptId: string) {
  return prisma.gymTrainerAffiliation.create({
    data: { id: randomUUID(), gymId, ptId, status: 'ACTIVE' },
  });
}

async function cleanup(gymId: string, collaborationId: string, affiliationId: string) {
  await prisma.gymPtCollaboration.delete({ where: { id: collaborationId } }).catch(() => {});
  await prisma.gymTrainerAffiliation.delete({ where: { id: affiliationId } }).catch(() => {});
  await prisma.gym.delete({ where: { id: gymId } }).catch(() => {});
}

test('terminate() không truyền effectiveAt — hành vi y hệt trước đây: chấm dứt ngay lập tức', async () => {
  const gym = await makeGym();
  const ptUserId = randomUUID();
  const collab = await makeAcceptedCollaboration(gym.id, ptUserId);
  const affiliation = await makeAffiliation(gym.id, ptUserId);

  try {
    const updated = await collaborationService.terminate(collab.id, 'GYM', gym.ownerId);
    assert.equal(updated.status, 'TERMINATED');
    assert.ok(updated.terminatedAt);

    const affRow = await prisma.gymTrainerAffiliation.findUnique({ where: { id: affiliation.id } });
    assert.equal(affRow?.status, 'SUSPENDED', 'chấm dứt ngay vẫn phải khoá affiliation ngay như trước');
  } finally {
    await cleanup(gym.id, collab.id, affiliation.id);
  }
});

test('terminate() với effectiveAt trong tương lai — status vẫn ACCEPTED, affiliation KHÔNG bị khoá ngay', async () => {
  const gym = await makeGym();
  const ptUserId = randomUUID();
  const collab = await makeAcceptedCollaboration(gym.id, ptUserId);
  const affiliation = await makeAffiliation(gym.id, ptUserId);
  const effectiveAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 ngày sau

  try {
    const updated = await collaborationService.terminate(collab.id, 'GYM', gym.ownerId, effectiveAt);
    assert.equal(updated.status, 'ACCEPTED', 'còn trong thời gian báo trước — chưa thật sự chấm dứt');
    assert.equal(updated.effectiveAt?.getTime(), effectiveAt.getTime());

    const affRow = await prisma.gymTrainerAffiliation.findUnique({ where: { id: affiliation.id } });
    assert.equal(affRow?.status, 'ACTIVE', 'PT vẫn hiển thị đang cộng tác trong lúc chờ hiệu lực');
  } finally {
    await cleanup(gym.id, collab.id, affiliation.id);
  }
});

test('activeRates() từ chối NGAY một hợp tác đang chờ chấm dứt (effectiveAt tương lai) — dù status vẫn ACCEPTED', async () => {
  const gym = await makeGym();
  const ptUserId = randomUUID();
  const collab = await makeAcceptedCollaboration(gym.id, ptUserId);
  const affiliation = await makeAffiliation(gym.id, ptUserId);

  try {
    const before = await collaborationService.activeRates(gym.id, ptUserId);
    assert.ok(before, 'trước khi chấm dứt, hợp tác vẫn hoạt động bình thường');

    await collaborationService.terminate(collab.id, 'GYM', gym.ownerId, new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));

    const after = await collaborationService.activeRates(gym.id, ptUserId);
    assert.equal(after, null, 'ngay khi terminate() gọi (kể cả có báo trước), hợp đồng MỚI/mã giới thiệu MỚI phải bị chặn ngay');
  } finally {
    await cleanup(gym.id, collab.id, affiliation.id);
  }
});

test('listFor() tự chốt (finalizeIfEffective) một hợp tác đã tới effectiveAt trong quá khứ', async () => {
  const gym = await makeGym();
  const ptUserId = randomUUID();
  // effectiveAt đã ở QUÁ KHỨ — mô phỏng thời gian đã trôi qua kể từ lúc terminate() được gọi.
  const collab = await makeAcceptedCollaboration(gym.id, ptUserId, {
    effectiveAt: new Date(Date.now() - 60 * 1000),
    terminatedBy: gym.ownerId,
  });
  const affiliation = await makeAffiliation(gym.id, ptUserId);

  try {
    const list = await collaborationService.listFor({ ptUserId });
    const found = list.find((r: any) => r.id === collab.id);
    assert.equal(found?.status, 'TERMINATED', 'listFor phải tự chốt khi effectiveAt đã qua, không chờ ai ghi lại row');

    const affRow = await prisma.gymTrainerAffiliation.findUnique({ where: { id: affiliation.id } });
    assert.equal(affRow?.status, 'SUSPENDED');
  } finally {
    await cleanup(gym.id, collab.id, affiliation.id);
  }
});
