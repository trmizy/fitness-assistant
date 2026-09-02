import { logger } from '@gym-coach/shared';
import { gymRepository } from '../repositories/gym.repository';
import { brandRepository } from '../repositories/brand.repository';
import { reviewRepository } from '../repositories/review.repository';
import { membershipRepository } from '../repositories/membership.repository';
import { brandService } from './brand.service';
import type { GymOperationalStatus } from '../generated/prisma';

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
    const gyms = await gymRepository.findApproved();
    const ratings = await reviewRepository.aggregateForGyms(gyms.map((g) => g.id));
    return gyms.map((g) => {
      const r = ratings.get(g.id);
      return { ...toPublicGym(g), averageRating: round2(r?.averageRating ?? 0), reviewCount: r?.count ?? 0 };
    });
  },

  async getApprovedById(id: string) {
    const gym = await gymRepository.findApprovedById(id);
    if (!gym) throw err('Gym not found', 404);
    const r = await reviewRepository.aggregateForGym(id);
    return { ...toPublicGym(gym), averageRating: round2(r.averageRating), reviewCount: r.count };
  },

  async createGym(ownerId: string, data: { name: string; description?: string; address: string; city?: string; phone?: string; email?: string; brandId?: string }) {
    // A branch must join a brand the same owner actually created — otherwise anyone could
    // attach their gym to someone else's chain by guessing a brandId.
    if (data.brandId) await brandService.getOwnedBrand(data.brandId, ownerId);
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
      ...(data.brandId ? { brand: { connect: { id: data.brandId } } } : {}),
    });
  },

  async getOwnedGym(gymId: string, ownerId: string) {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);
    if (gym.ownerId !== ownerId) throw err('Not authorized — you do not own this gym', 403);
    return gym;
  },

  async listOwned(ownerId: string) {
    return gymRepository.findByOwner(ownerId);
  },

  /**
   * Vòng 4 / Phase C2/C4 — name/address changes only ever move pendingName/pendingAddress
   * (approvedName/approvedAddress stay untouched until the admin approves them); every other
   * field here (description/city/phone/email) stays freely editable exactly as before this
   * phase. brandId (C4) lets an owner move a gym to a brand they own, or pass null to detach —
   * same ownership check createGym already used, reused rather than duplicated.
   */
  async updateOwnedGym(
    gymId: string,
    ownerId: string,
    data: Partial<{ name: string; description: string; address: string; city: string; phone: string; email: string; brandId: string | null }>,
  ) {
    const gym = await this.getOwnedGym(gymId, ownerId);
    const patch: Record<string, unknown> = {};

    if (data.name !== undefined) {
      patch.name = data.name;
      if (data.name !== gym.name) patch.pendingName = data.name;
    }
    if (data.address !== undefined) {
      patch.address = data.address;
      if (data.address !== gym.address) patch.pendingAddress = data.address;
    }
    if (data.description !== undefined) patch.description = data.description;
    if (data.city !== undefined) patch.city = data.city;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.email !== undefined) patch.email = data.email;

    if (data.brandId !== undefined) {
      if (data.brandId) {
        await brandService.getOwnedBrand(data.brandId, ownerId);
        patch.brand = { connect: { id: data.brandId } };
      } else {
        patch.brand = { disconnect: true };
      }
    }

    return gymRepository.update(gymId, patch);
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
    });
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
        reopenedAt: new Date(),
      });
    }

    // TEMPORARILY_CLOSED or PERMANENTLY_CLOSED — both require a reason (the `closureReason`
    // column exists specifically so an actionable item / admin queue has something to show).
    if (!reason?.trim()) throw err('Vui lòng cho biết lý do đóng cửa', 400);

    const updated = await gymRepository.setOperationalStatus(gymId, target, {
      closureReason: reason.trim(),
      closedAt: new Date(),
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
