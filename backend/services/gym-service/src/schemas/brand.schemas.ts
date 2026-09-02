import { z } from 'zod';

/**
 * Vòng 4 / Phase B — brand.service.ts's updateBrand (and createBrand's minimal
 * `if (!data.name?.trim())` check) let req.body reach Prisma with no length limit and no
 * validation on description at all. These schemas run at the route layer (owner.routes.ts)
 * before the controller/service ever sees the body.
 */

const brandName = z
  .string({ required_error: 'Tên thương hiệu là bắt buộc' })
  .trim()
  .min(1, 'Tên thương hiệu không được để trống')
  .max(100, 'Tên thương hiệu không được vượt quá 100 ký tự');

const brandDescription = z
  .string()
  .trim()
  .max(2000, 'Mô tả thương hiệu không được vượt quá 2000 ký tự')
  .optional();

export const brandCreateSchema = z.object({
  name: brandName,
  description: brandDescription,
});

export const brandUpdateSchema = z.object({
  name: brandName.optional(),
  description: brandDescription,
});
