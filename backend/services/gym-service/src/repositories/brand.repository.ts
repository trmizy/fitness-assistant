import { prisma } from './prisma';
import { Prisma } from '../generated/prisma';

export const brandRepository = {
  async create(data: Prisma.GymBrandCreateInput) {
    return prisma.gymBrand.create({ data });
  },

  async findById(id: string) {
    return prisma.gymBrand.findUnique({ where: { id } });
  },

  async findByOwner(ownerId: string) {
    return prisma.gymBrand.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } });
  },

  /** A brand plus its branches — the owner's branch-management view. */
  async findByIdWithBranches(id: string) {
    return prisma.gymBrand.findUnique({
      where: { id },
      include: { branches: { orderBy: { createdAt: 'asc' } } },
    });
  },

  async update(id: string, data: Prisma.GymBrandUpdateInput) {
    return prisma.gymBrand.update({ where: { id }, data });
  },
};
