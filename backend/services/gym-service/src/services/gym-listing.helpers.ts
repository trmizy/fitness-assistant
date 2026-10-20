/**
 * Shared building blocks of the branch-listing workflow (state machine in gym-listing.service.ts, apply + admin actions
 * in gym-listing-apply.service.ts). Everything here takes a `Db` so it runs on the shared client OR inside a transaction.
 * Mirrors user-service's pt-listing.helpers.ts.
 */
import { randomUUID } from 'node:crypto';
import { logger } from '@gym-coach/shared';
import { Prisma, type PartnerAuditAction } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { partnerAuditService } from './partner-audit.service';
import { listingPhotoStorage } from './listing-photo-storage';
import {
  COPY_FROM_CLOSED_DAYS,
  ListingError,
  MAX_AMENITIES_PER_GYM,
  MAX_GYM_PHOTOS,
  gymListingPayloadSchema,
  type GymListingPayload,
} from './gym-listing.schemas';

export type Db = Prisma.TransactionClient;

export const OPEN_STATUSES = ['DRAFT', 'PENDING'] as const;
export const CLOSED_STATUSES = ['APPROVED', 'REJECTED', 'WITHDRAWN', 'CHANGES_REQUESTED', 'STALE'] as const;
export const isOpen = (status: string) => (OPEN_STATUSES as readonly string[]).includes(status);

/** Lifetime of a presigned GET handed out inside an authenticated preview / owner response. */
export const STAGED_URL_TTL_SEC = 15 * 60;

const PHOTO_ORDER = [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] as const;

// ── the branch + its published listing ─────────────────────────────────────────────────────────

/** Branch statuses that have a public listing to revise: APPROVED, and SUSPENDED (a suspended branch stays editable). */
export const LISTING_EDITABLE_STATUSES = ['APPROVED', 'SUSPENDED'] as const;

/**
 * Whether a revision may exist for this branch (Ngài, Phase B2 follow-up): status APPROVED or SUSPENDED, and not permanently
 * closed (temporarily closed is fine). Anything else is 409 LISTING_NOT_AVAILABLE; a DRAFT branch (the wizard) is
 * 409 GYM_IS_DRAFT. `anyStatus` skips the check (read-only history).
 */
export function assertListingAvailable(
  gym: { status: string; operationalStatus: string },
  opts: { allowDraft?: boolean; anyStatus?: boolean } = {},
) {
  if (opts.anyStatus) return;
  if (gym.status === 'DRAFT') {
    if (opts.allowDraft) return;
    throw new ListingError(409, 'GYM_IS_DRAFT', 'Chi nhánh còn ở bước nháp. Hãy hoàn tất và gửi duyệt chi nhánh trước khi quản lý tin đăng.');
  }
  if (!(LISTING_EDITABLE_STATUSES as readonly string[]).includes(gym.status) || gym.operationalStatus === 'PERMANENTLY_CLOSED') {
    const why = gym.operationalStatus === 'PERMANENTLY_CLOSED' ? 'đã đóng cửa vĩnh viễn' : 'chưa được duyệt hoặc không còn ở trạng thái được chỉnh sửa tin đăng';
    throw new ListingError(409, 'LISTING_NOT_AVAILABLE', `Chi nhánh ${why} nên chưa thể chỉnh sửa tin đăng.`);
  }
}

/**
 * The branch of an OWNER-side listing request. A branch that is missing and a branch that belongs to somebody else
 * answer the same way (404), so the response cannot be used to find out which branch ids exist (swap test, plan B19).
 * See assertListingAvailable for the status rule.
 */
export async function requireOwnedListingGym(db: Db, gymId: string, ownerId: string, opts: { allowDraft?: boolean; anyStatus?: boolean } = {}) {
  const gym = await db.gym.findUnique({ where: { id: gymId } });
  if (!gym || gym.ownerId !== ownerId) throw new ListingError(404, 'GYM_NOT_FOUND', 'Không tìm thấy chi nhánh');
  assertListingAvailable(gym, opts);
  return gym;
}

export async function requireGymExists(db: Db, gymId: string, opts: { allowDraft?: boolean; anyStatus?: boolean } = {}) {
  const gym = await db.gym.findUnique({ where: { id: gymId } });
  if (!gym) throw new ListingError(404, 'GYM_NOT_FOUND', 'Không tìm thấy chi nhánh');
  assertListingAvailable(gym, opts);
  return gym;
}

