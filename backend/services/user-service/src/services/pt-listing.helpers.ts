/**
 * Shared building blocks of the PT listing workflow (state machine in pt-listing.service.ts, apply + admin actions in
 * pt-listing-apply.service.ts). Everything here takes a `Db` so it runs on the shared client OR inside a transaction.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma";
import {
  COPY_FROM_CLOSED_DAYS,
  ListingError,
  MAX_PACKAGES_PER_PT,
  MAX_PHYSIQUE_PHOTOS,
  PROFILE_FIELDS,
  ptListingPayloadSchema,
  type PtListingPayload,
} from "./pt-listing.schemas";

export type Db = Prisma.TransactionClient;

export const OPEN_STATUSES = ["DRAFT", "PENDING"] as const;
export const CLOSED_STATUSES = ["APPROVED", "REJECTED", "WITHDRAWN", "CHANGES_REQUESTED", "STALE"] as const;
export const isOpen = (status: string) => (OPEN_STATUSES as readonly string[]).includes(status);

// ── the PT + its published listing ─────────────────────────────────────────────────────────────

export interface PublishedState {
  profileId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  listingVersion: number;
  listingPublishedAt: Date | null;
  applicationId: string;
  payload: PtListingPayload;
  packages: Array<Awaited<ReturnType<Db["pTServicePackage"]["findMany"]>>[number]>;
  photos: Array<Awaited<ReturnType<Db["ptPhysiquePhoto"]["findMany"]>>[number]>;
}

/** The PT's profile + APPROVED application, or the refusal a non-PT / not-yet-approved caller gets. */
export async function requireApprovedPt(db: Db, ptUserId: string) {
  const profile = await db.userProfile.findUnique({
    where: { userId: ptUserId },
    select: { id: true, userId: true, isPT: true, firstName: true, lastName: true, listingVersion: true, listingPublishedAt: true, ptApplication: { select: { id: true, status: true } } },
  });
  if (!profile || !profile.isPT) {
    throw new ListingError(403, "NOT_A_PT", "Chỉ huấn luyện viên mới quản lý được tin đăng.");
  }
  if (!profile.ptApplication || profile.ptApplication.status !== "APPROVED") {
    throw new ListingError(403, "PT_NOT_APPROVED", "Hồ sơ huấn luyện viên của bạn chưa được duyệt nên chưa có tin đăng.");
  }
  return { ...profile, applicationId: profile.ptApplication.id };
}

