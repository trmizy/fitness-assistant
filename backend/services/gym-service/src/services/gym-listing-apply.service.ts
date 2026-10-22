/**
 * Branch listing management - the apply transaction and the ADMIN side (plan §1 B8-B10, B22, §3, §12.3, §12.4).
 *
 * `applyGymListingRevisionTx` is the ONE place that writes the public side of a branch's listing: the description,
 * the `gym_amenities` set (then the `gyms.facilities` mirror through syncFacilitiesMirrorTx), and the photos. It runs
 * inside the caller's transaction, after taking row locks on the branch and its photos, so every apply for one branch
 * is serial and the photo / cover / sort_order rules (B5, B6) hold.
 *
 * LOCK ORDER, everywhere: open revision row -> gym row -> photo rows. The amenity-decision flow (gym-amenity-catalog
 * .service.ts) also takes revisions before gyms, and the photo delete takes the revision before the photo, so two
 * of these can never wait for each other in a cycle.
 *
 * Every write to `gyms` happens in a transaction that declared itself an event-aware writer (withCompatWriter).
 */
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { withCompatWriter } from '../repositories/compat-writer';
import { syncFacilitiesMirrorTx } from './gym-amenity.service';
import { diffPayloads, type FieldChange } from './gym-listing-diff';
import { buildPreview } from './gym-listing.service';
import { sendListingNotices, type ListingNotice } from './gym-listing-notify';
import { listingPhotoStorage } from './listing-photo-storage';
import {
  ListingError,
  MAX_GYM_PHOTOS,
  type GymListingPayload,
} from './gym-listing.schemas';
import {
  assertListingAvailable,
  filterPayloadForDraft,
  insertDraft,
  isOpen,
  loadPublished,
  lockGym,
  parseStoredPayload,
  recordPartnerAudit,
  requireGymExists,
  toHistoryItem,
  toPhotoView,
  validateRefs,
  type Db,
  type SystemAdjustment,
} from './gym-listing.helpers';
import { logger } from '@gym-coach/shared';

const TX = { maxWait: 10_000, timeout: 30_000 };

export interface PreviousSnapshot {
  listingVersion: number;
  listingPublishedAt: string | null;
  payload: GymListingPayload;
}

const gymLabel = (g: { name: string; approvedName: string | null }) => g.approvedName ?? g.name;

/** Locks the branch's open revision (if any) FIRST - the lock order that keeps every listing path deadlock-free. */
async function lockOpenRevision(tx: Db, gymId: string) {
  return tx.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`
    SELECT id, status::text AS status FROM gym_listing_revisions WHERE gym_id = ${gymId} AND status IN ('DRAFT','PENDING') ORDER BY id FOR UPDATE`);
}

// ═══ the apply transaction ═════════════════════════════════════════════════════════════════════

export interface ApplyArgs {
  gymId: string;
  payload: GymListingPayload;
  actorUserId: string;
  source: 'OWNER' | 'ADMIN_DIRECT';
  reason?: string | null;
  /** DISABLED amenities that may stay because they already are on the branch (a direct edit that does not touch them). */
  tolerateDisabledIds?: ReadonlySet<string>;
  /**
   * Performs the revision's own state change, INSIDE this transaction and after the previous public state has been
   * captured: for an approval it is the conditional UPDATE PENDING -> APPROVED (0 rows = somebody decided first),
   * for an admin edit it is the INSERT of the APPROVED ADMIN_DIRECT revision. `previous_snapshot` has to go in with
   * that write - once the row is APPROVED the immutability trigger forbids touching it again.
   */
  close: (ctx: { previousSnapshot: PreviousSnapshot }) => Promise<{ id: string }>;
}

export interface ApplyResult {
  revisionId: string;
  listingVersion: number;
  changes: FieldChange[];
  /** Photos that stopped being public in this apply (their files stay for 90 days, unless purged). */
  retiredPhotos: Array<{ id: string; s3Key: string | null }>;
}

