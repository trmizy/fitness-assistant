import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { gymDraftService } from '../services/gym-draft.service';
import { gymHoursService } from '../services/gym-hours.service';
import { gymBranchDocumentService } from '../services/gym-branch-document.service';
import { gymBranchReviewService } from '../services/gym-branch-review.service';

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 4 — "Request Changes" by category on a branch's first-time
 * wizard submission, distinct from gymService.requestChanges (name/address, post-approval
 * renames only).
 */

const created: { gyms: string[]; brands: string[] } = { gyms: [], brands: [] };

async function cleanup() {
  if (created.gyms.length) await prisma.gym.deleteMany({ where: { id: { in: created.gyms } } });
  if (created.brands.length) await prisma.gymBrand.deleteMany({ where: { id: { in: created.brands } } });
  created.gyms.length = 0;
  created.brands.length = 0;
}

/** Drives a fresh draft all the way to a real PENDING_REVIEW row — every step's minimum
 * required content, matching gym-draft.integration.test.ts's own success-path fixture. */
async function makeSubmittedGym(ownerId = randomUUID()) {
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'Test Brand', approvedName: 'Test Brand' } });
  created.brands.push(brand.id);
  const draft = await gymDraftService.createDraft(ownerId);
  created.gyms.push(draft.id);
  await gymDraftService.updateDraft(draft.id, ownerId, { name: 'Gymini Test', address: '1 Test St' });
  await gymHoursService.setHours(draft.id, ownerId, [
    { day: 'MONDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
    { day: 'TUESDAY', type: 'CLOSED' },
    { day: 'WEDNESDAY', type: 'CLOSED' },
    { day: 'THURSDAY', type: 'CLOSED' },
    { day: 'FRIDAY', type: 'CLOSED' },
    { day: 'SATURDAY', type: 'CLOSED' },
    { day: 'SUNDAY', type: 'CLOSED' },
  ]);
  await gymBranchDocumentService.attachFile(draft.id, ownerId, 'LEASE_OR_PROPERTY_DOC', `${ownerId}-1-lease.pdf`);
  await gymBranchDocumentService.attachFile(draft.id, ownerId, 'FACILITY_PHOTOS', `${ownerId}-2-facility.jpg`);
  const submitted = await gymDraftService.submitForReview(draft.id, ownerId);
  return { ownerId, gymId: submitted.id };
}

