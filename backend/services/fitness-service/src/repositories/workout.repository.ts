import { prisma } from './prisma';

const workoutInclude = {
  exercises: {
    include: {
      exercise: true,
      workoutSets: { orderBy: { setNumber: 'asc' as const } },
    },
    orderBy: { order: 'asc' as const },
  },
};

export const workoutRepository = {
  findMany: (where: Record<string, any>, limit = 50) =>
    prisma.workout.findMany({
      where,
      include: workoutInclude,
      orderBy: { date: 'desc' },
      take: limit,
    }),

  findOne: (id: string, userId: string) =>
    prisma.workout.findFirst({
      where: { id, userId },
      include: workoutInclude,
    }),

  create: (userId: string, data: any) =>
    prisma.workout.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        date: data.date ? new Date(data.date) : new Date(),
        duration: data.duration,
        notes: data.notes,
        exercises: {
          create: data.exercises.map((ex: any, index: number) => ({
            exerciseId: ex.exerciseId,
            sets: ex.sets,
            reps: ex.reps,
            duration: ex.duration,
            weight: ex.weight,
            notes: ex.notes,
            order: index,
            workoutSets: {
              create: Array.from({ length: ex.sets }, (_, i) => ({
                setNumber: i + 1,
                reps: ex.reps ?? null,
                weight: ex.weight ?? null,
                completed: false,
              })),
            },
          })),
        },
      },
      include: workoutInclude,
    }),

  async update(id: string, data: any) {
    await prisma.workoutExercise.deleteMany({ where: { workoutId: id } });
    return prisma.workout.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        date: data.date ? new Date(data.date) : undefined,
        duration: data.duration,
        notes: data.notes,
        exercises: {
          create: data.exercises.map((ex: any, index: number) => ({
            exerciseId: ex.exerciseId,
            sets: ex.sets,
            reps: ex.reps,
            duration: ex.duration,
            weight: ex.weight,
            notes: ex.notes,
            order: index,
            workoutSets: {
              create: Array.from({ length: ex.sets }, (_, i) => ({
                setNumber: i + 1,
                reps: ex.reps ?? null,
                weight: ex.weight ?? null,
                completed: false,
              })),
            },
          })),
        },
      },
      include: workoutInclude,
    });
  },

  delete: (id: string) => prisma.workout.delete({ where: { id } }),

  updateSet: (setId: string, data: { reps?: number; weight?: number; rpe?: number; completed?: boolean }) =>
    prisma.workoutSet.update({
      where: { id: setId },
      data,
    }),

  findSetWithOwner: (setId: string, userId: string) =>
    prisma.workoutSet.findFirst({
      where: {
        id: setId,
        workoutExercise: { workout: { userId } },
      },
    }),

  async findExercisePRs(userId: string, exerciseId?: string) {
    const where: any = { workout: { userId } };
    if (exerciseId) where.exerciseId = exerciseId;

    const records = await prisma.workoutExercise.findMany({
      where,
      include: { exercise: true, workout: { select: { date: true } } },
      orderBy: { weight: 'desc' },
    });

    // Group by exercise, keep max weight per exercise
    const prMap = new Map<string, any>();
    for (const r of records) {
      if (!r.weight) continue;
      const key = r.exerciseId;
      if (!prMap.has(key) || r.weight > prMap.get(key).weight) {
        prMap.set(key, {
          exerciseId: r.exerciseId,
          exerciseName: r.exercise?.exerciseName,
          weight: r.weight,
          reps: r.reps,
          sets: r.sets,
          date: r.workout?.date,
        });
      }
    }

    return Array.from(prMap.values());
  },

  findForStats: (userId: string, startDate: Date) =>
    prisma.workout.findMany({
      where: { userId, date: { gte: startDate } },
      include: { exercises: true },
    }),
};
