import { logger } from '@gym-coach/shared';
import { gymRepository } from '../repositories/gym.repository';
import { brandRepository } from '../repositories/brand.repository';
import { reviewRepository } from '../repositories/review.repository';
import { membershipRepository } from '../repositories/membership.repository';
import { planRepository } from '../repositories/plan.repository';
import { brandService } from './brand.service';
import { partnerGuard } from './partner-guard.service';
import type { GymOperationalStatus } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { brandLogoUrl, resolvePhotoUrl } from './gym-photo-url';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Public-facing shape: substitutes the moderation-approved name/address (and, if the gym
 * belongs to a brand, the brand's own approved name) in place of the owner's raw working
 * values. Vòng 4 / Phase C1/C2 — "public pages always read approvedName/approvedAddress". */
function toPublicGym<
  T extends {
    name: string;
    address: string;
    approvedName: string | null;
    approvedAddress: string | null;
    brand?: { name: string; approvedName: string | null } | null;
  },
>(gym: T) {
  return {
    ...gym,
    name: gym.approvedName ?? gym.name,
    address: gym.approvedAddress ?? gym.address,
    ...(gym.brand ? { brand: { ...gym.brand, name: gym.brand.approvedName ?? gym.brand.name } } : {}),
  };
}

export const gymService = {
  async listApproved() {
    const [allGyms, hiddenOwnerIds] = await Promise.all([
      gymRepository.findApproved(),
      partnerGuard.hiddenFromPublicOwnerUserIds(),
    ]);
    // Phase 5 mục 5.1 — tạm khoá/chấm dứt đối tác thì ẩn khỏi trang tìm kiếm công khai,
    // dù `status`/`operationalStatus` riêng của từng chi nhánh không đổi (khách cũ vẫn
    // check-in bình thường — chỉ khách MỚI không tìm thấy để đăng ký).
    const hidden = new Set(hiddenOwnerIds);
    const gyms = hidden.size > 0 ? allGyms.filter((g) => !hidden.has(g.ownerId)) : allGyms;
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
        ...toPublicGym(g),
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
    const gym = await gymRepository.findApprovedById(id);
    if (!gym) throw err('Gym not found', 404);
    const hiddenOwnerIds = await partnerGuard.hiddenFromPublicOwnerUserIds();
    if (hiddenOwnerIds.includes(gym.ownerId)) throw err('Gym not found', 404);
    const [r, photos, siblings] = await Promise.all([
      reviewRepository.aggregateForGym(id),
      prisma.gymPhoto.findMany({ where: { gymId: id }, orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }] }),
      gym.brandId
        ? prisma.gym.findMany({
            where: { brandId: gym.brandId, status: 'APPROVED', operationalStatus: 'OPEN' },
            select: { id: true, name: true, approvedName: true, address: true, approvedAddress: true, latitude: true, longitude: true },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    const pub = toPublicGym(gym);
    return {
      ...pub,
      averageRating: round2(r.averageRating),
      reviewCount: r.count,
      // Chỉ tới được đây khi chi nhánh ĐÃ DUYỆT (findApprovedById) — ảnh nộp lúc xin duyệt giờ mới
      // hiện cho khách. Bucket vẫn riêng tư: mỗi ảnh là link ký tạm (resolvePhotoUrl).
      photos: (
        await Promise.all(photos.map(async (p) => ({ id: p.id, category: p.category, isCover: p.isCover, url: await resolvePhotoUrl(p) })))
      ).filter((p) => p.url),
      brand: pub.brand ? { ...pub.brand, logoUrl: await brandLogoUrl(gym.brand?.logoKey) } : pub.brand,
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
    },
  ) {
    const existingBrands = await brandService.listOwned(ownerId);
    const brand = existingBrands[0];
    if (!brand) {
      throw err('Hãy đặt tên thương hiệu của bạn trước khi tạo phòng gym', 400);
    }
    return gymRepository.create({
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
      brand: { connect: { id: brand.id } },
    });
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

    if (data.locationNote !== undefined) patch.locationNote = data.locationNote;
    // GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 4. Free edit, no pending*/material-change
    // overlay like name/address above — same discipline as locationNote.
    if (data.facilities !== undefined) patch.facilities = data.facilities;
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

    return gymRepository.update(gymId, patch);
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
  async setStatus(gymId: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED') {
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

    return gymRepository.updateStatus(gymId, status);
  },

  /**
   * Vòng 4 / Phase C2 — the dedicated "Duyệt đổi tên/địa chỉ" admin action for an
   * ALREADY-approved gym's later rename. Promotes whichever of name/address actually has
   * something pending; leaves the other untouched if only one was changed.
   */
  async approveRename(gymId: string) {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);
    if (gym.pendingName === null && gym.pendingAddress === null) {
      throw err('Phòng gym này không có tên/địa chỉ nào đang chờ duyệt', 409);
    }
    return gymRepository.update(gymId, {
      ...(gym.pendingName !== null ? { approvedName: gym.pendingName, pendingName: null } : {}),
      ...(gym.pendingAddress !== null ? { approvedAddress: gym.pendingAddress, pendingAddress: null } : {}),
      pendingNameNote: null,
      pendingAddressNote: null,
      changesRequestedAt: null,
      changesRequestedBy: null,
    });
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
    if (data.description !== undefined) patch.description = data.description;
    if (data.city !== undefined) patch.city = data.city;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.email !== undefined) patch.email = data.email;
    if ((data.name !== undefined || data.address !== undefined)) {
      patch.changesRequestedAt = null;
      patch.changesRequestedBy = null;
    }

    return gymRepository.update(gymId, patch);
  },

  /**
   * Vòng 4 / Phase C3 — the owner's own open/closed switch, independent from admin moderation
   * `status`. State machine: OPEN -> TEMPORARILY_CLOSED or PERMANENTLY_CLOSED (reason
   * required); TEMPORARILY_CLOSED -> OPEN (reopen) or PERMANENTLY_CLOSED; PERMANENTLY_CLOSED is
   * terminal — nothing here transitions out of it (that would need actual admin/manual
   * intervention, out of this phase's scope).
   */
  async setOperationalStatus(
    gymId: string,
    ownerId: string,
    target: GymOperationalStatus,
    reason?: string,
    expectedReopenAt?: Date,
  ) {
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
      // Reopen date is only meaningful for a temporary closure — a permanent one has none.
      expectedReopenAt: target === 'TEMPORARILY_CLOSED' ? expectedReopenAt ?? null : null,
    });

    if (target === 'PERMANENTLY_CLOSED') {
      const memberships = await membershipRepository.findByGym(gymId);
      const activeCount = memberships.filter((m) => m.status === 'ACTIVE').length;
      logger.warn(
        `[Gym] ${gymId} (${gym.name}) PERMANENTLY_CLOSED by owner — ${activeCount} active membership(s) need admin review for a refund (reason: GYM_CLOSED)`,
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
    await this.getOwnedGym(gymId, ownerId); // ownership check only — throws if not this owner's gym

    const { membershipService } = await import('./membership.service');
    const { paymentClient } = await import('../clients/payment.client');
    const { prisma } = await import('../repositories/prisma');

    const [activeMemberships, activeCollaborations, wallet] = await Promise.all([
      membershipRepository.findActiveByGyms([gymId]),
      prisma.gymPtCollaboration.count({ where: { gymId, status: 'ACCEPTED' } }),
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
