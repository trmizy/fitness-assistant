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
  status?: string;
  validFrom?: Date;
  triggeredBy?: string | null;
  reason?: string | null;
  goalMode?: string;
  trainingCycleId?: string | null;
  createdByUserId?: string | null;
  previousGoalId?: string | null;
  sourceAssessmentId?: string | null;
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

  // Only the currently-ACTIVE prescription — callers wanting history should
  // use findGoalHistoryByUserId instead.
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
        water_ml AS "waterMl",
        status,
        valid_from AS "validFrom",
        triggered_by AS "triggeredBy",
        reason,
        goal_mode AS "goalMode",
        training_cycle_id AS "trainingCycleId",
        created_by_user_id AS "createdByUserId",
        previous_goal_id AS "previousGoalId",
        source_assessment_id AS "sourceAssessmentId"
      FROM nutrition_goals
      WHERE user_id = ${userId} AND status = 'ACTIVE'
      LIMIT 1
    `;
    return rows[0] ?? null;
  },

  /** By id, any status — for rendering "Current: X -> Proposed: Y" in a PT
   * review UI, which needs to read a specific (possibly SUPERSEDED) row. */
  findGoalById: async (id: string): Promise<NutritionGoalRow | null> => {
    const rows = await prisma.$queryRaw<NutritionGoalRow[]>`
      SELECT
        id, user_id AS "userId", calories, protein, carbs, fat,
        water_ml AS "waterMl", status, valid_from AS "validFrom",
        triggered_by AS "triggeredBy", reason, goal_mode AS "goalMode",
        training_cycle_id AS "trainingCycleId",
        created_by_user_id AS "createdByUserId",
        previous_goal_id AS "previousGoalId",
        source_assessment_id AS "sourceAssessmentId"
      FROM nutrition_goals
      WHERE id = ${id}
    `;
    return rows[0] ?? null;
  },

  /** Full version history, newest first — for an eventual "why did my
   * calories change" audit view. Not currently surfaced by any route. */
  findGoalHistoryByUserId: async (userId: string): Promise<NutritionGoalRow[]> =>
    prisma.$queryRaw<NutritionGoalRow[]>`
      SELECT
        id, user_id AS "userId", calories, protein, carbs, fat,
        water_ml AS "waterMl", status, valid_from AS "validFrom",
        triggered_by AS "triggeredBy", reason, goal_mode AS "goalMode",
        training_cycle_id AS "trainingCycleId",
        created_by_user_id AS "createdByUserId",
        previous_goal_id AS "previousGoalId",
        source_assessment_id AS "sourceAssessmentId"
      FROM nutrition_goals
      WHERE user_id = ${userId}
      ORDER BY valid_from DESC
    `,

  /**
   * Creates a NEW active nutrition-goal version, superseding whatever was
   * previously ACTIVE for this user rather than overwriting it in place —
   * the old row (and every row before it) stays in the table forever,
   * `status = 'SUPERSEDED'`, so "what was my calorie target 3 weeks ago and
   * why did it change" stays answerable. Mirrors PersonalizedServicePlanVersion's
   * DELIVERED/ACCEPTED/SUPERSEDED pattern (ai-service).
   */
  upsertGoal: async (
    userId: string,
    data: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      waterMl?: number | null;
      goalMode?: "RECOMMENDED" | "CUSTOM";
    },
    options?: {
      reason?: string;
      triggeredBy?: "ONBOARDING" | "MANUAL" | "AI_ADAPTIVE" | "PT";
      trainingCycleId?: string | null;
      createdByUserId?: string | null;
      sourceAssessmentId?: string | null;
    },
  ): Promise<NutritionGoalRow> => {
    const newId = randomUUID();
    // Phase 2 (PT nutrition workflow) — capture whatever WAS active right
    // before this call as previousGoalId. The append-only SUPERSEDED chain
    // already makes this reconstructable from validFrom ordering, but an
    // explicit pointer is what the PT "Current -> Proposed" review UI reads
    // directly, with no ambiguity.
    const current = await nutritionRepository.findGoalByUserId(userId);
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE nutrition_goals
        SET status = 'SUPERSEDED', superseded_at = NOW()
        WHERE user_id = ${userId} AND status = 'ACTIVE'
      `,
      prisma.$executeRaw`
        INSERT INTO nutrition_goals (
          id, user_id, calories, protein, carbs, fat, water_ml,
          status, valid_from, reason, triggered_by, goal_mode, training_cycle_id,
          created_by_user_id, previous_goal_id, source_assessment_id, created_at, updated_at
        )
        VALUES (
          ${newId}, ${userId}, ${data.calories}, ${data.protein}, ${data.carbs}, ${data.fat},
          ${data.waterMl ?? null}, 'ACTIVE', NOW(), ${options?.reason ?? null},
          ${options?.triggeredBy ?? "MANUAL"}, ${data.goalMode ?? "RECOMMENDED"},
          ${options?.trainingCycleId ?? null}, ${options?.createdByUserId ?? null},
          ${current?.id ?? null}, ${options?.sourceAssessmentId ?? null}, NOW(), NOW()
        )
      `,
    ]);
    const rows = await prisma.$queryRaw<NutritionGoalRow[]>`
      SELECT
        id, user_id AS "userId", calories, protein, carbs, fat,
        water_ml AS "waterMl", status, valid_from AS "validFrom",
        triggered_by AS "triggeredBy", reason, goal_mode AS "goalMode",
        training_cycle_id AS "trainingCycleId",
        created_by_user_id AS "createdByUserId",
        previous_goal_id AS "previousGoalId",
        source_assessment_id AS "sourceAssessmentId"
      FROM nutrition_goals
      WHERE id = ${newId}
    `;
    return rows[0];
  },
};
