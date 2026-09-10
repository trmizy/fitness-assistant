import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { gymPhotoService } from '../services/gym-photo.service';
import { gymBranchDocumentService } from '../services/gym-branch-document.service';
import { gymHoursService } from '../services/gym-hours.service';

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 6 — admin review workspace. These 3 "for admin" service
 * functions are the only new backend logic this phase needed (facilities already ride along
 * on the plain Gym row `GET /admin/gyms` already returns) — no ownership check, since an
 * admin reviews any gym, but gym-branch-document's variant still needs to resolve the
 * correct partner for its read-only §95.4 context.
 */

async function makeOwnerWithPartnerAndGym() {
  const ownerId = randomUUID();
  const partner = await prisma.gymPartner.create({
    data: { legalName: `Test Partner ${randomUUID().slice(0, 8)}`, status: 'ACTIVE', verificationStatus: 'VERIFIED' },
  });
  await prisma.gymPartnerAccount.create({
    data: { partnerId: partner.id, userId: ownerId, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
  });
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'Test Brand', approvedName: 'Test Brand' } });
  await prisma.gymPartner.update({ where: { id: partner.id }, data: { brandId: brand.id } });
  await prisma.gymPartnerDocument.create({
    data: { partnerId: partner.id, docType: 'BUSINESS_LICENSE', required: true, fileUrl: 'https://example.com/license.pdf', status: 'VERIFIED' },
  });
  const gym = await prisma.gym.create({
    data: { id: randomUUID(), ownerId, brandId: brand.id, name: 'Test Gym', address: '1 Test St', status: 'PENDING_REVIEW' },
  });
  return { ownerId, partnerId: partner.id, brandId: brand.id, gymId: gym.id };
}

async function cleanup(gymId: string, brandId: string, partnerId: string) {
  await prisma.gym.delete({ where: { id: gymId } }).catch(() => {});
  await prisma.gymBrand.delete({ where: { id: brandId } }).catch(() => {});
  await prisma.gymPartner.delete({ where: { id: partnerId } }).catch(() => {});
}

integrationTest('gymPhotoService.listForAdmin: đọc được ảnh của bất kỳ gym nào, không cần là chủ', async () => {
  const { gymId, brandId, partnerId } = await makeOwnerWithPartnerAndGym();
  try {
    const photo = await prisma.gymPhoto.create({ data: { gymId, fileName: 'admin-test.png', sortOrder: 0, isCover: true } });
    const photos = await gymPhotoService.listForAdmin(gymId);
    assert.equal(photos.length, 1);
    assert.equal(photos[0].id, photo.id);
  } finally {
    await cleanup(gymId, brandId, partnerId);
  }
});

integrationTest('gymHoursService.getHours dùng lại được nguyên xi cho admin — luôn đủ 7 ngày', async () => {
  const { gymId, brandId, partnerId } = await makeOwnerWithPartnerAndGym();
  try {
    const hours = await gymHoursService.getHours(gymId);
    assert.equal(hours.length, 7);
  } finally {
    await cleanup(gymId, brandId, partnerId);
  }
});

integrationTest('gymBranchDocumentService.listForAdmin: trả đủ 3 dòng branch-level + đúng ngữ cảnh đối tác (§95.4)', async () => {
  const { gymId, brandId, partnerId } = await makeOwnerWithPartnerAndGym();
  try {
    const view = await gymBranchDocumentService.listForAdmin(gymId);
    assert.equal(view.documents.length, 3);
    assert.equal(view.partnerContext.length, 6);
    const license = view.partnerContext.find((d: any) => d.docType === 'BUSINESS_LICENSE');
    assert.equal(license?.status, 'VERIFIED');
  } finally {
    await cleanup(gymId, brandId, partnerId);
  }
});

integrationTest('gymBranchDocumentService.listForAdmin: báo lỗi rõ ràng nếu gym không tồn tại', async () => {
  await assert.rejects(
    () => gymBranchDocumentService.listForAdmin(randomUUID()),
    (e: any) => e.status === 404,
  );
});
