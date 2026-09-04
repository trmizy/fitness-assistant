import { z } from 'zod';

/**
 * Vòng 4 / Phase B — plan.service.ts's createPlan/updatePlan passed price/durationDays/
 * visitLimit straight to Prisma with zero range checks (only saleStartAt<=saleEndAt was ever
 * validated, in assertSaleWindowValid). Nothing stopped price=-100000 or durationDays=0.
 *
 * The saleStartAt<=saleEndAt refine below is a same-request early check only — it can't see a
 * plan's EXISTING stored saleStartAt/saleEndAt when an update sends just one of the two, so
 * plan.service.ts's assertSaleWindowValid (which merges with the stored row) stays the real
 * guard for that partial-update case and must not be removed.
 */

const planName = z
  .string({ required_error: 'Tên gói tập là bắt buộc' })
  .trim()
  .min(2, 'Tên gói tập phải có ít nhất 2 ký tự')
  .max(100, 'Tên gói tập không được vượt quá 100 ký tự');

const planDescription = z
  .string()
  .trim()
  .max(2000, 'Mô tả gói tập không được vượt quá 2000 ký tự')
  .optional();

// Decimal(12,2) in the DB allows far more than this — the ceiling here is a sanity check
// against fat-fingered/malicious input (e.g. an extra zero or two), not the column's own limit.
const PRICE_CEILING = 1_000_000_000;
const planPrice = z
  .number({ required_error: 'Giá gói tập là bắt buộc', invalid_type_error: 'Giá gói tập phải là một số' })
  .positive('Giá gói tập phải lớn hơn 0')
  .max(PRICE_CEILING, `Giá gói tập không được vượt quá ${PRICE_CEILING.toLocaleString('vi-VN')}đ`);

const planDurationDays = z
  .number({ required_error: 'Thời hạn gói tập là bắt buộc', invalid_type_error: 'Thời hạn gói tập phải là một số' })
  .int('Thời hạn gói tập phải là số nguyên (số ngày)')
  .min(1, 'Thời hạn gói tập phải ít nhất 1 ngày')
  .max(3650, 'Thời hạn gói tập không được vượt quá 3650 ngày');

const planVisitLimit = z
  .number({ invalid_type_error: 'Giới hạn lượt vào phải là một số' })
  .int('Giới hạn lượt vào phải là số nguyên')
  .positive('Giới hạn lượt vào phải lớn hơn 0')
  .nullable()
  .optional();

// Loosely typed on purpose — the service layer does new Date(str) on these; tightening to
// z.string().datetime() risks rejecting a currently-working format this schema has never seen.
const planSaleStartAt = z.string().trim().min(1).nullable().optional();
const planSaleEndAt = z.string().trim().min(1).nullable().optional();

const planStatus = z.enum(['ACTIVE', 'INACTIVE'], {
  errorMap: () => ({ message: 'Trạng thái gói tập không hợp lệ (chỉ nhận ACTIVE hoặc INACTIVE)' }),
});

function saleWindowStillValid(data: { saleStartAt?: string | null; saleEndAt?: string | null }) {
  if (!data.saleStartAt || !data.saleEndAt) return true;
  const start = new Date(data.saleStartAt);
  const end = new Date(data.saleEndAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return true; // let the service's own Date parsing surface a bad string
  return start <= end;
}

const saleWindowRefinement = {
  message: 'Thời gian bắt đầu mở bán (saleStartAt) phải trước hoặc bằng thời gian kết thúc (saleEndAt)',
  path: ['saleEndAt'],
};

export const planCreateSchema = z
  .object({
    name: planName,
    description: planDescription,
    price: planPrice,
    durationDays: planDurationDays,
    visitLimit: planVisitLimit,
    saleStartAt: planSaleStartAt,
    saleEndAt: planSaleEndAt,
  })
  .refine(saleWindowStillValid, saleWindowRefinement);

export const planUpdateSchema = z
  .object({
    name: planName.optional(),
    description: planDescription,
    price: planPrice.optional(),
    durationDays: planDurationDays.optional(),
    visitLimit: planVisitLimit,
    status: planStatus.optional(),
    saleStartAt: planSaleStartAt,
    saleEndAt: planSaleEndAt,
  })
  .refine(saleWindowStillValid, saleWindowRefinement);
