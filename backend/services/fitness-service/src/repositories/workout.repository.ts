import { prisma } from './prisma';

const workoutInclude = {
  exercises: {
    include: { exercise: true },
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
          })),
        },
      },
      include: workoutInclude,
    });
  },

  delete: (id: string) => prisma.workout.delete({ where: { id } }),

  findForStats: (userId: string, startDate: Date) =>
    prisma.workout.findMany({
      where: { userId, date: { gte: startDate } },
      include: { exercises: true },
    }),
};
