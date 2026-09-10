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
