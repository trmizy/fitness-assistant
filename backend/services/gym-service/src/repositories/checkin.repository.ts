import { prisma } from './prisma';

export const checkinRepository = {
  async listForGym(gymId: string, limit = 50) {
    return prisma.gymCheckIn.findMany({
      where: { gymId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
};
