import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { partnerService } from '../services/partner.service';
import { partnerInvitationService } from '../services/partner-invitation.service';
import { onboardingService } from '../services/onboarding.service';
import { partnerDiligenceService } from '../services/partner-diligence.service';
import { commissionRateService } from '../services/commission-rate.service';
import { partnerGuard } from '../services/partner-guard.service';
import { membershipService } from '../services/membership.service';
import { gymService } from '../services/gym.service';

/**
 * Phase 2-5 — nghiệm thu "quản lý đối tác phòng tập". Cùng kỷ luật với
 * partner-identity.integration.test.ts: chạy trên CSDL dev thật, dọn sạch sau mỗi bài.
 */

const created: { partners: string[]; gyms: string[]; brands: string[]; plans: string[]; memberships: string[] } = {
  partners: [], gyms: [], brands: [], plans: [], memberships: [],
};

async function makePartner(overrides: Partial<{ status: any; contactEmail: string; verificationStatus: any }> = {}) {
  const partner = await prisma.gymPartner.create({
    data: {
      legalName: `Test Partner ${randomUUID().slice(0, 8)}`,
      contactEmail: overrides.contactEmail ?? `${randomUUID().slice(0, 8)}@example.com`,
      status: overrides.status ?? 'ACTIVE',
      // Mặc định VERIFIED — hầu hết test dựng một đối tác coi như đã ổn định, đúng thực tế
      // sau backfill của migration 20260908050000 cho mọi hồ sơ đã qua PROSPECT. Chỉ cần
      // NOT_VERIFIED tường minh ở đúng các test đang kiểm chính trục thẩm định.
      verificationStatus: overrides.verificationStatus ?? 'VERIFIED',
    },
  });
  created.partners.push(partner.id);
  return partner;
}

async function makeAccount(partnerId: string, role: 'OWNER' | 'MANAGER', userId = randomUUID(), scopedGymIds: string[] = []) {
  return prisma.gymPartnerAccount.create({
    data: { partnerId, userId, role, scopedGymIds, status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
  });
}

async function makeBrandAndGym(ownerId: string) {
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'Test Brand', approvedName: 'Test Brand' } });
  created.brands.push(brand.id);
  const gym = await prisma.gym.create({
    data: {
      ownerId, brandId: brand.id, name: 'Test Gym', address: '1 Test St',
      status: 'APPROVED', operationalStatus: 'OPEN', approvedName: 'Test Gym', approvedAddress: '1 Test St',
    },
  });
  created.gyms.push(gym.id);
  return { brand, gym };
}

async function makeActiveMembership(gymId: string, brandId: string, clientId = randomUUID()) {
  const plan = await prisma.gymMembershipPlan.create({
    data: { brandId, name: 'Test Plan', price: 1_000_000, durationDays: 30 },
  });
  created.plans.push(plan.id);
  const now = new Date();
  const membership = await prisma.gymMembershipContract.create({
    data: {
      gymId, planId: plan.id, clientId, priceAtPurchase: 1_000_000, durationDaysSnapshot: 30,
      status: 'ACTIVE', startDate: now, endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      totalVisits: null, usedVisits: 0,
    },
  });
  created.memberships.push(membership.id);
  return membership;
}

async function cleanup() {
  // onboardingService.submitBrand tạo GymBrand như một TÁC DỤNG PHỤ (không đi qua
  // makeBrandAndGym) — quét thêm brandId hiện đang gắn trên các đối tác sắp xoá, chứ
  // không chỉ dựa vào những gì test đã tự tay push vào created.brands, kẻo bỏ sót.
  if (created.partners.length) {
    const partners = await prisma.gymPartner.findMany({ where: { id: { in: created.partners } }, select: { brandId: true } });
    for (const p of partners) if (p.brandId && !created.brands.includes(p.brandId)) created.brands.push(p.brandId);
  }
  // Bug thật đã xảy ra: membershipService.purchase() (gọi thật, không mock) tạo một dòng
  // GymMembershipContract thật cho gym sắp xoá — không có test nào tự tay push dòng đó vào
  // created.memberships. Xoá theo gymId ở đây luôn, không chỉ theo id đã track, vì bất kỳ
  // hội viên nào gắn với một gym TEST đều chắc chắn cũng là dữ liệu test.
  if (created.gyms.length) {
    await prisma.gymMembershipContract.deleteMany({ where: { gymId: { in: created.gyms } } });
  }
  if (created.memberships.length) await prisma.gymMembershipContract.deleteMany({ where: { id: { in: created.memberships } } });
  if (created.plans.length) await prisma.gymMembershipPlan.deleteMany({ where: { id: { in: created.plans } } });
  if (created.gyms.length) await prisma.gym.deleteMany({ where: { id: { in: created.gyms } } });
  if (created.partners.length) await prisma.gymPartner.deleteMany({ where: { id: { in: created.partners } } });
  if (created.brands.length) await prisma.gymBrand.deleteMany({ where: { id: { in: created.brands } } });
  created.memberships.length = 0; created.plans.length = 0; created.gyms.length = 0; created.brands.length = 0; created.partners.length = 0;
}

