import { prisma } from './prisma';

export const foodRepository = {
  searchByName: (query: string, limit = 20) =>
    prisma.food.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      take: limit,
    }),

  updateImageUrl: (id: string, imageUrl: string) =>
    prisma.food.update({ where: { id }, data: { imageUrl } }),
};
