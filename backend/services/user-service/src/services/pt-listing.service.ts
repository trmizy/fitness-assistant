/**
 * PT listing management - the OWNER side of the revision workflow (plan §1 B7/B8, §12.13).
 *
 *            (no open revision)
 *                  | createDraft  (copy of the published listing, or of a closed revision <= 30 days old)
 *                  v
 *      +--> DRAFT ---- saveDraft (draft_version + 1, optimistic) ----+
 *      |      |   \--- discard --> WITHDRAWN
 *      |      | submit (expectedDraftVersion, base_version == listing_version)
 *      |      v
 *      |   PENDING --- withdraw --> WITHDRAWN + a new DRAFT copy (parent_revision_id)
 *      |      |        approve / reject / request-changes / (admin edit -> STALE): pt-listing-apply.service.ts
 *
 * Every transition is a conditional UPDATE on the OLD status (`updateMany ... where status = X`), so two requests
 * racing for the same transition produce exactly one winner and one 409 - never a double submit or double approve.
 * A closed revision is immutable history (a Postgres trigger refuses to change or delete it).
 *
 * The caller's identity is ALWAYS the verified token's user id; no body field names a PT.
 */
import axios from "axios";
import { logger } from "@gym-coach/shared";
import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { diffPayloads } from "./pt-listing-diff";
import {
  ListingError,
  MAX_PACKAGES_PER_PT,
  MAX_PHYSIQUE_PHOTOS,
  MAX_STAGED_PHOTOS,
  type PtListingPayload,
} from "./pt-listing.schemas";
import {
  assertCopyable,
  filterPayloadForDraft,
  insertDraft,
  isOpen,
  loadPublished,
  parseStoredPayload,
  requireApprovedPt,
  toHistoryItem,
  toOwnerRevisionDto,
  validateRefs,
  CLOSED_STATUSES,
} from "./pt-listing.helpers";
import { toOwnerPhotoView } from "./pt-physique-upload.service";

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || "http://chat-service:3005";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

/** Tells the admins' open sessions a revision is waiting. Fire-and-forget, not stored (same as a new PT application). */
export const listingHooks = {
  notifyAdminsSubmitted(revisionId: string, ptUserId: string): void {
    axios
      .post(
        `${CHAT_SERVICE_URL}/internal/push-notification`,
        {
          adminBroadcast: true,
          notification: {
            id: `pt-listing-${revisionId}`,
            text: "Có bản sửa tin đăng PT cần xét duyệt",
            eventType: "PT_LISTING_SUBMITTED",
            entityType: "PT_LISTING",
            entityId: ptUserId,
            link: "/admin/listings",
            unread: true,
            createdAt: new Date().toISOString(),
          },
        },
        { timeout: 3000, headers: { "x-internal-secret": INTERNAL_API_SECRET } },
      )
      .catch((err: unknown) => logger.warn({ err }, "Failed to push admin realtime notification (PT listing)"));
  },
};

const TX = { maxWait: 10_000, timeout: 30_000 };

async function findOpen(ptUserId: string, db: Prisma.TransactionClient = prisma) {
  return db.ptListingRevision.findFirst({ where: { ptUserId, status: { in: ["DRAFT", "PENDING"] } } });
}

function conflictWithRevision(status: number, code: string, message: string, rev: Awaited<ReturnType<typeof findOpen>>, listingVersion: number) {
  return new ListingError(status, code, message, { revision: rev ? toOwnerRevisionDto(rev, listingVersion) : null, listingVersion });
}

async function currentVersion(ptUserId: string): Promise<number> {
  const p = await prisma.userProfile.findUnique({ where: { userId: ptUserId }, select: { listingVersion: true } });
  return p?.listingVersion ?? 0;
}