// ── Phase 2 ────────────────────────────────────────────────────────────────

integrationTest('Phase 2: provisionOwnerAccount chuyển PROSPECT -> INVITED và tạo thư mời', async () => {
  try {
    const partner = await makePartner({ status: 'PROSPECT', contactEmail: 'owner-provision@example.com', verificationStatus: 'VERIFIED' });
    const { partner: updated, invitation, rawToken } = await partnerService.provisionOwnerAccount(partner.id, 'admin-1');

    assert.equal(updated.status, 'INVITED');
    assert.equal(invitation.role, 'OWNER');
    assert.equal(invitation.email, 'owner-provision@example.com');
    assert.ok(rawToken.length > 20);

    // Không cấp lại được khi đã ACTIVE.
    await partnerInvitationService.acceptInvitation(rawToken, randomUUID());
    await assert.rejects(() => partnerService.provisionOwnerAccount(partner.id, 'admin-1'), (e: any) => e.status === 409);
  } finally {
    await cleanup();
  }
});

integrationTest('GYM_MANAGEMENT §60: provisionOwnerAccount từ chối khi chưa VERIFIED', async () => {
  try {
    const notVerified = await makePartner({ status: 'PROSPECT', verificationStatus: 'NOT_VERIFIED' });
    await assert.rejects(() => partnerService.provisionOwnerAccount(notVerified.id, 'admin-1'), (e: any) => e.status === 409);

    const inReview = await makePartner({ status: 'PROSPECT', verificationStatus: 'IN_REVIEW' });
    await assert.rejects(() => partnerService.provisionOwnerAccount(inReview.id, 'admin-1'), (e: any) => e.status === 409);

    const needsInfo = await makePartner({ status: 'PROSPECT', verificationStatus: 'NEEDS_INFO' });
    await assert.rejects(() => partnerService.provisionOwnerAccount(needsInfo.id, 'admin-1'), (e: any) => e.status === 409);

    // Đúng thứ tự accept-flow: chuyển sang VERIFIED rồi mới cấp được.
    await partnerDiligenceService.setVerificationStatus(notVerified.id, 'IN_REVIEW', 'admin-1');
    await partnerDiligenceService.setVerificationStatus(notVerified.id, 'VERIFIED', 'admin-1');
    const { partner: updated } = await partnerService.provisionOwnerAccount(notVerified.id, 'admin-1');
    assert.equal(updated.status, 'INVITED');
  } finally {
    await cleanup();
  }
});

integrationTest('GYM_MANAGEMENT §60: setVerificationStatus — NEEDS_INFO bắt buộc ghi chú, không được set REJECTED trực tiếp', async () => {
  try {
    const partner = await makePartner({ status: 'PROSPECT', verificationStatus: 'NOT_VERIFIED' });

    await assert.rejects(
      () => partnerDiligenceService.setVerificationStatus(partner.id, 'NEEDS_INFO', 'admin-1'),
      (e: any) => e.status === 400,
      'NEEDS_INFO phải kèm ghi chú',
    );
    await assert.rejects(
      () => partnerDiligenceService.setVerificationStatus(partner.id, 'REJECTED' as any, 'admin-1'),
      (e: any) => e.status === 400,
      'phải dùng reject(), không set trực tiếp',
    );

    const inReview = await partnerDiligenceService.setVerificationStatus(partner.id, 'IN_REVIEW', 'admin-1');
    assert.equal(inReview.verificationStatus, 'IN_REVIEW');
    assert.equal(inReview.verifiedAt, null, 'IN_REVIEW không phải quyết định cuối, không set verifiedAt');

    const needsInfo = await partnerDiligenceService.setVerificationStatus(partner.id, 'NEEDS_INFO', 'admin-1', 'Thiếu giấy phép PCCC');
    assert.equal(needsInfo.verificationStatus, 'NEEDS_INFO');
    assert.equal(needsInfo.verificationNotes, 'Thiếu giấy phép PCCC');

    const verified = await partnerDiligenceService.setVerificationStatus(partner.id, 'VERIFIED', 'admin-1');
    assert.equal(verified.verificationStatus, 'VERIFIED');
    assert.ok(verified.verifiedAt);
    assert.equal(verified.verifiedBy, 'admin-1');
  } finally {
    await cleanup();
  }
});

