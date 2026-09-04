import { Prisma } from '../generated/prisma';
import { prisma } from './prisma';

export const affiliationRepository = {
  async create(data: Prisma.GymTrainerAffiliationCreateInput) {
    return prisma.gymTrainerAffiliation.create({ data });
  },

  async findById(id: string) {
    return prisma.gymTrainerAffiliation.findUnique({ where: { id } });
  },

  async update(id: string, data: Prisma.GymTrainerAffiliationUpdateInput) {
    return prisma.gymTrainerAffiliation.update({ where: { id }, data });
  },

  async findPublicByGym(gymId: string) {
    return prisma.gymTrainerAffiliation.findMany({ where: { gymId, status: 'ACTIVE', visibility: 'PUBLIC' } });
  },

  async findByPT(ptId: string) {
    return prisma.gymTrainerAffiliation.findMany({ where: { ptId }, orderBy: { createdAt: 'desc' } });
  },

  async findPendingByPT(ptId: string) {
    return prisma.gymTrainerAffiliation.findMany({ where: { ptId, status: 'PENDING' } });
  },
};
