import test from 'node:test';
import assert from 'node:assert/strict';
import { brandCreateSchema, brandUpdateSchema } from '../schemas/brand.schemas';
import { gymCreateSchema, gymUpdateSchema } from '../schemas/gym.schemas';
import { planCreateSchema, planUpdateSchema } from '../schemas/plan.schemas';
import { validateBody } from '../middleware/validate.middleware';

/**
 * Vòng 4 / Phase B — brand.service.ts's updateBrand, gym.controller.ts's createOwned/
 * updateOwned, and plan.controller.ts's create/update all forwarded req.body straight to
 * Prisma with little to no validation: price=-100000, durationDays=0, and a blank brand name
 * all reached the DB before this. These tests exercise the Zod schemas directly (pure, no DB)
 * plus the validateBody middleware's own request/response contract.
 */

const validPlan = {
  name: 'Gói Premium',
  price: 500_000,
  durationDays: 30,
  visitLimit: 12,
};

test('planCreateSchema — chấp nhận payload hợp lệ đầy đủ', () => {
  const result = planCreateSchema.safeParse(validPlan);
  assert.ok(result.success);
});

test('planCreateSchema — từ chối price âm', () => {
  const result = planCreateSchema.safeParse({ ...validPlan, price: -100_000 });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0].message, /Giá gói tập/);
});

test('planCreateSchema — từ chối price = 0', () => {
  const result = planCreateSchema.safeParse({ ...validPlan, price: 0 });
  assert.equal(result.success, false);
});

test('planCreateSchema — từ chối price vượt trần hợp lý', () => {
  const result = planCreateSchema.safeParse({ ...validPlan, price: 999_999_999_999 });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0].message, /Giá gói tập/);
});

test('planCreateSchema — từ chối durationDays = 0', () => {
  const result = planCreateSchema.safeParse({ ...validPlan, durationDays: 0 });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0].message, /Thời hạn gói tập/);
});

test('planCreateSchema — từ chối durationDays không phải số nguyên', () => {
  const result = planCreateSchema.safeParse({ ...validPlan, durationDays: 30.5 });
  assert.equal(result.success, false);
});

test('planCreateSchema — từ chối durationDays vượt 3650 ngày', () => {
  const result = planCreateSchema.safeParse({ ...validPlan, durationDays: 4000 });
  assert.equal(result.success, false);
});

test('planCreateSchema — visitLimit = null hợp lệ (không giới hạn)', () => {
  const result = planCreateSchema.safeParse({ ...validPlan, visitLimit: null });
  assert.ok(result.success);
});

test('planCreateSchema — visitLimit âm bị từ chối', () => {
  const result = planCreateSchema.safeParse({ ...validPlan, visitLimit: -5 });
  assert.equal(result.success, false);
});

test('planCreateSchema — saleStartAt sau saleEndAt bị từ chối', () => {
  const result = planCreateSchema.safeParse({
    ...validPlan,
    saleStartAt: '2026-09-10T00:00:00.000Z',
    saleEndAt: '2026-09-01T00:00:00.000Z',
  });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0].message, /saleStartAt.*saleEndAt/);
});

test('planCreateSchema — saleStartAt <= saleEndAt hợp lệ', () => {
  const result = planCreateSchema.safeParse({
    ...validPlan,
    saleStartAt: '2026-09-01T00:00:00.000Z',
    saleEndAt: '2026-09-10T00:00:00.000Z',
  });
  assert.ok(result.success);
});

test('planCreateSchema — tên gói tập chỉ 1 ký tự bị từ chối (yêu cầu 2-100)', () => {
  const result = planCreateSchema.safeParse({ ...validPlan, name: 'A' });
  assert.equal(result.success, false);
});

test('planUpdateSchema — payload rỗng hợp lệ (không có gì để đổi vẫn cho qua)', () => {
  const result = planUpdateSchema.safeParse({});
  assert.ok(result.success);
});

test('planUpdateSchema — chỉ sửa price vẫn áp đúng ràng buộc dương', () => {
  const result = planUpdateSchema.safeParse({ price: -1 });
  assert.equal(result.success, false);
});

test('planUpdateSchema — status khác ACTIVE/INACTIVE bị từ chối', () => {
  const result = planUpdateSchema.safeParse({ status: 'DELETED' });
  assert.equal(result.success, false);
});

test('brandCreateSchema — tên rỗng (chỉ khoảng trắng) bị từ chối', () => {
  const result = brandCreateSchema.safeParse({ name: '   ' });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0].message, /Tên thương hiệu/);
});

test('brandCreateSchema — tên hợp lệ được trim', () => {
  const result = brandCreateSchema.safeParse({ name: '  Gym Chain X  ' });
  assert.ok(result.success);
  if (result.success) assert.equal(result.data.name, 'Gym Chain X');
});

test('brandUpdateSchema — chỉ sửa description, không có name vẫn hợp lệ', () => {
  const result = brandUpdateSchema.safeParse({ description: 'Mô tả mới' });
  assert.ok(result.success);
});

test('gymCreateSchema — địa chỉ rỗng bị từ chối', () => {
  const result = gymCreateSchema.safeParse({ name: 'Gym A', address: '' });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0].message, /Địa chỉ/);
});

test('gymCreateSchema — email sai định dạng bị từ chối', () => {
  const result = gymCreateSchema.safeParse({ name: 'Gym A', address: '123 Đường ABC', email: 'not-an-email' });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0].message, /Email/);
});

test('gymCreateSchema — email rỗng vẫn hợp lệ (cho phép xoá email)', () => {
  const result = gymCreateSchema.safeParse({ name: 'Gym A', address: '123 Đường ABC', email: '' });
  assert.ok(result.success);
});

// Vòng 4 / Phase C4 — brandId was intentionally added to gymUpdateSchema (moving a gym
// between brands, or detaching it) after this test was first written; updated to match.
test('gymUpdateSchema — brandId không phải uuid hợp lệ bị từ chối', () => {
  const result = gymUpdateSchema.safeParse({ name: 'Gym A', brandId: 'not-a-uuid' });
  assert.equal(result.success, false);
});

test('gymUpdateSchema — brandId: null hợp lệ (tháo gym khỏi brand)', () => {
  const result = gymUpdateSchema.safeParse({ brandId: null });
  assert.ok(result.success);
  if (result.success) assert.equal((result.data as any).brandId, null);
});

// ── validateBody middleware ─────────────────────────────────────────────

function fakeReqRes(body: unknown) {
  const req: any = { body };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return { req, res };
}

test('validateBody — payload không hợp lệ trả 400 kèm thông báo tiếng Việt, không gọi next', () => {
  const { req, res } = fakeReqRes({ ...validPlan, price: -1 });
  let nextCalled = false;
  validateBody(planCreateSchema)(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as any).success, false);
  assert.match((res.body as any).error.message, /Giá gói tập/);
});

test('validateBody — payload hợp lệ thay req.body bằng dữ liệu đã parse rồi gọi next', () => {
  const { req, res } = fakeReqRes({ ...validPlan, name: '  Gói Premium  ' });
  let nextCalled = false;
  validateBody(planCreateSchema)(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.body.name, 'Gói Premium'); // trimmed
});