integrationTest('GYM_MANAGEMENT §60: reject()/reopen() đồng bộ verificationStatus', async () => {
  try {
    const partner = await makePartner({ status: 'PROSPECT', verificationStatus: 'IN_REVIEW' });

    const rejected = await partnerDiligenceService.reject(partner.id, 'Giấy phép hết hạn', 'admin-1');
    assert.equal(rejected.verificationStatus, 'REJECTED');
    assert.equal(rejected.verificationNotes, 'Giấy phép hết hạn');
    assert.equal(rejected.verifiedBy, 'admin-1');

    const reopened = await partnerDiligenceService.reopen(partner.id);
    assert.equal(reopened.verificationStatus, 'NOT_VERIFIED', 'mở lại = xem xét lại từ đầu');
    assert.equal(reopened.verificationNotes, null);
    assert.equal(reopened.rejectedAt, null);
  } finally {
    await cleanup();
  }
});

integrationTest('GYM_MANAGEMENT §65: assignAdmin + PartnerInternalNote (owner-invisible)', async () => {
  try {
    const partner = await makePartner();
    const assigned = await partnerDiligenceService.assignAdmin(partner.id, 'admin-42');
    assert.equal(assigned.assignedAdminId, 'admin-42');
    const unassigned = await partnerDiligenceService.assignAdmin(partner.id, null);
    assert.equal(unassigned.assignedAdminId, null);

    await assert.rejects(() => partnerDiligenceService.addInternalNote(partner.id, 'admin-1', '  '), (e: any) => e.status === 400);
    const note = await partnerDiligenceService.addInternalNote(partner.id, 'admin-1', 'Đã gọi điện, hẹn tuần sau');
    assert.equal(note.text, 'Đã gọi điện, hẹn tuần sau');
    assert.equal(note.authorAdminId, 'admin-1');

    const notes = await partnerDiligenceService.listInternalNotes(partner.id);
    assert.equal(notes.length, 1);
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 2: chuyển quyền sở hữu hạ chủ cũ xuống MANAGER và cập nhật ownerId của gym/brand', async () => {
  try {
    const partner = await makePartner();
    const oldOwnerUserId = randomUUID();
    const oldOwner = await makeAccount(partner.id, 'OWNER', oldOwnerUserId);
    const { brand, gym } = await makeBrandAndGym(oldOwnerUserId);
    await partnerService.attachBrand(partner.id, brand.id);

    const newOwnerUserId = randomUUID();
    const scopedGym = [gym.id];
    const manager = await makeAccount(partner.id, 'MANAGER', newOwnerUserId, scopedGym);

    const result = await partnerService.transferOwnership(partner.id, manager.id, 'admin-1');
    assert.equal(result.gymsMoved, 1);
    assert.equal(result.brandsMoved, 1);

    const refreshedOld = await prisma.gymPartnerAccount.findUnique({ where: { id: oldOwner.id } });
    const refreshedNew = await prisma.gymPartnerAccount.findUnique({ where: { id: manager.id } });
    assert.equal(refreshedOld?.role, 'MANAGER');
    assert.deepEqual(refreshedOld?.scopedGymIds, scopedGym, 'chủ cũ kế thừa đúng phạm vi của người vừa lên chức');
    assert.equal(refreshedNew?.role, 'OWNER');
    assert.deepEqual(refreshedNew?.scopedGymIds, [], 'OWNER mới không còn bị giới hạn chi nhánh');

    const refreshedGym = await prisma.gym.findUnique({ where: { id: gym.id } });
    const refreshedBrand = await prisma.gymBrand.findUnique({ where: { id: brand.id } });
    assert.equal(refreshedGym?.ownerId, newOwnerUserId, 'Gym.ownerId phải trỏ sang chủ mới — nếu không chủ mới đăng nhập vào sẽ thấy trống trơn');
    assert.equal(refreshedBrand?.ownerId, newOwnerUserId);

    const consistency = await partnerService.assertOwnershipConsistent(partner.id);
    assert.equal(consistency.consistent, true);
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 2: không chuyển quyền sở hữu cho tài khoản đã bị thu hồi hoặc thuộc đối tác khác', async () => {
  try {
    const partner = await makePartner();
    const ownerUserId = randomUUID();
    await makeAccount(partner.id, 'OWNER', ownerUserId);

    const revokedManager = await prisma.gymPartnerAccount.create({
      data: { partnerId: partner.id, userId: randomUUID(), role: 'MANAGER', scopedGymIds: [randomUUID()], status: 'REVOKED' },
    });
    await assert.rejects(
      () => partnerService.transferOwnership(partner.id, revokedManager.id, 'admin-1'),
      (e: any) => e.status === 409,
      'không chuyển quyền cho tài khoản đã bị thu hồi',
    );

    const otherPartner = await makePartner();
    const foreignManager = await makeAccount(otherPartner.id, 'MANAGER', randomUUID(), [randomUUID()]);
    await assert.rejects(
      () => partnerService.transferOwnership(partner.id, foreignManager.id, 'admin-1'),
      (e: any) => e.status === 403,
      'không chuyển quyền sang tài khoản thuộc đối tác khác',
    );
  } finally {
    await cleanup();
  }
});

// ── Phase 3 ────────────────────────────────────────────────────────────────

integrationTest('Phase 3: MANAGER chỉ cần bước 1-2, OWNER cần đủ 5 bước', async () => {
  try {
    const partner = await makePartner({ status: 'INVITED' });
    const ownerAcc = await prisma.gymPartnerAccount.create({
      data: { partnerId: partner.id, userId: randomUUID(), role: 'OWNER', scopedGymIds: [], status: 'ACTIVE', activatedAt: new Date() },
    });
    const managerAcc = await prisma.gymPartnerAccount.create({
      data: { partnerId: partner.id, userId: randomUUID(), role: 'MANAGER', scopedGymIds: [randomUUID()], status: 'ACTIVE', activatedAt: new Date() },
    });

    let progress = await onboardingService.getProgress(managerAcc.id);
    assert.equal(progress.completed, false);
    assert.equal(progress.steps.brand, null, 'MANAGER không có khái niệm bước thương hiệu');
    progress = await onboardingService.submitContact(managerAcc.id, '0900000001');
    assert.equal(progress.completed, true, 'MANAGER hoàn tất chỉ với bước liên hệ');

    progress = await onboardingService.getProgress(ownerAcc.id);
    assert.equal(progress.completed, false);
    progress = await onboardingService.submitContact(ownerAcc.id, '0900000002');
    assert.equal(progress.completed, false, 'OWNER chưa xong chỉ với bước liên hệ');
    progress = await onboardingService.submitBrand(ownerAcc.id, ownerAcc.userId, partner.id, { name: 'Onboard Brand' });
    assert.equal(progress.completed, false);
    progress = await onboardingService.submitPayout(ownerAcc.id, partner.id, { bankName: 'VCB', accountNumber: '123', accountHolder: 'A' });
    assert.equal(progress.completed, false);
    progress = await onboardingService.submitTerms(ownerAcc.id, partner.id, 'v1');
    assert.equal(progress.completed, true, 'OWNER hoàn tất sau đủ cả 5 bước');

    const refreshedAccount = await prisma.gymPartnerAccount.findUnique({ where: { id: ownerAcc.id } });
    assert.ok(refreshedAccount?.onboardingCompletedAt, 'onboardingCompletedAt phải được set khi hoàn tất');

    const refreshedPartner = await prisma.gymPartner.findUnique({ where: { id: partner.id } });
    assert.equal(refreshedPartner?.brandId != null, true);
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 3: submitBrand không ném lỗi khi gọi lại lần hai (idempotent, đóng app giữa chừng)', async () => {
  try {
    const partner = await makePartner();
    const ownerAcc = await makeAccount(partner.id, 'OWNER');
    await onboardingService.submitBrand(ownerAcc.id, ownerAcc.userId, partner.id, { name: 'Idempotent Brand' });
    // Gọi lại lần hai — không được ném "đã có thương hiệu".
    await onboardingService.submitBrand(ownerAcc.id, ownerAcc.userId, partner.id, { name: 'Idempotent Brand' });
    const refreshedPartner = await prisma.gymPartner.findUnique({ where: { id: partner.id } });
    assert.ok(refreshedPartner?.brandId);
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 3: inviteManager từ chối chi nhánh không thuộc chủ sở hữu', async () => {
  try {
    const partner = await makePartner();
    const ownerUserId = randomUUID();
    await makeAccount(partner.id, 'OWNER', ownerUserId);
    await assert.rejects(
      () => partnerService.inviteManager(partner.id, ownerUserId, { email: 'm@example.com', scopedGymIds: [randomUUID()] }, ownerUserId),
      (e: any) => e.status === 403,
    );
    await assert.rejects(
      () => partnerService.inviteManager(partner.id, ownerUserId, { email: 'm@example.com', scopedGymIds: [] }, ownerUserId),
      (e: any) => e.status === 400,
    );
  } finally {
    await cleanup();
  }
});

// ── Phase 4 ────────────────────────────────────────────────────────────────

integrationTest('Phase 4: listDocuments luôn trả đủ 6 dòng, kể cả chưa từng nộp gì', async () => {
  try {
    const partner = await makePartner({ status: 'PROSPECT' });
    const docs = await partnerDiligenceService.listDocuments(partner.id);
    assert.equal(docs.length, 6);
    assert.equal(docs.filter((d) => d.required).length, 3, 'đúng 3 mục bắt buộc (🔴)');

    await partnerDiligenceService.upsertDocument(partner.id, 'BUSINESS_LICENSE', 'https://files/lic.pdf');
    const afterUpload = await partnerDiligenceService.listDocuments(partner.id);
    const license = afterUpload.find((d) => d.docType === 'BUSINESS_LICENSE')!;
    assert.equal(license.status, 'RECEIVED');

    await partnerDiligenceService.verifyDocument(partner.id, 'BUSINESS_LICENSE', 'admin-1', 'VERIFIED');
    const afterVerify = await partnerDiligenceService.listDocuments(partner.id);
    assert.equal(afterVerify.find((d) => d.docType === 'BUSINESS_LICENSE')!.status, 'VERIFIED');

    // Không xác minh được khi chưa nộp tệp.
    await assert.rejects(() => partnerDiligenceService.verifyDocument(partner.id, 'FIRE_SAFETY_CERTIFICATE', 'admin-1', 'VERIFIED'), (e: any) => e.status === 409);
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 4: từ chối hồ sơ giữ nguyên PROSPECT, mở lại được, và chỉ từ chối được khi đang PROSPECT', async () => {
  try {
    const partner = await makePartner({ status: 'PROSPECT' });
    const rejected = await partnerDiligenceService.reject(partner.id, 'Thiếu giấy phép kinh doanh');
    assert.equal(rejected.status, 'PROSPECT', 'từ chối KHÔNG thêm status mới');
    assert.ok(rejected.rejectedAt);
    assert.equal(rejected.rejectionReason, 'Thiếu giấy phép kinh doanh');

    const reopened = await partnerDiligenceService.reopen(partner.id);
    assert.equal(reopened.rejectedAt, null);
    assert.equal(reopened.rejectionReason, null);

    await assert.rejects(() => partnerDiligenceService.reopen(partner.id), (e: any) => e.status === 409, 'không mở lại được hồ sơ chưa từng bị từ chối');

    const activePartner = await makePartner({ status: 'ACTIVE' });
    await assert.rejects(() => partnerDiligenceService.reject(activePartner.id, 'x'), (e: any) => e.status === 409, 'chỉ từ chối được PROSPECT');
  } finally {
    await cleanup();
  }
});

// ── Phase 5 ────────────────────────────────────────────────────────────────

integrationTest('Phase 5: chiết khấu luôn bị kẹp ở sàn 0.10 dù cấu hình/đàm phán ghi thấp hơn', async () => {
  try {
    await commissionRateService.setRate(0.05, new Date('2020-01-01'), 'admin-1');
    const configRate = await commissionRateService.getEffectiveConfigRate();
    assert.equal(configRate, 0.05, 'bản thân cấu hình vẫn lưu đúng giá trị đã đặt, không tự sửa');

    const partnerNoOverride = await makePartner();
    const ownerId1 = randomUUID();
    await makeAccount(partnerNoOverride.id, 'OWNER', ownerId1);
    const applied1 = await commissionRateService.resolveEffectiveRateForOwner(ownerId1);
    assert.equal(applied1, '0.1000', 'mức chung 5% vẫn bị kẹp lên sàn 10% khi áp dụng thực tế');

    const partnerWithOverride = await prisma.gymPartner.create({
      data: { legalName: 'Negotiated', status: 'ACTIVE', commissionRateOverride: 0.03 },
    });
    created.partners.push(partnerWithOverride.id);
    const ownerId2 = randomUUID();
    await makeAccount(partnerWithOverride.id, 'OWNER', ownerId2);
    const applied2 = await commissionRateService.resolveEffectiveRateForOwner(ownerId2);
    assert.equal(applied2, '0.1000', 'override 3% đàm phán riêng cũng bị kẹp lên sàn 10% — sàn áp dụng cho mọi trường hợp');

    const partnerHighOverride = await prisma.gymPartner.create({
      data: { legalName: 'HighNegotiated', status: 'ACTIVE', commissionRateOverride: 0.15 },
    });
    created.partners.push(partnerHighOverride.id);
    const ownerId3 = randomUUID();
    await makeAccount(partnerHighOverride.id, 'OWNER', ownerId3);
    const applied3 = await commissionRateService.resolveEffectiveRateForOwner(ownerId3);
    assert.equal(applied3, '0.1500', 'override trên sàn thì giữ nguyên, không bị hạ xuống');
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 5: đối tác SUSPENDED/TERMINATED chặn mua mới, đối tác ACTIVE thì không', async () => {
  try {
    const suspended = await prisma.gymPartner.create({ data: { legalName: 'Suspended Co', status: 'SUSPENDED' } });
    created.partners.push(suspended.id);
    const suspendedOwner = randomUUID();
    await makeAccount(suspended.id, 'OWNER', suspendedOwner);
    await assert.rejects(() => partnerGuard.assertAcceptsNewMoney(suspendedOwner), (e: any) => e.status === 409);
    await assert.rejects(() => partnerGuard.assertWithdrawalsAllowed(suspendedOwner), (e: any) => e.status === 409);

    const terminated = await prisma.gymPartner.create({ data: { legalName: 'Terminated Co', status: 'TERMINATED' } });
    created.partners.push(terminated.id);
    const terminatedOwner = randomUUID();
    await makeAccount(terminated.id, 'OWNER', terminatedOwner);
    await assert.rejects(() => partnerGuard.assertAcceptsNewMoney(terminatedOwner), (e: any) => e.status === 409);

    const active = await makePartner({ status: 'ACTIVE' });
    const activeOwner = randomUUID();
    await makeAccount(active.id, 'OWNER', activeOwner);
    await assert.doesNotReject(() => partnerGuard.assertAcceptsNewMoney(activeOwner));
    await assert.doesNotReject(() => partnerGuard.assertWithdrawalsAllowed(activeOwner));

    // Chủ gym không có hồ sơ đối tác (legacy) — không bị chặn.
    await assert.doesNotReject(() => partnerGuard.assertAcceptsNewMoney(randomUUID()));
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 5: mua gói mới bị chặn thật khi đối tác đang tạm khoá (qua membershipService.purchase)', async () => {
  try {
    const partner = await makePartner({ status: 'ACTIVE' });
    const ownerId = randomUUID();
    await makeAccount(partner.id, 'OWNER', ownerId);
    const { brand, gym } = await makeBrandAndGym(ownerId);
    await partnerService.attachBrand(partner.id, brand.id);
    const plan = await prisma.gymMembershipPlan.create({ data: { brandId: brand.id, name: 'P', price: 500_000, durationDays: 30 } });
    created.plans.push(plan.id);

    // ACTIVE — mua được (thất bại ở bước gọi payment-service thật là chấp nhận được, miễn
    // không phải bị chặn bởi partnerGuard).
    try {
      await membershipService.purchase(gym.id, plan.id, randomUUID());
    } catch (e: any) {
      assert.notEqual(e.message, 'Đối tác quản lý phòng tập này đang bị tạm khoá — không thể mua/thanh toán gói mới');
    }

    await partnerService.suspend(partner.id, 'admin-1', 'Vi phạm điều khoản');
    await assert.rejects(
      () => membershipService.purchase(gym.id, plan.id, randomUUID()),
      (e: any) => e.status === 409 && /tạm khoá/.test(e.message),
    );
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 5: chỉ tạm khoá được đối tác đang ACTIVE, chỉ bỏ tạm khoá được đối tác đang SUSPENDED', async () => {
  try {
    const partner = await makePartner({ status: 'ACTIVE' });
    await assert.rejects(() => partnerService.suspend(partner.id, 'admin-1', ''), (e: any) => e.status === 400, 'lý do là bắt buộc');

    const suspended = await partnerService.suspend(partner.id, 'admin-1', 'Vi phạm');
    assert.equal(suspended.status, 'SUSPENDED');
    assert.ok(suspended.suspendedAt);

    await assert.rejects(() => partnerService.suspend(partner.id, 'admin-1', 'x'), (e: any) => e.status === 409, 'không tạm khoá lại đối tác đã tạm khoá');

    const unsuspended = await partnerService.unsuspend(partner.id, 'admin-1');
    assert.equal(unsuspended.status, 'ACTIVE');
    assert.equal(unsuspended.suspendedAt, null);

    await assert.rejects(() => partnerService.unsuspend(partner.id, 'admin-1'), (e: any) => e.status === 409, 'không bỏ tạm khoá đối tác đang không bị khoá');
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 5: terminationImpact đếm đúng số hội viên ACTIVE và tổng giá trị chưa dùng', async () => {
  try {
    const partner = await makePartner({ status: 'ACTIVE' });
    const ownerId = randomUUID();
    await makeAccount(partner.id, 'OWNER', ownerId);
    const { brand, gym } = await makeBrandAndGym(ownerId);
    await partnerService.attachBrand(partner.id, brand.id);
    await makeActiveMembership(gym.id, brand.id);
    await makeActiveMembership(gym.id, brand.id);

    const impact = await partnerService.terminationImpact(partner.id);
    assert.equal(impact.activeMembers, 2);
    assert.equal(impact.activeGyms, 1);
    assert.ok(impact.unusedValueTotal > 0, 'phải tính ra một khoản tiền chưa dùng dương');
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 5: chấm dứt với SERVE_UNTIL_EXPIRY không đụng tới hội viên đang ACTIVE', async () => {
  try {
    const partner = await makePartner({ status: 'ACTIVE' });
    const ownerId = randomUUID();
    await makeAccount(partner.id, 'OWNER', ownerId);
    const { brand, gym } = await makeBrandAndGym(ownerId);
    await partnerService.attachBrand(partner.id, brand.id);
    const membership = await makeActiveMembership(gym.id, brand.id);

    const result = await partnerService.terminate(partner.id, 'admin-1', 'Ngừng hợp tác', 'SERVE_UNTIL_EXPIRY');
    assert.equal(result.partner.status, 'TERMINATED');
    assert.equal(result.refunded, 0);

    const refreshedMembership = await prisma.gymMembershipContract.findUnique({ where: { id: membership.id } });
    assert.equal(refreshedMembership?.status, 'ACTIVE', 'hội viên còn hạn phải tiếp tục chạy bình thường, không bị đụng vào');

    await assert.rejects(() => partnerService.terminate(partner.id, 'admin-1', 'x', 'SERVE_UNTIL_EXPIRY'), (e: any) => e.status === 409, 'không chấm dứt lại đối tác đã chấm dứt');
  } finally {
    await cleanup();
  }
});

integrationTest('Phase 5: chấm dứt bắt buộc phải chọn cách xử lý hội viên và có lý do', async () => {
  try {
    const partner = await makePartner({ status: 'ACTIVE' });
    await assert.rejects(() => partnerService.terminate(partner.id, 'admin-1', '', 'SERVE_UNTIL_EXPIRY'), (e: any) => e.status === 400);
    await assert.rejects(() => partnerService.terminate(partner.id, 'admin-1', 'lý do', 'INVALID' as any), (e: any) => e.status === 400);
  } finally {
    await cleanup();
  }
});

// ── GYM_MANAGEMENT master spec, Phase 1 — "Request Changes" theo từng trường ────────────────

integrationTest('GYM_MANAGEMENT §60/§62: requestChanges không đổi status, owner sửa lại thì tự xoá ghi chú', async () => {
  try {
    const partner = await makePartner({ status: 'ACTIVE' });
    const ownerId = randomUUID();
    await makeAccount(partner.id, 'OWNER', ownerId);
    const { gym } = await makeBrandAndGym(ownerId); // status: APPROVED sẵn

    await assert.rejects(() => gymService.requestChanges(gym.id, 'admin-1', {}), (e: any) => e.status === 400, 'cần ít nhất một ghi chú');

    const flagged = await gymService.requestChanges(gym.id, 'admin-1', { nameNote: 'Tên trùng với thương hiệu khác', addressNote: 'Địa chỉ thiếu số nhà' });
    assert.equal(flagged.status, 'APPROVED', 'không được lùi khỏi APPROVED chỉ vì đang chờ chỉnh sửa');
    assert.equal(flagged.pendingNameNote, 'Tên trùng với thương hiệu khác');
    assert.equal(flagged.pendingAddressNote, 'Địa chỉ thiếu số nhà');
    assert.ok(flagged.changesRequestedAt);
    assert.equal(flagged.changesRequestedBy, 'admin-1');

    // Owner chỉ sửa tên -> ghi chú tên bị xoá, ghi chú địa chỉ (chưa sửa) vẫn còn treo.
    const afterNameFix = await gymService.updateOwnedGym(gym.id, ownerId, { name: 'Tên Mới Không Trùng' });
    assert.equal(afterNameFix.pendingNameNote, null);
    assert.equal(afterNameFix.pendingAddressNote, 'Địa chỉ thiếu số nhà', 'còn 1 mục chưa sửa thì hàng đợi vẫn còn treo');
    assert.ok(afterNameFix.changesRequestedAt, 'chưa xong hết thì vẫn còn trong hàng đợi cần chú ý');

    // Owner sửa nốt địa chỉ -> toàn bộ yêu cầu coi như đã giải quyết.
    const afterAddressFix = await gymService.updateOwnedGym(gym.id, ownerId, { address: '99 Đường Mới' });
    assert.equal(afterAddressFix.pendingAddressNote, null);
    assert.equal(afterAddressFix.changesRequestedAt, null, 'đã sửa hết thì rơi khỏi hàng đợi');
    assert.equal(afterAddressFix.changesRequestedBy, null);
  } finally {
    await cleanup();
  }
});

integrationTest('GYM_MANAGEMENT §60/§62: duyệt (approve/approveRename) cũng giải toả ghi chú đang treo', async () => {
  try {
    const partner = await makePartner({ status: 'ACTIVE' });
    const ownerId = randomUUID();
    await makeAccount(partner.id, 'OWNER', ownerId);
    const pending = await prisma.gym.create({
      data: { ownerId, name: 'Chi nhánh mới', address: '1 Chờ duyệt', status: 'PENDING_REVIEW', operationalStatus: 'OPEN' },
    });
    created.gyms.push(pending.id);

    await gymService.requestChanges(pending.id, 'admin-1', { nameNote: 'Ghi rõ số chi nhánh' });
    const approved = await gymService.setStatus(pending.id, 'APPROVED');
    assert.equal(approved.pendingNameNote, null);
    assert.equal(approved.changesRequestedAt, null);

    // Chi nhánh đã duyệt, đổi tên -> có pending -> yêu cầu chỉnh sửa -> duyệt đổi tên.
    await gymService.updateOwnedGym(pending.id, ownerId, { name: 'Tên Đổi Lần 2' });
    await gymService.requestChanges(pending.id, 'admin-1', { nameNote: 'Vẫn chưa đúng định dạng' });
    const renamed = await gymService.approveRename(pending.id);
    assert.equal(renamed.pendingNameNote, null);
    assert.equal(renamed.changesRequestedAt, null);
    assert.equal(renamed.approvedName, 'Tên Đổi Lần 2');
  } finally {
    await cleanup();
  }
});

integrationTest('GYM_MANAGEMENT §61: TEMPORARILY_CLOSED nhận ngày dự kiến mở lại, OPEN lại thì xoá', async () => {
  try {
    const partner = await makePartner({ status: 'ACTIVE' });
    const ownerId = randomUUID();
    await makeAccount(partner.id, 'OWNER', ownerId);
    const { gym } = await makeBrandAndGym(ownerId);

    const reopenDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const closed = await gymService.setOperationalStatus(gym.id, ownerId, 'TEMPORARILY_CLOSED', 'Sửa chữa cơ sở vật chất', reopenDate);
    assert.equal(closed.operationalStatus, 'TEMPORARILY_CLOSED');
    assert.equal(closed.expectedReopenAt?.getTime(), reopenDate.getTime());

    const reopened = await gymService.setOperationalStatus(gym.id, ownerId, 'OPEN');
    assert.equal(reopened.expectedReopenAt, null, 'mở lại thì ngày dự kiến không còn ý nghĩa');
  } finally {
    await cleanup();
  }
});