/** Row lock on the branch: every apply / admin edit / amenity-resolution for one listing runs one after the other. */
export async function lockGym(db: Db, gymId: string) {
  const rows = await db.$queryRaw<{ id: string; owner_id: string; status: string; listing_version: number }[]>(Prisma.sql`
    SELECT id, owner_id, status::text AS status, listing_version FROM gyms WHERE id = ${gymId} FOR UPDATE`);
  if (!rows[0]) throw new ListingError(404, 'GYM_NOT_FOUND', 'Không tìm thấy chi nhánh');
  return { id: rows[0].id, ownerId: rows[0].owner_id, status: rows[0].status, listingVersion: rows[0].listing_version };
}

type GymRow = Awaited<ReturnType<typeof prisma.gym.findUniqueOrThrow>>;
type PhotoRow = Awaited<ReturnType<typeof prisma.gymPhoto.findMany>>[number];
type GymAmenityWithAmenity = Awaited<ReturnType<typeof prisma.gymAmenity.findMany<{ include: { amenity: true } }>>>[number];

export interface PublishedState {
  gym: GymRow;
  listingVersion: number;
  listingPublishedAt: Date | null;
  payload: GymListingPayload;
  photos: PhotoRow[];
  amenities: GymAmenityWithAmenity[];
}

/** The published listing as a payload (the same shape a revision carries), read on `db`. */
export async function loadPublished(db: Db, gymId: string): Promise<PublishedState> {
  const gym = await db.gym.findUniqueOrThrow({ where: { id: gymId } });
  const [photos, amenities] = await Promise.all([
    db.gymPhoto.findMany({ where: { gymId, status: 'PUBLISHED' }, orderBy: [...PHOTO_ORDER] }),
    db.gymAmenity.findMany({ where: { gymId }, include: { amenity: true }, orderBy: [{ amenity: { sortOrder: 'asc' } }, { amenity: { name: 'asc' } }] }),
  ]);
  const payload: GymListingPayload = {
    description: gym.description && gym.description.trim() ? gym.description : null,
    // The gym's amenity rows, DISABLED ones included: a revision that drops a disabled amenity is a real change.
    amenityIds: amenities.map((a) => a.amenityId),
    proposalIds: [],
    photoIds: photos.map((p) => p.id),
    coverPhotoId: photos.find((p) => p.isCover)?.id ?? null,
  };
  return { gym, listingVersion: gym.listingVersion, listingPublishedAt: gym.listingPublishedAt, payload, photos, amenities };
}

/** Parses a STORED payload (already validated once) back into the typed shape. */
export function parseStoredPayload(raw: unknown): GymListingPayload {
  return gymListingPayloadSchema.parse(raw);
}

// ── payload validation against the database ────────────────────────────────────────────────────

export interface ValidateOptions {
  /** DISABLED amenities that are allowed to stay because they already are on the branch (an admin direct edit that does not touch amenities). */
  tolerateDisabledIds?: ReadonlySet<string>;
  /** Status of the AMENITY_DISABLED refusal: 422 while editing, 409 at submit / apply (a rare race, plan §12.3). */
  disabledStatus?: 409 | 422;
}

/**
 * Validates the references in a payload and returns it normalized:
 *  - at most 20 photos (422 PHOTO_LIMIT), each one belonging to THIS branch and still STAGED/PUBLISHED
 *    (422 PHOTO_NOT_OWNED); the cover is one of them (first photo when none was chosen, null when there is none);
 *  - amenities exist (422 AMENITY_UNKNOWN) and are ACTIVE (AMENITY_DISABLED, with the list);
 *  - proposals are PENDING proposals of THIS branch's owner (422 PROPOSAL_NOT_OWNED).
 * A foreign id and a non-existent id answer the same way, so the response cannot be used to probe other branches.
 */