/** Why a conditional UPDATE found nothing to update: tell the caller which race it lost. */
async function explainLostRace(ptUserId: string, revisionId: string, expected: { draftVersion?: number; baseVersion?: number }): Promise<never> {
  const now = await prisma.ptListingRevision.findFirst({ where: { id: revisionId, ptUserId } });
  const lv = await currentVersion(ptUserId);
  if (!now || !isOpen(now.status)) {
    throw conflictWithRevision(409, "REVISION_CLOSED", "Bản sửa này đã được xử lý. Hãy tải lại trang.", null, lv);
  }
  if (now.status === "PENDING") {
    throw conflictWithRevision(409, "REVISION_UNDER_REVIEW", "Bản sửa đang chờ duyệt nên không thể thay đổi. Hãy rút lại bản sửa nếu muốn chỉnh tiếp.", now, lv);
  }
  if (expected.draftVersion !== undefined && now.draftVersion !== expected.draftVersion) {
    throw conflictWithRevision(409, "DRAFT_STALE", "Bản nháp đã được thay đổi ở nơi khác. Hãy tải lại bản mới nhất.", now, lv);
  }
  if (expected.baseVersion !== undefined && now.baseVersion !== expected.baseVersion) {
    throw conflictWithRevision(409, "LISTING_STALE", "Tin đăng công khai đã thay đổi từ khi bạn bắt đầu sửa. Hãy cập nhật bản nháp theo bản mới.", now, lv);
  }
  throw conflictWithRevision(409, "REVISION_CONFLICT", "Không thể thực hiện thao tác lúc này. Vui lòng thử lại.", now, lv);
}

