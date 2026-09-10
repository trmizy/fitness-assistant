import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { gymDraftService } from '../services/gym-draft.service';
import { gymHoursService } from '../services/gym-hours.service';
import { gymBranchDocumentService } from '../services/gym-branch-document.service';

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 1 — "Add Branch" wizard shell: draft creation, partial
 * unvalidated save, and full-validation submit.
 */

const created: { gyms: string[]; brands: string[] } = { gyms: [], brands: [] };

async function makeOwnerWithBrand(ownerId = randomUUID()) {
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'Test Brand', approvedName: 'Test Brand' } });
  created.brands.push(brand.id);
  return ownerId;
}

async function cleanup() {
  if (created.gyms.length) await prisma.gym.deleteMany({ where: { id: { in: created.gyms } } });
  if (created.brands.length) await prisma.gymBrand.deleteMany({ where: { id: { in: created.brands } } });
  created.gyms.length = 0;
  created.brands.length = 0;
}

integrationTest('§3: không tạo được draft khi chưa có thương hiệu', async () => {
  const ownerWithNoBrand = randomUUID();
  await assert.rejects(
    () => gymDraftService.createDraft(ownerWithNoBrand),
    (e: any) => e.status === 400,
  );
});

integrationTest('createDraft: tạo được ngay, không cần trường nào, status DRAFT, wizardStep 1', async () => {
  try {
    const ownerId = await makeOwnerWithBrand();
    const draft = await gymDraftService.createDraft(ownerId);
    created.gyms.push(draft.id);
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.wizardStep, 1);
  } finally {
    await cleanup();
  }
});

integrationTest('updateDraft: lưu từng phần, không kiểm định dạng (§8 auto-save)', async () => {
  try {
    const ownerId = await makeOwnerWithBrand();
    const draft = await gymDraftService.createDraft(ownerId);
    created.gyms.push(draft.id);

    const step2 = await gymDraftService.updateDraft(draft.id, ownerId, { name: 'Gymini Fitness Nguyễn Huệ', wizardStep: 2 });
    assert.equal(step2.name, 'Gymini Fitness Nguyễn Huệ');
    assert.equal(step2.wizardStep, 2);

    // Cố ý lưu một địa chỉ rỗng — không bị chặn, vì draft không kiểm định dạng.
    const step3 = await gymDraftService.updateDraft(draft.id, ownerId, { address: '', wizardStep: 3 });
    assert.equal(step3.address, '');
    assert.equal(step3.wizardStep, 3);
  } finally {
    await cleanup();
  }
});

integrationTest('updateDraft: kẹp wizardStep trong khoảng 1-7 (mỗi draft độc lập, vì mốc là "xa nhất từng tới")', async () => {
  try {
    const ownerId = await makeOwnerWithBrand();

    const draftA = await gymDraftService.createDraft(ownerId);
    created.gyms.push(draftA.id);
    const tooHigh = await gymDraftService.updateDraft(draftA.id, ownerId, { wizardStep: 99 });
    assert.equal(tooHigh.wizardStep, 7);

    const draftB = await gymDraftService.createDraft(ownerId);
    created.gyms.push(draftB.id);
    const tooLow = await gymDraftService.updateDraft(draftB.id, ownerId, { wizardStep: -5 });
    assert.equal(tooLow.wizardStep, 1);
  } finally {
    await cleanup();
  }
});

integrationTest('updateDraft: đi lùi để xem lại bước cũ không làm khoá lại các bước đã mở khoá (§9/§10)', async () => {
  try {
    const ownerId = await makeOwnerWithBrand();
    const draft = await gymDraftService.createDraft(ownerId);
    created.gyms.push(draft.id);

    await gymDraftService.updateDraft(draft.id, ownerId, { wizardStep: 3 });
    // Owner clicks the rail to go back and review step 2 — this must NOT regress the
    // furthest-reached mark back down to 2 (that would re-lock step 3 they already unlocked).
    const wentBack = await gymDraftService.updateDraft(draft.id, ownerId, { wizardStep: 2 });
    assert.equal(wentBack.wizardStep, 3, 'đi lùi không được làm giảm mốc xa nhất đã tới');
  } finally {
    await cleanup();
  }
});

integrationTest('updateDraft: không sửa được draft của chủ khác (404, không lộ tồn tại)', async () => {
  try {
    const ownerId = await makeOwnerWithBrand();
    const draft = await gymDraftService.createDraft(ownerId);
    created.gyms.push(draft.id);
    await assert.rejects(
      () => gymDraftService.updateDraft(draft.id, randomUUID(), { name: 'x' }),
      (e: any) => e.status === 404,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('submitForReview: từ chối khi thiếu trường bắt buộc, liệt kê đúng field còn thiếu (§34)', async () => {
  try {
    const ownerId = await makeOwnerWithBrand();
    const draft = await gymDraftService.createDraft(ownerId);
    created.gyms.push(draft.id);
    // Vẫn còn address rỗng (giá trị khởi tạo mặc định của createDraft), chưa khai giờ mở cửa,
    // VÀ chưa nộp giấy tờ xác minh bắt buộc — cả ba đều phải xuất hiện trong cùng một lần báo
    // lỗi (§34: gộp hết, không dừng ở lỗi đầu tiên).
    await assert.rejects(
      () => gymDraftService.submitForReview(draft.id, ownerId),
      (e: any) => {
        assert.equal(e.status, 400);
        assert.ok(Array.isArray(e.issues) && e.issues.some((i: any) => i.field === 'address'));
        assert.ok(e.issues.some((i: any) => i.field === 'operatingHours'));
        assert.ok(e.issues.some((i: any) => i.field === 'verification'));
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

integrationTest('submitForReview: đủ trường thì chuyển DRAFT -> PENDING_REVIEW, xoá wizardStep', async () => {
  try {
    const ownerId = await makeOwnerWithBrand();
    const draft = await gymDraftService.createDraft(ownerId);
    created.gyms.push(draft.id);
    await gymDraftService.updateDraft(draft.id, ownerId, { name: 'Gymini Fitness Nguyễn Huệ', address: '123 Nguyễn Huệ, Q1' });
    await gymHoursService.setHours(draft.id, ownerId, [
      { day: 'MONDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
      { day: 'TUESDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
      { day: 'WEDNESDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
      { day: 'THURSDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
      { day: 'FRIDAY', type: 'OPEN', openMinute: 360, closeMinute: 1320 },
      { day: 'SATURDAY', type: 'CLOSED' },
      { day: 'SUNDAY', type: 'CLOSED' },
    ]);
    await gymBranchDocumentService.attachFile(draft.id, ownerId, 'LEASE_OR_PROPERTY_DOC', `${ownerId}-1-lease.pdf`);
    await gymBranchDocumentService.attachFile(draft.id, ownerId, 'FACILITY_PHOTOS', `${ownerId}-2-facility.jpg`);

    const submitted = await gymDraftService.submitForReview(draft.id, ownerId);
    assert.equal(submitted.status, 'PENDING_REVIEW');
    assert.equal(submitted.wizardStep, null);
    assert.equal(submitted.pendingName, 'Gymini Fitness Nguyễn Huệ');
    assert.equal(submitted.pendingAddress, '123 Nguyễn Huệ, Q1');

    // Không submit lại được một hồ sơ đã không còn ở trạng thái nháp.
    await assert.rejects(
      () => gymDraftService.submitForReview(draft.id, ownerId),
      (e: any) => e.status === 409,
    );
  } finally {
    await cleanup();
  }
});
