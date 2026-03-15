import { prisma } from './prisma';
import { redisClient } from './redis';

export const exerciseRepository = {
  async findMany(where: Record<string, any>) {
    const cacheKey = `exercises:${JSON.stringify(where)}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return { data: JSON.parse(cached), fromCache: true };
    }

    const exercises = await prisma.exercise.findMany({
      where,
      orderBy: { exerciseName: 'asc' },
    });

    await redisClient.setEx(cacheKey, 300, JSON.stringify(exercises));
    return { data: exercises, fromCache: false };
  },

  async findById(id: string) {
    const cacheKey = `exercise:${id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const exercise = await prisma.exercise.findUnique({ where: { id } });
    if (exercise) await redisClient.setEx(cacheKey, 300, JSON.stringify(exercise));
    return exercise;
  },
};
