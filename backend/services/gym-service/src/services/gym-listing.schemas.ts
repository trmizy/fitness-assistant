/**
 * Branch listing management (Listing Management B2) - the shapes a listing revision is made of.
 *
 * A revision's `payload` is the COMPLETE desired state of the editable part of a branch's public listing:
 *
 *   { description, amenityIds, proposalIds, photoIds, coverPhotoId }
 *
 * It is a full replacement, not a patch: the apply transaction compares it with what is published and writes the
 * difference. Every schema is `.strict()` - an unknown key is a 400, never silently dropped or stored (plan §3).
 * Same structure as user-service's pt-listing.schemas.ts (the committed reference implementation).
 */
import { z } from 'zod';
import { AMENITY_CATEGORIES } from './amenity-catalog';

// ── limits ─────────────────────────────────────────────────────────────────────────────────────
/** Public photos per branch (Ngài's decision, 20 per branch). */
export const MAX_GYM_PHOTOS = 20;
/** Photos that may sit in STAGED at once per branch (plan B5 item 6; Ngài's decision: 40). */
export const MAX_STAGED_PHOTOS = 40;
/** A closed revision may be copied into a new draft only this long after it closed (plan §12.13 item 5). */
export const COPY_FROM_CLOSED_DAYS = 30;
/** The description limit that already exists on the branch (gym.schemas.ts `gymDescription`). */
export const MAX_DESCRIPTION_LENGTH = 300;
export const MAX_AMENITIES_PER_GYM = 60;
export const MAX_PROPOSALS_PER_REVISION = 10;
/** A reason an admin gives for a direct edit (Ngài's decision: >= 10 characters, stored). */
export const MIN_ADMIN_REASON_LENGTH = 10;

// ── errors ─────────────────────────────────────────────────────────────────────────────────────
export class ListingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ListingError';
  }
}

// ── payload schema ─────────────────────────────────────────────────────────────────────────────
const descriptionField = z
  .string()
  .trim()
  .max(MAX_DESCRIPTION_LENGTH, `Giới thiệu phòng gym tối đa ${MAX_DESCRIPTION_LENGTH} ký tự`)
  .nullable()
  .transform((v) => (v === null || v === '' ? null : v));

const uuidList = (max: number) =>
  z
    .array(z.string().uuid())
    .max(max)
    .transform((arr) => [...new Set(arr)]);

/** Catalogue ids are free text, not UUIDs: the 18 SYSTEM rows are 'amenity-sys-<slug>' (migration seed). */
const catalogId = z.string().trim().min(1).max(100);
const catalogIdList = (max: number) => z.array(catalogId).max(max).transform((arr) => [...new Set(arr)]);

export const gymListingPayloadSchema = z
  .object({
    description: descriptionField,
    amenityIds: catalogIdList(MAX_AMENITIES_PER_GYM),
    proposalIds: uuidList(MAX_PROPOSALS_PER_REVISION),
    // The cap (20) is a 422 PHOTO_LIMIT from validateRefs, not a 400 here; this ceiling only bounds the request size.
    photoIds: z.array(z.string().uuid()).max(100),
    coverPhotoId: z.string().uuid().nullable(),
  })
  .strict();

export type GymListingPayload = z.infer<typeof gymListingPayloadSchema>;

export const saveDraftBodySchema = z
  .object({
    expectedDraftVersion: z.number().int().min(1),
    payload: gymListingPayloadSchema,
    ownerNote: z.string().trim().max(1000).optional(),
  })
  .strict();

export const createDraftBodySchema = z.object({ copyFromRevisionId: z.string().uuid().optional() }).strict();
export const expectedDraftBodySchema = z
  .object({ expectedDraftVersion: z.number().int().min(1).optional(), ownerNote: z.string().trim().max(1000).optional() })
  .strict();
export const submitBodySchema = z
  .object({ expectedDraftVersion: z.number().int().min(1), ownerNote: z.string().trim().max(1000).optional() })
  .strict();
export const emptyBodySchema = z.object({}).strict();

export const presignBodySchema = z.object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']) }).strict();
export const reorderPhotosBodySchema = z.object({ photoIds: z.array(z.string().uuid()).min(1).max(100) }).strict();
export const confirmBodySchema = z.object({ uploadId: z.string().uuid() }).strict();

