import { prisma } from "./prisma";
import { randomUUID } from "crypto";

type NutritionGoalRow = {
  id: string;
  userId: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  waterMl: number | null;
};

export const nutritionRepository = {
  findMany: (where: Record<string, any>) =>
    prisma.nutritionLog.findMany({
      where,
      orderBy: { date: "desc" },
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

  // Partial update — only mutable snapshot fields are accepted.
  update: (id: string, data: any) => {
    const patch: Record<string, any> = {};
    if (data.mealType !== undefined) patch.mealType = data.mealType;
    if (data.foodName !== undefined) patch.foodName = data.foodName;
    if (data.calories !== undefined) patch.calories = data.calories;
    if (data.protein !== undefined) patch.protein = data.protein;
    if (data.carbs !== undefined) patch.carbs = data.carbs;
    if (data.fats !== undefined) patch.fats = data.fats;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.date !== undefined) patch.date = new Date(data.date);
    return prisma.nutritionLog.update({ where: { id }, data: patch });
  },

  findForStats: (userId: string, startDate: Date) =>
    prisma.nutritionLog.findMany({
      where: { userId, date: { gte: startDate } },
    }),

  findGoalByUserId: async (
    userId: string,
  ): Promise<NutritionGoalRow | null> => {
    const rows = await prisma.$queryRaw<NutritionGoalRow[]>`
      SELECT
        id,
        user_id AS "userId",
        calories,
        protein,
        carbs,
        fat,
        water_ml AS "waterMl"
      FROM nutrition_goals
      WHERE user_id = ${userId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  },

  upsertGoal: async (
    userId: string,
    data: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      waterMl?: number | null;
    },
  ): Promise<NutritionGoalRow> => {
    const rows = await prisma.$queryRaw<NutritionGoalRow[]>`
      INSERT INTO nutrition_goals (
        id,
        user_id,
        calories,
        protein,
        carbs,
        fat,
        water_ml,
        created_at,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${userId},
        ${data.calories},
        ${data.protein},
        ${data.carbs},
        ${data.fat},
        ${data.waterMl ?? null},
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        calories = EXCLUDED.calories,
        protein = EXCLUDED.protein,
        carbs = EXCLUDED.carbs,
        fat = EXCLUDED.fat,
        water_ml = EXCLUDED.water_ml,
        updated_at = NOW()
      RETURNING
        id,
        user_id AS "userId",
        calories,
        protein,
        carbs,
        fat,
        water_ml AS "waterMl"
    `;
    return rows[0];
  },
};
