import { prisma } from './prisma';

export const commissionRateRepository = {
  create(data: { rate: number; effectiveFrom: Date; createdBy?: string | null }) {
    return prisma.platformCommissionRate.create({ data });
  },

  /** Dòng mới nhất có hiệu lực tại thời điểm `asOf` — KHÔNG BAO GIỜ trả về một dòng có
   * effectiveFrom trong tương lai so với asOf. */
  findEffectiveAsOf(asOf: Date) {
    return prisma.platformCommissionRate.findFirst({
      where: { effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
  },

  listAll() {
    return prisma.platformCommissionRate.findMany({ orderBy: { effectiveFrom: 'desc' } });
  },
};
