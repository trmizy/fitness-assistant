/**
 * PT listing management - the apply transaction and the ADMIN side (plan §1 B8-B10, B22, §3, §12.4, §12.5).
 *
 * `applyPtListingRevisionTx` is the ONE place that writes the public side of a trainer's listing: the allowlisted
 * PTApplication columns, UserProfile.specialties, the packages (through ptServicePackageService's transactional
 * writers) and the physique photos. It runs inside the caller's transaction, after taking row locks on the profile,
 * the packages and the photos, so every apply for one trainer is serial and a contract being created (FOR SHARE on
 * the package row) either sees the old terms with the old version or the new terms with the new version.
 */
import { logger } from "@gym-coach/shared";
import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { notificationService } from "./notification.service";
import { ptServicePackageService } from "./pt_service_package.service";
import { diffPayloads, type FieldChange } from "./pt-listing-diff";
import {
  ListingError,
  MAX_PACKAGES_PER_PT,
  MAX_PHYSIQUE_PHOTOS,
  type PtListingPayload,
} from "./pt-listing.schemas";
import {
  filterPayloadForDraft,
  insertDraft,
  isOpen,
  loadPublished,
  lockProfile,
  parseStoredPayload,
  toHistoryItem,
  validateRefs,
  type Db,
  type SystemAdjustment,
} from "./pt-listing.helpers";
import { ptMediaStorage } from "./pt-media-s3.service";
import { toOwnerPhotoView } from "./pt-physique-upload.service";
import { toListingPreviewDto } from "./pt-listing-preview";

const TX = { maxWait: 10_000, timeout: 30_000 };

export interface PreviousSnapshot {
  listingVersion: number;
  listingPublishedAt: string | null;
  payload: PtListingPayload;
}

type CreatedNotice = Awaited<ReturnType<typeof notificationService.createInTx>>;

function notice(ptUserId: string, eventType: string, text: string) {
  return { userId: ptUserId, text, eventType, entityType: "PT_LISTING", entityId: ptUserId, link: "/pt/listing" };
}

// ═══ the apply transaction ═════════════════════════════════════════════════════════════════════

export interface ApplyArgs {
  ptUserId: string;
  payload: PtListingPayload;
  actorUserId: string;
  source: "OWNER" | "ADMIN_DIRECT";
  reason?: string | null;
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
  retiredPhotos: Array<{ id: string; storageKey: string }>;
}

