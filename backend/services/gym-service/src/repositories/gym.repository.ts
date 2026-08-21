import { prisma } from './prisma';
import { Prisma, GymStatus } from '../generated/prisma';

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

  /** Public listing — approved gyms only. Includes the brand (if any) so the client can
   * group same-brand branches into one card without a second round-trip. */
  async findApproved() {
    return prisma.gym.findMany({
      where: { status: 'APPROVED' },
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findApprovedById(id: string) {
    return prisma.gym.findFirst({ where: { id, status: 'APPROVED' }, include: { brand: true } });
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
};