export async function applyGymListingRevisionTx(tx: Db, args: ApplyArgs): Promise<ApplyResult> {
  const { gymId, actorUserId } = args;
  await withCompatWriter(tx);

  // 1. locks: the branch first (the caller already holds the open revision), then every live photo row, in id order
  const locked = await lockGym(tx, gymId);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM gym_photos WHERE gym_id = ${gymId} AND status IN ('STAGED','PUBLISHED') ORDER BY id FOR UPDATE`);

  // 2. what is public right now (read AFTER the locks), and the payload checked against exactly that state
  const published = await loadPublished(tx, gymId);
  // a revision can only be applied to a branch that still has a listing to revise (it may have been closed for good meanwhile)
  assertListingAvailable(published.gym);
  let payload: GymListingPayload;
  try {
    payload = await validateRefs(tx, published.gym, args.payload, { tolerateDisabledIds: args.tolerateDisabledIds, disabledStatus: 409 });
  } catch (e) {
    if (e instanceof ListingError && e.status === 422) {
      throw new ListingError(409, 'REVISION_INVALID', `Bản sửa không còn hợp lệ: ${e.message}`, { cause: e.code });
    }
    throw e;
  }
  // every listing keeps at least one amenity (proposals have been resolved into catalogue ids by now)
  if (payload.amenityIds.length === 0) {
    throw new ListingError(422, 'AMENITIES_REQUIRED', 'Tin đăng phải có ít nhất một tiện ích.');
  }
  const changes = diffPayloads(published.payload, payload);
  const previousSnapshot: PreviousSnapshot = {
    listingVersion: locked.listingVersion,
    listingPublishedAt: published.listingPublishedAt ? published.listingPublishedAt.toISOString() : null,
    payload: published.payload,
  };

  // 3. the revision's own transition (conditional UPDATE / INSERT) - before any public write
  const closed = await args.close({ previousSnapshot });

  // 4. amenities: the branch's set becomes exactly the payload's (catalogue ids only), then the legacy mirror follows
  const wanted = new Set(payload.amenityIds);
  const have = new Set(published.amenities.map((a) => a.amenityId));
  await tx.gymAmenity.deleteMany({ where: { gymId, amenityId: { notIn: [...wanted] } } });
  const toAdd = [...wanted].filter((id) => !have.has(id));
  if (toAdd.length > 0) await tx.gymAmenity.createMany({ data: toAdd.map((amenityId) => ({ gymId, amenityId })), skipDuplicates: true });
  await syncFacilitiesMirrorTx(tx, gymId);

  // 5. photos: payload ids -> PUBLISHED with sort_order 0..n-1 and ONE cover, everything else public -> RETIRED
  const now = new Date();
  const nextIds = payload.photoIds;
  const retiredPhotos = published.photos.filter((ph) => !nextIds.includes(ph.id)).map((ph) => ({ id: ph.id, s3Key: ph.s3Key }));
  await tx.gymPhoto.updateMany({ where: { gymId, isCover: true }, data: { isCover: false } });
  if (retiredPhotos.length > 0) {
    await tx.gymPhoto.updateMany({
      where: { gymId, status: 'PUBLISHED', id: { notIn: nextIds } },
      data: { status: 'RETIRED', retiredAt: now, isCover: false },
    });
  }
  for (let i = 0; i < nextIds.length; i++) {
    await tx.gymPhoto.update({
      where: { id: nextIds[i] },
      data: { status: 'PUBLISHED', sortOrder: i, isCover: nextIds[i] === payload.coverPhotoId, retiredAt: null },
    });
  }
  const publicCount = await tx.gymPhoto.count({ where: { gymId, status: 'PUBLISHED' } });
  if (publicCount > MAX_GYM_PHOTOS) {
    throw new ListingError(422, 'PHOTO_LIMIT', `Tin đăng chỉ có tối đa ${MAX_GYM_PHOTOS} ảnh.`);
  }

  // 6. description + version
  const updated = await tx.gym.update({
    where: { id: gymId },
    data: { description: payload.description, listingVersion: { increment: 1 }, listingPublishedAt: now },
    select: { listingVersion: true },
  });

  // 7. audit (PartnerAuditLog, same transaction)
  await recordPartnerAudit(tx, published.gym, {
    actorUserId,
    action: args.source === 'ADMIN_DIRECT' ? 'LISTING_ADMIN_EDITED' : 'LISTING_APPROVED',
    reason: args.reason ?? null,
    metadata: {
      revisionId: closed.id,
      source: args.source,
      fromVersion: locked.listingVersion,
      toVersion: updated.listingVersion,
      changes,
    },
  });

  return { revisionId: closed.id, listingVersion: updated.listingVersion, changes, retiredPhotos };
}

// ═══ moving an open revision to a closed state ═════════════════════════════════════════════════

interface StaleOutcome {
  staleRevisionId: string;
  draftId: string | null;
  notice: ListingNotice;
}

/** PENDING -> STALE plus a rebased DRAFT that keeps the owner's work (the public listing moved under it). */
async function staleAndRebaseTx(
  tx: Db,
  gym: { id: string; ownerId: string; name: string; approvedName: string | null },
  pendingId: string,
  newBaseVersion: number,
  note: string,
): Promise<StaleOutcome | null> {
  const pending = await tx.gymListingRevision.findFirst({ where: { id: pendingId, gymId: gym.id, status: 'PENDING' } });
  if (!pending) return null;
  const res = await tx.gymListingRevision.updateMany({
    where: { id: pendingId, status: 'PENDING' },
    data: { status: 'STALE', reviewedAt: new Date(), reviewNote: note },
  });
  if (res.count === 0) return null;
  const filtered = await filterPayloadForDraft(tx, gym, parseStoredPayload(pending.payload));
  const adjustments: SystemAdjustment[] = [{ type: 'REBASED_AFTER_ADMIN_EDIT', fromRevisionId: pendingId }, ...filtered.adjustments];
  const draftId = await insertDraft(tx, {
    gymId: gym.id,
    payload: filtered.payload,
    baseVersion: newBaseVersion,
    parentRevisionId: pendingId,
    adjustments,
    ownerNote: pending.ownerNote,
  });
  return {
    staleRevisionId: pendingId,
    draftId,
    notice: {
      userId: gym.ownerId,
      gymId: gym.id,
      eventType: 'GYM_LISTING_INVALIDATED',
      text: `Quản trị viên vừa cập nhật tin đăng của chi nhánh ${gymLabel(gym)}. Hãy xem lại bản sửa và gửi lại.`,
    },
  };
}

/**
 * Turns the amenity part of a PENDING revision into what can actually be applied, or says why it cannot:
 *  - a proposal still PENDING            -> 409 CUSTOM_AMENITY_PENDING (decide the proposal first);
 *  - a proposal APPROVED / MERGED        -> replaced by the amenity it produced;
 *  - a proposal REJECTED / CANCELLED     -> 409 AMENITY_PROPOSAL_DEAD unless `dropRejectedAmenities`;
 *  - an amenity DISABLED in the meantime -> 409 AMENITY_DISABLED unless `dropDisabledAmenities`.
 * Everything dropped is written to `system_adjustments` and the owner is told.
 */
async function resolveForApproval(
  tx: Db,
  gym: { id: string; ownerId: string },
  payload: GymListingPayload,
  opts: { dropRejectedAmenities: boolean; dropDisabledAmenities: boolean },
): Promise<{ payload: GymListingPayload; adjustments: SystemAdjustment[] }> {
  const adjustments: SystemAdjustment[] = [];
  let amenityIds = [...payload.amenityIds];

  if (payload.proposalIds.length > 0) {
    const rows = await tx.amenityProposal.findMany({ where: { id: { in: payload.proposalIds }, ownerUserId: gym.ownerId } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const pending = rows.filter((r) => r.status === 'PENDING');
    if (pending.length > 0) {
      throw new ListingError(409, 'CUSTOM_AMENITY_PENDING', 'Bản sửa còn tiện ích tùy chỉnh chờ duyệt. Hãy xử lý các đề xuất tiện ích trước.', {
        proposals: pending.map((p) => ({ id: p.id, name: p.name })),
      });
    }
    const dead: Array<{ id: string; name?: string }> = [];
    for (const id of payload.proposalIds) {
      const row = byId.get(id);
      if (row && (row.status === 'APPROVED' || row.status === 'MERGED') && row.resultingAmenityId) {
        if (!amenityIds.includes(row.resultingAmenityId)) amenityIds.push(row.resultingAmenityId);
        adjustments.push({ type: 'PROPOSAL_RESOLVED', proposalId: id, name: row.name, amenityId: row.resultingAmenityId });
      } else {
        dead.push({ id, name: row?.name });
      }
    }
    if (dead.length > 0) {
      if (!opts.dropRejectedAmenities) {
        throw new ListingError(409, 'AMENITY_PROPOSAL_DEAD', 'Bản sửa còn tiện ích đề xuất đã bị từ chối hoặc huỷ. Chọn "Duyệt và bỏ tiện ích bị từ chối" để tiếp tục.', { proposals: dead });
      }
      for (const d of dead) adjustments.push({ type: 'PROPOSAL_REJECTED_REMOVED', proposalId: d.id, ...(d.name ? { name: d.name } : {}) });
    }
  }

  amenityIds = [...new Set(amenityIds)];
  if (amenityIds.length > 0) {
    const rows = await tx.amenity.findMany({ where: { id: { in: amenityIds } }, select: { id: true, name: true, status: true } });
    const disabled = rows.filter((r) => r.status !== 'ACTIVE');
    if (disabled.length > 0) {
      if (!opts.dropDisabledAmenities) {
        throw new ListingError(409, 'AMENITY_DISABLED', `Bản sửa có tiện ích đã ngừng trong danh mục: ${disabled.map((d) => d.name).join(', ')}. Chọn "Duyệt và bỏ tiện ích đã tắt" để tiếp tục.`, {
          amenities: disabled.map((d) => ({ id: d.id, name: d.name })),
        });
      }
      const drop = new Set(disabled.map((d) => d.id));
      amenityIds = amenityIds.filter((id) => !drop.has(id));
      for (const d of disabled) adjustments.push({ type: 'AMENITY_DISABLED_REMOVED', amenityId: d.id, name: d.name });
    }
  }
  return { payload: { ...payload, amenityIds, proposalIds: [] }, adjustments };
}

// ═══ the admin service ═════════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 20;
const REVISION_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'WITHDRAWN', 'STALE'] as const;

export const adminGymListingService = {
  /** GET /admin/listings/gyms?status=&brandId=&gymId=&q=&page= */
  async list(query: { status?: string; brandId?: string; gymId?: string; q?: string; page?: number }) {
    const status = (query.status || 'PENDING').toUpperCase();
    if (!(REVISION_STATUSES as readonly string[]).includes(status)) throw new ListingError(400, 'VALIDATION_FAILED', 'status không hợp lệ');
    const page = Math.max(1, Math.floor(Number(query.page)) || 1);

    const gymFilter: Prisma.GymWhereInput = {};
    if (query.brandId) gymFilter.brandId = query.brandId;
    const q = (query.q ?? '').trim();
    if (q) {
      gymFilter.OR = [
        { id: q },
        { name: { contains: q, mode: 'insensitive' } },
        { approvedName: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { brand: { is: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { approvedName: { contains: q, mode: 'insensitive' } }] } } },
      ];
    }
    const where: Prisma.GymListingRevisionWhereInput = {
      status: status as (typeof REVISION_STATUSES)[number],
      ...(query.gymId ? { gymId: query.gymId } : {}),
      ...(Object.keys(gymFilter).length ? { gym: { is: gymFilter } } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.gymListingRevision.count({ where }),
      prisma.gymListingRevision.findMany({
        where,
        include: { gym: { select: { id: true, name: true, approvedName: true, brandId: true, listingVersion: true, brand: { select: { id: true, name: true, approvedName: true } } } } },
        orderBy: status === 'PENDING' ? [{ submittedAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      items: rows.map((r) => {
        const payload = r.payload as { photoIds?: unknown[]; amenityIds?: unknown[]; proposalIds?: unknown[] } | null;
        return {
          ...toHistoryItem(r, { admin: true }),
          gymName: gymLabel(r.gym),
          brandId: r.gym.brandId,
          brandName: r.gym.brand ? (r.gym.brand.approvedName ?? r.gym.brand.name) : null,
          currentListingVersion: r.gym.listingVersion,
          stale: isOpen(r.status) && r.baseVersion !== r.gym.listingVersion,
          summary: {
            photoCount: payload?.photoIds?.length ?? 0,
            amenityCount: payload?.amenityIds?.length ?? 0,
            proposalCount: payload?.proposalIds?.length ?? 0,
          },
        };
      }),
    };
  },

  /** GET /admin/listings/gyms/revisions/:rid - the revision with its diff against what is public now. */
  async getRevision(revisionId: string) {
    const rev = await prisma.gymListingRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw new ListingError(404, 'REVISION_NOT_FOUND', 'Không tìm thấy bản sửa');
    const published = await loadPublished(prisma, rev.gymId);
    const payload = parseStoredPayload(rev.payload);
    const snapshot = rev.previousSnapshot as unknown as PreviousSnapshot | null;

    const allAmenityIds = [...new Set([...payload.amenityIds, ...published.payload.amenityIds])];
    const [amenities, proposals, photoRows] = await Promise.all([
      allAmenityIds.length ? prisma.amenity.findMany({ where: { id: { in: allAmenityIds } } }) : Promise.resolve([]),
      payload.proposalIds.length ? prisma.amenityProposal.findMany({ where: { id: { in: payload.proposalIds } } }) : Promise.resolve([]),
      prisma.gymPhoto.findMany({
        where: { gymId: rev.gymId, id: { in: [...new Set([...payload.photoIds, ...published.payload.photoIds])] } },
      }),
    ]);
    const disabledInPayload = amenities.filter((a) => payload.amenityIds.includes(a.id) && a.status !== 'ACTIVE');
    const pendingInPayload = proposals.filter((p) => p.status === 'PENDING');
    return {
      revision: {
        ...toHistoryItem(rev, { admin: true }),
        draftVersion: rev.draftVersion,
        payload,
        previousSnapshot: rev.previousSnapshot,
        ownerNote: rev.ownerNote,
      },
      gym: {
        id: published.gym.id,
        name: gymLabel(published.gym),
        status: published.gym.status,
        operationalStatus: published.gym.operationalStatus,
        brandId: published.gym.brandId,
        ownerId: published.gym.ownerId,
        listingVersion: published.listingVersion,
        listingPublishedAt: published.listingPublishedAt,
      },
      stale: isOpen(rev.status) && rev.baseVersion !== published.listingVersion,
      published: published.payload,
      changes: diffPayloads(published.payload, payload),
      // For a revision that was applied: what it changed at the moment it went live.
      changesAtDecision: snapshot?.payload ? diffPayloads(snapshot.payload, payload) : null,
      amenities: amenities.map((a) => ({ id: a.id, slug: a.slug, name: a.name, category: a.category, iconKey: a.iconKey, status: a.status, source: a.source })),
      proposals: proposals.map((p) => ({ id: p.id, name: p.name, kind: p.kind, suggestedCategory: p.suggestedCategory, status: p.status, note: p.note, targetAmenityId: p.targetAmenityId, resultingAmenityId: p.resultingAmenityId })),
      flags: {
        hasDisabledAmenity: disabledInPayload.length > 0,
        disabledAmenities: disabledInPayload.map((a) => ({ id: a.id, name: a.name })),
        hasPendingProposal: pendingInPayload.length > 0,
        pendingProposals: pendingInPayload.map((p) => ({ id: p.id, name: p.name })),
      },
      photos: await Promise.all(photoRows.map(toPhotoView)),
    };
  },

  /** GET /admin/listings/gyms/revisions/:rid/preview */
  async previewRevision(revisionId: string) {
    const rev = await prisma.gymListingRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw new ListingError(404, 'REVISION_NOT_FOUND', 'Không tìm thấy bản sửa');
    return buildPreview(rev, 'ADMIN');
  },

  /** POST .../revisions/:rid/approve */
  async approve(revisionId: string, adminId: string, opts: { note?: string; dropRejectedAmenities?: boolean; dropDisabledAmenities?: boolean } = {}) {
    const out = await prisma.$transaction(async (tx) => {
      const first = await tx.gymListingRevision.findUnique({ where: { id: revisionId } });
      if (!first) throw new ListingError(404, 'REVISION_NOT_FOUND', 'Không tìm thấy bản sửa');
      // lock order: revision -> gym. A second approval waits here and then finds the revision already decided.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM gym_listing_revisions WHERE id = ${revisionId} FOR UPDATE`);
      const locked = await lockGym(tx, first.gymId);
      const rev = await tx.gymListingRevision.findUniqueOrThrow({ where: { id: revisionId } });
      if (rev.status !== 'PENDING') {
        throw new ListingError(409, 'ALREADY_DECIDED', 'Bản sửa này đã được xử lý.', { status: rev.status });
      }
      const gym = await tx.gym.findUniqueOrThrow({ where: { id: rev.gymId } });
      if (rev.baseVersion !== locked.listingVersion) {
        // The public listing moved after this was submitted (an admin edit normally stales it eagerly; this is the net).
        const stale = await staleAndRebaseTx(tx, gym, rev.id, locked.listingVersion, 'Tin đăng công khai đã thay đổi sau khi bản sửa được gửi.');
        return { stale: true as const, notices: stale ? [stale.notice] : [] };
      }
      const resolved = await resolveForApproval(tx, gym, parseStoredPayload(rev.payload), {
        dropRejectedAmenities: opts.dropRejectedAmenities === true,
        dropDisabledAmenities: opts.dropDisabledAmenities === true,
      });
      const previousAdjustments = Array.isArray(rev.systemAdjustments) ? (rev.systemAdjustments as unknown[]) : [];
      const applied = await applyGymListingRevisionTx(tx, {
        gymId: rev.gymId,
        payload: resolved.payload,
        actorUserId: adminId,
        source: 'OWNER',
        close: async ({ previousSnapshot }) => {
          const res = await tx.gymListingRevision.updateMany({
            where: { id: rev.id, status: 'PENDING' },
            data: {
              status: 'APPROVED',
              reviewedBy: adminId,
              reviewedAt: new Date(),
              reviewNote: opts.note ?? null,
              previousSnapshot: previousSnapshot as unknown as Prisma.InputJsonValue,
              // The row keeps what actually went live, and says what the server changed on the way.
              payload: resolved.payload as unknown as Prisma.InputJsonValue,
              systemAdjustments: [...previousAdjustments, ...resolved.adjustments] as unknown as Prisma.InputJsonValue,
            },
          });
          if (res.count === 0) throw new ListingError(409, 'ALREADY_DECIDED', 'Bản sửa này đã được xử lý.');
          return { id: rev.id };
        },
      });
      const notices: ListingNotice[] = [
        {
          userId: gym.ownerId,
          gymId: gym.id,
          eventType: 'GYM_LISTING_APPROVED',
          text:
            resolved.adjustments.length > 0
              ? `Bản sửa tin đăng của chi nhánh ${gymLabel(gym)} đã được duyệt (có điều chỉnh: ${resolved.adjustments.length} mục).`
              : `Bản sửa tin đăng của chi nhánh ${gymLabel(gym)} đã được duyệt và hiển thị với khách hàng.`,
        },
      ];
      return { stale: false as const, applied, notices, adjustments: resolved.adjustments };
    }, TX);

    await sendListingNotices(out.notices);
    if (out.stale) {
      throw new ListingError(409, 'LISTING_STALE', 'Tin đăng công khai đã thay đổi sau khi bản sửa được gửi. Bản sửa đã được chuyển thành bản nháp mới cho chủ chi nhánh.');
    }
    return { approved: true, revisionId, listingVersion: out.applied.listingVersion, changes: out.applied.changes, systemAdjustments: out.adjustments };
  },

  /** POST .../revisions/:rid/reject  (note required) */
  async reject(revisionId: string, adminId: string, note: string) {
    const notices = await prisma.$transaction(async (tx) => {
      const rev = await tx.gymListingRevision.findUnique({ where: { id: revisionId }, include: { gym: true } });
      if (!rev) throw new ListingError(404, 'REVISION_NOT_FOUND', 'Không tìm thấy bản sửa');
      const res = await tx.gymListingRevision.updateMany({
        where: { id: revisionId, status: 'PENDING' },
        data: { status: 'REJECTED', reviewedBy: adminId, reviewedAt: new Date(), reviewNote: note },
      });
      if (res.count === 0) {
        throw new ListingError(409, 'ALREADY_DECIDED', 'Bản sửa này đã được xử lý.', { status: (await tx.gymListingRevision.findUnique({ where: { id: revisionId } }))?.status });
      }
      await recordPartnerAudit(tx, rev.gym, { actorUserId: adminId, action: 'LISTING_REJECTED', reason: note, metadata: { revisionId } });
      return [{ userId: rev.gym.ownerId, gymId: rev.gymId, eventType: 'GYM_LISTING_REJECTED', text: `Bản sửa tin đăng của chi nhánh ${gymLabel(rev.gym)} bị từ chối: ${note}` } satisfies ListingNotice];
    }, TX);
    await sendListingNotices(notices);
    return { rejected: true, revisionId };
  },

  /** POST .../revisions/:rid/request-changes  (note required) - CHANGES_REQUESTED + a DRAFT child carrying the note. */
  async requestChanges(revisionId: string, adminId: string, note: string) {
    const out = await prisma.$transaction(async (tx) => {
      const rev = await tx.gymListingRevision.findUnique({ where: { id: revisionId }, include: { gym: true } });
      if (!rev) throw new ListingError(404, 'REVISION_NOT_FOUND', 'Không tìm thấy bản sửa');
      const res = await tx.gymListingRevision.updateMany({
        where: { id: revisionId, status: 'PENDING' },
        data: { status: 'CHANGES_REQUESTED', reviewedBy: adminId, reviewedAt: new Date(), reviewNote: note },
      });
      if (res.count === 0) {
        throw new ListingError(409, 'ALREADY_DECIDED', 'Bản sửa này đã được xử lý.', { status: (await tx.gymListingRevision.findUnique({ where: { id: revisionId } }))?.status });
      }
      const filtered = await filterPayloadForDraft(tx, rev.gym, parseStoredPayload(rev.payload));
      const lv = (await tx.gym.findUniqueOrThrow({ where: { id: rev.gymId }, select: { listingVersion: true } })).listingVersion;
      const draftId = await insertDraft(tx, {
        gymId: rev.gymId,
        payload: filtered.payload,
        baseVersion: lv,
        parentRevisionId: rev.id,
        adjustments: filtered.adjustments,
        reviewNote: note,
        ownerNote: rev.ownerNote,
      });
      await recordPartnerAudit(tx, rev.gym, { actorUserId: adminId, action: 'LISTING_CHANGES_REQUESTED', reason: note, metadata: { revisionId } });
      const notice: ListingNotice = {
        userId: rev.gym.ownerId,
        gymId: rev.gymId,
        eventType: 'GYM_LISTING_CHANGES_REQUESTED',
        text: `Quản trị viên yêu cầu bạn chỉnh sửa tin đăng của chi nhánh ${gymLabel(rev.gym)}: ${note}`,
      };
      return { draftId, notices: [notice] };
    }, TX);
    await sendListingNotices(out.notices);
    return { changesRequested: true, revisionId, draftRevisionId: out.draftId };
  },

  /** POST /admin/listings/gyms/:gymId/direct-edit */
  async directEdit(adminId: string, gymId: string, spec: DirectEditSpec) {
    const out = await prisma.$transaction((tx) => directEditTx(tx, adminId, gymId, spec), TX);
    await sendListingNotices(out.notices);
    return {
      revisionId: out.revisionId,
      listingVersion: out.listingVersion,
      changes: out.changes,
      invalidatedRevisionId: out.invalidatedRevisionId,
      rebasedDraftRevisionId: out.rebasedDraftId,
    };
  },

  /**
   * POST /admin/listings/gyms/:gymId/photos/:photoId/retire {reason, purge?}
   * A retire is an ADMIN_DIRECT revision whose photo list lacks the photo (so the audit, version bump and invalidation
   * of any pending revision are the same as for every other admin edit). `purge` also deletes the file at once - a
   * signed link handed out earlier then dies immediately instead of after its 10 minutes.
   */
  async retirePhoto(adminId: string, gymId: string, photoId: string, body: { reason: string; purge?: boolean }) {
    const out = await prisma.$transaction(async (tx) => {
      const photo = await tx.gymPhoto.findFirst({ where: { id: photoId, gymId, status: 'PUBLISHED' } });
      if (!photo) throw new ListingError(404, 'PHOTO_NOT_FOUND', 'Không tìm thấy ảnh đang công khai này');
      const current = await tx.gymPhoto.findMany({
        where: { gymId, status: 'PUBLISHED' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      return directEditTx(tx, adminId, gymId, {
        photoIds: current.map((c) => c.id).filter((id) => id !== photoId),
        reason: body.reason,
        expectedListingVersion: null,
      });
    }, TX);
    await sendListingNotices(out.notices);
    let purged = false;
    if (body.purge) {
      const doomed = out.retiredPhotos.find((p) => p.id === photoId);
      if (doomed?.s3Key) {
        try {
          await listingPhotoStorage().deleteObject(doomed.s3Key);
          purged = true;
        } catch (e) {
          // The photo is already retired (no longer served); a leftover file is picked up by the 90-day sweep.
          logger.warn({ photoId, err: (e as Error).message }, '[GymListing] purge: could not delete the file');
        }
      }
    }
    return { retired: true, photoId, purged, listingVersion: out.listingVersion, revisionId: out.revisionId };
  },

  /**
   * GET /admin/listings/gyms/:gymId - the CURRENT published listing of one branch, with or without any revision
   * (what the admin's "Sửa trực tiếp" starts from, plus the `listingVersion` the edit must quote).
   * 404 for an unknown branch; 409 GYM_IS_DRAFT / LISTING_NOT_AVAILABLE for a branch that is not APPROVED / SUSPENDED
   * or is permanently closed (same rule as every other listing route: assertListingAvailable).
   */
  async getPublished(gymId: string) {
    await requireGymExists(prisma, gymId);
    const published = await loadPublished(prisma, gymId);
    const [photos, open, brand] = await Promise.all([
      Promise.all(published.photos.map(toPhotoView)),
      prisma.gymListingRevision.findFirst({ where: { gymId, status: { in: ['DRAFT', 'PENDING'] } }, select: { id: true, status: true } }),
      published.gym.brandId ? prisma.gymBrand.findUnique({ where: { id: published.gym.brandId }, select: { name: true, approvedName: true } }) : Promise.resolve(null),
    ]);
    return {
      gym: {
        id: published.gym.id,
        name: gymLabel(published.gym),
        brandName: brand ? (brand.approvedName ?? brand.name) : null,
        listingVersion: published.listingVersion,
        listingPublishedAt: published.listingPublishedAt,
        status: published.gym.status,
        operationalStatus: published.gym.operationalStatus,
      },
      published: {
        description: published.payload.description,
        amenityIds: published.payload.amenityIds,
        photoIds: published.payload.photoIds,
        coverPhotoId: published.payload.coverPhotoId,
      },
      // Custom ones included, DISABLED ones too (status says which): the dialog keeps a disabled one removable.
      amenities: published.amenities.map((a) => ({
        id: a.amenity.id,
        slug: a.amenity.slug,
        name: a.amenity.name,
        category: a.amenity.category,
        iconKey: a.amenity.iconKey,
        status: a.amenity.status,
        source: a.amenity.source,
      })),
      photos,
      openRevision: open ? { id: open.id, status: open.status } : null,
    };
  },

  /** GET /admin/listings/gyms/:gymId/history */
  async history(gymId: string, page = 1) {
    await requireGymExists(prisma, gymId, { anyStatus: true });
    const take = 50;
    const [revisions, audit] = await Promise.all([
      prisma.gymListingRevision.findMany({ where: { gymId }, orderBy: { createdAt: 'desc' }, skip: (Math.max(1, page) - 1) * take, take }),
      prisma.partnerAuditLog.findMany({
        where: { metadata: { path: ['gymId'], equals: gymId } },
        orderBy: { createdAt: 'desc' },
        take,
        // Explicit select: ipAddress/userAgent are personal data and never go to the admin UI.
        select: { id: true, partnerId: true, actorUserId: true, action: true, targetAccountId: true, reason: true, metadata: true, createdAt: true },
      }),
    ]);
    return { revisions: revisions.map((r) => toHistoryItem(r, { admin: true })), audit };
  },
};

// ═══ admin direct edit ═════════════════════════════════════════════════════════════════════════

export interface DirectEditSpec {
  description?: string | null;
  amenityIds?: string[];
  photoIds?: string[];
  coverPhotoId?: string | null;
  reason: string;
  /** null = "whatever is current" (the photo retire, and PATCH /admin/gyms/:id with an optional version). */
  expectedListingVersion: number | null;
}

export async function directEditTx(tx: Db, adminId: string, gymId: string, spec: DirectEditSpec) {
  await requireGymExists(tx, gymId);
  // lock order: open revision -> gym
  await lockOpenRevision(tx, gymId);
  const locked = await lockGym(tx, gymId);
  if (spec.expectedListingVersion !== null && spec.expectedListingVersion !== locked.listingVersion) {
    throw new ListingError(409, 'LISTING_STALE', 'Tin đăng đã thay đổi từ khi bạn mở. Hãy tải lại rồi sửa tiếp.', { listingVersion: locked.listingVersion });
  }
  const published = await loadPublished(tx, gymId);

  const photoIds = spec.photoIds ?? published.payload.photoIds;
  const wantedCover = spec.coverPhotoId !== undefined ? spec.coverPhotoId : published.payload.coverPhotoId;
  const next: GymListingPayload = {
    description: spec.description !== undefined ? spec.description : published.payload.description,
    amenityIds: spec.amenityIds ?? published.payload.amenityIds,
    proposalIds: [],
    photoIds,
    coverPhotoId: wantedCover && photoIds.includes(wantedCover) ? wantedCover : null,
  };
  // A DISABLED amenity the branch already has may stay (an edit that does not touch it); a NEW one may not be added.
  const publishedDisabled = new Set(published.amenities.filter((a) => a.amenity.status !== 'ACTIVE').map((a) => a.amenityId));
  const normalized = await validateRefs(tx, published.gym, next, { tolerateDisabledIds: publishedDisabled });
  if (diffPayloads(published.payload, normalized).length === 0) {
    throw new ListingError(422, 'NO_CHANGES', 'Không có thay đổi nào so với tin đăng hiện tại.');
  }

  const pending = await tx.gymListingRevision.findFirst({ where: { gymId, status: 'PENDING' } });
  const applied = await applyGymListingRevisionTx(tx, {
    gymId,
    payload: normalized,
    actorUserId: adminId,
    source: 'ADMIN_DIRECT',
    reason: spec.reason,
    tolerateDisabledIds: publishedDisabled,
    close: async ({ previousSnapshot }) => {
      const row = await tx.gymListingRevision.create({
        data: {
          gymId,
          status: 'APPROVED',
          source: 'ADMIN_DIRECT',
          baseVersion: locked.listingVersion,
          payload: normalized as unknown as Prisma.InputJsonValue,
          previousSnapshot: previousSnapshot as unknown as Prisma.InputJsonValue,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          adminReason: spec.reason,
        },
      });
      return { id: row.id };
    },
  });

  let invalidated: StaleOutcome | null = null;
  if (pending) {
    invalidated = await staleAndRebaseTx(tx, published.gym, pending.id, applied.listingVersion, 'Quản trị viên đã cập nhật trực tiếp tin đăng sau khi bản sửa được gửi.');
  }
  return {
    revisionId: applied.revisionId,
    listingVersion: applied.listingVersion,
    changes: applied.changes,
    retiredPhotos: applied.retiredPhotos,
    invalidatedRevisionId: invalidated?.staleRevisionId ?? null,
    rebasedDraftId: invalidated?.draftId ?? null,
    notices: invalidated ? [invalidated.notice] : [],
  };
}
