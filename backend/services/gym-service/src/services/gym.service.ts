import { randomUUID } from 'node:crypto';
import { logger } from '@gym-coach/shared';
import { gymRepository } from '../repositories/gym.repository';
import { reviewRepository } from '../repositories/review.repository';
import { membershipRepository } from '../repositories/membership.repository';
import { planRepository } from '../repositories/plan.repository';
import { brandService } from './brand.service';
import { brandRepository } from '../repositories/brand.repository';
import { prisma } from '../repositories/prisma';
import { withCompatWriter } from '../repositories/compat-writer';
import { replaceDraftSystemAmenitiesTx } from './gym-amenity.service';
import { applyAmenitySelectionTx, type AmenitySelectionInput } from './gym-amenity-selection.service';
import { LEGACY_NO_HEADER, createdFlowVersionData, amenitiesRequired, amenitiesRequiredError, recordLegacyCompatTx, recordLegacyRejectedEvent, type ListingCompat } from './legacy-compat.service';
import { listingReviewRequiredError } from './client-compat.service';
import type { GymOperationalStatus, PartnerAccountRole } from '../generated/prisma';
import { brandLogoUrl } from './gym-photo-url';
import { gymPublicRepository, toPublicGymDto, toPublicGymPhotos } from './gym-public';
import { directEditTx } from './gym-listing-apply.service';
import { recordPartnerAudit, resolvePartnerId } from './gym-listing.helpers';
import { partnerAuditService } from './partner-audit.service';
import { sendListingNotices } from './gym-listing-notify';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/** The account actually making an operational-status change — see setOperationalStatus. */
export interface OperationalStatusActor {
  /** The logged-in user (req.user.userId). For a MANAGER this is NOT the owner principal. */
  userId: string;
  role: PartnerAccountRole;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Audit row for an admin action on a branch, right after the change (partnerAuditService.record never throws). */
async function auditGymAdminAction(
  gym: { id: string; ownerId: string; brandId: string | null },
  actorUserId: string | undefined,
  action: 'GYM_ADMIN_STATUS_CHANGED' | 'GYM_ADMIN_RENAME_APPROVED',
  metadata: Record<string, unknown>,
) {
  if (!actorUserId) return;
  const partnerId = await resolvePartnerId(prisma, gym);
  if (!partnerId) {
    logger.warn({ gymId: gym.id, action }, '[Gym] owner has no partner record - PartnerAuditLog row skipped');
    return;
  }
  await partnerAuditService.record({ partnerId, actorUserId, action, metadata: { gymId: gym.id, ...metadata } });
}

/** GYM_ADMIN_UPDATED: who changed which operational / identity columns of a branch, from what to what, and why. */
async function auditAdminUpdate(
  tx: Parameters<typeof recordPartnerAudit>[0],
  before: { id: string; ownerId: string; brandId: string | null } & Record<string, any>,
  patch: Record<string, unknown>,
  ctx: { adminId?: string; reason?: string },
) {
  if (!ctx.adminId) return;
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ['name', 'address', 'city', 'phone', 'email', 'description'] as const) {
    if (key in patch) changed[key] = { from: before[key] ?? null, to: patch[key] ?? null };
  }
  if (Object.keys(changed).length === 0) return;
  await recordPartnerAudit(tx, before, {
    actorUserId: ctx.adminId,
    action: 'GYM_ADMIN_UPDATED',
    reason: ctx.reason ?? null,
    metadata: { changed },
  });
}