export const ptListingService = {
  limits: { maxPhotos: MAX_PHYSIQUE_PHOTOS, maxPackages: MAX_PACKAGES_PER_PT, maxStagedPhotos: MAX_STAGED_PHOTOS },

  /** GET /profile/me/listing */
  async getListing(ptUserId: string) {
    const published = await loadPublished(prisma, ptUserId);
    const [open, history, photos] = await Promise.all([
      findOpen(ptUserId),
      prisma.ptListingRevision.findMany({
        where: { ptUserId, status: { in: [...CLOSED_STATUSES] } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.ptPhysiquePhoto.findMany({
        where: { ptUserId, status: { in: ["STAGED", "PUBLISHED"] } },
        orderBy: [{ status: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    return {
      listingVersion: published.listingVersion,
      listingPublishedAt: published.listingPublishedAt,
      published: {
        payload: published.payload,
        packages: published.packages.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          sessionCount: p.sessionCount,
          sessionMode: p.sessionMode,
          sessionDurationMinutes: p.sessionDurationMinutes,
          validityDays: p.validityDays,
          isActive: p.isActive,
          version: p.version,
        })),
        photos: published.photos.map((p) => ({ id: p.id, url: `/media/pt-physique/${p.id}`, isCover: p.isCover, sortOrder: p.sortOrder })),
      },
      openRevision: open ? toOwnerRevisionDto(open, published.listingVersion) : null,
      // Every photo the PT can put in a revision (STAGED = uploaded, not public; PUBLISHED = public now), with a URL
      // that works for the viewer: a short presigned link for STAGED ones, the stable /media link for public ones.
      photos: await Promise.all(photos.map(toOwnerPhotoView)),
      history: history.map((r) => toHistoryItem(r, { admin: false })),
      limits: ptListingService.limits,
    };
  },

  /** POST /profile/me/listing/draft */
  async createDraft(ptUserId: string, opts: { copyFromRevisionId?: string }) {
    return prisma.$transaction(async (tx) => {
      const published = await loadPublished(tx, ptUserId);
      const open = await findOpen(ptUserId, tx);
      if (open) throw conflictWithRevision(409, "OPEN_REVISION_EXISTS", "Bạn đang có một bản sửa chưa hoàn tất.", open, published.listingVersion);

      let payload = published.payload;
      let adjustments: Awaited<ReturnType<typeof filterPayloadForDraft>>["adjustments"] = [];
      let parentRevisionId: string | null = null;
      if (opts.copyFromRevisionId) {
        const src = await tx.ptListingRevision.findFirst({ where: { id: opts.copyFromRevisionId, ptUserId } });
        if (!src) throw new ListingError(404, "REVISION_NOT_FOUND", "Không tìm thấy bản sửa");
        assertCopyable(src);
        const filtered = await filterPayloadForDraft(tx, ptUserId, parseStoredPayload(src.payload));
        payload = filtered.payload;
        adjustments = filtered.adjustments;
        parentRevisionId = src.id;
      }
      const id = await insertDraft(tx, { ptUserId, payload, baseVersion: published.listingVersion, parentRevisionId, adjustments });
      if (!id) {
        throw conflictWithRevision(409, "OPEN_REVISION_EXISTS", "Bạn đang có một bản sửa chưa hoàn tất.", await findOpen(ptUserId, tx), published.listingVersion);
      }
      const rev = await tx.ptListingRevision.findUniqueOrThrow({ where: { id } });
      return { revision: toOwnerRevisionDto(rev, published.listingVersion) };
    }, TX);
  },

  /** PUT /profile/me/listing/draft */
  async saveDraft(ptUserId: string, body: { expectedDraftVersion: number; payload: PtListingPayload; ownerNote?: string }) {
    await requireApprovedPt(prisma, ptUserId);
    const open = await findOpen(ptUserId);
    if (!open) throw new ListingError(404, "NO_OPEN_REVISION", "Bạn chưa có bản nháp nào. Hãy tạo bản nháp trước.");
    if (open.status === "PENDING") {
      throw conflictWithRevision(409, "REVISION_UNDER_REVIEW", "Bản sửa đang chờ duyệt nên không thể thay đổi. Hãy rút lại bản sửa nếu muốn chỉnh tiếp.", open, await currentVersion(ptUserId));
    }
    const payload = await validateRefs(prisma, ptUserId, body.payload);
    const res = await prisma.ptListingRevision.updateMany({
      where: { id: open.id, ptUserId, status: "DRAFT", draftVersion: body.expectedDraftVersion },
      data: {
        payload: payload as unknown as Prisma.InputJsonValue,
        draftVersion: { increment: 1 },
        ...(body.ownerNote !== undefined ? { ownerNote: body.ownerNote } : {}),
      },
    });
    if (res.count === 0) return explainLostRace(ptUserId, open.id, { draftVersion: body.expectedDraftVersion });
    const rev = await prisma.ptListingRevision.findUniqueOrThrow({ where: { id: open.id } });
    return { revision: toOwnerRevisionDto(rev, await currentVersion(ptUserId)) };
  },

  /** POST /profile/me/listing/submit */
  async submit(ptUserId: string, body: { expectedDraftVersion: number; ownerNote?: string }) {
    const published = await loadPublished(prisma, ptUserId);
    const open = await findOpen(ptUserId);
    if (!open) throw new ListingError(404, "NO_OPEN_REVISION", "Bạn chưa có bản nháp nào để gửi duyệt.");
    if (open.status === "PENDING") {
      throw conflictWithRevision(409, "REVISION_UNDER_REVIEW", "Bản sửa đã được gửi và đang chờ duyệt.", open, published.listingVersion);
    }
    if (open.draftVersion !== body.expectedDraftVersion) {
      throw conflictWithRevision(409, "DRAFT_STALE", "Bản nháp đã được thay đổi ở nơi khác. Hãy tải lại bản mới nhất.", open, published.listingVersion);
    }
    if (open.baseVersion !== published.listingVersion) {
      throw conflictWithRevision(409, "LISTING_STALE", "Tin đăng công khai đã thay đổi từ khi bạn bắt đầu sửa. Hãy cập nhật bản nháp theo bản mới.", open, published.listingVersion);
    }
    const payload = await validateRefs(prisma, ptUserId, parseStoredPayload(open.payload));
    if (diffPayloads(published.payload, payload).length === 0) {
      throw new ListingError(422, "NO_CHANGES", "Bản sửa không có thay đổi nào so với tin đăng hiện tại.");
    }
    const res = await prisma.ptListingRevision.updateMany({
      where: { id: open.id, ptUserId, status: "DRAFT", draftVersion: body.expectedDraftVersion, baseVersion: published.listingVersion },
      data: {
        status: "PENDING",
        payload: payload as unknown as Prisma.InputJsonValue,
        submittedAt: new Date(),
        submittedBy: ptUserId,
        ...(body.ownerNote !== undefined ? { ownerNote: body.ownerNote } : {}),
      },
    });
    if (res.count === 0) return explainLostRace(ptUserId, open.id, { draftVersion: body.expectedDraftVersion, baseVersion: published.listingVersion });
    const rev = await prisma.ptListingRevision.findUniqueOrThrow({ where: { id: open.id } });
    listingHooks.notifyAdminsSubmitted(rev.id, ptUserId);
    return { revision: toOwnerRevisionDto(rev, published.listingVersion) };
  },

  /** POST /profile/me/listing/withdraw - PENDING -> WITHDRAWN, and a fresh DRAFT with the same content. */
  async withdraw(ptUserId: string) {
    await requireApprovedPt(prisma, ptUserId);
    return prisma.$transaction(async (tx) => {
      const open = await findOpen(ptUserId, tx);
      const lv = (await tx.userProfile.findUniqueOrThrow({ where: { userId: ptUserId }, select: { listingVersion: true } })).listingVersion;
      if (!open) throw new ListingError(404, "NO_OPEN_REVISION", "Bạn không có bản sửa nào đang mở.");
      if (open.status !== "PENDING") {
        throw conflictWithRevision(409, "REVISION_NOT_PENDING", "Chỉ rút lại được bản sửa đang chờ duyệt. Với bản nháp, hãy dùng 'bỏ nháp'.", open, lv);
      }
      const res = await tx.ptListingRevision.updateMany({ where: { id: open.id, ptUserId, status: "PENDING" }, data: { status: "WITHDRAWN" } });
      if (res.count === 0) throw conflictWithRevision(409, "REVISION_CLOSED", "Bản sửa này đã được xử lý. Hãy tải lại trang.", null, lv);
      const childId = await insertDraft(tx, {
        ptUserId,
        payload: parseStoredPayload(open.payload),
        baseVersion: open.baseVersion,
        parentRevisionId: open.id,
        ownerNote: open.ownerNote,
      });
      if (!childId) throw new ListingError(409, "OPEN_REVISION_EXISTS", "Không tạo được bản nháp mới. Vui lòng thử lại.");
      const child = await tx.ptListingRevision.findUniqueOrThrow({ where: { id: childId } });
      return { withdrawnRevisionId: open.id, revision: toOwnerRevisionDto(child, lv) };
    }, TX);
  },

  /** POST /profile/me/listing/discard - DRAFT -> WITHDRAWN. */
  async discard(ptUserId: string) {
    await requireApprovedPt(prisma, ptUserId);
    const open = await findOpen(ptUserId);
    const lv = await currentVersion(ptUserId);
    if (!open) throw new ListingError(404, "NO_OPEN_REVISION", "Bạn không có bản nháp nào để bỏ.");
    if (open.status === "PENDING") {
      throw conflictWithRevision(409, "REVISION_UNDER_REVIEW", "Bản sửa đang chờ duyệt. Hãy rút lại bản sửa trước.", open, lv);
    }
    const res = await prisma.ptListingRevision.updateMany({ where: { id: open.id, ptUserId, status: "DRAFT" }, data: { status: "WITHDRAWN" } });
    if (res.count === 0) return explainLostRace(ptUserId, open.id, {});
    return { discardedRevisionId: open.id };
  },

  /** POST /profile/me/listing/rebase - keep the owner's edits, move the base to the current public version. */
  async rebase(ptUserId: string, body: { expectedDraftVersion?: number }) {
    await requireApprovedPt(prisma, ptUserId);
    return prisma.$transaction(async (tx) => {
      const open = await findOpen(ptUserId, tx);
      const lv = (await tx.userProfile.findUniqueOrThrow({ where: { userId: ptUserId }, select: { listingVersion: true } })).listingVersion;
      if (!open) throw new ListingError(404, "NO_OPEN_REVISION", "Bạn chưa có bản nháp nào.");
      if (open.status === "PENDING") {
        throw conflictWithRevision(409, "REVISION_UNDER_REVIEW", "Bản sửa đang chờ duyệt nên không thể cập nhật.", open, lv);
      }
      if (body.expectedDraftVersion !== undefined && open.draftVersion !== body.expectedDraftVersion) {
        throw conflictWithRevision(409, "DRAFT_STALE", "Bản nháp đã được thay đổi ở nơi khác. Hãy tải lại bản mới nhất.", open, lv);
      }
      const filtered = await filterPayloadForDraft(tx, ptUserId, parseStoredPayload(open.payload));
      const previous = Array.isArray(open.systemAdjustments) ? (open.systemAdjustments as unknown[]) : [];
      const res = await tx.ptListingRevision.updateMany({
        where: { id: open.id, status: "DRAFT", draftVersion: open.draftVersion },
        data: {
          baseVersion: lv,
          payload: filtered.payload as unknown as Prisma.InputJsonValue,
          systemAdjustments: [...previous, ...filtered.adjustments] as unknown as Prisma.InputJsonValue,
          draftVersion: { increment: 1 },
        },
      });
      if (res.count === 0) throw conflictWithRevision(409, "DRAFT_STALE", "Bản nháp đã được thay đổi ở nơi khác. Hãy tải lại bản mới nhất.", open, lv);
      const rev = await tx.ptListingRevision.findUniqueOrThrow({ where: { id: open.id } });
      return { revision: toOwnerRevisionDto(rev, lv) };
    }, TX);
  },
};
