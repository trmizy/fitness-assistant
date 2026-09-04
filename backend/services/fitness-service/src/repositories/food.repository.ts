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

  // Product Completeness pass — Food Library browse page. Only a fuzzy
  // search-by-query existed before this; a plain paginated list is a
  // different access pattern (the empty-query "show me the catalog" state,
  // and stable ordering for pagination — searchByName has no `skip`/total
  // count and short-circuits under 2 characters).
  //
  // `sortBy` covers the "protein-rich / carb-rich / fat-rich" sort spec §18
  // explicitly allows (real, computable from Food's own numeric columns) —
  // deliberately distinct from a "food group/category" FILTER, which would
  // need a real taxonomy field that doesn't exist and is NOT added here.
  async findMany(options?: {
    skip?: number;
    take?: number;
    sortBy?: "name" | "protein" | "carbs" | "fats";
    source?: string;
    foodForm?: string;
    isSupplement?: boolean;
    hasImage?: boolean;
  }) {
    const where = {
      ...(options?.source ? { source: options.source } : {}),
      ...(options?.foodForm ? { foodForm: options.foodForm } : {}),
      ...(options?.isSupplement !== undefined
        ? { isSupplement: options.isSupplement }
        : {}),
      ...(options?.hasImage ? { imageUrl: { not: null } } : {}),
    };
    const orderBy =
      options?.sortBy && options.sortBy !== "name"
        ? [{ [options.sortBy]: "desc" as const }, { name: "asc" as const }]
        : { name: "asc" as const };
    const [rows, total] = await Promise.all([
      prisma.food.findMany({
        where,
        orderBy,
        skip: options?.skip,
        take: options?.take,
      }),
      prisma.food.count({ where }),
    ]);
    return { data: rows, total };
  },

  async getFilterOptions() {
    const [sources, foodForms] = await Promise.all([
      prisma.food.findMany({
        distinct: ["source"],
        select: { source: true },
        orderBy: { source: "asc" },
      }),
      prisma.food.findMany({
        distinct: ["foodForm"],
        where: { foodForm: { not: null } },
        select: { foodForm: true },
        orderBy: { foodForm: "asc" },
      }),
    ]);

    return {
      sources: sources.map((row) => row.source).filter(Boolean),
      foodForms: foodForms
        .map((row) => row.foodForm)
        .filter((value): value is string => Boolean(value)),
      supplementValues: [false, true],
    };
  },

  findById: (id: string) => prisma.food.findUnique({ where: { id } }),
};
