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

  /** Public listing — approved gyms only. */
  async findApproved() {
    return prisma.gym.findMany({ where: { status: 'APPROVED' }, orderBy: { createdAt: 'desc' } });
  },

  async findApprovedById(id: string) {
    return prisma.gym.findFirst({ where: { id, status: 'APPROVED' } });
  },

  async findByOwner(ownerId: string) {
    return prisma.gym.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } });
  },

  async updateStatus(id: string, status: GymStatus) {
    return prisma.gym.update({ where: { id }, data: { status } });
  },
};
