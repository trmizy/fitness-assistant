import { z } from 'zod';
import { amenitySelectionFields } from '../services/amenity-selection.schemas';

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
  // Hiện ở đầu mục "Chi tiết" cho khách ("Thông tin giới thiệu") — ngắn gọn, đọc lướt được.
  .max(300, 'Giới thiệu phòng gym tối đa 300 ký tự')
  .optional();

const gymCity = z
  .string()
  .trim()
  .max(100, 'Tên thành phố không được vượt quá 100 ký tự')
  .optional();

// GYM_BRANCH_FORM_SPEC.md §14 — optional free-text directions on top of the formal address.
const gymLocationNote = z
  .string()
  .trim()
  .max(300, 'Hướng dẫn vị trí không được vượt quá 300 ký tự')
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


// Tìm phòng gym theo tỉnh/thành — denormalized từ VietnamProvince/VietnamWard bên
// user-service (không FK xuyên service, cùng quy ước `ownerId`). Nullable ở DB nên
// optional().nullable() ở đây: bỏ trống nghĩa là "không xác định chi nhánh này ở đâu".
const gymProvinceCode = z.number().int().positive().optional().nullable();
const gymWardCode = z.number().int().positive().optional().nullable();
// Toạ độ chi nhánh — trình duyệt của CHỦ GYM tự lấy khi họ bấm "Dùng vị trí hiện tại" lúc
// tạo/sửa chi nhánh. Biên độ khớp với toạ độ địa lý thật (vĩ độ ±90, kinh độ ±180).
const gymLatitude = z.number().min(-90).max(90).optional().nullable();
const gymLongitude = z.number().min(-180).max(180).optional().nullable();

// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 4 "Facilities & Services". Must match the
// `GymFacility` Prisma enum exactly, kept as a plain array here (not importing the generated
// Prisma enum) so this schema file has no dependency on `prisma generate` having run.
export const GYM_FACILITY_VALUES = [
  'FREE_WEIGHTS', 'CARDIO_MACHINES', 'FUNCTIONAL_TRAINING_AREA', 'GROUP_CLASSES', 'YOGA_STUDIO',
  'SWIMMING_POOL', 'PERSONAL_TRAINER', 'INBODY_SCAN', 'LOCKER_ROOM', 'SHOWER', 'SAUNA',
  'TOWEL_SERVICE', 'PARKING', 'WIFI', 'AIR_CONDITIONING', 'DRINKING_WATER', 'KIDS_AREA',
  'VENDING_MACHINE',
] as const;
const gymFacilities = z
  .array(z.enum(GYM_FACILITY_VALUES, { errorMap: () => ({ message: 'Tiện ích không hợp lệ' }) }))
  .optional();

export const gymCreateSchema = z.object({
  name: gymName,
  description: gymDescription,
  address: gymAddress,
  city: gymCity,
  phone: gymPhone,
  email: gymEmail,
  // GYM_BRANCH_FORM_SPEC.md §4/§57 — deliberately no brandId field. It was accepted here but
  // never actually read by gymService.createGym (which already auto-derives the owner's one
  // brand) — removed so the schema can't even pretend to accept a client-supplied brand.
  provinceCode: gymProvinceCode,
  wardCode: gymWardCode,
  latitude: gymLatitude,
  longitude: gymLongitude,
  locationNote: gymLocationNote,
  facilities: gymFacilities,
});

/**
 * POST /owner/gyms (the mobile quick create): the fields of `gymCreateSchema` plus the amenity selection of Listing Management B3
 * (`amenityIds` / `proposals` / `proposalIds`). Whether an empty selection is accepted depends on the client - see
 * legacy-compat.service.ts. `gymCreateSchema` itself stays the validation the draft submit re-uses.
 */
export const gymQuickCreateSchema = gymCreateSchema.extend(amenitySelectionFields);