export async function applyPtListingRevisionTx(tx: Db, args: ApplyArgs): Promise<ApplyResult> {
  const { ptUserId, actorUserId } = args;

  // 1. locks: profile first, then every package / photo row of this trainer (always in id order)
  const locked = await lockProfile(tx, ptUserId);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM pt_service_packages WHERE pt_user_id = ${ptUserId} ORDER BY id FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM pt_physique_photos WHERE pt_user_id = ${ptUserId} AND status IN ('STAGED','PUBLISHED') ORDER BY id FOR UPDATE`);

  // 2. what is public right now (read AFTER the locks), and the payload checked against exactly that state
  const published = await loadPublished(tx, ptUserId);
  let payload: PtListingPayload;
  try {
    payload = await validateRefs(tx, ptUserId, args.payload);
  } catch (e) {
    if (e instanceof ListingError && e.status === 422) {
      throw new ListingError(409, "REVISION_INVALID", `Bản sửa không còn hợp lệ: ${e.message}`, { cause: e.code });
    }
    throw e;
  }
  const changes = diffPayloads(published.payload, payload);
  const previousSnapshot: PreviousSnapshot = {
    listingVersion: locked.listingVersion,
    listingPublishedAt: published.listingPublishedAt ? published.listingPublishedAt.toISOString() : null,
    payload: published.payload,
  };

  // 3. the revision's own transition (conditional UPDATE / INSERT) - before any public write
  const closed = await args.close({ previousSnapshot });

  // 4. profile columns: an explicit allowlist, nothing else is ever written here
  const p = payload.profile;
  await tx.pTApplication.update({
    where: { id: published.applicationId },
    data: {
      professionalBio: p.professionalBio,
      mainSpecialties: p.mainSpecialties,
      trainingMethodsApproach: p.trainingMethodsApproach,
      targetClientGroups: p.targetClientGroups,
      primaryTrainingGoals: p.primaryTrainingGoals,
      languages: p.languages,
      websiteUrl: p.websiteUrl,
      linkedinUrl: p.linkedinUrl,
    },
  });

  // 5. packages: create / update (version bump only on a commercial change) / archive
  const live = new Map(published.packages.map((row) => [row.id, row]));
  const keptIds = new Set<string>();
  for (const item of payload.packages) {
    if (item.archive) continue; // handled with the "missing from the payload" sweep below
    if (!item.id) {
      await ptServicePackageService.createPackageTx(tx, ptUserId, item);
      continue;
    }
    keptIds.add(item.id);
    const row = live.get(item.id);
    if (!row) continue; // validateRefs guaranteed ownership; a missing row would have been refused above
    await ptServicePackageService.updatePackageTx(tx, row, {
      name: item.name,
      description: item.description,
      price: item.price,
      sessionCount: item.sessionCount,
      sessionMode: item.sessionMode,
      sessionDurationMinutes: item.sessionDurationMinutes,
      validityDays: item.validityDays,
      isActive: item.isActive,
    });
  }
  for (const row of published.packages) {
    if (!keptIds.has(row.id)) await ptServicePackageService.archivePackageTx(tx, row.id);
  }
  const stillOnSale = await tx.pTServicePackage.count({ where: { ptUserId, archivedAt: null } });
  if (stillOnSale > MAX_PACKAGES_PER_PT) {
    throw new ListingError(422, "PACKAGE_LIMIT", `Mỗi huấn luyện viên có tối đa ${MAX_PACKAGES_PER_PT} gói đang bán.`);
  }

  // 6. photos: payload ids -> PUBLISHED with sort_order 0..n-1 and ONE cover, everything else public -> RETIRED
  const now = new Date();
  const nextIds = payload.photoIds;
  const retiredPhotos = published.photos.filter((ph) => !nextIds.includes(ph.id)).map((ph) => ({ id: ph.id, storageKey: ph.storageKey }));
  await tx.ptPhysiquePhoto.updateMany({ where: { ptUserId, isCover: true }, data: { isCover: false } });
  if (retiredPhotos.length > 0) {
    await tx.ptPhysiquePhoto.updateMany({
      where: { ptUserId, status: "PUBLISHED", id: { notIn: nextIds } },
      data: { status: "RETIRED", retiredAt: now, isCover: false },
    });
  }
  for (let i = 0; i < nextIds.length; i++) {
    await tx.ptPhysiquePhoto.update({
      where: { id: nextIds[i] },
      data: { status: "PUBLISHED", sortOrder: i, isCover: nextIds[i] === payload.coverPhotoId, retiredAt: null },
    });
  }
  const publicCount = await tx.ptPhysiquePhoto.count({ where: { ptUserId, status: "PUBLISHED" } });
  if (publicCount > MAX_PHYSIQUE_PHOTOS) {
    throw new ListingError(422, "PHOTO_LIMIT", `Tin đăng chỉ có tối đa ${MAX_PHYSIQUE_PHOTOS} ảnh hình thể.`);
  }

  // 7. version + search column + audit
  const updated = await tx.userProfile.update({
    where: { userId: ptUserId },
    data: { specialties: p.mainSpecialties, listingVersion: { increment: 1 }, listingPublishedAt: now },
    select: { listingVersion: true },
  });
  await tx.auditLog.create({
    data: {
      actorUserId,
      action: args.source === "ADMIN_DIRECT" ? "PT_LISTING_ADMIN_EDITED" : "PT_LISTING_APPROVED",
      entityType: "PT_LISTING",
      entityId: ptUserId,
      metadata: {
        revisionId: closed.id,
        source: args.source,
        reason: args.reason ?? null,
        fromVersion: locked.listingVersion,
        toVersion: updated.listingVersion,
        changes,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return { revisionId: closed.id, listingVersion: updated.listingVersion, changes, retiredPhotos };
}

// ═══ moving an open revision to a closed state ═════════════════════════════════════════════════

/** PENDING -> STALE plus a rebased DRAFT that keeps the owner's work (the public listing moved under it). */
async function staleAndRebaseTx(tx: Db, ptUserId: string, pendingId: string, newBaseVersion: number, note: string): Promise<NoticeAndDraft | null> {
  const pending = await tx.ptListingRevision.findFirst({ where: { id: pendingId, ptUserId, status: "PENDING" } });
  if (!pending) return null;
  const res = await tx.ptListingRevision.updateMany({
    where: { id: pendingId, status: "PENDING" },
    data: { status: "STALE", reviewedAt: new Date(), reviewNote: note },
  });
  if (res.count === 0) return null;
  const filtered = await filterPayloadForDraft(tx, ptUserId, parseStoredPayload(pending.payload));
  const adjustments: SystemAdjustment[] = [{ type: "REBASED_AFTER_ADMIN_EDIT", fromRevisionId: pendingId }, ...filtered.adjustments];
  const draftId = await insertDraft(tx, {
    ptUserId,
    payload: filtered.payload,
    baseVersion: newBaseVersion,
    parentRevisionId: pendingId,
    adjustments,
    ownerNote: pending.ownerNote,
  });
  const notification = await notificationService.createInTx(
    tx,
    notice(ptUserId, "PT_LISTING_INVALIDATED", "Quản trị viên vừa cập nhật tin đăng của bạn. Hãy xem lại bản sửa và gửi lại."),
  );
  return { staleRevisionId: pendingId, draftId, notification };
}
interface NoticeAndDraft {
  staleRevisionId: string;
  draftId: string | null;
  notification: CreatedNotice;
}

// ═══ the admin service ═════════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 20;

export const adminPtListingService = {
  /** GET /admin/listings/pts?status=&q=&page= */
  async list(query: { status?: string; q?: string; page?: number }) {
    const status = (query.status || "PENDING").toUpperCase();
    const valid = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "WITHDRAWN", "STALE"];
    if (!valid.includes(status)) throw new ListingError(400, "VALIDATION_FAILED", "status không hợp lệ");
    const page = Math.max(1, Number(query.page) || 1);

    const where: Prisma.PtListingRevisionWhereInput = { status: status as any };
    const q = (query.q ?? "").trim();
    if (q) {
      const matches = await prisma.userProfile.findMany({
        where: {
          isPT: true,
          OR: [
            { userId: q },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { userId: true },
        take: 200,
      });
      where.ptUserId = { in: matches.map((m) => m.userId) };
    }
    const [total, rows] = await Promise.all([
      prisma.ptListingRevision.count({ where }),
      prisma.ptListingRevision.findMany({
        where,
        orderBy: status === "PENDING" ? [{ submittedAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    const profiles = await prisma.userProfile.findMany({
      where: { userId: { in: rows.map((r) => r.ptUserId) } },
      select: { userId: true, firstName: true, lastName: true, listingVersion: true },
    });
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      items: rows.map((r) => {
        const pt = byId.get(r.ptUserId);
        const payload = r.payload as any;
        return {
          ...toHistoryItem(r, { admin: true }),
          ptUserId: r.ptUserId,
          ptName: [pt?.firstName, pt?.lastName].filter(Boolean).join(" ") || null,
          currentListingVersion: pt?.listingVersion ?? null,
          stale: isOpen(r.status) && pt ? r.baseVersion !== pt.listingVersion : false,
          summary: { photoCount: payload?.photoIds?.length ?? 0, packageCount: payload?.packages?.length ?? 0 },
        };
      }),
    };
  },

  /** GET /admin/listings/pts/revisions/:rid - the revision with its field diff against what is public now. */
  async getRevision(revisionId: string) {
    const rev = await prisma.ptListingRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw new ListingError(404, "REVISION_NOT_FOUND", "Không tìm thấy bản sửa");
    const published = await loadPublished(prisma, rev.ptUserId).catch(() => null);
    const payload = parseStoredPayload(rev.payload);
    const photoRows = await prisma.ptPhysiquePhoto.findMany({ where: { id: { in: payload.photoIds }, ptUserId: rev.ptUserId } });
    const snapshot = rev.previousSnapshot as unknown as PreviousSnapshot | null;
    return {
      revision: {
        ...toHistoryItem(rev, { admin: true }),
        ptUserId: rev.ptUserId,
        draftVersion: rev.draftVersion,
        payload,
        previousSnapshot: rev.previousSnapshot,
        ownerNote: rev.ownerNote,
      },
      pt: published
        ? { userId: published.userId, firstName: published.firstName, lastName: published.lastName, listingVersion: published.listingVersion, listingPublishedAt: published.listingPublishedAt }
        : null,
      stale: published ? isOpen(rev.status) && rev.baseVersion !== published.listingVersion : false,
      published: published ? published.payload : null,
      changes: published ? diffPayloads(published.payload, payload) : [],
      // For a revision that was applied: what it changed at the moment it went live.
      changesAtDecision: snapshot?.payload ? diffPayloads(snapshot.payload, payload) : null,
      photos: await Promise.all(photoRows.map(toOwnerPhotoView)),
    };
  },

  /** GET /admin/listings/pts/revisions/:rid/preview */
  async previewRevision(revisionId: string) {
    const rev = await prisma.ptListingRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw new ListingError(404, "REVISION_NOT_FOUND", "Không tìm thấy bản sửa");
    return buildPreview(rev, "ADMIN");
  },

  /** POST .../revisions/:rid/approve */
  async approve(revisionId: string, adminId: string, note?: string) {
    const out = await prisma.$transaction(async (tx) => {
      const first = await tx.ptListingRevision.findUnique({ where: { id: revisionId } });
      if (!first) throw new ListingError(404, "REVISION_NOT_FOUND", "Không tìm thấy bản sửa");
      const locked = await lockProfile(tx, first.ptUserId);
      const rev = await tx.ptListingRevision.findUniqueOrThrow({ where: { id: revisionId } });
      if (rev.status !== "PENDING") {
        throw new ListingError(409, "ALREADY_DECIDED", "Bản sửa này đã được xử lý.", { status: rev.status });
      }
      if (rev.baseVersion !== locked.listingVersion) {
        // The public listing moved after this was submitted (an admin edit normally stales it eagerly; this is the net).
        const stale = await staleAndRebaseTx(tx, rev.ptUserId, rev.id, locked.listingVersion, "Tin đăng công khai đã thay đổi sau khi bản sửa được gửi.");
        return { stale: true as const, notice: stale?.notification ?? null };
      }
      const applied = await applyPtListingRevisionTx(tx, {
        ptUserId: rev.ptUserId,
        payload: parseStoredPayload(rev.payload),
        actorUserId: adminId,
        source: "OWNER",
        close: async ({ previousSnapshot }) => {
          const res = await tx.ptListingRevision.updateMany({
            where: { id: rev.id, status: "PENDING" },
            data: {
              status: "APPROVED",
              reviewedBy: adminId,
              reviewedAt: new Date(),
              reviewNote: note ?? null,
              previousSnapshot: previousSnapshot as unknown as Prisma.InputJsonValue,
            },
          });
          if (res.count === 0) throw new ListingError(409, "ALREADY_DECIDED", "Bản sửa này đã được xử lý.");
          return { id: rev.id };
        },
      });
      const notification = await notificationService.createInTx(
        tx,
        notice(rev.ptUserId, "PT_LISTING_APPROVED", "Tin đăng của bạn đã được duyệt và hiển thị với khách hàng."),
      );
      return { stale: false as const, applied, notice: notification };
    }, TX);

    if (out.notice) notificationService.publish(out.notice);
    if (out.stale) {
      throw new ListingError(409, "LISTING_STALE", "Tin đăng công khai đã thay đổi sau khi bản sửa được gửi. Bản sửa đã được chuyển thành bản nháp mới cho huấn luyện viên.");
    }
    return { approved: true, revisionId, listingVersion: out.applied.listingVersion, changes: out.applied.changes };
  },

  /** POST .../revisions/:rid/reject  (note required) */
  async reject(revisionId: string, adminId: string, note: string) {
    const notificationRow = await prisma.$transaction(async (tx) => {
      const rev = await tx.ptListingRevision.findUnique({ where: { id: revisionId } });
      if (!rev) throw new ListingError(404, "REVISION_NOT_FOUND", "Không tìm thấy bản sửa");
      const res = await tx.ptListingRevision.updateMany({
        where: { id: revisionId, status: "PENDING" },
        data: { status: "REJECTED", reviewedBy: adminId, reviewedAt: new Date(), reviewNote: note },
      });
      if (res.count === 0) throw new ListingError(409, "ALREADY_DECIDED", "Bản sửa này đã được xử lý.", { status: (await tx.ptListingRevision.findUnique({ where: { id: revisionId } }))?.status });
      await tx.auditLog.create({
        data: { actorUserId: adminId, action: "PT_LISTING_REJECTED", entityType: "PT_LISTING", entityId: rev.ptUserId, metadata: { revisionId, note } },
      });
      return notificationService.createInTx(tx, notice(rev.ptUserId, "PT_LISTING_REJECTED", `Bản sửa tin đăng của bạn bị từ chối: ${note}`));
    }, TX);
    if (notificationRow) notificationService.publish(notificationRow);
    return { rejected: true, revisionId };
  },

  /** POST .../revisions/:rid/request-changes  (note required) - CHANGES_REQUESTED + a DRAFT child carrying the note. */
  async requestChanges(revisionId: string, adminId: string, note: string) {
    const out = await prisma.$transaction(async (tx) => {
      const rev = await tx.ptListingRevision.findUnique({ where: { id: revisionId } });
      if (!rev) throw new ListingError(404, "REVISION_NOT_FOUND", "Không tìm thấy bản sửa");
      const res = await tx.ptListingRevision.updateMany({
        where: { id: revisionId, status: "PENDING" },
        data: { status: "CHANGES_REQUESTED", reviewedBy: adminId, reviewedAt: new Date(), reviewNote: note },
      });
      if (res.count === 0) throw new ListingError(409, "ALREADY_DECIDED", "Bản sửa này đã được xử lý.", { status: (await tx.ptListingRevision.findUnique({ where: { id: revisionId } }))?.status });
      const filtered = await filterPayloadForDraft(tx, rev.ptUserId, parseStoredPayload(rev.payload));
      const lv = (await tx.userProfile.findUniqueOrThrow({ where: { userId: rev.ptUserId }, select: { listingVersion: true } })).listingVersion;
      const draftId = await insertDraft(tx, {
        ptUserId: rev.ptUserId,
        payload: filtered.payload,
        baseVersion: rev.baseVersion === lv ? rev.baseVersion : lv,
        parentRevisionId: rev.id,
        adjustments: filtered.adjustments,
        reviewNote: note,
        ownerNote: rev.ownerNote,
      });
      await tx.auditLog.create({
        data: { actorUserId: adminId, action: "PT_LISTING_CHANGES_REQUESTED", entityType: "PT_LISTING", entityId: rev.ptUserId, metadata: { revisionId, note } },
      });
      const notification = await notificationService.createInTx(
        tx,
        notice(rev.ptUserId, "PT_LISTING_CHANGES_REQUESTED", `Quản trị viên yêu cầu bạn chỉnh sửa tin đăng: ${note}`),
      );
      return { draftId, notification };
    }, TX);
    if (out.notification) notificationService.publish(out.notification);
    return { changesRequested: true, revisionId, draftRevisionId: out.draftId };
  },

  /** POST /admin/listings/pts/:ptUserId/direct-edit */
  async directEdit(adminId: string, ptUserId: string, body: DirectEditSpec) {
    const out = await prisma.$transaction((tx) => directEditTx(tx, adminId, ptUserId, body), TX);
    if (out.notice) notificationService.publish(out.notice);
    return {
      revisionId: out.revisionId,
      listingVersion: out.listingVersion,
      changes: out.changes,
      invalidatedRevisionId: out.invalidatedRevisionId,
      rebasedDraftRevisionId: out.rebasedDraftId,
    };
  },

  /**
   * POST /admin/listings/pts/:ptUserId/physique/:photoId/retire {reason, purge?}
   * A retire is an ADMIN_DIRECT revision whose photo list lacks the photo (so the audit, version bump and
   * invalidation of any pending revision are the same as for every other admin edit). `purge` also deletes the file
   * at once - a signed link handed out earlier then dies immediately instead of after its 10 minutes.
   */
  async retirePhoto(adminId: string, ptUserId: string, photoId: string, body: { reason: string; purge?: boolean }) {
    const out = await prisma.$transaction(async (tx) => {
      const photo = await tx.ptPhysiquePhoto.findFirst({ where: { id: photoId, ptUserId, status: "PUBLISHED" } });
      if (!photo) throw new ListingError(404, "PHOTO_NOT_FOUND", "Không tìm thấy ảnh đang công khai này");
      const current = await tx.ptPhysiquePhoto.findMany({
        where: { ptUserId, status: "PUBLISHED" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      return directEditTx(tx, adminId, ptUserId, {
        photoIds: current.map((c) => c.id).filter((id) => id !== photoId),
        reason: body.reason,
        expectedListingVersion: null,
      });
    }, TX);
    if (out.notice) notificationService.publish(out.notice);
    let purged = false;
    if (body.purge) {
      const doomed = out.retiredPhotos.find((p) => p.id === photoId);
      if (doomed) {
        try {
          await ptMediaStorage().deleteObject(doomed.storageKey);
          purged = true;
        } catch (e) {
          // The photo is already retired (no longer served); a leftover file is picked up by the 90-day sweep.
          logger.warn({ photoId, err: (e as Error).message }, "[PtListing] purge: could not delete the file");
        }
      }
    }
    return { retired: true, photoId, purged, listingVersion: out.listingVersion, revisionId: out.revisionId };
  },

  /**
   * GET /admin/listings/pts/:ptUserId - the CURRENT published listing of one trainer, with or without any revision
   * (what the admin's "Sửa trực tiếp" starts from, plus the `listingVersion` the edit must quote).
   * 404 unless the user is a PT with an APPROVED application. Names only: no email, phone or application documents.
   */
  async getPublished(ptUserId: string) {
    let published: Awaited<ReturnType<typeof loadPublished>>;
    try {
      published = await loadPublished(prisma, ptUserId);
    } catch (e) {
      if (e instanceof ListingError && (e.code === "NOT_A_PT" || e.code === "PT_NOT_APPROVED")) {
        throw new ListingError(404, "PT_NOT_FOUND", "Không tìm thấy huấn luyện viên có tin đăng.");
      }
      throw e;
    }
    const [photos, open] = await Promise.all([
      Promise.all(published.photos.map(toOwnerPhotoView)),
      prisma.ptListingRevision.findFirst({ where: { ptUserId, status: { in: ["DRAFT", "PENDING"] } }, select: { id: true, status: true } }),
    ]);
    return {
      pt: {
        userId: published.userId,
        firstName: published.firstName,
        lastName: published.lastName,
        listingVersion: published.listingVersion,
        listingPublishedAt: published.listingPublishedAt,
      },
      published: published.payload,
      photos,
      openRevision: open ? { id: open.id, status: open.status } : null,
    };
  },

  /** GET /admin/listings/pts/:ptUserId/history */
  async history(ptUserId: string, page = 1) {
    const take = 50;
    const [revisions, audit] = await Promise.all([
      prisma.ptListingRevision.findMany({ where: { ptUserId }, orderBy: { createdAt: "desc" }, skip: (Math.max(1, page) - 1) * take, take }),
      // Explicit select: the audit row also stores ipAddress/userAgent (personal data) — never sent to the admin UI.
      prisma.auditLog.findMany({
        where: { entityType: "PT_LISTING", entityId: ptUserId },
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, actorUserId: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true },
      }),
    ]);
    return { revisions: revisions.map((r) => toHistoryItem(r, { admin: true })), audit };
  },
};

// ═══ admin direct edit ═════════════════════════════════════════════════════════════════════════

export interface DirectEditSpec {
  profile?: Partial<PtListingPayload["profile"]>;
  packages?: PtListingPayload["packages"];
  photoIds?: string[];
  coverPhotoId?: string | null;
  reason: string;
  /** null = "whatever is current" (used by the photo retire, which has no version in its body). */
  expectedListingVersion: number | null;
}

async function directEditTx(tx: Db, adminId: string, ptUserId: string, spec: DirectEditSpec) {
  const locked = await lockProfile(tx, ptUserId);
  if (spec.expectedListingVersion !== null && spec.expectedListingVersion !== locked.listingVersion) {
    throw new ListingError(409, "LISTING_STALE", "Tin đăng đã thay đổi từ khi bạn mở. Hãy tải lại rồi sửa tiếp.", { listingVersion: locked.listingVersion });
  }
  const published = await loadPublished(tx, ptUserId);

  // Admin works with what is PUBLIC: reorder, set the cover, drop photos. Never add a photo (nobody but the PT
  // may supply pictures of their body), so every id must already be a published photo of this trainer.
  if (spec.photoIds) {
    const publicIds = new Set(published.payload.photoIds);
    if (spec.photoIds.some((id) => !publicIds.has(id))) {
      throw new ListingError(422, "PHOTO_NOT_PUBLISHED", "Quản trị viên chỉ được sắp xếp hoặc gỡ ảnh đang công khai, không thêm ảnh mới.");
    }
  }
  const photoIds = spec.photoIds ?? published.payload.photoIds;
  const wantedCover = spec.coverPhotoId !== undefined ? spec.coverPhotoId : published.payload.coverPhotoId;
  const next: PtListingPayload = {
    profile: { ...published.payload.profile, ...(spec.profile ?? {}) },
    packages: spec.packages ?? published.payload.packages,
    photoIds,
    coverPhotoId: wantedCover && photoIds.includes(wantedCover) ? wantedCover : null,
  };
  const normalized = await validateRefs(tx, ptUserId, next);
  if (diffPayloads(published.payload, normalized).length === 0) {
    throw new ListingError(422, "NO_CHANGES", "Không có thay đổi nào so với tin đăng hiện tại.");
  }

  const pending = await tx.ptListingRevision.findFirst({ where: { ptUserId, status: "PENDING" } });
  const applied: ApplyResult = await applyPtListingRevisionTx(tx, {
    ptUserId,
    payload: normalized,
    actorUserId: adminId,
    source: "ADMIN_DIRECT",
    reason: spec.reason,
    close: async ({ previousSnapshot }) => {
      const row = await tx.ptListingRevision.create({
        data: {
          ptUserId,
          status: "APPROVED",
          source: "ADMIN_DIRECT",
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

  let invalidated: NoticeAndDraft | null = null;
  if (pending) {
    invalidated = await staleAndRebaseTx(tx, ptUserId, pending.id, applied.listingVersion, "Quản trị viên đã cập nhật trực tiếp tin đăng sau khi bản sửa được gửi.");
  }
  return {
    revisionId: applied.revisionId,
    listingVersion: applied.listingVersion,
    changes: applied.changes,
    retiredPhotos: applied.retiredPhotos,
    invalidatedRevisionId: invalidated?.staleRevisionId ?? null,
    rebasedDraftId: invalidated?.draftId ?? null,
    notice: invalidated?.notification ?? null,
  };
}

// ═══ preview (shared by the owner and the admin controllers) ═══════════════════════════════════

export async function buildPreview(
  rev: { id: string; ptUserId: string; status: string; source: string; payload: unknown; systemAdjustments: unknown },
  viewer: "OWNER" | "ADMIN",
) {
  const payload = parseStoredPayload(rev.payload);
  const profile = await prisma.userProfile.findUnique({ where: { userId: rev.ptUserId }, select: { userId: true, firstName: true, lastName: true } });
  if (!profile) throw new ListingError(404, "PT_NOT_FOUND", "Không tìm thấy huấn luyện viên");
  const rows = await prisma.ptPhysiquePhoto.findMany({
    where: { id: { in: payload.photoIds }, ptUserId: rev.ptUserId, status: { in: ["STAGED", "PUBLISHED"] } },
  });
  const photos = await Promise.all(rows.map(toOwnerPhotoView));
  return toListingPreviewDto({ ...rev, payload }, profile, photos, viewer);
}
