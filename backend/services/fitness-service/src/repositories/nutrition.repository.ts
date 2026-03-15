import { prisma } from './prisma';

export const nutritionRepository = {
  findMany: (where: Record<string, any>) =>
    prisma.nutritionLog.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 100,
    }),

  findOne: (id: string, userId: string) =>
    prisma.nutritionLog.findFirst({ where: { id, userId } }),

  create: (userId: string, data: any) =>
    prisma.nutritionLog.create({
      data: {
        userId,
        date: data.date ? new Date(data.date) : new Date(),
        mealType: data.mealType,
        foodName: data.foodName,
        calories: data.calories,
        protein: data.protein,
        carbs: data.carbs,
        fats: data.fats,
        notes: data.notes,
      },
    }),

  delete: (id: string) => prisma.nutritionLog.delete({ where: { id } }),

  findForStats: (userId: string, startDate: Date) =>
    prisma.nutritionLog.findMany({
      where: { userId, date: { gte: startDate } },
    }),
};
