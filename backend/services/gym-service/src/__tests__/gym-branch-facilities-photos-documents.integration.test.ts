import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { gymDraftService } from '../services/gym-draft.service';
import { gymService } from '../services/gym.service';
import { gymPhotoService } from '../services/gym-photo.service';
import { gymBranchDocumentService } from '../services/gym-branch-document.service';

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 3 — Steps 4-6 (Facilities & Services, Photos, Branch-level
 * Verification Documents).
 */

const created: { gyms: string[]; brands: string[]; partners: string[] } = { gyms: [], brands: [], partners: [] };

async function makeOwnerWithDraft(ownerId = randomUUID()) {
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'Test Brand', approvedName: 'Test Brand' } });
  created.brands.push(brand.id);
  const draft = await gymDraftService.createDraft(ownerId);
  created.gyms.push(draft.id);
  return { ownerId, gymId: draft.id };
}

/** Also gives this owner a real GymPartner + GymPartnerAccount, with one partner-level
 * document on file — so listForOwner's §95.4 read-only `partnerContext` has something in it
 * to assert on. */
async function makeOwnerWithPartnerAndDraft(ownerId = randomUUID()) {
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
  await prisma.gymPartnerDocument.create({
    data: { partnerId: partner.id, docType: 'BUSINESS_LICENSE', required: true, fileUrl: 'https://example.com/license.pdf', status: 'VERIFIED' },
  });
  const draft = await gymDraftService.createDraft(ownerId);
  created.gyms.push(draft.id);
  return { ownerId, gymId: draft.id, partnerId: partner.id };
}

async function cleanup() {
  if (created.gyms.length) await prisma.gym.deleteMany({ where: { id: { in: created.gyms } } });
  if (created.brands.length) await prisma.gymBrand.deleteMany({ where: { id: { in: created.brands } } });
  if (created.partners.length) await prisma.gymPartner.deleteMany({ where: { id: { in: created.partners } } });
  created.gyms.length = 0;
  created.brands.length = 0;
  created.partners.length = 0;
}

// ── Step 4: Facilities & Services ───────────────────────────────────────────────────────

integrationTest('updateOwnedGym: lưu được danh sách tiện ích, đọc lại đúng', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const updated = await gymService.updateOwnedGym(gymId, ownerId, { facilities: ['FREE_WEIGHTS', 'SAUNA', 'WIFI'] as any });
    assert.deepEqual([...updated.facilities].sort(), ['FREE_WEIGHTS', 'SAUNA', 'WIFI'].sort());
  } finally {
    await cleanup();
  }
});

integrationTest('updateDraft: facilities đi qua đúng con đường lưu-từng-phần không xác thực', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const updated = await gymDraftService.updateDraft(gymId, ownerId, { facilities: ['CARDIO_MACHINES'] as any });
    assert.deepEqual(updated.facilities, ['CARDIO_MACHINES']);
  } finally {
    await cleanup();
  }
});

// ── Step 5: Photos ───────────────────────────────────────────────────────────────────────

integrationTest('gymPhotoService: ảnh đầu tiên tự động là ảnh bìa, ảnh sau thì không', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const first = await gymPhotoService.upload(gymId, ownerId, 'fake-1.jpg');
    const second = await gymPhotoService.upload(gymId, ownerId, 'fake-2.jpg');
    assert.equal(first.isCover, true);
    assert.equal(second.isCover, false);
    assert.equal(first.sortOrder, 0);
    assert.equal(second.sortOrder, 1);
  } finally {
    await cleanup();
  }
});

integrationTest('gymPhotoService: setCover chuyển cờ đúng một ảnh, không sửa được ảnh của gym khác', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const first = await gymPhotoService.upload(gymId, ownerId, 'fake-a.jpg');
    const second = await gymPhotoService.upload(gymId, ownerId, 'fake-b.jpg');
    const afterCoverChange = await gymPhotoService.setCover(gymId, ownerId, second.id);
    const firstAfter = afterCoverChange.find((p) => p.id === first.id)!;
    const secondAfter = afterCoverChange.find((p) => p.id === second.id)!;
    assert.equal(firstAfter.isCover, false);
    assert.equal(secondAfter.isCover, true);

    await assert.rejects(
      () => gymPhotoService.setCover(gymId, randomUUID(), first.id),
      (e: any) => e.status === 403,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('gymPhotoService: xoá ảnh bìa thì tự động thăng ảnh còn lại làm ảnh bìa mới', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const first = await gymPhotoService.upload(gymId, ownerId, 'fake-c.jpg');
    const second = await gymPhotoService.upload(gymId, ownerId, 'fake-d.jpg');
    await gymPhotoService.delete(gymId, ownerId, first.id);
    const remaining = await gymPhotoService.listForOwner(gymId, ownerId);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, second.id);
    assert.equal(remaining[0].isCover, true);
  } finally {
    await cleanup();
  }
});

