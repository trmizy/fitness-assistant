import { PrismaClient } from '../generated/prisma';
import { normalizeVietnamese } from '../utils/normalize';

const prisma = new PrismaClient();

export const locationRepository = {
  findAllProvinces: () =>
    prisma.vietnamProvince.findMany({
      select: { code: true, name: true, codename: true, divisionType: true },
      orderBy: { name: 'asc' },
    }),

  findProvinceByCode: (code: number) =>
    prisma.vietnamProvince.findUnique({ where: { code } }),

  findWardsByProvince: (provinceCode: number) =>
    prisma.vietnamWard.findMany({
      where: { provinceCode },
      select: { code: true, name: true, codename: true, divisionType: true, shortCodename: true },
      orderBy: { name: 'asc' },
    }),

  findWardByCode: (code: number) =>
    prisma.vietnamWard.findUnique({ where: { code } }),

  searchLocations: (q: string) => {
    const normalized = normalizeVietnamese(q);
    const normalizedUnderscore = normalized.replace(/\s+/g, '_');
    return prisma.vietnamWard.findMany({
      where: {
        OR: [
          { nameNormalized: { contains: normalized } },
          { codename: { contains: normalizedUnderscore } },
          { shortCodename: { contains: normalizedUnderscore } },
        ],
      },
      include: { province: { select: { name: true } } },
      take: 20,
      orderBy: { name: 'asc' },
    });
  },
};