export async function validateRefs(
  db: Db,
  gym: { id: string; ownerId: string },
  payload: GymListingPayload,
  opts: ValidateOptions = {},
): Promise<GymListingPayload> {
  const photoIds = payload.photoIds;
  if (new Set(photoIds).size !== photoIds.length) {
    throw new ListingError(422, 'PHOTO_DUPLICATE', 'Một ảnh không thể xuất hiện hai lần trong tin đăng.');
  }
  if (photoIds.length > MAX_GYM_PHOTOS) {
    throw new ListingError(422, 'PHOTO_LIMIT', `Tin đăng chỉ có tối đa ${MAX_GYM_PHOTOS} ảnh.`);
  }
  if (photoIds.length > 0) {
    const found = await db.gymPhoto.findMany({
      where: { id: { in: photoIds }, gymId: gym.id, status: { in: ['STAGED', 'PUBLISHED'] } },
      select: { id: true },
    });
    if (found.length !== photoIds.length) {
      throw new ListingError(422, 'PHOTO_NOT_OWNED', 'Có ảnh không thuộc chi nhánh này hoặc không còn khả dụng.');
    }
  }
  let cover = payload.coverPhotoId;
  if (cover !== null && !photoIds.includes(cover)) {
    throw new ListingError(422, 'COVER_NOT_IN_PHOTOS', 'Ảnh bìa phải là một trong các ảnh của tin đăng.');
  }
  if (photoIds.length === 0) cover = null;
  else if (cover === null) cover = photoIds[0];

  if (payload.amenityIds.length + payload.proposalIds.length > MAX_AMENITIES_PER_GYM) {
    throw new ListingError(422, 'AMENITY_LIMIT', `Mỗi chi nhánh có tối đa ${MAX_AMENITIES_PER_GYM} tiện ích.`);
  }
  if (payload.amenityIds.length > 0) {
    const rows = await db.amenity.findMany({ where: { id: { in: payload.amenityIds } }, select: { id: true, name: true, status: true } });
    if (rows.length !== payload.amenityIds.length) {
      throw new ListingError(422, 'AMENITY_UNKNOWN', 'Có tiện ích không có trong danh mục.');
    }
    const disabled = rows.filter((r) => r.status !== 'ACTIVE' && !opts.tolerateDisabledIds?.has(r.id));
    if (disabled.length > 0) {
      throw new ListingError(
        opts.disabledStatus ?? 422,
        'AMENITY_DISABLED',
        `Tiện ích đã ngừng trong danh mục: ${disabled.map((d) => d.name).join(', ')}`,
        { amenities: disabled.map((d) => ({ id: d.id, name: d.name })) },
      );
    }
  }
  if (payload.proposalIds.length > 0) {
    const mine = await db.amenityProposal.findMany({
      where: { id: { in: payload.proposalIds }, ownerUserId: gym.ownerId, status: 'PENDING' },
      select: { id: true },
    });
    if (mine.length !== payload.proposalIds.length) {
      throw new ListingError(422, 'PROPOSAL_NOT_OWNED', 'Có đề xuất tiện ích không phải của bạn hoặc đã được xử lý.');
    }
  }
  return { ...payload, coverPhotoId: cover };
}

export interface SystemAdjustment {
  type: string;
  [key: string]: unknown;
}

/**
 * Drops from a payload everything that no longer exists or is no longer usable (photo gone, amenity disabled, proposal
 * resolved) and says so. Used when a draft is created (from the published listing or from a closed revision), when a
 * draft is rebased, and for the DRAFT that follows a withdraw / request-changes / stale - a draft must never point at a
 * dead id. Photo rows are read FOR SHARE so the cleanup job (FOR UPDATE SKIP LOCKED) cannot remove one underneath us.
 */