integrationTest('requestChanges: chỉ áp dụng khi đang PENDING_REVIEW', async () => {
  try {
    const ownerId = randomUUID();
    const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'Test Brand', approvedName: 'Test Brand' } });
    created.brands.push(brand.id);
    const draft = await gymDraftService.createDraft(ownerId);
    created.gyms.push(draft.id);
    await assert.rejects(
      () => gymBranchReviewService.requestChanges(draft.id, 'admin-1', [{ category: 'BASIC_INFO', message: 'Thiếu mô tả' }]),
      (e: any) => e.status === 409,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('requestChanges: từ chối khi danh sách vấn đề rỗng, thiếu nội dung, hoặc hạng mục không hợp lệ', async () => {
  try {
    const { gymId } = await makeSubmittedGym();
    await assert.rejects(() => gymBranchReviewService.requestChanges(gymId, 'admin-1', []), (e: any) => e.status === 400);
    await assert.rejects(
      () => gymBranchReviewService.requestChanges(gymId, 'admin-1', [{ category: 'BASIC_INFO', message: '' }]),
      (e: any) => e.status === 400,
    );
    await assert.rejects(
      () => gymBranchReviewService.requestChanges(gymId, 'admin-1', [{ category: 'NOT_REAL' as any, message: 'x' }]),
      (e: any) => e.status === 400,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('requestChanges: tạo đủ số vấn đề, chuyển về DRAFT với wizardStep mở hết (7)', async () => {
  try {
    const { ownerId, gymId } = await makeSubmittedGym();
    const updated = await gymBranchReviewService.requestChanges(gymId, 'admin-1', [
      { category: 'OPENING_HOURS', message: 'Cần mở cửa thêm cuối tuần' },
      { category: 'VERIFICATION', message: 'Ảnh hợp đồng thuê bị mờ, chụp lại rõ hơn' },
    ]);
    assert.equal(updated.status, 'DRAFT');
    assert.equal(updated.wizardStep, 7);

    const open = await gymBranchReviewService.listOpenForOwner(gymId, ownerId);
    assert.equal(open.length, 2);
    assert.ok(open.some((i) => i.category === 'OPENING_HOURS'));
    assert.ok(open.some((i) => i.category === 'VERIFICATION'));
    assert.ok(open.every((i) => i.resolvedAt === null));
  } finally {
    await cleanup();
  }
});

integrationTest('submitForReview sau khi bị yêu cầu chỉnh sửa: gửi lại thành công tự đóng hết vấn đề còn mở', async () => {
  try {
    const { ownerId, gymId } = await makeSubmittedGym();
    await gymBranchReviewService.requestChanges(gymId, 'admin-1', [{ category: 'OTHER', message: 'Xem lại toàn bộ hồ sơ' }]);

    const openBefore = await gymBranchReviewService.listOpenForOwner(gymId, ownerId);
    assert.equal(openBefore.length, 1);

    // Chưa cần sửa gì thêm — dữ liệu cũ vẫn đủ điều kiện để submit lại thành công.
    const resubmitted = await gymDraftService.submitForReview(gymId, ownerId);
    assert.equal(resubmitted.status, 'PENDING_REVIEW');

    const openAfter = await gymBranchReviewService.listOpenForOwner(gymId, ownerId);
    assert.equal(openAfter.length, 0, 'gửi lại thành công phải đóng hết vấn đề còn mở');

    const all = await gymBranchReviewService.listAllForAdmin(gymId);
    assert.equal(all.length, 1);
    assert.ok(all[0].resolvedAt !== null);
  } finally {
    await cleanup();
  }
});

integrationTest('listOpenForOwner: không xem được vấn đề của chi nhánh chủ khác', async () => {
  try {
    const { gymId } = await makeSubmittedGym();
    await gymBranchReviewService.requestChanges(gymId, 'admin-1', [{ category: 'OTHER', message: 'x' }]);
    await assert.rejects(
      () => gymBranchReviewService.listOpenForOwner(gymId, randomUUID()),
      (e: any) => e.status === 403,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('submitForReview: từ chối khi thiếu giấy tờ xác minh bắt buộc (§95.4)', async () => {
  try {
    const ownerId = randomUUID();
    const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'Test Brand', approvedName: 'Test Brand' } });
    created.brands.push(brand.id);
    const draft = await gymDraftService.createDraft(ownerId);
    created.gyms.push(draft.id);
    await gymDraftService.updateDraft(draft.id, ownerId, { name: 'X', address: 'Y' });
    await gymHoursService.setHours(draft.id, ownerId, [
      { day: 'MONDAY', type: 'ALL_DAY' },
      { day: 'TUESDAY', type: 'CLOSED' },
      { day: 'WEDNESDAY', type: 'CLOSED' },
      { day: 'THURSDAY', type: 'CLOSED' },
      { day: 'FRIDAY', type: 'CLOSED' },
      { day: 'SATURDAY', type: 'CLOSED' },
      { day: 'SUNDAY', type: 'CLOSED' },
    ]);
    // Chỉ nộp 1 trong 2 giấy tờ bắt buộc — thiếu FACILITY_PHOTOS.
    await gymBranchDocumentService.attachFile(draft.id, ownerId, 'LEASE_OR_PROPERTY_DOC', `${ownerId}-1.pdf`);

    await assert.rejects(
      () => gymDraftService.submitForReview(draft.id, ownerId),
      (e: any) => {
        assert.equal(e.status, 400);
        assert.ok(e.issues.some((i: any) => i.field === 'verification' && i.message.includes('FACILITY_PHOTOS')));
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});
