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

  async findActiveByGym(gymId: string) {
    return prisma.gymMembershipPlan.findMany({ where: { gymId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
  },

  async findAllByGym(gymId: string) {
    return prisma.gymMembershipPlan.findMany({ where: { gymId }, orderBy: { createdAt: 'asc' } });
  },
};
