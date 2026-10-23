/**
 * Branch listing management - the OWNER side of the revision workflow (plan §1 B7/B8, §12.13). Same state machine as
 * the PT listing (user-service pt-listing.service.ts):
 *
 *            (no open revision)
 *                  | createDraft  (copy of the published listing, or of a closed revision <= 30 days old)
 *                  v
 *      +--> DRAFT ---- saveDraft (draft_version + 1, optimistic) ----+
 *      |      |   \--- discard --> WITHDRAWN
 *      |      | submit (expectedDraftVersion, base_version == listing_version)
 *      |      v
 *      |   PENDING --- withdraw --> WITHDRAWN + a new DRAFT copy (parent_revision_id)
 *      |      |        approve / reject / request-changes / (admin edit -> STALE): gym-listing-apply.service.ts
 *
 * Every transition is a conditional UPDATE on the OLD status (`updateMany ... where status = X`), so two requests
 * racing for the same transition produce exactly one winner and one 409 - never a double submit or double approve.
 * A closed revision is immutable history (a Postgres trigger refuses to change or delete it).
 *
 * The caller's identity is ALWAYS the token's owner principal; `requireOwnedListingGym` answers 404 for a branch that
 * is not theirs (a branch id cannot be probed). Only the OWNER reaches these (route guard requirePartnerOwner).
 */
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { diffPayloads } from './gym-listing-diff';
import { toListingPreviewDto } from './gym-listing-preview';
import {
  ListingError,
  MAX_GYM_PHOTOS,
  MAX_STAGED_PHOTOS,
  type GymListingPayload,
} from './gym-listing.schemas';
import {
  CLOSED_STATUSES,
  assertCopyable,
  filterPayloadForDraft,
  insertDraft,
  isOpen,
  loadPublished,
  parseStoredPayload,
  recordPartnerAudit,
  requireOwnedListingGym,
  toHistoryItem,
  toOwnerRevisionDto,
  toPhotoView,
  validateRefs,
  type Db,
} from './gym-listing.helpers';

const TX = { maxWait: 10_000, timeout: 30_000 };

async function findOpen(gymId: string, db: Db = prisma) {
  return db.gymListingRevision.findFirst({ where: { gymId, status: { in: ['DRAFT', 'PENDING'] } } });
}

function conflictWithRevision(status: number, code: string, message: string, rev: Awaited<ReturnType<typeof findOpen>>, listingVersion: number) {
  return new ListingError(status, code, message, { revision: rev ? toOwnerRevisionDto(rev, listingVersion) : null, listingVersion });
}

async function currentVersion(gymId: string, db: Db = prisma): Promise<number> {
  const g = await db.gym.findUnique({ where: { id: gymId }, select: { listingVersion: true } });
  return g?.listingVersion ?? 0;
}

/** Why a conditional UPDATE found nothing to update: tell the caller which race it lost. */
async function explainLostRace(gymId: string, revisionId: string, expected: { draftVersion?: number; baseVersion?: number }): Promise<never> {
  const now = await prisma.gymListingRevision.findFirst({ where: { id: revisionId, gymId } });
  const lv = await currentVersion(gymId);
  if (!now || !isOpen(now.status)) {
    throw conflictWithRevision(409, 'REVISION_CLOSED', 'Bản sửa này đã được xử lý. Hãy tải lại trang.', null, lv);
  }
  if (now.status === 'PENDING') {
    throw conflictWithRevision(409, 'REVISION_UNDER_REVIEW', 'Bản sửa đang chờ duyệt nên không thể thay đổi. Hãy rút lại bản sửa nếu muốn chỉnh tiếp.', now, lv);
  }
  if (expected.draftVersion !== undefined && now.draftVersion !== expected.draftVersion) {
    throw conflictWithRevision(409, 'DRAFT_STALE', 'Bản nháp đã được thay đổi ở nơi khác. Hãy tải lại bản mới nhất.', now, lv);
  }
  if (expected.baseVersion !== undefined && now.baseVersion !== expected.baseVersion) {
    throw conflictWithRevision(409, 'LISTING_STALE', 'Tin đăng công khai đã thay đổi từ khi bạn bắt đầu sửa. Hãy cập nhật bản nháp theo bản mới.', now, lv);
  }
  throw conflictWithRevision(409, 'REVISION_CONFLICT', 'Không thể thực hiện thao tác lúc này. Vui lòng thử lại.', now, lv);
}

