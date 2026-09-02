import { z } from 'zod';

/**
 * Vòng 4 / Phase B — gym.controller.ts's createOwned/updateOwned passed req.body straight to
 * gymService with no validation at all: name/address had no length or emptiness check, email
 * was never checked to look like an email. These schemas only cover name/address/description/
 * city/phone/email/brandId — the fields the current owner-facing create/update payload
 * actually has. Phase C adds approvedName/pendingName + operationalStatus on top of this and
 * is out of scope here.
 */

const gymName = z
  .string({ required_error: 'Tên phòng gym là bắt buộc' })
  .trim()
  .min(1, 'Tên phòng gym không được để trống')
  .max(150, 'Tên phòng gym không được vượt quá 150 ký tự');

const gymAddress = z
  .string({ required_error: 'Địa chỉ phòng gym là bắt buộc' })
  .trim()
  .min(1, 'Địa chỉ phòng gym không được để trống')
  .max(300, 'Địa chỉ phòng gym không được vượt quá 300 ký tự');

const gymDescription = z
  .string()
  .trim()
  .max(2000, 'Mô tả phòng gym không được vượt quá 2000 ký tự')
  .optional();

const gymCity = z
  .string()
  .trim()
  .max(100, 'Tên thành phố không được vượt quá 100 ký tự')
  .optional();

const gymPhone = z
  .string()
  .trim()
  .max(20, 'Số điện thoại không được vượt quá 20 ký tự')
  .optional();

// Empty string is kept valid (and distinct from "field omitted") so a caller can still
// explicitly clear an existing email — same semantics as before this schema existed.
const gymEmail = z
  .union([z.string().trim().email('Email không đúng định dạng').max(200), z.literal('')])
  .optional();

const gymBrandId = z.string().uuid('brandId không hợp lệ').optional();

export const gymCreateSchema = z.object({
  name: gymName,
  description: gymDescription,
  address: gymAddress,
  city: gymCity,
  phone: gymPhone,
  email: gymEmail,
  brandId: gymBrandId,
});

export const gymUpdateSchema = z.object({
  name: gymName.optional(),
  description: gymDescription,
  address: gymAddress.optional(),
  city: gymCity,
  phone: gymPhone,
  email: gymEmail,
  // Vòng 4 / Phase C4 — move a gym to a brand the owner owns, or null to detach. Explicitly
  // nullable (not just optional): omitted means "don't touch brandId", null means "detach".
  brandId: gymBrandId.nullable().optional(),
});

// Vòng 4 / Phase C3 — the owner's open/close switch. `reason` is required by the service layer
// for TEMPORARILY_CLOSED/PERMANENTLY_CLOSED (not enforced here since it depends on which
// target status was chosen — see gymService.setOperationalStatus).
export const gymOperationalStatusSchema = z.object({
  operationalStatus: z.enum(['OPEN', 'TEMPORARILY_CLOSED', 'PERMANENTLY_CLOSED'], {
    errorMap: () => ({ message: 'Trạng thái hoạt động không hợp lệ' }),
  }),
  reason: z.string().trim().max(500, 'Lý do không được vượt quá 500 ký tự').optional(),
});
