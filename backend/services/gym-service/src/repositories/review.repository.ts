import { prisma } from './prisma';

export const reviewRepository = {
  async listForGym(gymId: string) {
    return prisma.gymReview.findMany({ where: { gymId }, orderBy: { updatedAt: 'desc' } });
  },

  async findOwn(gymId: string, clientId: string) {
    return prisma.gymReview.findUnique({ where: { gymId_clientId: { gymId, clientId } } });
  },

  async aggregateForGym(gymId: string): Promise<{ averageRating: number; count: number }> {
    const agg = await prisma.gymReview.aggregate({ where: { gymId }, _avg: { rating: true }, _count: true });
    return { averageRating: agg._avg.rating ?? 0, count: agg._count };
  },

  /** One grouped query for many gyms (used by the public gym list). */
  async aggregateForGyms(gymIds: string[]): Promise<Map<string, { averageRating: number; count: number }>> {
    const map = new Map<string, { averageRating: number; count: number }>();
    if (gymIds.length === 0) return map;
    const rows = await prisma.gymReview.groupBy({
      by: ['gymId'],
      where: { gymId: { in: gymIds } },
      _avg: { rating: true },
      _count: true,
    });
    for (const r of rows) map.set(r.gymId, { averageRating: r._avg.rating ?? 0, count: r._count });
    return map;
  },

  async upsert(gymId: string, clientId: string, rating: number, comment: string | null) {
    return prisma.gymReview.upsert({
      where: { gymId_clientId: { gymId, clientId } },
      create: { gymId, clientId, rating, comment },
      update: { rating, comment },
    });
  },

  async deleteOwn(gymId: string, clientId: string) {
    return prisma.gymReview.deleteMany({ where: { gymId, clientId } });
  },
};