integrationTest('gymPhotoService: từ chối khi vượt quá giới hạn số ảnh', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    for (let i = 0; i < 20; i++) {
      await gymPhotoService.upload(gymId, ownerId, `fake-limit-${i}.jpg`);
    }
    await assert.rejects(
      () => gymPhotoService.upload(gymId, ownerId, 'fake-limit-overflow.jpg'),
      (e: any) => e.status === 400,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('gymPhotoService: reorder từ chối danh sách không khớp đúng bộ ảnh hiện có', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const first = await gymPhotoService.upload(gymId, ownerId, 'fake-e.jpg');
    await gymPhotoService.upload(gymId, ownerId, 'fake-f.jpg');
    await assert.rejects(
      () => gymPhotoService.reorder(gymId, ownerId, [first.id, randomUUID()]),
      (e: any) => e.status === 400,
    );
  } finally {
    await cleanup();
  }
});

// ── Step 6: Verification Documents ──────────────────────────────────────────────────────

integrationTest('gymBranchDocumentService: luôn trả đủ 3 dòng, đúng cờ required cho từng loại', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const { documents } = await gymBranchDocumentService.listForOwner(gymId, ownerId);
    assert.equal(documents.length, 3);
    const byType = new Map(documents.map((d) => [d.docType, d]));
    assert.equal(byType.get('LEASE_OR_PROPERTY_DOC')!.required, true);
    assert.equal(byType.get('FACILITY_PHOTOS')!.required, true);
    assert.equal(byType.get('FIRE_SAFETY_CERTIFICATE')!.required, false);
    assert.ok(documents.every((d) => d.status === 'PENDING' && d.fileToken === null));
  } finally {
    await cleanup();
  }
});

integrationTest('gymBranchDocumentService: §95.4 — chỉ hiển thị tài liệu cấp đối tác dưới dạng ngữ cảnh, không phải ghi được', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithPartnerAndDraft();
    const { partnerContext } = await gymBranchDocumentService.listForOwner(gymId, ownerId);
    assert.equal(partnerContext.length, 6); // ALL_DOC_TYPES ở cấp đối tác, luôn đủ 6 dòng
    const license = partnerContext.find((d: any) => d.docType === 'BUSINESS_LICENSE');
    assert.equal(license?.status, 'VERIFIED');
  } finally {
    await cleanup();
  }
});

integrationTest('gymBranchDocumentService: chưa có hồ sơ đối tác thì partnerContext rỗng, không lỗi', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const { partnerContext } = await gymBranchDocumentService.listForOwner(gymId, ownerId);
    assert.deepEqual(partnerContext, []);
  } finally {
    await cleanup();
  }
});

integrationTest('gymBranchDocumentService: attachFile từ chối loại giấy tờ không hợp lệ và token rỗng', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    await assert.rejects(
      () => gymBranchDocumentService.attachFile(gymId, ownerId, 'NOT_A_REAL_TYPE' as any, 'some-token'),
      (e: any) => e.status === 400,
    );
    await assert.rejects(
      () => gymBranchDocumentService.attachFile(gymId, ownerId, 'LEASE_OR_PROPERTY_DOC', ''),
      (e: any) => e.status === 400,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('gymBranchDocumentService: attachFile lưu token, đặt trạng thái RECEIVED; nộp lại reset trạng thái đã duyệt trước đó', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const doc = await gymBranchDocumentService.attachFile(gymId, ownerId, 'FIRE_SAFETY_CERTIFICATE', `${ownerId}-123-abc.pdf`);
    assert.equal(doc.status, 'RECEIVED');
    assert.equal(doc.fileToken, `${ownerId}-123-abc.pdf`);

    await prisma.gymBranchDocument.update({ where: { id: doc.id }, data: { status: 'VERIFIED', verifiedBy: 'admin-1', verifiedAt: new Date() } });
    const reuploaded = await gymBranchDocumentService.attachFile(gymId, ownerId, 'FIRE_SAFETY_CERTIFICATE', `${ownerId}-456-def.pdf`);
    assert.equal(reuploaded.status, 'RECEIVED', 'nộp lại tệp mới phải được xem xét lại từ đầu, không giữ nguyên VERIFIED cũ');
  } finally {
    await cleanup();
  }
});

integrationTest('gymBranchDocumentService: không thao tác được trên chi nhánh của chủ khác', async () => {
  try {
    const { gymId } = await makeOwnerWithDraft();
    await assert.rejects(
      () => gymBranchDocumentService.listForOwner(gymId, randomUUID()),
      (e: any) => e.status === 403,
    );
  } finally {
    await cleanup();
  }
});
