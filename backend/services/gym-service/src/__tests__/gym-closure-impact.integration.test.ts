import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { gymService } from '../services/gym.service';

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 5 — owner-facing permanent-closure impact summary (§9 of
 * GYM_BRANCH_FORM_API_GAPS.md). Scoped-down mirror of partnerService.terminationImpact, one
 * gym instead of a whole partner's every gym.
 */

async function makeBrandAndGym() {
  const ownerId = randomUUID();
  const brand = await prisma.gymBrand.create({ data: { id: randomUUID(), ownerId, name: 'Test Brand' } });
  const gym = await prisma.gym.create({
    data: { id: randomUUID(), ownerId, brandId: brand.id, name: 'Test Gym', address: '1 Test St', status: 'APPROVED' },
  });
  return { ownerId, brand, gym };
}

async function cleanup(brandId: string, gymId: string, planId?: string, membershipId?: string, collaborationId?: string) {
  if (membershipId) await prisma.gymMembershipContract.delete({ where: { id: membershipId } }).catch(() => {});
  if (collaborationId) await prisma.gymPtCollaboration.delete({ where: { id: collaborationId } }).catch(() => {});
  if (planId) await prisma.gymMembershipPlan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.gym.delete({ where: { id: gymId } }).catch(() => {});
  await prisma.gymBrand.delete({ where: { id: brandId } }).catch(() => {});
}

integrationTest('closureImpact: gym mới, chưa có hội viên/cộng tác thì mọi số liệu đều bằng 0', async () => {
  const { ownerId, brand, gym } = await makeBrandAndGym();
  try {
    const impact = await gymService.closureImpact(gym.id, ownerId);
    assert.equal(impact.activeMembers, 0);
    assert.equal(impact.unusedValueTotal, 0);
    assert.equal(impact.activeCollaborations, 0);
    assert.equal(typeof impact.walletBalance, 'number');
  } finally {
    await cleanup(brand.id, gym.id);
  }
});

integrationTest('closureImpact: đếm đúng hội viên ACTIVE + ước tính đúng phần chưa dùng', async () => {
  const { ownerId, brand, gym } = await makeBrandAndGym();
  const plan = await prisma.gymMembershipPlan.create({
    data: { id: randomUUID(), brandId: brand.id, name: 'Test Plan', price: 300_000, durationDays: 30 },
  });
  const membership = await prisma.gymMembershipContract.create({
    data: {
      id: randomUUID(),
      gymId: gym.id,
      planId: plan.id,
      clientId: randomUUID(),
      status: 'ACTIVE',
      priceAtPurchase: 300_000,
      durationDaysSnapshot: 30,
      startDate: new Date(),
      endDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // còn ~nửa thời hạn
    },
  });
  try {
    const impact = await gymService.closureImpact(gym.id, ownerId);
    assert.equal(impact.activeMembers, 1);
    assert.ok(impact.unusedValueTotal > 0, 'còn ~nửa thời hạn thì phần chưa dùng phải > 0');
    assert.ok(impact.unusedValueTotal <= 300_000);
  } finally {
    await cleanup(brand.id, gym.id, plan.id, membership.id);
  }
});

integrationTest('closureImpact: đếm đúng số cộng tác PT đang ACCEPTED, không tính PENDING/REJECTED', async () => {
  const { ownerId, brand, gym } = await makeBrandAndGym();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const accepted = await prisma.gymPtCollaboration.create({
    data: {
      id: randomUUID(), gymId: gym.id, ptUserId: randomUUID(), status: 'ACCEPTED',
      proposedPtRate: 0.7, proposedGymRate: 0.2, platformRate: 0.1, proposedBy: 'GYM',
      expiresAt, acceptedAt: new Date(),
    },
  });
  const pending = await prisma.gymPtCollaboration.create({
    data: {
      id: randomUUID(), gymId: gym.id, ptUserId: randomUUID(), status: 'PENDING',
      proposedPtRate: 0.7, proposedGymRate: 0.2, platformRate: 0.1, proposedBy: 'GYM',
      expiresAt,
    },
  });
  try {
    const impact = await gymService.closureImpact(gym.id, ownerId);
    assert.equal(impact.activeCollaborations, 1);
  } finally {
    await prisma.gymPtCollaboration.delete({ where: { id: pending.id } }).catch(() => {});
    await cleanup(brand.id, gym.id, undefined, undefined, accepted.id);
  }
});

integrationTest('closureImpact: không xem được của gym chủ khác', async () => {
  const { brand, gym } = await makeBrandAndGym();
  try {
    await assert.rejects(
      () => gymService.closureImpact(gym.id, randomUUID()),
      (e: any) => e.status === 403,
    );
  } finally {
    await cleanup(brand.id, gym.id);
  }
});

// ── Đóng cửa vĩnh viễn: chỉ OWNER, có dấu vết, và nghĩa vụ đang chạy được GIỮ NGUYÊN ───────────
//
// Không có luồng chặn/hoàn tiền mới nào ở đây: đóng cửa vĩnh viễn chỉ đổi trạng thái vận hành và
// ghi lại ai/lúc nào/vì sao. Hội viên đang ACTIVE vẫn ACTIVE và chi nhánh hiện ra ở hạng mục chờ
// admin xử lý (listPermanentlyClosedNeedingReview) — đúng hành vi có từ Vòng 4 / Phase C3.