/** The published listing as a payload (the same shape a revision carries), read on `db`. */
export async function loadPublished(db: Db, ptUserId: string): Promise<PublishedState> {
  const profile = await requireApprovedPt(db, ptUserId);
  const [app, packages, photos] = await Promise.all([
    db.pTApplication.findUniqueOrThrow({
      where: { id: profile.applicationId },
      select: {
        professionalBio: true,
        mainSpecialties: true,
        trainingMethodsApproach: true,
        targetClientGroups: true,
        primaryTrainingGoals: true,
        languages: true,
        websiteUrl: true,
        linkedinUrl: true,
      },
    }),
    db.pTServicePackage.findMany({ where: { ptUserId, archivedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.ptPhysiquePhoto.findMany({
      where: { ptUserId, status: "PUBLISHED" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const payload: PtListingPayload = {
    profile: {
      professionalBio: app.professionalBio ?? null,
      mainSpecialties: app.mainSpecialties,
      trainingMethodsApproach: app.trainingMethodsApproach ?? null,
      targetClientGroups: app.targetClientGroups,
      primaryTrainingGoals: app.primaryTrainingGoals,
      languages: app.languages,
      websiteUrl: app.websiteUrl ?? null,
      linkedinUrl: app.linkedinUrl ?? null,
    },
    packages: packages.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      price: Number(p.price),
      sessionCount: p.sessionCount,
      sessionMode: p.sessionMode as "ONLINE" | "OFFLINE",
      sessionDurationMinutes: p.sessionDurationMinutes,
      validityDays: p.validityDays ?? null,
      isActive: p.isActive,
    })),
    photoIds: photos.map((p) => p.id),
    coverPhotoId: photos.find((p) => p.isCover)?.id ?? null,
  };
  return {
    profileId: profile.id,
    userId: ptUserId,
    firstName: profile.firstName,
    lastName: profile.lastName,
    listingVersion: profile.listingVersion,
    listingPublishedAt: profile.listingPublishedAt,
    applicationId: profile.applicationId,
    payload,
    packages,
    photos,
  };
}

/** Row lock on the PT's profile: every apply / admin edit of one listing runs one after the other. */
export async function lockProfile(db: Db, ptUserId: string) {
  const rows = await db.$queryRaw<{ id: string; isPT: boolean; listing_version: number }[]>(Prisma.sql`
    SELECT id, "isPT", listing_version FROM user_profiles WHERE "userId" = ${ptUserId} FOR UPDATE`);
  if (!rows[0]) throw new ListingError(404, "PT_NOT_FOUND", "Không tìm thấy huấn luyện viên");
  return { id: rows[0].id, isPT: rows[0].isPT, listingVersion: rows[0].listing_version };
}

// ── payload validation against the database ────────────────────────────────────────────────────

/** Parses a STORED payload (already validated once) back into the typed shape. */
export function parseStoredPayload(raw: unknown): PtListingPayload {
  return ptListingPayloadSchema.parse(raw);
}

/**
 * Validates the references in a payload and returns it normalized:
 *  - at most 5 photos (422 PHOTO_LIMIT), each one owned by THIS PT and still STAGED/PUBLISHED (422 PHOTO_NOT_OWNED);
 *  - the cover is one of the photos (first photo when none was chosen, null when there is no photo);
 *  - at most 10 packages that stay (422 PACKAGE_LIMIT), every package id owned by THIS PT and not archived
 *    (422 PACKAGE_NOT_OWNED).
 * A foreign id and a non-existent id answer the same way, so the response cannot be used to probe other trainers.
 */
export async function validateRefs(db: Db, ptUserId: string, payload: PtListingPayload): Promise<PtListingPayload> {
  const photoIds = payload.photoIds;
  if (new Set(photoIds).size !== photoIds.length) {
    throw new ListingError(422, "PHOTO_DUPLICATE", "Một ảnh không thể xuất hiện hai lần trong tin đăng.");
  }
  if (photoIds.length > MAX_PHYSIQUE_PHOTOS) {
    throw new ListingError(422, "PHOTO_LIMIT", `Tin đăng chỉ có tối đa ${MAX_PHYSIQUE_PHOTOS} ảnh hình thể.`);
  }
  if (photoIds.length > 0) {
    const found = await db.ptPhysiquePhoto.findMany({
      where: { id: { in: photoIds }, ptUserId, status: { in: ["STAGED", "PUBLISHED"] } },
      select: { id: true },
    });
    if (found.length !== photoIds.length) {
      throw new ListingError(422, "PHOTO_NOT_OWNED", "Có ảnh không thuộc về bạn hoặc không còn khả dụng.");
    }
  }
  let cover = payload.coverPhotoId;
  if (cover !== null && !photoIds.includes(cover)) {
    throw new ListingError(422, "COVER_NOT_IN_PHOTOS", "Ảnh bìa phải là một trong các ảnh của tin đăng.");
  }
  if (photoIds.length === 0) cover = null;
  else if (cover === null) cover = photoIds[0];

  const ids = payload.packages.map((p) => p.id).filter(Boolean) as string[];
  if (new Set(ids).size !== ids.length) {
    throw new ListingError(422, "PACKAGE_DUPLICATE", "Một gói không thể xuất hiện hai lần trong tin đăng.");
  }
  const staying = payload.packages.filter((p) => !p.archive);
  if (staying.length > MAX_PACKAGES_PER_PT) {
    throw new ListingError(422, "PACKAGE_LIMIT", `Mỗi huấn luyện viên có tối đa ${MAX_PACKAGES_PER_PT} gói đang bán.`);
  }
  if (ids.length > 0) {
    const owned = await db.pTServicePackage.findMany({ where: { id: { in: ids }, ptUserId, archivedAt: null }, select: { id: true } });
    if (owned.length !== ids.length) {
      throw new ListingError(422, "PACKAGE_NOT_OWNED", "Có gói không thuộc về bạn hoặc đã được lưu trữ.");
    }
  }
  return { ...payload, coverPhotoId: cover };
}

export interface SystemAdjustment {
  type: string;
  [key: string]: unknown;
}

/**
 * Drops from a payload everything that no longer exists (photo gone, package archived) and says so. Used when a
 * closed revision is copied into a new draft and when a draft is rebased - a draft must never point at a dead id.
 * Photo rows are read FOR SHARE so the cleanup job (FOR UPDATE SKIP LOCKED) cannot remove one underneath us.
 */
export async function filterPayloadForDraft(
  db: Db,
  ptUserId: string,
  payload: PtListingPayload,
): Promise<{ payload: PtListingPayload; adjustments: SystemAdjustment[] }> {
  const adjustments: SystemAdjustment[] = [];

  let photoIds = payload.photoIds;
  if (photoIds.length > 0) {
    const alive = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM pt_physique_photos
       WHERE id IN (${Prisma.join(photoIds)}) AND pt_user_id = ${ptUserId} AND status IN ('STAGED','PUBLISHED')
       ORDER BY id FOR SHARE`);
    const aliveSet = new Set(alive.map((r) => r.id));
    for (const id of photoIds) if (!aliveSet.has(id)) adjustments.push({ type: "PHOTO_NO_LONGER_AVAILABLE", photoId: id });
    photoIds = photoIds.filter((id) => aliveSet.has(id));
  }
  let cover = payload.coverPhotoId && photoIds.includes(payload.coverPhotoId) ? payload.coverPhotoId : null;
  if (cover === null && photoIds.length > 0) cover = photoIds[0];

  const pkgIds = payload.packages.map((p) => p.id).filter(Boolean) as string[];
  let packages = payload.packages;
  if (pkgIds.length > 0) {
    const alive = await db.pTServicePackage.findMany({ where: { id: { in: pkgIds }, ptUserId, archivedAt: null }, select: { id: true } });
    const aliveSet = new Set(alive.map((r) => r.id));
    packages = payload.packages.filter((p) => {
      if (!p.id || aliveSet.has(p.id)) return true;
      adjustments.push({ type: "PACKAGE_NO_LONGER_AVAILABLE", packageId: p.id, name: p.name });
      return false;
    });
  }
  return { payload: { ...payload, photoIds, coverPhotoId: cover, packages }, adjustments };
}

// ── writing revisions ──────────────────────────────────────────────────────────────────────────

/**
 * Inserts an open DRAFT unless the PT already has an open revision (the partial unique index decides, atomically).
 * Returns the new id, or null when one already exists. No catching of unique violations.
 */
export async function insertDraft(
  db: Db,
  args: {
    ptUserId: string;
    payload: PtListingPayload;
    baseVersion: number;
    parentRevisionId?: string | null;
    adjustments?: SystemAdjustment[];
    reviewNote?: string | null;
    ownerNote?: string | null;
  },
): Promise<string | null> {
  const id = randomUUID();
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO pt_listing_revisions
      (id, pt_user_id, status, source, parent_revision_id, base_version, draft_version, payload, system_adjustments, review_note, owner_note, created_at, updated_at)
    VALUES
      (${id}, ${args.ptUserId}, 'DRAFT'::"PtListingRevisionStatus", 'OWNER'::"PtListingRevisionSource", ${args.parentRevisionId ?? null}, ${args.baseVersion}, 1,
       ${JSON.stringify(args.payload)}::jsonb, ${JSON.stringify(args.adjustments ?? [])}::jsonb, ${args.reviewNote ?? null}, ${args.ownerNote ?? null}, now(), now())
    ON CONFLICT (pt_user_id) WHERE status IN ('DRAFT','PENDING') DO NOTHING
    RETURNING id`);
  return rows[0]?.id ?? null;
}

export function closedAtOf(rev: { reviewedAt: Date | null; updatedAt: Date }): Date {
  return rev.reviewedAt ?? rev.updatedAt;
}

export function assertCopyable(rev: { status: string; reviewedAt: Date | null; updatedAt: Date }) {
  if (isOpen(rev.status)) {
    throw new ListingError(409, "REVISION_NOT_CLOSED", "Bản sửa này vẫn đang mở, không thể chép.");
  }
  const ageMs = Date.now() - closedAtOf(rev).getTime();
  if (ageMs > COPY_FROM_CLOSED_DAYS * 24 * 3600 * 1000) {
    throw new ListingError(409, "REVISION_TOO_OLD_TO_COPY", `Chỉ chép được từ bản sửa đã đóng trong ${COPY_FROM_CLOSED_DAYS} ngày gần đây.`);
  }
}

// ── DTOs ───────────────────────────────────────────────────────────────────────────────────────

type RevisionRow = Awaited<ReturnType<Db["ptListingRevision"]["findUniqueOrThrow"]>>;

/** A revision as the OWNER sees it (no admin-only columns). */
export function toOwnerRevisionDto(rev: RevisionRow, currentListingVersion: number) {
  return {
    id: rev.id,
    status: rev.status,
    source: rev.source,
    parentRevisionId: rev.parentRevisionId,
    baseVersion: rev.baseVersion,
    draftVersion: rev.draftVersion,
    payload: rev.payload,
    systemAdjustments: rev.systemAdjustments,
    ownerNote: rev.ownerNote,
    reviewNote: rev.reviewNote,
    submittedAt: rev.submittedAt,
    reviewedAt: rev.reviewedAt,
    createdAt: rev.createdAt,
    updatedAt: rev.updatedAt,
    stale: isOpen(rev.status) && rev.baseVersion !== currentListingVersion,
  };
}

/** One history line (no payload): what the owner / admin lists show. */
export function toHistoryItem(rev: RevisionRow, opts: { admin: boolean }) {
  return {
    id: rev.id,
    status: rev.status,
    source: rev.source,
    parentRevisionId: rev.parentRevisionId,
    baseVersion: rev.baseVersion,
    submittedAt: rev.submittedAt,
    reviewedAt: rev.reviewedAt,
    reviewNote: rev.reviewNote,
    systemAdjustments: rev.systemAdjustments,
    createdAt: rev.createdAt,
    closedAt: isOpen(rev.status) ? null : closedAtOf(rev),
    ...(opts.admin ? { reviewedBy: rev.reviewedBy, adminReason: rev.adminReason, submittedBy: rev.submittedBy } : {}),
  };
}

export const PROFILE_COLUMNS = PROFILE_FIELDS;
