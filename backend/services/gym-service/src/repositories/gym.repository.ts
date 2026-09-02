import { prisma } from './prisma';
import { Prisma, GymStatus, GymOperationalStatus } from '../generated/prisma';

export const gymRepository = {
  async create(data: Prisma.GymCreateInput) {
    return prisma.gym.create({ data });
  },

  async findById(id: string) {
    return prisma.gym.findUnique({ where: { id } });
  },

  async update(id: string, data: Prisma.GymUpdateInput) {
    return prisma.gym.update({ where: { id }, data });
  },

  /** Public listing — approved AND open gyms only (Vòng 4 / Phase C3: a gym the owner has
   * temporarily/permanently closed must not be discoverable or purchasable, same as one still
   * PENDING_REVIEW). Includes the brand (if any) so the client can group same-brand branches
   * into one card without a second round-trip — gymService substitutes approvedName/
   * approvedAddress (and the brand's approvedName) into the response before it leaves here. */
  async findApproved() {
    return prisma.gym.findMany({
      where: { status: 'APPROVED', operationalStatus: 'OPEN' },
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findApprovedById(id: string) {
    return prisma.gym.findFirst({
      where: { id, status: 'APPROVED', operationalStatus: 'OPEN' },
      include: { brand: true },
    });
  },

  async findByOwner(ownerId: string) {
    return prisma.gym.findMany({
      where: { ownerId },
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
    });
  },

  async updateStatus(id: string, status: GymStatus) {
    return prisma.gym.update({ where: { id }, data: { status } });
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
    extra: { closureReason?: string | null; closedAt?: Date | null; reopenedAt?: Date | null },
  ) {
    return prisma.gym.update({ where: { id }, data: { operationalStatus, ...extra } });
  },
};
