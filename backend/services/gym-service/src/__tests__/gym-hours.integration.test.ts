import test from 'node:test';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../repositories/prisma';
import { gymDraftService } from '../services/gym-draft.service';
import { gymHoursService } from '../services/gym-hours.service';

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 3 "Opening Hours". §74: free edit whether the
 * branch is still DRAFT or already APPROVED — setHours/getHours are exercised directly
 * against a DRAFT gym here since that's the cheapest fixture to stand up; the endpoint
 * itself does not branch on status.
 */

const created: { gyms: string[]; brands: string[] } = { gyms: [], brands: [] };

async function makeOwnerWithDraft(ownerId = randomUUID()) {
  const brand = await prisma.gymBrand.create({ data: { ownerId, name: 'Test Brand', approvedName: 'Test Brand' } });
  created.brands.push(brand.id);
  const draft = await gymDraftService.createDraft(ownerId);
  created.gyms.push(draft.id);
  return { ownerId, gymId: draft.id };
}

async function cleanup() {
  if (created.gyms.length) await prisma.gym.deleteMany({ where: { id: { in: created.gyms } } });
  if (created.brands.length) await prisma.gymBrand.deleteMany({ where: { id: { in: created.brands } } });
  created.gyms.length = 0;
  created.brands.length = 0;
}

const ALL_CLOSED = [
  { day: 'MONDAY', type: 'CLOSED' },
  { day: 'TUESDAY', type: 'CLOSED' },
  { day: 'WEDNESDAY', type: 'CLOSED' },
  { day: 'THURSDAY', type: 'CLOSED' },
  { day: 'FRIDAY', type: 'CLOSED' },
  { day: 'SATURDAY', type: 'CLOSED' },
  { day: 'SUNDAY', type: 'CLOSED' },
] as const;

integrationTest('getHours: chưa từng lưu gì thì vẫn trả đủ 7 ngày, tất cả CLOSED (§18)', async () => {
  try {
    const { gymId } = await makeOwnerWithDraft();
    const hours = await gymHoursService.getHours(gymId);
    assert.equal(hours.length, 7);
    assert.ok(hours.every((h) => h.type === 'CLOSED'));
    const days = hours.map((h) => h.day).sort();
    assert.deepEqual(days, ['FRIDAY', 'MONDAY', 'SATURDAY', 'SUNDAY', 'THURSDAY', 'TUESDAY', 'WEDNESDAY']);
  } finally {
    await cleanup();
  }
});

integrationTest('validate: thiếu ngày hoặc trùng ngày đều bị chặn', async () => {
  const sixDays = ALL_CLOSED.slice(0, 6).map((d) => ({ ...d }));
  assert.throws(() => gymHoursService.validate(sixDays as any), (e: any) => e.status === 400);

  const dup = [...ALL_CLOSED.slice(0, 6), { day: 'MONDAY', type: 'CLOSED' }].map((d) => ({ ...d }));
  assert.throws(() => gymHoursService.validate(dup as any), (e: any) => e.status === 400);
});

integrationTest('validate: OPEN thiếu giờ, giờ ngoài phạm vi, hoặc mở sau đóng đều bị chặn', async () => {
  const missingTimes = ALL_CLOSED.map((d) => (d.day === 'MONDAY' ? { day: d.day, type: 'OPEN' } : { ...d }));
  assert.throws(() => gymHoursService.validate(missingTimes as any), (e: any) => e.status === 400);

  const outOfRange = ALL_CLOSED.map((d) =>
    d.day === 'MONDAY' ? { day: d.day, type: 'OPEN', openMinute: -1, closeMinute: 600 } : { ...d },
  );
  assert.throws(() => gymHoursService.validate(outOfRange as any), (e: any) => e.status === 400);

  const openAfterClose = ALL_CLOSED.map((d) =>
    d.day === 'MONDAY' ? { day: d.day, type: 'OPEN', openMinute: 1000, closeMinute: 500 } : { ...d },
  );
  assert.throws(() => gymHoursService.validate(openAfterClose as any), (e: any) => e.status === 400);
});

integrationTest('validate: không bắt buộc phải có ngày mở nào (chỉ chặn ở submit-time) — mọi ngày CLOSED vẫn hợp lệ', () => {
  assert.doesNotThrow(() => gymHoursService.validate(ALL_CLOSED.map((d) => ({ ...d })) as any));
});

integrationTest('setHours: lưu xong đọc lại đúng, không sửa được chi nhánh của chủ khác (403)', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const days = ALL_CLOSED.map((d) => (d.day === 'WEDNESDAY' ? { day: d.day, type: 'ALL_DAY' } : { ...d }));
    const saved = await gymHoursService.setHours(gymId, ownerId, days as any);
    const wed = saved.find((h) => h.day === 'WEDNESDAY');
    assert.equal(wed?.type, 'ALL_DAY');

    const reread = await gymHoursService.getHours(gymId);
    assert.equal(reread.find((h) => h.day === 'WEDNESDAY')?.type, 'ALL_DAY');

    await assert.rejects(
      () => gymHoursService.setHours(gymId, randomUUID(), ALL_CLOSED.map((d) => ({ ...d })) as any),
      (e: any) => e.status === 403,
    );
  } finally {
    await cleanup();
  }
});

integrationTest('setHours: lưu đè hoàn toàn tuần trước đó (replaceAll), không cộng dồn', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    const withMondayOpen = ALL_CLOSED.map((d) =>
      d.day === 'MONDAY' ? { day: d.day, type: 'OPEN', openMinute: 360, closeMinute: 1200 } : { ...d },
    );
    await gymHoursService.setHours(gymId, ownerId, withMondayOpen as any);

    const allClosedAgain = ALL_CLOSED.map((d) => ({ ...d }));
    const saved = await gymHoursService.setHours(gymId, ownerId, allClosedAgain as any);
    assert.ok(saved.every((h) => h.type === 'CLOSED'), 'ghi đè phải xoá sạch giờ OPEN cũ, không giữ lại');
  } finally {
    await cleanup();
  }
});

integrationTest('assertReadyForSubmit: chặn khi chưa có ngày nào mở, cho qua khi có OPEN hoặc ALL_DAY', async () => {
  try {
    const { ownerId, gymId } = await makeOwnerWithDraft();
    await assert.rejects(
      () => gymHoursService.assertReadyForSubmit(gymId),
      (e: any) => e.status === 400,
    );

    const withOneOpenDay = ALL_CLOSED.map((d) =>
      d.day === 'FRIDAY' ? { day: d.day, type: 'OPEN', openMinute: 480, closeMinute: 1260 } : { ...d },
    );
    await gymHoursService.setHours(gymId, ownerId, withOneOpenDay as any);
    // Không được ném lỗi nữa — nếu assertReadyForSubmit reject, dòng này tự làm fail test.
    await gymHoursService.assertReadyForSubmit(gymId);
  } finally {
    await cleanup();
  }
});
