import { prisma } from "./prisma";
import { redisClient } from "./redis";

export const exerciseRepository = {
  async findMany(
    where: Record<string, any>,
    options?: { skip?: number; take?: number },
  ) {
    const cacheKey = `exercises:${JSON.stringify({ where, options })}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return { data: JSON.parse(cached), fromCache: true };
    }

    const exercises = await prisma.exercise.findMany({
      where,
      orderBy: { exerciseName: "asc" },
      skip: options?.skip,
      take: options?.take,
    });

    await redisClient.setEx(cacheKey, 300, JSON.stringify(exercises));
    return { data: exercises, fromCache: false };
  },

  count(where: Record<string, any>) {
    return prisma.exercise.count({ where });
  },

  async getFilterOptions() {
    const [bodyParts, equipments, activityTypes, types, muscleRows] =
      await Promise.all([
        prisma.exercise.findMany({
          distinct: ["bodyPart"],
          select: { bodyPart: true },
          orderBy: { bodyPart: "asc" },
        }),
        prisma.exercise.findMany({
          distinct: ["typeOfEquipment"],
          select: { typeOfEquipment: true },
          orderBy: { typeOfEquipment: "asc" },
        }),
        prisma.exercise.findMany({
          distinct: ["typeOfActivity"],
          select: { typeOfActivity: true },
          orderBy: { typeOfActivity: "asc" },
        }),
        prisma.exercise.findMany({
          distinct: ["type"],
          select: { type: true },
          orderBy: { type: "asc" },
        }),
        prisma.exercise.findMany({ select: { muscleGroupsActivated: true } }),
      ]);

    return {
      bodyParts: bodyParts.map((row) => row.bodyPart),
      equipments: equipments.map((row) => row.typeOfEquipment),
      activityTypes: activityTypes.map((row) => row.typeOfActivity),
      types: types.map((row) => row.type),
      muscleGroups: Array.from(
        new Set(muscleRows.flatMap((row) => row.muscleGroupsActivated)),
      ).sort(),
    };
  },

  async findById(id: string) {
    const cacheKey = `exercise:${id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const exercise = await prisma.exercise.findUnique({ where: { id } });
    if (exercise)
      await redisClient.setEx(cacheKey, 300, JSON.stringify(exercise));
    return exercise;
  },

  findManyByIds(ids: string[]) {
    return prisma.exercise.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
  },

  async create(data: any) {
    const created = await prisma.exercise.create({ data });
    // Best-effort cache invalidation — keyspace is small, easier to nuke patterns.
    try {
      const keys = await redisClient.keys("exercises:*");
      if (keys.length) await redisClient.del(keys);
    } catch {}
    return created;
  },
};