export async function filterPayloadForDraft(
  db: Db,
  gym: { id: string; ownerId: string },
  payload: GymListingPayload,
): Promise<{ payload: GymListingPayload; adjustments: SystemAdjustment[] }> {
  const adjustments: SystemAdjustment[] = [];

  // photos
  let photoIds = payload.photoIds;
  if (photoIds.length > 0) {
    const alive = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM gym_photos
       WHERE id IN (${Prisma.join(photoIds)}) AND gym_id = ${gym.id} AND status IN ('STAGED','PUBLISHED')
       ORDER BY id FOR SHARE`);
    const aliveSet = new Set(alive.map((r) => r.id));
    for (const id of photoIds) if (!aliveSet.has(id)) adjustments.push({ type: 'PHOTO_NO_LONGER_AVAILABLE', photoId: id });
    photoIds = photoIds.filter((id) => aliveSet.has(id));
  }
  let cover = payload.coverPhotoId && photoIds.includes(payload.coverPhotoId) ? payload.coverPhotoId : null;
  if (cover === null && photoIds.length > 0) cover = photoIds[0];

  // amenities: unknown ids vanish silently-with-a-note, DISABLED ones are removed with the documented adjustment
  let amenityIds = payload.amenityIds;
  if (amenityIds.length > 0) {
    const rows = await db.amenity.findMany({ where: { id: { in: amenityIds } }, select: { id: true, name: true, status: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    amenityIds = amenityIds.filter((id) => {
      const row = byId.get(id);
      if (!row) {
        adjustments.push({ type: 'AMENITY_NO_LONGER_AVAILABLE', amenityId: id });
        return false;
      }
      if (row.status !== 'ACTIVE') {
        adjustments.push({ type: 'AMENITY_DISABLED_REMOVED', amenityId: row.id, name: row.name });
        return false;
      }
      return true;
    });
  }

  // proposals: PENDING of this owner stay; a decided one is replaced by the amenity it produced
  let proposalIds: string[] = [];
  if (payload.proposalIds.length > 0) {
    const rows = await db.amenityProposal.findMany({
      where: { id: { in: payload.proposalIds }, ownerUserId: gym.ownerId },
      include: { resultingAmenity: { select: { id: true, name: true, status: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const extra = new Set(amenityIds);
    for (const id of payload.proposalIds) {
      const row = byId.get(id);
      if (!row) {
        adjustments.push({ type: 'PROPOSAL_NO_LONGER_AVAILABLE', proposalId: id });
      } else if (row.status === 'PENDING') {
        proposalIds.push(id);
      } else if ((row.status === 'APPROVED' || row.status === 'MERGED') && row.resultingAmenity?.status === 'ACTIVE') {
        if (!extra.has(row.resultingAmenity.id)) {
          extra.add(row.resultingAmenity.id);
          amenityIds = [...amenityIds, row.resultingAmenity.id];
        }
        adjustments.push({ type: 'PROPOSAL_RESOLVED', proposalId: id, name: row.name, amenityId: row.resultingAmenity.id });
      } else {
        adjustments.push({ type: 'PROPOSAL_NO_LONGER_AVAILABLE', proposalId: id, name: row.name });
      }
    }
  }
  return { payload: { ...payload, amenityIds, proposalIds, photoIds, coverPhotoId: cover }, adjustments };
}

// ── writing revisions ──────────────────────────────────────────────────────────────────────────

/**
 * Inserts an open DRAFT unless the branch already has an open revision (the partial unique index decides, atomically).
 * Returns the new id, or null when one already exists. No catching of unique violations.
 */
export async function insertDraft(
  db: Db,
  args: {
    gymId: string;
    payload: GymListingPayload;
    baseVersion: number;
    parentRevisionId?: string | null;
    adjustments?: SystemAdjustment[];
    reviewNote?: string | null;
    ownerNote?: string | null;
  },
): Promise<string | null> {
  const id = randomUUID();
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO gym_listing_revisions
      (id, gym_id, status, source, parent_revision_id, base_version, draft_version, payload, system_adjustments, review_note, owner_note, created_at, updated_at)
    VALUES
      (${id}, ${args.gymId}, 'DRAFT'::"GymListingRevisionStatus", 'OWNER'::"GymListingRevisionSource", ${args.parentRevisionId ?? null}, ${args.baseVersion}, 1,
       ${JSON.stringify(args.payload)}::jsonb, ${JSON.stringify(args.adjustments ?? [])}::jsonb, ${args.reviewNote ?? null}, ${args.ownerNote ?? null}, now(), now())
    ON CONFLICT (gym_id) WHERE status IN ('DRAFT','PENDING') DO NOTHING
    RETURNING id`);
  return rows[0]?.id ?? null;
}

export function closedAtOf(rev: { reviewedAt: Date | null; updatedAt: Date }): Date {
  return rev.reviewedAt ?? rev.updatedAt;
}

