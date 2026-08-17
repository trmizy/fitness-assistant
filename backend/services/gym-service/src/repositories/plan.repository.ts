import { prisma } from './prisma';
import { Prisma } from '../generated/prisma';

export const planRepository = {
  async create(data: Prisma.GymMembershipPlanCreateInput) {
    return prisma.gymMembershipPlan.create({ data });
  },

  async findById(id: string) {
    return prisma.gymMembershipPlan.findUnique({ where: { id } });
  },

  async update(id: string, data: Prisma.GymMembershipPlanUpdateInput) {
    return prisma.gymMembershipPlan.update({ where: { id }, data });
  },

  /** Public listing: active AND currently inside its sale window (or has none). A plan whose
   * campaign already ended must disappear here without touching memberships already sold. */
  async findActiveByGym(gymId: string) {
    const now = new Date();
    return prisma.gymMembershipPlan.findMany({
      where: {
        gymId,
        status: 'ACTIVE',
        AND: [
          { OR: [{ saleStartAt: null }, { saleStartAt: { lte: now } }] },
          { OR: [{ saleEndAt: null }, { saleEndAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  async findAllByGym(gymId: string) {
    return prisma.gymMembershipPlan.findMany({ where: { gymId }, orderBy: { createdAt: 'asc' } });
  },
};
