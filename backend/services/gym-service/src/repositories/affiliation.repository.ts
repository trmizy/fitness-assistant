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

  // Public, unauthenticated (GET /gyms/:gymId/trainers) — an explicit select, not the whole
  // row: `commissionRate` is the gym's negotiated cut and `invitedBy` an owner's user id.
  // Neither is public information; a new column must be opted in here, not leak by default.
  async findPublicByGym(gymId: string) {
    return prisma.gymTrainerAffiliation.findMany({
      where: { gymId, status: 'ACTIVE', visibility: 'PUBLIC' },
      select: {
        id: true,
        gymId: true,
        ptId: true,
        status: true,
        employmentType: true,
        visibility: true,
        joinedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async findByPT(ptId: string) {
    return prisma.gymTrainerAffiliation.findMany({ where: { ptId }, orderBy: { createdAt: 'desc' } });
  },

  async findPendingByPT(ptId: string) {
    return prisma.gymTrainerAffiliation.findMany({ where: { ptId, status: 'PENDING' } });
  },
};