// ── admin: revisions ───────────────────────────────────────────────────────────────────────────
export const adminApproveBodySchema = z
  .object({
    note: z.string().trim().max(1000).optional(),
    /** "Duyệt bản sửa, bỏ tiện ích bị từ chối" (B12): also drops a proposal in the payload that was REJECTED / CANCELLED. */
    dropRejectedAmenities: z.boolean().optional(),
    /** "Duyệt và bỏ tiện ích đã tắt" (§12.3): drops catalogue amenities that were DISABLED since the revision was submitted. */
    dropDisabledAmenities: z.boolean().optional(),
  })
  .strict();
export const adminNoteRequiredBodySchema = z
  .object({ note: z.string().trim().min(1, 'Cần nhập ghi chú').max(1000) })
  .strict();

const adminReason = z.string().trim().min(MIN_ADMIN_REASON_LENGTH, `Lý do tối thiểu ${MIN_ADMIN_REASON_LENGTH} ký tự`).max(1000);

export const adminDirectEditBodySchema = z
  .object({
    description: descriptionField.optional(),
    amenityIds: catalogIdList(MAX_AMENITIES_PER_GYM).optional(),
    photoIds: z.array(z.string().uuid()).max(100).optional(),
    coverPhotoId: z.string().uuid().nullable().optional(),
    reason: adminReason,
    expectedListingVersion: z.number().int().min(0),
  })
  .strict();

export const adminRetireBodySchema = z.object({ reason: adminReason, purge: z.boolean().optional() }).strict();

// ── amenities ──────────────────────────────────────────────────────────────────────────────────
const amenityCategory = z.enum(AMENITY_CATEGORIES);

export const proposalNameField = z.string().trim().min(2, 'Tên tiện ích tối thiểu 2 ký tự').max(40, 'Tên tiện ích tối đa 40 ký tự');

export const ownerProposalBodySchema = z
  .object({
    gymId: z.string().uuid(),
    name: proposalNameField,
    suggestedCategory: amenityCategory,
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const ownerProposalPatchBodySchema = z
  .object({
    name: proposalNameField.optional(),
    suggestedCategory: amenityCategory.optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Không có gì để cập nhật' });

export const adminAmenityCreateBodySchema = z
  .object({
    name: proposalNameField,
    category: amenityCategory,
    iconKey: z.string().trim().min(1).max(40),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

export const adminAmenityPatchBodySchema = z
  .object({
    name: proposalNameField.optional(),
    category: amenityCategory.optional(),
    iconKey: z.string().trim().min(1).max(40).optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).filter((k) => k !== 'reason').length > 0, { message: 'Không có gì để cập nhật' });

const proposalIdList = z.array(z.string().uuid()).min(1).max(200);

export const adminProposalApproveBodySchema = z
  .object({
    proposalIds: proposalIdList,
    /** Defaults: the owners' suggested category / the first proposal's name. */
    category: amenityCategory.optional(),
    iconKey: z.string().trim().min(1).max(40).optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    name: proposalNameField.optional(),
    /** The explicit "bật lại X và gộp" answer to 409 AMENITY_EXISTS_DISABLED. Never implied. */
    reenableAndMerge: z.boolean().optional(),
  })
  .strict();

export const adminProposalRejectBodySchema = z
  .object({ proposalIds: proposalIdList, reason: z.string().trim().min(3, 'Cần nhập lý do').max(500) })
  .strict();

export const adminProposalMergeBodySchema = z
  .object({
    proposalIds: proposalIdList,
    targetAmenityId: catalogId,
    reenableAndMerge: z.boolean().optional(),
  })
  .strict();

// ── helpers ────────────────────────────────────────────────────────────────────────────────────
/** Parses with a schema; a failure is a 400 VALIDATION_FAILED with the first Vietnamese-readable issue. */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path?.length ? ` (${issue.path.join('.')})` : '';
    throw new ListingError(400, 'VALIDATION_FAILED', `Dữ liệu không hợp lệ${where}: ${issue?.message ?? 'sai định dạng'}`, {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}