integrationTest('đóng cửa vĩnh viễn: MANAGER bị từ chối, chi nhánh trong DB không đổi gì', async () => {
  const { ownerId, brand, gym } = await makeBrandAndGym();
  const managerUserId = randomUUID();
  try {
    await assert.rejects(
      () =>
        gymService.setOperationalStatus(gym.id, ownerId, 'PERMANENTLY_CLOSED', 'Hết hợp đồng thuê', undefined, {
          userId: managerUserId,
          role: 'MANAGER',
        }),
      (e: any) => e.status === 403 && e.code === 'OWNER_ROLE_REQUIRED',
    );
    const row = await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } });
    assert.equal(row.operationalStatus, 'OPEN');
    assert.equal(row.closedAt, null);
    assert.equal(row.closedBy, null);
    assert.equal(row.closureReason, null);
  } finally {
    await cleanup(brand.id, gym.id);
  }
});

integrationTest('tạm đóng → mở lại bởi MANAGER: DB ghi đúng người quản lý đã đóng, mở lại thì xoá dấu đó', async () => {
  const { ownerId, brand, gym } = await makeBrandAndGym();
  const manager = { userId: randomUUID(), role: 'MANAGER' as const };
  try {
    await gymService.setOperationalStatus(gym.id, ownerId, 'TEMPORARILY_CLOSED', 'Bảo trì', undefined, manager);
    let row = await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } });
    assert.equal(row.operationalStatus, 'TEMPORARILY_CLOSED');
    assert.equal(row.closedBy, manager.userId, 'người thực hiện, không phải ownerId');
    assert.notEqual(row.closedBy, ownerId);

    await gymService.setOperationalStatus(gym.id, ownerId, 'OPEN', undefined, undefined, manager);
    row = await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } });
    assert.equal(row.operationalStatus, 'OPEN');
    assert.equal(row.closedBy, null);
    assert.equal(row.closureReason, null);
    assert.ok(row.reopenedAt);
  } finally {
    await cleanup(brand.id, gym.id);
  }
});

integrationTest('đóng cửa vĩnh viễn bởi OWNER: ghi ai/lúc nào/vì sao; hội viên + cộng tác đang chạy không bị đụng, admin vẫn thấy hạng mục cần xử lý', async () => {
  const { ownerId, brand, gym } = await makeBrandAndGym();
  const ptUserId = randomUUID();
  const plan = await prisma.gymMembershipPlan.create({
    data: { id: randomUUID(), brandId: brand.id, name: 'Test Plan', price: 300_000, durationDays: 30 },
  });
  const membership = await prisma.gymMembershipContract.create({
    data: {
      id: randomUUID(), gymId: gym.id, planId: plan.id, clientId: randomUUID(), status: 'ACTIVE',
      priceAtPurchase: 300_000, durationDaysSnapshot: 30,
      startDate: new Date(), endDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    },
  });
  const collaboration = await prisma.gymPtCollaboration.create({
    data: {
      id: randomUUID(), gymId: gym.id, ptUserId, status: 'ACCEPTED',
      proposedPtRate: 0.7, proposedGymRate: 0.2, platformRate: 0.1, proposedBy: 'GYM',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), acceptedAt: new Date(),
    },
  });
  const { collaborationService } = await import('../services/collaboration.service');
  try {
    assert.ok(await collaborationService.activeRates(gym.id, ptUserId), 'trước khi đóng: nhận hợp đồng PT mới bình thường');

    const before = Date.now();
    const closed = await gymService.setOperationalStatus(gym.id, ownerId, 'PERMANENTLY_CLOSED', 'Hết hợp đồng thuê mặt bằng', undefined, {
      userId: ownerId,
      role: 'OWNER',
    });
    assert.equal(closed.operationalStatus, 'PERMANENTLY_CLOSED');

    // Dấu vết nằm ngay trên dòng chi nhánh: ai (closedBy) · lúc nào (closedAt) · vì sao (closureReason).
    const row = await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } });
    assert.equal(row.closedBy, ownerId);
    assert.equal(row.closureReason, 'Hết hợp đồng thuê mặt bằng');
    assert.ok(row.closedAt && row.closedAt.getTime() >= before - 1000);
    assert.equal(row.status, 'APPROVED', 'trục duyệt của admin không bị đụng tới');

    // Nghĩa vụ đang chạy: KHÔNG tự hoàn tiền, KHÔNG tự chấm dứt cộng tác.
    assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: membership.id } })).status, 'ACTIVE');
    assert.equal((await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: collaboration.id } })).status, 'ACCEPTED');

    // ...nhưng không nhận hợp đồng PT MỚI gắn với chi nhánh này nữa.
    assert.equal(await collaborationService.activeRates(gym.id, ptUserId), null);
    assert.deepEqual(await collaborationService.listAcceptedGymsForPt(ptUserId), []);

    // Hạng mục cho admin vẫn hoạt động như cũ.
    const queue = await gymService.listPermanentlyClosedNeedingReview();
    const item = queue.find((g) => g.id === gym.id);
    assert.ok(item, 'chi nhánh vừa đóng phải hiện trong hạng mục cần admin xử lý');
    assert.equal(item!.activeMembershipCount, 1);
    assert.equal(item!.closedBy, ownerId, 'admin thấy luôn ai đã đóng');

    // Trạng thái cuối: kể cả OWNER cũng không mở lại được.
    await assert.rejects(
      () => gymService.setOperationalStatus(gym.id, ownerId, 'OPEN', undefined, undefined, { userId: ownerId, role: 'OWNER' }),
      (e: any) => e.status === 409,
    );
  } finally {
    await cleanup(brand.id, gym.id, plan.id, membership.id, collaboration.id);
  }
});
