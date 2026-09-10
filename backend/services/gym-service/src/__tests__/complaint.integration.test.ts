import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { complaintService } from '../services/complaint.service';

/**
 * GYM_MANAGEMENT master spec, Phase 5 — "Khiếu nại/Vi phạm". Same discipline as
 * partner-lifecycle.integration.test.ts: real dev DB, cleaned up after every test.
 */

const created: { partners: string[]; brands: string[]; gyms: string[]; plans: string[]; memberships: string[]; complaints: string[] } = {
  partners: [], brands: [], gyms: [], plans: [], memberships: [], complaints: [],
};

async function makeGymWithPartner(ownerId = randomUUID()) {
  const partner = await prisma.gymPartner.create({
    data: { legalName: `Test Partner ${randomUUID().slice(0, 8)}`, status: 'ACTIVE', verificationStatus: 'VERIFIED' },
  });
  created.partners.push(partner.id);
  await prisma.gymPartnerAccount.create({
    data: { partnerId: partner.id, userId: ownerId, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
  });
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'Test Brand', approvedName: 'Test Brand' } });
  created.brands.push(brand.id);
  await prisma.gymPartner.update({ where: { id: partner.id }, data: { brandId: brand.id } });
  const gym = await prisma.gym.create({
    data: { ownerId, brandId: brand.id, name: 'Test Gym', address: '1 Test St', status: 'APPROVED', operationalStatus: 'OPEN', approvedName: 'Test Gym', approvedAddress: '1 Test St' },
  });
  created.gyms.push(gym.id);
  return { partner, brand, gym };
}

async function makeMembership(gymId: string, clientId: string, overrides: Partial<{ status: string; endDate: Date }> = {}) {
  const plan = await prisma.gymMembershipPlan.create({
    data: { brandId: (await prisma.gym.findUniqueOrThrow({ where: { id: gymId } })).brandId!, name: 'Test Plan', price: 500_000, durationDays: 30 },
  });
  created.plans.push(plan.id);
  const now = new Date();
  const membership = await prisma.gymMembershipContract.create({
    data: {
      gymId, planId: plan.id, clientId, priceAtPurchase: 500_000, durationDaysSnapshot: 30,
      status: (overrides.status ?? 'ACTIVE') as any,
      startDate: now,
      endDate: overrides.endDate ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      totalVisits: null, usedVisits: 0,
    },
  });
  created.memberships.push(membership.id);
  return membership;
}

async function cleanup() {
  if (created.complaints.length) await prisma.gymComplaint.deleteMany({ where: { id: { in: created.complaints } } });
  if (created.gyms.length) await prisma.gymComplaint.deleteMany({ where: { gymId: { in: created.gyms } } });
  if (created.memberships.length) await prisma.gymMembershipContract.deleteMany({ where: { id: { in: created.memberships } } });
  if (created.plans.length) await prisma.gymMembershipPlan.deleteMany({ where: { id: { in: created.plans } } });
  if (created.gyms.length) await prisma.gym.deleteMany({ where: { id: { in: created.gyms } } });
  if (created.brands.length) await prisma.gymBrand.deleteMany({ where: { id: { in: created.brands } } });
  if (created.partners.length) await prisma.gymPartner.deleteMany({ where: { id: { in: created.partners } } });
  created.complaints.length = 0; created.memberships.length = 0; created.plans.length = 0;
  created.gyms.length = 0; created.brands.length = 0; created.partners.length = 0;
}

