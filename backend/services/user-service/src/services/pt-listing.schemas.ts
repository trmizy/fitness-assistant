/**
 * PT listing management, phase C2 - the shapes a listing revision is made of.
 *
 * A revision's `payload` is the COMPLETE desired state of the editable part of the PT's public listing:
 *
 *   { profile: { 8 text/array fields }, packages: [...], photoIds: [...], coverPhotoId }
 *
 * It is a full replacement, not a patch: the apply transaction compares it with what is published and writes the
 * difference. Every schema is `.strict()` - an unknown key is a 400, never silently dropped or stored (plan §3).
 */
import { z } from "zod";

// ── limits ─────────────────────────────────────────────────────────────────────────────────────
export const MAX_PHYSIQUE_PHOTOS = 5;
/** Non-archived packages per PT (same number as the old direct-edit path). */
export const MAX_PACKAGES_PER_PT = 10;
/** Photos that may sit in STAGED at once per PT (plan B5 item 6). */
export const MAX_STAGED_PHOTOS = 15;
/** A closed revision may be copied into a new draft only this long after it closed (plan §12.13 item 5). */
export const COPY_FROM_CLOSED_DAYS = 30;

// ── errors ─────────────────────────────────────────────────────────────────────────────────────
export class ListingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ListingError";
  }
}

// ── payload schema ─────────────────────────────────────────────────────────────────────────────
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v === "" ? null : v));

const textList = (maxItems: number, maxLen: number) =>
  z
    .array(z.string().trim().min(1).max(maxLen))
    .max(maxItems)
    .transform((arr) => [...new Set(arr)]);

const httpUrl = z
  .string()
  .trim()
  .max(300)
  .nullable()
  .transform((v) => (v === null || v === "" ? null : v))
  .refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), { message: "URL phải bắt đầu bằng http:// hoặc https://" });

export const ptListingProfileSchema = z
  .object({
    professionalBio: optionalText(2000),
    mainSpecialties: textList(10, 60),
    trainingMethodsApproach: optionalText(2000),
    targetClientGroups: textList(10, 60),
    primaryTrainingGoals: textList(10, 60),
    languages: textList(10, 30),
    websiteUrl: httpUrl,
    linkedinUrl: httpUrl,
  })
  .strict();

export const PROFILE_FIELDS = [
  "professionalBio",
  "mainSpecialties",
  "trainingMethodsApproach",
  "targetClientGroups",
  "primaryTrainingGoals",
  "languages",
  "websiteUrl",
  "linkedinUrl",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const ptListingPackageSchema = z
  .object({
    /** Present = edits an existing package of THIS PT; absent = a new package. */
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Tên gói không được để trống").max(80),
    description: z
      .string()
      .trim()
      .max(1000)
      .nullable()
      .optional()
      .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
    price: z.number().positive("Giá phải lớn hơn 0").max(1_000_000_000),
    sessionCount: z.number().int().min(1).max(200),
    sessionMode: z.enum(["ONLINE", "OFFLINE"]),
    sessionDurationMinutes: z.number().int().min(15).max(240),
    validityDays: z.number().int().min(1).max(3650).nullable(),
    isActive: z.boolean(),
    /** Explicitly drop this (existing) package. A published package missing from the list is archived too. */
    archive: z.boolean().optional(),
  })
  .strict();

export const PACKAGE_COMMERCIAL_FIELDS = [
  "name",
  "description",
  "price",
  "sessionCount",
  "sessionMode",
  "sessionDurationMinutes",
  "validityDays",
  "isActive",
] as const;

export const ptListingPayloadSchema = z
  .object({
    profile: ptListingProfileSchema,
    packages: z.array(ptListingPackageSchema).max(30),
    photoIds: z.array(z.string().uuid()).max(50),
    coverPhotoId: z.string().uuid().nullable(),
  })
  .strict();

export type PtListingProfile = z.infer<typeof ptListingProfileSchema>;
export type PtListingPackage = z.infer<typeof ptListingPackageSchema>;
export type PtListingPayload = z.infer<typeof ptListingPayloadSchema>;

export const saveDraftBodySchema = z
  .object({
    expectedDraftVersion: z.number().int().min(1),
    payload: ptListingPayloadSchema,
    ownerNote: z.string().trim().max(1000).optional(),
  })
  .strict();

export const createDraftBodySchema = z.object({ copyFromRevisionId: z.string().uuid().optional() }).strict();
export const expectedDraftBodySchema = z.object({ expectedDraftVersion: z.number().int().min(1).optional(), ownerNote: z.string().trim().max(1000).optional() }).strict();
export const submitBodySchema = z
  .object({ expectedDraftVersion: z.number().int().min(1), ownerNote: z.string().trim().max(1000).optional() })
  .strict();
export const emptyBodySchema = z.object({}).strict();

export const presignBodySchema = z.object({ contentType: z.enum(["image/jpeg", "image/png", "image/webp"]) }).strict();
export const confirmBodySchema = z.object({ uploadId: z.string().uuid() }).strict();

// admin ----------------------------------------------------------------------------------------
export const adminDecisionBodySchema = z.object({ note: z.string().trim().max(1000).optional() }).strict();
export const adminNoteRequiredBodySchema = z
  .object({ note: z.string().trim().min(1, "Cần nhập ghi chú").max(1000) })
  .strict();

export const adminDirectEditBodySchema = z
  .object({
    profile: ptListingProfileSchema.partial().strict().optional(),
    packages: z.array(ptListingPackageSchema).max(30).optional(),
    photoIds: z.array(z.string().uuid()).max(50).optional(),
    coverPhotoId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().min(10, "Lý do tối thiểu 10 ký tự").max(1000),
    expectedListingVersion: z.number().int().min(0),
  })
  .strict();

export const adminRetireBodySchema = z
  .object({
    reason: z.string().trim().min(10, "Lý do tối thiểu 10 ký tự").max(1000),
    purge: z.boolean().optional(),
  })
  .strict();

// ── helpers ────────────────────────────────────────────────────────────────────────────────────
/** Parses with a schema; a failure is a 400 VALIDATION_FAILED with the first Vietnamese-readable issue. */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path?.length ? ` (${issue.path.join(".")})` : "";
    throw new ListingError(400, "VALIDATION_FAILED", `Dữ liệu không hợp lệ${where}: ${issue?.message ?? "sai định dạng"}`, {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}
