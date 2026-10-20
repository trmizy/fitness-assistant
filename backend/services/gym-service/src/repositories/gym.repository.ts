import { prisma } from './prisma';
import { Prisma, GymStatus, GymOperationalStatus } from '../generated/prisma';
import { runAsCompatWriter } from './compat-writer';
import { publishStagedGymPhotosTx, wasNeverPublic } from '../services/gym-photo-lifecycle';

export const gymRepository = {
  async create(data: Prisma.GymCreateInput) {
    return runAsCompatWriter((tx) => tx.gym.create({ data }));
  },

  async findById(id: string) {
    return prisma.gym.findUnique({ where: { id } });
  },

  async update(id: string, data: Prisma.GymUpdateInput) {
    return runAsCompatWriter((tx) => tx.gym.update({ where: { id }, data }));
  },

  // The PUBLIC reads (approved AND open AND owner not hidden, with only ACTIVE amenities / PUBLISHED photos) live in
  // services/gym-public.ts (`gymPublicRepository`) next to the one visibility rule - Listing Management B1.

  async findByOwner(ownerId: string) {
    return prisma.gym.findMany({
      where: { ownerId },
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** The FIRST approval of a branch (DRAFT / PENDING_REVIEW / REJECTED -> APPROVED) also publishes its STAGED photos,
   * in the same transaction - clients only ever see PUBLISHED, so an approved branch would otherwise show none. */
  async updateStatus(id: string, status: GymStatus) {
    return runAsCompatWriter(async (tx) => {
      let firstApproval = false;
      if (status === 'APPROVED') {
        const current = await tx.gym.findUnique({ where: { id }, select: { status: true, listingVersion: true } });
        if (current && wasNeverPublic(current.status)) {
          await publishStagedGymPhotosTx(tx, id);
          // the first approval IS listing v1 (same rule as a PT's approved application); a re-approval changes nothing
          firstApproval = current.listingVersion === 0;
        }
      }
      return tx.gym.update({
        where: { id },
        data: { status, ...(firstApproval ? { listingVersion: 1, listingPublishedAt: new Date() } : {}) },
      });
    });
  },

  /** Admin moderation queue — every gym, optionally filtered to one moderation status (most
   * useful for PENDING_REVIEW, the "needs a first look" queue). Vòng 4 / Phase C: there was no
   * admin-facing gym list at all before this. */
  async findAllForAdmin(status?: GymStatus) {
    return prisma.gym.findMany({
      where: status ? { status } : undefined,
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Vòng 4 / Phase C3 — the "actionable item" for a permanently-closed gym: admin needs to
   * see these to go run the EXISTING refundByAdmin(reason: 'GYM_CLOSED') on any membership
   * still ACTIVE there. No new refund logic — this just surfaces which gyms need it. */
  async findPermanentlyClosed() {
    return prisma.gym.findMany({
      where: { operationalStatus: 'PERMANENTLY_CLOSED' },
      orderBy: { closedAt: 'desc' },
    });
  },

  async setOperationalStatus(
    id: string,
    operationalStatus: GymOperationalStatus,
    extra: {
      closureReason?: string | null;
      closedAt?: Date | null;
      closedBy?: string | null;
      reopenedAt?: Date | null;
      expectedReopenAt?: Date | null;
    },
  ) {
    return runAsCompatWriter((tx) => tx.gym.update({ where: { id }, data: { operationalStatus, ...extra } }));
  },
};