integrationTest('§60 eligibility: khách chưa từng mua gói ở gym này thì không báo cáo được', async () => {
  try {
    const { gym } = await makeGymWithPartner();
    const clientId = randomUUID();
    await assert.rejects(
      () => complaintService.submitAsMember(gym.id, clientId, { issueType: 'CLEANLINESS' as any, description: 'Bẩn quá' }),
      (e: any) => e.status === 403,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('§60 eligibility: gói đang ACTIVE thì báo cáo được, gán đúng partnerId', async () => {
  try {
    const { gym, partner } = await makeGymWithPartner();
    const clientId = randomUUID();
    await makeMembership(gym.id, clientId, { status: 'ACTIVE' });
    const complaint = await complaintService.submitAsMember(gym.id, clientId, { issueType: 'STAFF_BEHAVIOR' as any, description: 'Nhân viên thô lỗ' });
    created.complaints.push(complaint.id);
    assert.equal(complaint.source, 'MEMBER_REPORT');
    assert.equal(complaint.reporterUserId, clientId);
    assert.equal(complaint.partnerId, partner.id);
    assert.equal(complaint.status, 'OPEN');
  } finally {
    await cleanup();
  }
});

integrationTest('§60 eligibility: gói hết hạn trong vòng 30 ngày vẫn báo cáo được, quá 30 ngày thì không', async () => {
  try {
    const { gym } = await makeGymWithPartner();
    const recentClient = randomUUID();
    const staleClient = randomUUID();
    await makeMembership(gym.id, recentClient, { status: 'EXPIRED', endDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) });
    await makeMembership(gym.id, staleClient, { status: 'EXPIRED', endDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000) });

    const ok = await complaintService.submitAsMember(gym.id, recentClient, { issueType: 'EQUIPMENT_CONDITION' as any, description: 'Máy hỏng' });
    created.complaints.push(ok.id);
    assert.equal(ok.status, 'OPEN');

    await assert.rejects(
      () => complaintService.submitAsMember(gym.id, staleClient, { issueType: 'EQUIPMENT_CONDITION' as any, description: 'Máy hỏng' }),
      (e: any) => e.status === 403,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('tối đa 5 ảnh, từ chối nếu vượt', async () => {
  try {
    const { gym } = await makeGymWithPartner();
    const clientId = randomUUID();
    await makeMembership(gym.id, clientId);
    await assert.rejects(
      () =>
        complaintService.submitAsMember(gym.id, clientId, {
          issueType: 'OTHER' as any,
          description: 'x',
          photoTokens: ['a', 'b', 'c', 'd', 'e', 'f'],
        }),
      (e: any) => e.status === 400,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('admin tự ghi nhận (createByAdmin) — không cần kiểm điều kiện thành viên', async () => {
  try {
    const { gym, partner } = await makeGymWithPartner();
    const complaint = await complaintService.createByAdmin('admin-1', {
      gymId: gym.id,
      source: 'PT_REPORT' as any,
      issueType: 'SAFETY' as any,
      description: 'PT phản ánh qua điện thoại',
    });
    created.complaints.push(complaint.id);
    assert.equal(complaint.source, 'PT_REPORT');
    assert.equal(complaint.reporterUserId, null);
    assert.equal(complaint.partnerId, partner.id);
  } finally {
    await cleanup();
  }
});

integrationTest('updateStatus: RESOLVED bắt buộc có adminResponse, và là trạng thái cuối', async () => {
  try {
    const { gym } = await makeGymWithPartner();
    const complaint = await complaintService.createByAdmin('admin-1', {
      gymId: gym.id, source: 'SELF_DETECTED' as any, issueType: 'BILLING' as any, description: 'Thu sai giá',
    });
    created.complaints.push(complaint.id);

    await assert.rejects(
      () => complaintService.updateStatus(complaint.id, 'admin-1', { status: 'RESOLVED' as any }),
      (e: any) => e.status === 400,
    );

    const inProgress = await complaintService.updateStatus(complaint.id, 'admin-1', { status: 'IN_PROGRESS' as any });
    assert.equal(inProgress.status, 'IN_PROGRESS');

    const resolved = await complaintService.updateStatus(complaint.id, 'admin-1', { status: 'RESOLVED' as any, adminResponse: 'Đã nhắc nhở đối tác' });
    assert.equal(resolved.status, 'RESOLVED');
    assert.equal(resolved.adminResponse, 'Đã nhắc nhở đối tác');
    assert.ok(resolved.resolvedAt);
    assert.equal(resolved.resolvedBy, 'admin-1');

    await assert.rejects(
      () => complaintService.updateStatus(complaint.id, 'admin-1', { status: 'IN_PROGRESS' as any }),
      (e: any) => e.status === 409,
      'đã RESOLVED thì không đổi lại được nữa — không có phúc thẩm',
    );
  } finally {
    await cleanup();
  }
});

integrationTest('assignAdmin gán/gỡ đúng', async () => {
  try {
    const { gym } = await makeGymWithPartner();
    const complaint = await complaintService.createByAdmin('admin-1', {
      gymId: gym.id, source: 'SELF_DETECTED' as any, issueType: 'OTHER' as any, description: 'x',
    });
    created.complaints.push(complaint.id);
    const assigned = await complaintService.assignAdmin(complaint.id, 'admin-42');
    assert.equal(assigned.assignedAdminId, 'admin-42');
    const unassigned = await complaintService.assignAdmin(complaint.id, null);
    assert.equal(unassigned.assignedAdminId, null);
  } finally {
    await cleanup();
  }
});

integrationTest('listForPartner / listMine / queue trả đúng phạm vi', async () => {
  try {
    const { gym, partner } = await makeGymWithPartner();
    const clientId = randomUUID();
    await makeMembership(gym.id, clientId);
    const mine = await complaintService.submitAsMember(gym.id, clientId, { issueType: 'OTHER' as any, description: 'a' });
    created.complaints.push(mine.id);

    const forPartner = await complaintService.listForPartner(partner.id);
    assert.ok(forPartner.some((c) => c.id === mine.id));

    const forReporter = await complaintService.listMine(clientId);
    assert.ok(forReporter.some((c) => c.id === mine.id));

    const openQueue = await complaintService.queue('OPEN' as any);
    assert.ok(openQueue.some((c) => c.id === mine.id));
  } finally {
    await cleanup();
  }
});
