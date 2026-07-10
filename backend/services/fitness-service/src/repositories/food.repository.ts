import { prisma } from "./prisma";
import { normalizeVietnamese } from "../utils/normalizeVietnamese";

export const foodRepository = {
  searchByName: async (query: string, limit = 20) => {
    const q = query.trim();
    if (q.length < 2) return [];
    const normalized = normalizeVietnamese(q);

    return prisma.food.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          {
            aliases: {
              some: {
                OR: [
                  { alias: { contains: q, mode: "insensitive" } },
                  {
                    aliasNormalized: {
                      contains: normalized,
                      mode: "insensitive",
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      take: limit,
      orderBy: { name: "asc" },
    });
  },

  updateImageUrl: (id: string, imageUrl: string) =>
    prisma.food.update({ where: { id }, data: { imageUrl } }),
};