export const gymUpdateSchema = z.object({
  name: gymName.optional(),
  description: gymDescription,
  address: gymAddress.optional(),
  city: gymCity,
  phone: gymPhone,
  email: gymEmail,
  // GYM_BRANCH_FORM_SPEC.md §51/§79/§89 — deliberately NO brandId here any more. This used
  // to let an owner detach a branch from its brand or move it to another brand they owned
  // (Vòng 4 / Phase C4, before the one-partner-one-brand invariant existed at the data
  // layer). A branch now permanently belongs to the owner's single brand — no "Change
  // Brand", no standalone branch, confirmed with the user before removing this field.
  // Existing rows created under the old behavior are left untouched; only the ability to
  // create new ones is removed.
  provinceCode: gymProvinceCode,
  wardCode: gymWardCode,
  latitude: gymLatitude,
  longitude: gymLongitude,
  // GYM_BRANCH_FORM_SPEC.md §74 — free edit even after approval, no material-change gating.
  locationNote: gymLocationNote,
  facilities: gymFacilities,
});

// "Quản lý gym & owner" — admin editing a branch directly. Deliberately narrower than
// gymUpdateSchema above: no brandId here — reassigning a branch to a different brand is a much
// bigger, unreviewed operation (this route has no ownerId scoping at all) than what was asked
// for ("sửa trực tiếp thông tin chi nhánh": tên/địa chỉ/SĐT/email/mô tả).
export const gymAdminUpdateSchema = z.object({
  name: gymName.optional(),
  description: gymDescription,
  address: gymAddress.optional(),
  city: gymCity,
  phone: gymPhone,
  email: gymEmail,
  // Listing Management B2 — required (>= 10 characters) whenever `description` is sent (checked in
  // gymController.updateAsAdmin); it is stored on the ADMIN_DIRECT revision. `expectedListingVersion` is optional: when
  // given it must equal the branch's current listing_version (409 LISTING_STALE otherwise).
  reason: z.string().trim().max(500, 'Lý do không được vượt quá 500 ký tự').optional(),
  expectedListingVersion: z.number().int().min(0).optional(),
});

// GYM_BRANCH_FORM_SPEC.md Phase 1 — the wizard's draft save: deliberately LOOSE about values (a draft is not yet real;
// full validation happens once, at submit - see gym-draft.service.ts) but STRICT about keys, so a client cannot slip
// a column the wizard does not own (status, ownerId, listingVersion, approvedName, ...) into a draft save. `facilities`
// is the wizard's selection of GymFacility labels; it is written to gym_amenities, never to the column.
export const gymDraftUpdateSchema = z
  .object(
    {
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      address: z.string().optional(),
      city: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      provinceCode: z.number().nullable().optional(),
      wardCode: z.number().nullable().optional(),
      latitude: z.number().nullable().optional(),
      longitude: z.number().nullable().optional(),
      locationNote: z.string().nullable().optional(),
      facilities: gymFacilities,
      wizardStep: z.number().optional(),
      // Listing Management B3: the amenity step of the wizard (`amenityIds` wins over the older `facilities` labels).
      ...amenitySelectionFields,
    },
    {
      errorMap: (issue, ctx) =>
        issue.code === 'unrecognized_keys'
          ? { message: `Trường không được hỗ trợ khi lưu bản nháp: ${issue.keys.join(', ')}` }
          : { message: ctx.defaultError },
    },
  )
  .strict();

// Vòng 4 / Phase C3 — the owner's open/close switch. `reason` is required by the service layer
// for TEMPORARILY_CLOSED/PERMANENTLY_CLOSED (not enforced here since it depends on which
// target status was chosen — see gymService.setOperationalStatus).
export const gymOperationalStatusSchema = z.object({
  operationalStatus: z.enum(['OPEN', 'TEMPORARILY_CLOSED', 'PERMANENTLY_CLOSED'], {
    errorMap: () => ({ message: 'Trạng thái hoạt động không hợp lệ' }),
  }),
  reason: z.string().trim().max(500, 'Lý do không được vượt quá 500 ký tự').optional(),
  /// GYM_MANAGEMENT master spec §61 — ngày dự kiến mở lại, chỉ có ý nghĩa khi
  /// operationalStatus là TEMPORARILY_CLOSED; bị bỏ qua ở service nếu gửi kèm target khác.
  expectedReopenAt: z.coerce.date().optional(),
});