/** Names, categories and status of the amenities / proposals a set of payloads mentions (so a client can label the ids). */
export async function describeRefs(db: Db, ownerId: string, payloads: GymListingPayload[]) {
  const amenityIds = [...new Set(payloads.flatMap((p) => p.amenityIds))];
  const proposalIds = [...new Set(payloads.flatMap((p) => p.proposalIds))];
  const [amenities, proposals] = await Promise.all([
    amenityIds.length ? db.amenity.findMany({ where: { id: { in: amenityIds } } }) : Promise.resolve([]),
    db.amenityProposal.findMany({
      where: { ownerUserId: ownerId, OR: [{ id: { in: proposalIds } }, { status: 'PENDING' }] },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);
  return {
    amenities: amenities.map((a) => ({ id: a.id, slug: a.slug, name: a.name, category: a.category, iconKey: a.iconKey, status: a.status, source: a.source })),
    proposals: proposals.map((p) => ({
      id: p.id,
      gymId: p.gymId,
      kind: p.kind,
      targetAmenityId: p.targetAmenityId,
      name: p.name,
      suggestedCategory: p.suggestedCategory,
      note: p.note,
      status: p.status,
      resultingAmenityId: p.resultingAmenityId,
      rejectReason: p.rejectReason,
      createdAt: p.createdAt,
    })),
  };
}

/** The preview of an open revision for its OWNER or for an ADMIN (plan B14). Presigned links only inside this response. */
export async function buildPreview(
  rev: { id: string; gymId: string; status: string; source: string; payload: unknown; systemAdjustments: unknown },
  viewer: 'OWNER' | 'ADMIN',
) {
  const payload = parseStoredPayload(rev.payload);
  const gym = await prisma.gym.findUnique({ where: { id: rev.gymId } });
  if (!gym) throw new ListingError(404, 'GYM_NOT_FOUND', 'Không tìm thấy chi nhánh');
  const [amenities, proposals, photoRows] = await Promise.all([
    payload.amenityIds.length ? prisma.amenity.findMany({ where: { id: { in: payload.amenityIds } } }) : Promise.resolve([]),
    payload.proposalIds.length ? prisma.amenityProposal.findMany({ where: { id: { in: payload.proposalIds }, ownerUserId: gym.ownerId } }) : Promise.resolve([]),
    payload.photoIds.length
      ? prisma.gymPhoto.findMany({ where: { id: { in: payload.photoIds }, gymId: gym.id, status: { in: ['STAGED', 'PUBLISHED'] } } })
      : Promise.resolve([]),
  ]);
  const photos = await Promise.all(photoRows.map(toPhotoView));
  return toListingPreviewDto({ ...rev, payload }, gym, amenities, proposals, photos, viewer);
}

export const gymListingService = {
  limits: { maxPhotos: MAX_GYM_PHOTOS, maxStagedPhotos: MAX_STAGED_PHOTOS },

  /** GET /owner/gyms/:id/listing */
  async getListing(gymId: string, ownerId: string) {
    const gym = await requireOwnedListingGym(prisma, gymId, ownerId);
    const published = await loadPublished(prisma, gymId);
    const [open, history, photos] = await Promise.all([
      findOpen(gymId),
      prisma.gymListingRevision.findMany({
        where: { gymId, status: { in: [...CLOSED_STATUSES] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.gymPhoto.findMany({
        where: { gymId, status: { in: ['STAGED', 'PUBLISHED'] } },
        orderBy: [{ status: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const refs = await describeRefs(prisma, ownerId, [published.payload, ...(open ? [parseStoredPayload(open.payload)] : [])]);
    return {
      gym: { id: gym.id, name: gym.approvedName ?? gym.name, status: gym.status, operationalStatus: gym.operationalStatus },
      listingVersion: published.listingVersion,
      listingPublishedAt: published.listingPublishedAt,
      published: {
        payload: published.payload,
        photos: published.photos.map((p) => ({ id: p.id, url: `/media/gym-photos/${p.id}`, isCover: p.isCover, sortOrder: p.sortOrder })),
      },
      openRevision: open ? toOwnerRevisionDto(open, published.listingVersion) : null,
      // Every photo the owner can put in a revision (STAGED = uploaded, not public; PUBLISHED = public now), with a URL
      // that works for the viewer: a short presigned link for STAGED ones, the stable /media link for public ones.
      photos: await Promise.all(photos.map(toPhotoView)),
      amenities: refs.amenities,
      proposals: refs.proposals,
      history: history.map((r) => toHistoryItem(r, { admin: false })),
      limits: gymListingService.limits,
    };
  },

  /** POST /owner/gyms/:id/listing/draft */
  async createDraft(gymId: string, ownerId: string, opts: { copyFromRevisionId?: string }) {
    return prisma.$transaction(async (tx) => {
      const gym = await requireOwnedListingGym(tx, gymId, ownerId);
      const published = await loadPublished(tx, gymId);
      const open = await findOpen(gymId, tx);
      if (open) throw conflictWithRevision(409, 'OPEN_REVISION_EXISTS', 'Chi nhánh đang có một bản sửa chưa hoàn tất.', open, published.listingVersion);

      let source: GymListingPayload = published.payload;
      let parentRevisionId: string | null = null;
      if (opts.copyFromRevisionId) {
        const src = await tx.gymListingRevision.findFirst({ where: { id: opts.copyFromRevisionId, gymId } });
        if (!src) throw new ListingError(404, 'REVISION_NOT_FOUND', 'Không tìm thấy bản sửa');
        assertCopyable(src);
        source = parseStoredPayload(src.payload);
        parentRevisionId = src.id;
      }
      // Always filtered: a copy of the published listing drops DISABLED amenities (AMENITY_DISABLED_REMOVED), a copy of
      // a closed revision also drops photos that are gone - a draft never points at a dead id.
      const filtered = await filterPayloadForDraft(tx, gym, source);
      const id = await insertDraft(tx, { gymId, payload: filtered.payload, baseVersion: published.listingVersion, parentRevisionId, adjustments: filtered.adjustments });
      if (!id) {
        throw conflictWithRevision(409, 'OPEN_REVISION_EXISTS', 'Chi nhánh đang có một bản sửa chưa hoàn tất.', await findOpen(gymId, tx), published.listingVersion);
      }
      const rev = await tx.gymListingRevision.findUniqueOrThrow({ where: { id } });
      return { revision: toOwnerRevisionDto(rev, published.listingVersion) };
    }, TX);
  },

  /** PUT /owner/gyms/:id/listing/draft */
  async saveDraft(gymId: string, ownerId: string, body: { expectedDraftVersion: number; payload: GymListingPayload; ownerNote?: string }) {
    const gym = await requireOwnedListingGym(prisma, gymId, ownerId);
    const open = await findOpen(gymId);
    if (!open) throw new ListingError(404, 'NO_OPEN_REVISION', 'Chi nhánh chưa có bản nháp nào. Hãy tạo bản nháp trước.');
    if (open.status === 'PENDING') {
      throw conflictWithRevision(409, 'REVISION_UNDER_REVIEW', 'Bản sửa đang chờ duyệt nên không thể thay đổi. Hãy rút lại bản sửa nếu muốn chỉnh tiếp.', open, await currentVersion(gymId));
    }
    if (open.draftVersion !== body.expectedDraftVersion) {
      throw conflictWithRevision(409, 'DRAFT_STALE', 'Bản nháp đã được thay đổi ở nơi khác. Hãy tải lại bản mới nhất.', open, await currentVersion(gymId));
    }
    const payload = await validateRefs(prisma, gym, body.payload);
    const res = await prisma.gymListingRevision.updateMany({
      where: { id: open.id, gymId, status: 'DRAFT', draftVersion: body.expectedDraftVersion },
      data: {
        payload: payload as unknown as Prisma.InputJsonValue,
        draftVersion: { increment: 1 },
        ...(body.ownerNote !== undefined ? { ownerNote: body.ownerNote } : {}),
      },
    });
    if (res.count === 0) return explainLostRace(gymId, open.id, { draftVersion: body.expectedDraftVersion });
    const rev = await prisma.gymListingRevision.findUniqueOrThrow({ where: { id: open.id } });
    return { revision: toOwnerRevisionDto(rev, await currentVersion(gymId)) };
  },

  /** POST /owner/gyms/:id/listing/submit */
  async submit(gymId: string, ownerId: string, actorUserId: string, body: { expectedDraftVersion: number; ownerNote?: string }) {
    const gym = await requireOwnedListingGym(prisma, gymId, ownerId);
    const published = await loadPublished(prisma, gymId);
    const open = await findOpen(gymId);
    if (!open) throw new ListingError(404, 'NO_OPEN_REVISION', 'Chi nhánh chưa có bản nháp nào để gửi duyệt.');
    if (open.status === 'PENDING') {
      throw conflictWithRevision(409, 'REVISION_UNDER_REVIEW', 'Bản sửa đã được gửi và đang chờ duyệt.', open, published.listingVersion);
    }
    if (open.draftVersion !== body.expectedDraftVersion) {
      throw conflictWithRevision(409, 'DRAFT_STALE', 'Bản nháp đã được thay đổi ở nơi khác. Hãy tải lại bản mới nhất.', open, published.listingVersion);
    }
    if (open.baseVersion !== published.listingVersion) {
      throw conflictWithRevision(409, 'LISTING_STALE', 'Tin đăng công khai đã thay đổi từ khi bạn bắt đầu sửa. Hãy cập nhật bản nháp theo bản mới.', open, published.listingVersion);
    }
    // A rare race (an amenity disabled between the last save and now) is a 409 with the list, not a 422 (plan §12.3).
    const payload = await validateRefs(prisma, gym, parseStoredPayload(open.payload), { disabledStatus: 409 });
    if (payload.amenityIds.length + payload.proposalIds.length === 0) {
      throw new ListingError(422, 'AMENITIES_REQUIRED', 'Tin đăng phải có ít nhất một tiện ích (hoặc một đề xuất tiện ích) trước khi gửi duyệt.');
    }
    const changes = diffPayloads(published.payload, payload);
    if (changes.length === 0) {
      throw new ListingError(422, 'NO_CHANGES', 'Bản sửa không có thay đổi nào so với tin đăng hiện tại.');
    }
    const rev = await prisma.$transaction(async (tx) => {
      const res = await tx.gymListingRevision.updateMany({
        where: { id: open.id, gymId, status: 'DRAFT', draftVersion: body.expectedDraftVersion, baseVersion: published.listingVersion },
        data: {
          status: 'PENDING',
          payload: payload as unknown as Prisma.InputJsonValue,
          submittedAt: new Date(),
          submittedBy: actorUserId,
          ...(body.ownerNote !== undefined ? { ownerNote: body.ownerNote } : {}),
        },
      });
      if (res.count === 0) return null;
      await recordPartnerAudit(tx, gym, {
        actorUserId,
        action: 'LISTING_SUBMITTED',
        metadata: { revisionId: open.id, baseVersion: open.baseVersion, changedFields: changes.map((c) => c.path) },
      });
      return tx.gymListingRevision.findUniqueOrThrow({ where: { id: open.id } });
    }, TX);
    if (!rev) return explainLostRace(gymId, open.id, { draftVersion: body.expectedDraftVersion, baseVersion: published.listingVersion });
    return { revision: toOwnerRevisionDto(rev, published.listingVersion) };
  },

  /** POST /owner/gyms/:id/listing/withdraw - PENDING -> WITHDRAWN, and a fresh DRAFT with the same content. */
  async withdraw(gymId: string, ownerId: string) {
    return prisma.$transaction(async (tx) => {
      const gym = await requireOwnedListingGym(tx, gymId, ownerId);
      const open = await findOpen(gymId, tx);
      const lv = await currentVersion(gymId, tx);
      if (!open) throw new ListingError(404, 'NO_OPEN_REVISION', 'Chi nhánh không có bản sửa nào đang mở.');
      if (open.status !== 'PENDING') {
        throw conflictWithRevision(409, 'REVISION_NOT_PENDING', "Chỉ rút lại được bản sửa đang chờ duyệt. Với bản nháp, hãy dùng 'bỏ nháp'.", open, lv);
      }
      const res = await tx.gymListingRevision.updateMany({ where: { id: open.id, gymId, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
      if (res.count === 0) throw conflictWithRevision(409, 'REVISION_CLOSED', 'Bản sửa này đã được xử lý. Hãy tải lại trang.', null, lv);
      const filtered = await filterPayloadForDraft(tx, gym, parseStoredPayload(open.payload));
      const childId = await insertDraft(tx, {
        gymId,
        payload: filtered.payload,
        baseVersion: open.baseVersion,
        parentRevisionId: open.id,
        adjustments: filtered.adjustments,
        ownerNote: open.ownerNote,
      });
      if (!childId) throw new ListingError(409, 'OPEN_REVISION_EXISTS', 'Không tạo được bản nháp mới. Vui lòng thử lại.');
      const child = await tx.gymListingRevision.findUniqueOrThrow({ where: { id: childId } });
      return { withdrawnRevisionId: open.id, revision: toOwnerRevisionDto(child, lv) };
    }, TX);
  },

  /** POST /owner/gyms/:id/listing/discard - DRAFT -> WITHDRAWN. */
  async discard(gymId: string, ownerId: string) {
    await requireOwnedListingGym(prisma, gymId, ownerId);
    const open = await findOpen(gymId);
    const lv = await currentVersion(gymId);
    if (!open) throw new ListingError(404, 'NO_OPEN_REVISION', 'Chi nhánh không có bản nháp nào để bỏ.');
    if (open.status === 'PENDING') {
      throw conflictWithRevision(409, 'REVISION_UNDER_REVIEW', 'Bản sửa đang chờ duyệt. Hãy rút lại bản sửa trước.', open, lv);
    }
    const res = await prisma.gymListingRevision.updateMany({ where: { id: open.id, gymId, status: 'DRAFT' }, data: { status: 'WITHDRAWN' } });
    if (res.count === 0) return explainLostRace(gymId, open.id, {});
    return { discardedRevisionId: open.id };
  },

  /** POST /owner/gyms/:id/listing/rebase - keep the owner's edits, move the base to the current public version. */
  async rebase(gymId: string, ownerId: string, body: { expectedDraftVersion?: number }) {
    return prisma.$transaction(async (tx) => {
      const gym = await requireOwnedListingGym(tx, gymId, ownerId);
      const open = await findOpen(gymId, tx);
      const lv = await currentVersion(gymId, tx);
      if (!open) throw new ListingError(404, 'NO_OPEN_REVISION', 'Chi nhánh chưa có bản nháp nào.');
      if (open.status === 'PENDING') {
        throw conflictWithRevision(409, 'REVISION_UNDER_REVIEW', 'Bản sửa đang chờ duyệt nên không thể cập nhật.', open, lv);
      }
      if (body.expectedDraftVersion !== undefined && open.draftVersion !== body.expectedDraftVersion) {
        throw conflictWithRevision(409, 'DRAFT_STALE', 'Bản nháp đã được thay đổi ở nơi khác. Hãy tải lại bản mới nhất.', open, lv);
      }
      const filtered = await filterPayloadForDraft(tx, gym, parseStoredPayload(open.payload));
      const previous = Array.isArray(open.systemAdjustments) ? (open.systemAdjustments as unknown[]) : [];
      const res = await tx.gymListingRevision.updateMany({
        where: { id: open.id, status: 'DRAFT', draftVersion: open.draftVersion },
        data: {
          baseVersion: lv,
          payload: filtered.payload as unknown as Prisma.InputJsonValue,
          systemAdjustments: [...previous, ...filtered.adjustments] as unknown as Prisma.InputJsonValue,
          draftVersion: { increment: 1 },
        },
      });
      if (res.count === 0) throw conflictWithRevision(409, 'DRAFT_STALE', 'Bản nháp đã được thay đổi ở nơi khác. Hãy tải lại bản mới nhất.', open, lv);
      const rev = await tx.gymListingRevision.findUniqueOrThrow({ where: { id: open.id } });
      return { revision: toOwnerRevisionDto(rev, lv) };
    }, TX);
  },

  /** GET /owner/gyms/:id/listing/preview - the open revision, rendered like the public listing (owner only). */
  async preview(gymId: string, ownerId: string) {
    await requireOwnedListingGym(prisma, gymId, ownerId);
    const open = await findOpen(gymId);
    if (!open) throw new ListingError(404, 'NO_OPEN_REVISION', 'Chi nhánh chưa có bản nháp nào để xem trước.');
    return buildPreview(open, 'OWNER');
  },
};