export const gymService = {
  async listApproved() {
    // Listing Management B1 — one visibility rule (gymPublicWhere: APPROVED + OPEN + owner not hidden). Phase 5 mục 5.1:
    // tạm khoá/chấm dứt đối tác thì ẩn khỏi trang tìm kiếm công khai, dù `status`/`operationalStatus` riêng của từng
    // chi nhánh không đổi (khách cũ vẫn check-in bình thường — chỉ khách MỚI không tìm thấy để đăng ký).
    const gyms = await gymPublicRepository.findPublishedList();
    const brandIds = [...new Set(gyms.map((g) => g.brandId).filter((id): id is string => !!id))];
    const [ratings, cheapestByBrand] = await Promise.all([
      reviewRepository.aggregateForGyms(gyms.map((g) => g.id)),
      planRepository.findCheapestActiveByBrands(brandIds),
    ]);
    // "fromPrice" — lọc "theo mức giá" ở trang tìm kiếm cần giá thấp nhất của MỖI THƯƠNG
    // HIỆU (gói là brand-wide, một chi nhánh không có giá riêng — xem GymMembershipPlan's
    // doc comment). null nghĩa là brand này chưa có gói nào đang mở bán — ẩn khỏi mọi mức
    // giá cụ thể ở bộ lọc, không mặc định rơi vào bất kỳ khoảng nào.
    return gyms.map((g) => {
      const r = ratings.get(g.id);
      return {
        ...toPublicGymDto(g),
        averageRating: round2(r?.averageRating ?? 0),
        reviewCount: r?.count ?? 0,
        fromPrice: g.brandId ? (cheapestByBrand.get(g.brandId) ?? null) : null,
      };
    });
  },

  /** Just the brandId, for anything that only needs to resolve "which brand sells plans at
   * this gym" (plan.controller.ts's public listing) without paying for the review aggregate
   * getApprovedById computes. Returns null for a gym with no brand (legacy standalone) or one
   * that does not exist — the caller treats both the same way: nothing to list. */
  async getBrandIdForGym(gymId: string): Promise<string | null> {
    const gym = await gymRepository.findById(gymId);
    return gym?.brandId ?? null;
  },

  async getApprovedById(id: string) {
    const gym = await gymPublicRepository.findPublishedById(id);
    if (!gym) throw err('Gym not found', 404);
    const [r, siblings, logoUrl] = await Promise.all([
      reviewRepository.aggregateForGym(id),
      gym.brandId ? gymPublicRepository.findPublishedBranchesOfBrand(gym.brandId) : Promise.resolve([]),
      brandLogoUrl(gym.brand?.logoKey),
    ]);
    return {
      ...toPublicGymDto(gym, { brandLogoUrl: logoUrl }),
      averageRating: round2(r.averageRating),
      reviewCount: r.count,
      // Chỉ ảnh PUBLISHED (kiểu PublishedGymSource bảo đảm), URL cố định /media/gym-photos/:id — bucket vẫn riêng tư,
      // mỗi lần tải lại sẽ được chuyển hướng sang link ký tạm mới.
      photos: toPublicGymPhotos(gym),
      // Mọi chi nhánh đang mở của cùng thương hiệu (kể cả chi nhánh này) — cho bản đồ chi nhánh.
      brandBranches: siblings.map((b) => ({
        id: b.id,
        name: b.approvedName ?? b.name,
        address: b.approvedAddress ?? b.address,
        latitude: b.latitude,
        longitude: b.longitude,
      })),
    };
  },

  /**
   * One owner, one brand: every gym an owner creates is a branch of THEIR brand. Which brand a
   * gym joins is entirely server-decided from ownership, never client-supplied (a `brandId` in
   * the request body is accepted for backward compatibility but ignored) — closing the old
   * "guess someone else's brandId" concern for good, not just gating it.
   *
   * The brand itself is NOT auto-created here off the first gym's own name — that produced a
   * brand named after whatever the owner happened to type as their first branch, never asked.
   * MyGymsPage now prompts a brand-new owner to name their brand before they ever reach this
   * call, so by the time createGym runs, a brand is expected to already exist; this throws
   * rather than improvising one if it somehow doesn't.
   */
  async createGym(
    ownerId: string,
    data: {
      name: string; description?: string; address: string; city?: string; phone?: string; email?: string;
      provinceCode?: number | null; wardCode?: number | null; latitude?: number | null; longitude?: number | null;
    } & AmenitySelectionInput,
    compat: ListingCompat = LEGACY_NO_HEADER,
  ) {
    const existingBrands = await brandService.listOwned(ownerId);
    const brand = existingBrands[0];
    if (!brand) {
      throw err('Hãy đặt tên thương hiệu của bạn trước khi tạo phòng gym', 400);
    }
    // Listing Management B3 (plan 3, 12.8) - quick create. The branch is PENDING_REVIEW and its amenities (catalogue rows + own
    // proposals) are saved with it in ONE transaction, like the wizard's. New client: >= 1 amenity or 422 AMENITIES_REQUIRED. Old
    // client (no header): accepted without any when LISTING_LEGACY_CLIENT_COMPAT is on (the branch is labelled legacy_no_amenities,
    // ACCEPTED event + legacy_client_at in this transaction); refused 422 + REJECTED_422 event when it is off.
    const gymId = randomUUID();
    try {
      return await prisma.$transaction(async (tx) => {
        await withCompatWriter(tx);
        const created = await tx.gym.create({
          data: {
            id: gymId,
            ownerId,
            name: data.name,
            pendingName: data.name,
            description: data.description,
            address: data.address,
            pendingAddress: data.address,
            city: data.city,
            phone: data.phone,
            email: data.email,
            provinceCode: data.provinceCode ?? undefined,
            wardCode: data.wardCode ?? undefined,
            latitude: data.latitude ?? undefined,
            longitude: data.longitude ?? undefined,
            ...createdFlowVersionData(compat),
            brand: { connect: { id: brand.id } },
          },
        });
        const counts = await applyAmenitySelectionTx(tx, created, ownerId, {
          amenityIds: data.amenityIds,
          proposals: data.proposals,
          proposalIds: data.proposalIds,
        });
        const total = counts.amenityCount + counts.pendingProposalCount;
        if (total === 0 && amenitiesRequired(compat, created.createdFlowVersion)) throw amenitiesRequiredError(compat);
        await recordLegacyCompatTx(tx, {
          action: 'BRANCH_CREATE_QUICK',
          entityType: 'GYM',
          entityId: created.id,
          actorUserId: ownerId,
          flowHeader: compat.flowHeader,
          clientHeader: compat.clientHeader,
          outcome: 'ACCEPTED',
          legacyNoAmenities: total === 0,
        });
        return tx.gym.findUniqueOrThrow({ where: { id: created.id } });
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'AMENITIES_REQUIRED' && !compat.newClient) {
        // The branch was never created (rolled back), so the event points at the applicant's partner record when there is one.
        const partnerId = await resolvePartnerId(prisma, { ownerId, brandId: brand.id });
        await recordLegacyRejectedEvent({
          action: 'BRANCH_CREATE_QUICK',
          entityType: partnerId ? 'GYM_PARTNER' : 'GYM',
          entityId: partnerId ?? gymId,
          actorUserId: ownerId,
          flowHeader: compat.flowHeader,
          clientHeader: compat.clientHeader,
        });
      }
      throw e;
    }
  },

  async getOwnedGym(gymId: string, ownerId: string) {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);
    if (gym.ownerId !== ownerId) throw err('Not authorized — you do not own this gym', 403);
    return gym;
  },

  /**
   * Attaches the same averageRating/reviewCount as the public listing, plus activeMemberCount
   * (public DTOs never expose this — it's owner-only) — feeds the "Phòng gym của tôi" dashboard
   * cards. The owner still sees their own raw name/address here (not toPublicGym's
   * approved-name substitution); only what's PUBLICLY shown is approved-gated, not what the
   * owner can see about their own gym.
   */
  async listOwned(ownerId: string) {
    const gyms = await gymRepository.findByOwner(ownerId);
    const gymIds = gyms.map((g) => g.id);
    const [ratings, memberCounts] = await Promise.all([
      reviewRepository.aggregateForGyms(gymIds),
      membershipRepository.countActiveByGyms(gymIds),
    ]);
    return gyms.map((g) => {
      const r = ratings.get(g.id);
      return {
        ...g,
        averageRating: round2(r?.averageRating ?? 0),
        reviewCount: r?.count ?? 0,
        activeMemberCount: memberCounts.get(g.id) ?? 0,
      };
    });
  },

  /**
   * Vòng 4 / Phase C2 — name/address changes only ever move pendingName/pendingAddress
   * (approvedName/approvedAddress stay untouched until the admin approves them); every other
   * field here (description/city/phone/email) stays freely editable exactly as before this
   * phase. GYM_BRANCH_FORM_SPEC.md §51/§79/§89 — the old Phase C4 `brandId` handling (move a
   * gym to a brand the owner owns, or pass null to detach) has been removed entirely: a
   * branch permanently belongs to the owner's single brand, there is no "Change Brand" and
   * no standalone branch. Confirmed with the user before removing this capability, not just
   * the schema field that gated it at the HTTP layer.
   */
  async updateOwnedGym(
    gymId: string,
    ownerId: string,
    data: Partial<{
      name: string; description: string; address: string; city: string; phone: string; email: string;
      provinceCode: number | null; wardCode: number | null; latitude: number | null; longitude: number | null;
      locationNote: string; facilities: string[];
    }>,
  ) {
    const gym = await this.getOwnedGym(gymId, ownerId);
    const patch: Record<string, unknown> = {};

    // Listing Management B3/B4 — description and facilities are part of the PUBLIC LISTING: once a branch has left DRAFT
    // they change only through a reviewed revision, never by a direct write. The whole request is refused (409
    // LISTING_REVIEW_REQUIRED) before anything is written. A DRAFT branch (the wizard) is not affected.
    if (gym.status !== 'DRAFT' && (data.description !== undefined || data.facilities !== undefined)) {
      throw listingReviewRequiredError();
    }

    if (data.locationNote !== undefined) patch.locationNote = data.locationNote;
    if (data.name !== undefined) {
      patch.name = data.name;
      if (data.name !== gym.name) patch.pendingName = data.name;
      // GYM_MANAGEMENT master spec §60/§62 — editing the field a "Request Changes" note was
      // about counts as the owner's resubmission; the standing note no longer describes the
      // current (just-changed) value, so it's cleared here rather than left stale forever.
      patch.pendingNameNote = null;
    }
    if (data.address !== undefined) {
      patch.address = data.address;
      if (data.address !== gym.address) patch.pendingAddress = data.address;
      patch.pendingAddressNote = null;
    }
    if (data.description !== undefined) patch.description = data.description;
    if (data.city !== undefined) patch.city = data.city;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.email !== undefined) patch.email = data.email;
    if (data.provinceCode !== undefined) patch.provinceCode = data.provinceCode;
    if (data.wardCode !== undefined) patch.wardCode = data.wardCode;
    if (data.latitude !== undefined) patch.latitude = data.latitude;
    if (data.longitude !== undefined) patch.longitude = data.longitude;

    // Once neither field has a standing note left, the request-changes item is fully resolved
    // — clear the timestamp so it drops out of the admin "needs review" queue.
    const nameNoteGone = patch.pendingNameNote === null;
    const addressNoteGone = patch.pendingAddressNote === null;
    if ((nameNoteGone || gym.pendingNameNote === null) && (addressNoteGone || gym.pendingAddressNote === null)) {
      patch.changesRequestedAt = null;
      patch.changesRequestedBy = null;
    }

    // `facilities` is only a mirror of gym_amenities (B4): a DRAFT branch's selection goes to gym_amenities and the
    // mirror is re-synced; nothing writes the array directly.
    if (data.facilities === undefined) return gymRepository.update(gymId, patch);
    const facilities = data.facilities;
    return prisma.$transaction(async (tx) => {
      await withCompatWriter(tx);
      if (Object.keys(patch).length > 0) await tx.gym.update({ where: { id: gymId }, data: patch });
      await replaceDraftSystemAmenitiesTx(tx, gymId, facilities);
      return tx.gym.findUniqueOrThrow({ where: { id: gymId } });
    });
  },

  /**
   * GYM_MANAGEMENT master spec §60/§62 — "Request Changes" on specific fields (name and/or
   * address — the only two moderated fields) with a per-field note, instead of a blunt
   * approve/reject. Deliberately does NOT touch `status`: a first-time PENDING_REVIEW gym
   * stays PENDING_REVIEW, an already-APPROVED gym reviewing a rename stays APPROVED — never
   * regresses an approved branch just because a later change needs another look.
   */
  async requestChanges(gymId: string, adminId: string, notes: { nameNote?: string; addressNote?: string }) {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);
    if (!notes.nameNote?.trim() && !notes.addressNote?.trim()) {
      throw err('Cần ít nhất một ghi chú cho tên hoặc địa chỉ', 400);
    }
    return gymRepository.update(gymId, {
      pendingNameNote: notes.nameNote?.trim() || null,
      pendingAddressNote: notes.addressNote?.trim() || null,
      changesRequestedAt: new Date(),
      changesRequestedBy: adminId,
    });
  },

  /**
   * Vòng 4 / Phase C1/C2 — the FIRST time a gym transitions to APPROVED, that same admin
   * action also performs the gym's first name/address approval (approvedName/approvedAddress
   * were null until now) AND, if this gym belongs to a brand that has never had a branch
   * approved before, the brand's first-branch approval too — both mirror C1's rule exactly:
   * "First approval happens when admin approves the brand's FIRST branch." No new admin action
   * is needed for either of these first approvals; only a LATER rename needs the dedicated
   * approveRename actions below. A re-approval (e.g. SUSPENDED -> APPROVED again) does nothing
   * here since approvedName is already non-null by then — it must not silently wave through a
   * rename that was never sent through approveRename.
   */
  async setStatus(gymId: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED', actorUserId?: string) {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);

    if (status === 'APPROVED' && gym.approvedName === null) {
      await gymRepository.update(gymId, {
        approvedName: gym.pendingName ?? gym.name,
        approvedAddress: gym.pendingAddress ?? gym.address,
        pendingName: null,
        pendingAddress: null,
        // Approving resolves any standing "Request Changes" note the same way an owner
        // resubmission would — there's nothing left pending to comment on.
        pendingNameNote: null,
        pendingAddressNote: null,
        changesRequestedAt: null,
        changesRequestedBy: null,
      });

      if (gym.brandId) {
        const brand = await brandRepository.findById(gym.brandId);
        if (brand && brand.approvedName === null) {
          await brandRepository.update(gym.brandId, { approvedName: brand.pendingName ?? brand.name, pendingName: null });
        }
      }
    }

    const updated = await gymRepository.updateStatus(gymId, status);
    // Listing Management B2 - GYM_ADMIN_STATUS_CHANGED. Written right after the change (best effort: partnerAuditService.record
    // never throws). Without an acting admin (internal callers / old tests) no audit row is written.
    await auditGymAdminAction(gym, actorUserId, 'GYM_ADMIN_STATUS_CHANGED', { from: gym.status, to: status });
    return updated;
  },

  /**
   * Vòng 4 / Phase C2 — the dedicated "Duyệt đổi tên/địa chỉ" admin action for an
   * ALREADY-approved gym's later rename. Promotes whichever of name/address actually has
   * something pending; leaves the other untouched if only one was changed.
   */
  async approveRename(gymId: string, actorUserId?: string) {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);
    if (gym.pendingName === null && gym.pendingAddress === null) {
      throw err('Phòng gym này không có tên/địa chỉ nào đang chờ duyệt', 409);
    }
    const updated = await gymRepository.update(gymId, {
      ...(gym.pendingName !== null ? { approvedName: gym.pendingName, pendingName: null } : {}),
      ...(gym.pendingAddress !== null ? { approvedAddress: gym.pendingAddress, pendingAddress: null } : {}),
      pendingNameNote: null,
      pendingAddressNote: null,
      changesRequestedAt: null,
      changesRequestedBy: null,
    });
    await auditGymAdminAction(gym, actorUserId, 'GYM_ADMIN_RENAME_APPROVED', {
      ...(gym.pendingName !== null ? { name: { from: gym.approvedName, to: gym.pendingName } } : {}),
      ...(gym.pendingAddress !== null ? { address: { from: gym.approvedAddress, to: gym.pendingAddress } } : {}),
    });
    return updated;
  },

  /**
   * "Quản lý gym & owner" — admin editing a branch's own details directly, unlike the owner's
   * updateOwnedGym above: name/address take effect on BOTH the raw field and
   * approvedName/approvedAddress in the same write (any pending owner-submitted rename is
   * discarded — the admin's own edit replaces it, there's no one left to "approve" an admin's
   * own change against). phone/email/description/city have no approval gate for the owner
   * either, so they're a plain overwrite here too. No ownerId filter — this operates on any
   * gym regardless of which owner it belongs to, unlike getOwnedGym/updateOwnedGym.
   */
  async updateGymAsAdmin(
    gymId: string,
    data: Partial<{ name: string; description: string; address: string; city: string; phone: string; email: string }>,
    ctx: { adminId?: string; reason?: string; expectedListingVersion?: number } = {},
  ) {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);

    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) {
      patch.name = data.name;
      patch.approvedName = data.name;
      patch.pendingName = null;
      patch.pendingNameNote = null;
    }
    if (data.address !== undefined) {
      patch.address = data.address;
      patch.approvedAddress = data.address;
      patch.pendingAddress = null;
      patch.pendingAddressNote = null;
    }
    if (data.city !== undefined) patch.city = data.city;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.email !== undefined) patch.email = data.email;
    if (data.name !== undefined || data.address !== undefined) {
      patch.changesRequestedAt = null;
      patch.changesRequestedBy = null;
    }

    // Listing Management B2 - `description` is part of the PUBLIC LISTING: for a branch that has left DRAFT it is an ADMIN_DIRECT
    // revision (reason >= 10 characters stored on it, expectedListingVersion honoured when given, listing_version + 1,
    // previous_snapshot, mirror sync, LISTING_ADMIN_EDITED audit, a pending revision becomes STALE + a rebased draft). A DRAFT
    // branch has no listing yet - the wizard owns it - so its description is written directly, as before.
    const descriptionNow = data.description !== undefined ? data.description.trim() || null : undefined;
    const descriptionChanged = descriptionNow !== undefined && descriptionNow !== ((gym.description ?? '').trim() || null);
    const viaRevision = descriptionChanged && gym.status !== 'DRAFT';
    if (descriptionChanged && !viaRevision) patch.description = descriptionNow;

    if (!viaRevision) {
      if (Object.keys(patch).length === 0) return gym;
      return prisma.$transaction(async (tx) => {
        await withCompatWriter(tx);
        const updated = await tx.gym.update({ where: { id: gymId }, data: patch });
        await auditAdminUpdate(tx, gym, patch, ctx);
        return updated;
      });
    }

    const out = await prisma.$transaction(async (tx) => {
      // lock order: the listing edit (open revision -> gym) first, then the plain columns
      const direct = await directEditTx(tx, ctx.adminId ?? 'system', gymId, {
        description: descriptionNow,
        reason: ctx.reason as string,
        expectedListingVersion: ctx.expectedListingVersion ?? null,
      });
      let updated = await tx.gym.findUniqueOrThrow({ where: { id: gymId } });
      if (Object.keys(patch).length > 0) {
        await withCompatWriter(tx);
        updated = await tx.gym.update({ where: { id: gymId }, data: patch });
        await auditAdminUpdate(tx, gym, patch, ctx);
      }
      return { gym: updated, direct };
    });
    await sendListingNotices(out.direct.notices);
    return Object.assign(out.gym, { listing: { revisionId: out.direct.revisionId, listingVersion: out.direct.listingVersion } });
  },

  /**
   * Vòng 4 / Phase C3 — the owner's own open/closed switch, independent from admin moderation
   * `status`. State machine: OPEN -> TEMPORARILY_CLOSED or PERMANENTLY_CLOSED (reason
   * required); TEMPORARILY_CLOSED -> OPEN (reopen) or PERMANENTLY_CLOSED; PERMANENTLY_CLOSED is
   * terminal — nothing here transitions out of it (that would need actual admin/manual
   * intervention, out of this phase's scope).
   *
   * Who may do what: a branch MANAGER may close temporarily and reopen the branches in their
   * scope (the route's requireGymScope); PERMANENTLY_CLOSED is OWNER-only. It is irreversible
   * and ends the branch's business — memberships left for admin refund review, PT partnerships
   * that can no longer take a new contract — which is an owner's call, not a branch manager's.
   *
   * `ownerId` is the owner PRINCIPAL the gym is keyed to (a MANAGER's request carries their
   * owner's id there), so it cannot answer "who is acting". That is what `actor` is for: the
   * role rule reads `actor.role`, and `closedBy` is stamped with `actor.userId`. The rule is
   * enforced here rather than only on the route so no caller can reach the write without it,
   * and it fails closed — a permanent closure with no actor is refused.
   */
  async setOperationalStatus(
    gymId: string,
    ownerId: string,
    target: GymOperationalStatus,
    reason?: string,
    expectedReopenAt?: Date,
    actor?: OperationalStatusActor,
  ) {
    if (target === 'PERMANENTLY_CLOSED' && actor?.role !== 'OWNER') {
      throw Object.assign(
        err('Chỉ chủ sở hữu mới được đóng cửa vĩnh viễn chi nhánh — tài khoản quản lý chỉ có thể tạm đóng cửa hoặc mở lại', 403),
        { code: 'OWNER_ROLE_REQUIRED' },
      );
    }

    const gym = await this.getOwnedGym(gymId, ownerId);
    if (gym.operationalStatus === 'PERMANENTLY_CLOSED') {
      throw err('Phòng gym đã đóng cửa vĩnh viễn, không thể đổi trạng thái', 409);
    }
    if (target === gym.operationalStatus) {
      throw err(`Phòng gym đã ở trạng thái ${target}`, 409);
    }

    if (target === 'OPEN') {
      if (gym.operationalStatus !== 'TEMPORARILY_CLOSED') {
        throw err('Chỉ có thể mở lại phòng gym đang tạm đóng cửa', 409);
      }
      return gymRepository.setOperationalStatus(gymId, 'OPEN', {
        closureReason: null,
        // Cleared with the reason: the pair describes the CURRENT closure, and an open gym has none.
        closedBy: null,
        expectedReopenAt: null,
        reopenedAt: new Date(),
      });
    }

    // TEMPORARILY_CLOSED or PERMANENTLY_CLOSED — both require a reason (the `closureReason`
    // column exists specifically so an actionable item / admin queue has something to show).
    if (!reason?.trim()) throw err('Vui lòng cho biết lý do đóng cửa', 400);

    const updated = await gymRepository.setOperationalStatus(gymId, target, {
      closureReason: reason.trim(),
      closedAt: new Date(),
      // The audit stamp for this closure: who (the acting account, not the owner principal),
      // alongside when (closedAt) and why (closureReason) on the branch's own row.
      closedBy: actor?.userId ?? null,
      // Reopen date is only meaningful for a temporary closure — a permanent one has none.
      expectedReopenAt: target === 'TEMPORARILY_CLOSED' ? expectedReopenAt ?? null : null,
    });

    if (target === 'PERMANENTLY_CLOSED') {
      const memberships = await membershipRepository.findByGym(gymId);
      const activeCount = memberships.filter((m) => m.status === 'ACTIVE').length;
      logger.warn(
        `[Gym] ${gymId} (${gym.name}) PERMANENTLY_CLOSED by owner ${actor?.userId} — ${activeCount} active membership(s) need admin review for a refund (reason: GYM_CLOSED)`,
      );
    }

    return updated;
  },

  /**
   * GYM_BRANCH_FORM_SPEC.md, Phase 5 — owner-facing permanent-closure impact summary. Mirrors
   * partnerService.terminationImpact's own doc comment exactly ("không được để [actor] bấm
   * [huỷ] mà không biết mình đang ảnh hưởng tới bao nhiêu người"), scoped down from a whole
   * partner (every gym) to just THIS one branch. Every cross-service call is best-effort —
   * a slow/erroring payment-service must not block the warning screen from showing at all.
   */
  async closureImpact(gymId: string, ownerId: string) {
    const ownedGym = await this.getOwnedGym(gymId, ownerId); // ownership check — throws if not this owner's gym

    const { membershipService } = await import('./membership.service');
    const { paymentClient } = await import('../clients/payment.client');
    const { prisma } = await import('../repositories/prisma');

    const [activeMemberships, activeCollaborations, wallet] = await Promise.all([
      membershipRepository.findActiveByGyms([gymId]),
      // "Partnerships affected" = live branch-level rows for this branch (a row folded into a brand
      // agreement is superseded and no longer counts on its own) + ACCEPTED brand agreements of this
      // branch's brand, each of which covers this branch too.
      Promise.all([
        prisma.gymPtCollaboration.count({ where: { gymId, status: 'ACCEPTED', supersededByAgreementId: null } }),
        ownedGym.brandId
          ? prisma.gymBrandPtAgreement.count({ where: { brandId: ownedGym.brandId, status: 'ACCEPTED' } })
          : Promise.resolve(0),
      ]).then(([legacy, brand]) => legacy + brand),
      paymentClient.getWallet('GYM', gymId).catch(() => null),
    ]);

    const unusedValueTotal = activeMemberships.reduce(
      (sum, m) => sum + membershipService.quoteRefund(m as any).refundAmount,
      0,
    );

    return {
      activeMembers: activeMemberships.length,
      unusedValueTotal,
      activeCollaborations,
      walletBalance: Number(wallet?.availableBalance ?? 0) + Number(wallet?.pendingBalance ?? 0),
    };
  },

  /** Vòng 4 / Phase C — admin's gym-moderation list (there was no admin-facing gym list at
   * all before this phase; `status` lets the UI default to just the PENDING_REVIEW queue). */
  async listAllForAdmin(status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED') {
    return gymRepository.findAllForAdmin(status);
  },

  /** Vòng 4 / Phase C3 — the actionable item for PERMANENTLY_CLOSED gyms: which ones still
   * have ACTIVE memberships an admin needs to refund (via the existing refundByAdmin, reason
   * GYM_CLOSED — no new refund logic here, just visibility). */
  async listPermanentlyClosedNeedingReview() {
    const gyms = await gymRepository.findPermanentlyClosed();
    const withCounts = await Promise.all(
      gyms.map(async (gym) => {
        const memberships = await membershipRepository.findByGym(gym.id);
        const activeMembershipCount = memberships.filter((m) => m.status === 'ACTIVE').length;
        return { ...gym, activeMembershipCount };
      }),
    );
    return withCounts;
  },
};