export function assertCopyable(rev: { status: string; reviewedAt: Date | null; updatedAt: Date }) {
  if (isOpen(rev.status)) {
    throw new ListingError(409, 'REVISION_NOT_CLOSED', 'Bản sửa này vẫn đang mở, không thể chép.');
  }
  const ageMs = Date.now() - closedAtOf(rev).getTime();
  if (ageMs > COPY_FROM_CLOSED_DAYS * 24 * 3600 * 1000) {
    throw new ListingError(409, 'REVISION_TOO_OLD_TO_COPY', `Chỉ chép được từ bản sửa đã đóng trong ${COPY_FROM_CLOSED_DAYS} ngày gần đây.`);
  }
}

// ── photo views ────────────────────────────────────────────────────────────────────────────────

export interface PhotoView {
  id: string;
  status: string;
  /** Stable /media URL for PUBLISHED, a short presigned GET for STAGED; null when the file cannot be linked. */
  url: string | null;
  expiresAt: string | null;
  isCover: boolean;
  sortOrder: number;
}

/** A photo as the OWNER / ADMIN sees it. RETIRED and DISCARDED photos never get a link. */
export async function toPhotoView(p: { id: string; status: string; s3Key: string | null; isCover: boolean; sortOrder: number }): Promise<PhotoView> {
  if (p.status === 'PUBLISHED') {
    return { id: p.id, status: p.status, url: `/media/gym-photos/${p.id}`, expiresAt: null, isCover: p.isCover, sortOrder: p.sortOrder };
  }
  if (p.status !== 'STAGED' || !p.s3Key) {
    return { id: p.id, status: p.status, url: null, expiresAt: null, isCover: p.isCover, sortOrder: p.sortOrder };
  }
  try {
    const url = await listingPhotoStorage().presignGet({ key: p.s3Key, contentType: 'image/webp', expiresSec: STAGED_URL_TTL_SEC });
    return { id: p.id, status: p.status, url, expiresAt: new Date(Date.now() + STAGED_URL_TTL_SEC * 1000).toISOString(), isCover: p.isCover, sortOrder: p.sortOrder };
  } catch (e) {
    logger.warn({ photoId: p.id, err: (e as Error).message }, '[GymListing] could not presign a staged photo');
    return { id: p.id, status: p.status, url: null, expiresAt: null, isCover: p.isCover, sortOrder: p.sortOrder };
  }
}

// ── DTOs ───────────────────────────────────────────────────────────────────────────────────────

type RevisionRow = Awaited<ReturnType<typeof prisma.gymListingRevision.findUniqueOrThrow>>;

/** A revision as the OWNER sees it (no admin-only columns). */
export function toOwnerRevisionDto(rev: RevisionRow, currentListingVersion: number) {
  return {
    id: rev.id,
    gymId: rev.gymId,
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
    gymId: rev.gymId,
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

// ── audit ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The partner a branch's owner belongs to (PartnerAuditLog / PartnerUploadIntent need one). null for a legacy owner who
 * has no partner record and whose brand is not linked to one either.
 */
export async function resolvePartnerId(db: Db, owner: { ownerId: string; brandId?: string | null }): Promise<string | null> {
  const account = await db.gymPartnerAccount.findUnique({ where: { userId: owner.ownerId }, select: { partnerId: true } });
  if (account) return account.partnerId;
  if (owner.brandId) {
    const partner = await db.gymPartner.findFirst({ where: { brandId: owner.brandId }, select: { id: true } });
    if (partner) return partner.id;
  }
  return null;
}

/**
 * PartnerAuditLog row INSIDE the caller's transaction (a failed audit write rolls the action back). A branch whose owner
 * has no partner record cannot be audited there (the table needs a partnerId): that is logged loudly instead, and the
 * revision row itself (actor, time, payload, previous_snapshot, reason) remains the history.
 */
export async function recordPartnerAudit(
  tx: Prisma.TransactionClient,
  gym: { id: string; ownerId: string; brandId?: string | null },
  params: { actorUserId: string; action: PartnerAuditAction; reason?: string | null; metadata: Record<string, unknown> },
): Promise<void> {
  const partnerId = await resolvePartnerId(tx, gym);
  if (!partnerId) {
    logger.warn({ gymId: gym.id, action: params.action }, '[GymListing] owner has no partner record - PartnerAuditLog row skipped');
    return;
  }
  await partnerAuditService.recordInTx(tx, {
    partnerId,
    actorUserId: params.actorUserId,
    action: params.action,
    reason: params.reason ?? null,
    metadata: { gymId: gym.id, ...params.metadata },
  });
}
