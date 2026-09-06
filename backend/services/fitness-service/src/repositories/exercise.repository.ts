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
    const [bodyParts, equipments, activityTypes, types, muscleRows, difficultyRows, loggingModeRows] =
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
        // Product Completeness pass — Exercise Library difficulty/logging-mode
        // filters (spec §16), same distinct-values convention as the fields
        // above.
        prisma.exercise.findMany({
          distinct: ["difficultyLevel"],
          select: { difficultyLevel: true },
          where: { difficultyLevel: { not: null } },
          orderBy: { difficultyLevel: "asc" },
        }),
        prisma.exercise.findMany({
          distinct: ["loggingMode"],
          select: { loggingMode: true },
          orderBy: { loggingMode: "asc" },
        }),
      ]);

    return {
      bodyParts: bodyParts.map((row) => row.bodyPart),
      equipments: equipments.map((row) => row.typeOfEquipment),
      activityTypes: activityTypes.map((row) => row.typeOfActivity),
      types: types.map((row) => row.type),
      muscleGroups: Array.from(
        new Set(muscleRows.flatMap((row) => row.muscleGroupsActivated)),
      ).sort(),
      difficultyLevels: difficultyRows
        .map((row) => row.difficultyLevel)
        .filter((v): v is string => !!v),
      loggingModes: loggingModeRows.map((row) => row.loggingMode),
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

  // Product Completeness pass — Exercise Detail page's "Aliases if
  // available" / "Media/license attribution" (spec §17). A separate cache
  // key/method rather than widening findById's `include`: findById's other
  // caller (getMuscleMap's existence check) only ever reads `.exerciseName`
  // and shouldn't pay for aliases/sources on every muscle-map lookup, and a
  // shared cache key with two different shapes would be a real footgun.
  async findByIdWithDetails(id: string) {
    const cacheKey = `exercise-detail:${id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const exercise = await prisma.exercise.findUnique({
      where: { id },
      include: {
        aliases: { orderBy: [{ language: "asc" }, { aliasType: "asc" }] },
        sources: { orderBy: { importedAt: "asc" } },
      },
    });
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

  // Gate 6 (exercise/anatomy data-expansion roadmap) — real ExerciseMuscle
  // links for the muscle-map UI, with primary/secondary role intact
  // (impossible to get from the legacy flat muscleGroupsActivated
  // column). Returns [] for an exercise with no mapping yet — the UI's
  // job to render an explicit "chưa có dữ liệu" state for that, never
  // guessed from the exercise name.
  async findMuscleLinks(exerciseId: string) {
    return prisma.exerciseMuscle.findMany({
      where: { exerciseId },
      include: { muscle: true },
      orderBy: [{ role: "asc" }],
    });
  },

  async listAllMuscles() {
    return prisma.muscle.findMany({ orderBy: [{ anatomyRegion: "asc" }, { code: "asc" }] });
  },

  // Product Completeness pass — Muscle Library detail page's "related
  // exercises" list. `:muscleId` in the route can be either the Muscle's
  // uuid `id` or its stable `code` (the Muscle Library list page links by
  // `code` since that's what GET /exercises/muscles already keys its rows
  // on) — resolve either the same way GET /exercises/:id/muscle-map already
  // treats the ExerciseMuscle table as the one source of truth for muscle
  // mapping, never the legacy muscleGroupsActivated array.
  findMuscleByIdOrCode(idOrCode: string) {
    return prisma.muscle.findFirst({
      where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
    });
  },

  async findExercisesByMuscleId(
    muscleId: string,
    options?: { skip?: number; take?: number },
  ) {
    // Same visibility gate as the public GET /exercises browse path
    // (exercise.service.ts's listExercises): PUBLISHED + SYSTEM only, never
    // another user's USER_CUSTOM exercise.
    const where = {
      status: "PUBLISHED",
      source: "SYSTEM",
      muscleLinks: { some: { muscleId } },
    };
    const [rows, total] = await Promise.all([
      prisma.exercise.findMany({
        where,
        orderBy: { exerciseName: "asc" },
        skip: options?.skip,
        take: options?.take,
        include: {
          muscleLinks: { where: { muscleId }, select: { role: true } },
        },
      }),
      prisma.exercise.count({ where }),
    ]);
    const exercises = rows.map(({ muscleLinks, ...exercise }) => ({
      ...exercise,
      // Whether this exercise trains the muscle as a primary or secondary
      // mover — a muscle can only have one role per exercise
      // (`@@unique([exerciseId, muscleId, role])` isn't quite that, but in
      // practice seed data never double-links the same pair with both
      // roles), so the first (only) match is authoritative.
      muscleRole: muscleLinks[0]?.role ?? null,
    }));
    return { exercises, total };
  },
};
