import { nutritionRepository } from '../repositories/nutrition.repository';
import type { CreateNutritionDto } from '../models/fitness.models';
import type { UpsertNutritionGoalDto } from '../models/fitness.models';

const DEFAULT_NUTRITION_GOAL = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 65,
  waterMl: null as number | null,
};

const PLAN_TO_LOG_MEAL_TYPE: Record<string, string> = {
  BREAKFAST: 'breakfast',
  LUNCH: 'lunch',
  DINNER: 'dinner',
  SNACK: 'snack',
};

function roundMacro(value: number) {
  return Math.round(value * 10) / 10;
}

function sumNutritionItems(items: any[]) {
  return items.reduce(
    (sum, item) => {
      sum.calories += Number(item.calories ?? 0);
      sum.protein += Number(item.proteinGrams ?? item.protein ?? 0);
      sum.carbs += Number(item.carbGrams ?? item.carbs ?? 0);
      sum.fat += Number(item.fatGrams ?? item.fat ?? item.fats ?? 0);
      return sum;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function normalizePlanMealItem(item: any) {
  return {
    ...item,
    id: item.id,
    sourceType: 'PLAN_ITEM',
    programMealItemId: item.id,
    logItemId: null,
    foodId: item.foodId ?? item.food?.id ?? null,
    customFoodName: item.customFoodName ?? null,
    foodName: item.customFoodName || item.food?.name || 'Món ăn',
    quantity: item.quantity ?? 100,
    unit: item.unit ?? 'g',
    calories: item.calories ?? 0,
    proteinGrams: item.proteinGrams ?? 0,
    carbGrams: item.carbGrams ?? 0,
    fatGrams: item.fatGrams ?? 0,
    protein: item.proteinGrams ?? 0,
    carbs: item.carbGrams ?? 0,
    fat: item.fatGrams ?? 0,
    editable: true,
  };
}

function normalizeLogMealItem(log: any) {
  return {
    id: log.id,
    sourceType: 'LOG_ITEM',
    programMealItemId: null,
    logItemId: log.id,
    foodId: (log as any).foodId ?? null,
    customFoodName: log.foodName,
    foodName: log.foodName,
    quantity: (log as any).quantity ?? null,
    unit: (log as any).unit ?? null,
    calories: log.calories ?? 0,
    proteinGrams: log.protein ?? 0,
    carbGrams: log.carbs ?? 0,
    fatGrams: log.fats ?? 0,
    protein: log.protein ?? 0,
    carbs: log.carbs ?? 0,
    fat: log.fats ?? 0,
    notes: log.notes ?? null,
    editable: true,
  };
}

export const nutritionService = {
  async listLogs(
    userId: string,
    filters: { startDate?: string; endDate?: string; mealType?: string },
  ) {
    const where: any = { userId };
    if (filters.startDate || filters.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setUTCHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }
    if (filters.mealType) where.mealType = filters.mealType;
    return nutritionRepository.findMany(where);
  },

  async createLog(userId: string, data: CreateNutritionDto) {
    return nutritionRepository.create(userId, data);
  },

  async deleteLog(id: string, userId: string) {
    const log = await nutritionRepository.findOne(id, userId);
    if (!log) throw { status: 404, message: 'Nutrition log not found' };
    await nutritionRepository.delete(id);
    return { message: 'Nutrition log deleted' };
  },

  // PATCH /nutrition/:id â€” owner-only partial update of a snapshot row.
  // NutritionLog stores macros directly (not auto-computed from Food), so we accept
  // edits on the snapshot fields consistent with create. We do NOT recompute macros.
  async updateLog(id: string, userId: string, data: any) {
    const existing = await nutritionRepository.findOne(id, userId);
    if (!existing) throw { status: 404, message: 'Nutrition log not found' };
    return nutritionRepository.update(id, data);
  },

  async getGoal(userId: string) {
    const goal = await nutritionRepository.findGoalByUserId(userId);
    return goal ?? DEFAULT_NUTRITION_GOAL;
  },

  async upsertGoal(userId: string, data: UpsertNutritionGoalDto) {
    return nutritionRepository.upsertGoal(userId, data);
  },

  async getCurrentProgram(userId: string) {
    const { prisma } = await import('../repositories/prisma');
    const program = await prisma.nutritionProgram.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: {
        days: {
          orderBy: { dayNumber: 'asc' },
          include: {
            meals: {
              orderBy: { createdAt: 'asc' },
              include: {
                items: {
                  include: { food: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return program;
  },


  async updateProgram(id: string, userId: string, data: any) {
    const { prisma } = await import('../repositories/prisma');
    const existing = await prisma.nutritionProgram.findFirst({ where: { id, userId } });
    if (!existing) throw { status: 404, message: 'Nutrition program not found' };
    const patch: any = {};
    if (typeof data.name === 'string') patch.name = data.name.trim();
    if (typeof data.goal === 'string') patch.goal = data.goal.trim();
    if (typeof data.dailyCaloriesTarget === 'number') patch.dailyCaloriesTarget = data.dailyCaloriesTarget;
    if (typeof data.proteinTargetGrams === 'number') patch.proteinTargetGrams = data.proteinTargetGrams;
    if (typeof data.carbTargetGrams === 'number') patch.carbTargetGrams = data.carbTargetGrams;
    if (typeof data.fatTargetGrams === 'number') patch.fatTargetGrams = data.fatTargetGrams;
    return prisma.nutritionProgram.update({ where: { id }, data: patch });
  },

  async deleteProgram(id: string, userId: string) {
    const { prisma } = await import('../repositories/prisma');
    const existing = await prisma.nutritionProgram.findFirst({ where: { id, userId } });
    if (!existing) throw { status: 404, message: 'Nutrition program not found' };
    return prisma.nutritionProgram.update({
      where: { id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
  },

  async addMealItem(mealId: string, userId: string, data: any) {
    const { prisma } = await import('../repositories/prisma');
    const meal = await prisma.nutritionProgramMeal.findFirst({
      where: { id: mealId },
      include: { day: { include: { program: { select: { userId: true } } } } },
    });
    if (!meal) throw { status: 404, message: 'Meal not found' };
    if ((meal as any).day?.program?.userId !== userId) throw { status: 403, message: 'Not authorized' };

    if (data.foodId) {
      const food = await prisma.food.findUnique({ where: { id: data.foodId } });
      if (!food) throw { status: 400, message: 'Food not found in catalog' };
    }

    return prisma.nutritionProgramMealItem.create({
      data: {
        mealId,
        foodId: data.foodId || null,
        customFoodName: data.customFoodName || data.name || null,
        quantity: typeof data.quantity === 'number' ? data.quantity : 100,
        unit: data.unit || 'g',
        calories: typeof data.calories === 'number' ? data.calories : 0,
        proteinGrams: typeof data.protein === 'number' ? data.protein : (typeof data.proteinGrams === 'number' ? data.proteinGrams : 0),
        carbGrams: typeof data.carbs === 'number' ? data.carbs : (typeof data.carbGrams === 'number' ? data.carbGrams : 0),
        fatGrams: typeof data.fat === 'number' ? data.fat : (typeof data.fatGrams === 'number' ? data.fatGrams : 0),
        notes: data.notes || null,
      },
      include: { food: true },
    });
  },

  async updateMealItem(itemId: string, userId: string, data: any) {
    const { prisma } = await import('../repositories/prisma');
    const item = await prisma.nutritionProgramMealItem.findFirst({
      where: { id: itemId },
      include: { meal: { include: { day: { include: { program: { select: { userId: true } } } } } } },
    });
    if (!item) throw { status: 404, message: 'Meal item not found' };
    if ((item as any).meal?.day?.program?.userId !== userId) throw { status: 403, message: 'Not authorized' };
    const lockedCompletion = await prisma.nutritionMealCompletion.findFirst({
      where: { userId, mealId: (item as any).mealId, status: { in: ['COMPLETED', 'PARTIAL'] } },
    });
    if (lockedCompletion) throw { status: 409, message: 'Cannot edit items from a completed or partial meal' };

    if (data.foodId) {
      const food = await prisma.food.findUnique({ where: { id: data.foodId } });
      if (!food) throw { status: 400, message: 'Food not found in catalog' };
    }

    const patch: any = {};
    if (data.foodId !== undefined) patch.foodId = data.foodId;
    if (data.customFoodName !== undefined) patch.customFoodName = data.customFoodName;
    if (typeof data.quantity === 'number') patch.quantity = data.quantity;
    if (data.unit !== undefined) patch.unit = data.unit;
    if (typeof data.calories === 'number') patch.calories = data.calories;
    if (typeof data.protein === 'number') patch.proteinGrams = data.protein;
    if (typeof data.proteinGrams === 'number') patch.proteinGrams = data.proteinGrams;
    if (typeof data.carbs === 'number') patch.carbGrams = data.carbs;
    if (typeof data.carbGrams === 'number') patch.carbGrams = data.carbGrams;
    if (typeof data.fat === 'number') patch.fatGrams = data.fat;
    if (typeof data.fatGrams === 'number') patch.fatGrams = data.fatGrams;
    if (data.notes !== undefined) patch.notes = data.notes;

    return prisma.nutritionProgramMealItem.update({ where: { id: itemId }, data: patch, include: { food: true } });
  },

  async deleteMealItem(itemId: string, userId: string) {
    const { prisma } = await import('../repositories/prisma');
    const item = await prisma.nutritionProgramMealItem.findFirst({
      where: { id: itemId },
      include: { meal: { include: { day: { include: { program: { select: { userId: true } } } } } } },
    });
    if (!item) throw { status: 404, message: 'Meal item not found' };
    if ((item as any).meal?.day?.program?.userId !== userId) throw { status: 403, message: 'Not authorized' };
    const lockedCompletion = await prisma.nutritionMealCompletion.findFirst({
      where: { userId, mealId: (item as any).mealId, status: { in: ['COMPLETED', 'PARTIAL'] } },
    });
    if (lockedCompletion) throw { status: 409, message: 'Cannot delete items from a completed or partial meal' };
    return prisma.nutritionProgramMealItem.delete({ where: { id: itemId } });
  },

  /**
   * Delete a planned meal from the program.
   * COMPLETED or PARTIAL → blocked. PENDING / SKIPPED → allowed.
   */
  async deletePlanMeal(mealId: string, userId: string) {
    const { prisma } = await import('../repositories/prisma');

    const meal = await prisma.nutritionProgramMeal.findFirst({
      where: { id: mealId },
      include: { day: { include: { program: { select: { userId: true } } } } },
    });
    if (!meal) throw { status: 404, message: 'Bữa ăn không tồn tại' };
    if ((meal as any).day?.program?.userId !== userId) throw { status: 403, message: 'Không có quyền' };

    const blockedCompletion = await prisma.nutritionMealCompletion.findFirst({
      where: { mealId, userId, status: { in: ['COMPLETED', 'PARTIAL'] } },
    });
    if (blockedCompletion) {
      throw { status: 409, message: 'Không thể xoá bữa ăn đã thực hiện. Lịch sử ăn uống cần được giữ lại.' };
    }

    await prisma.nutritionMealCompletion.deleteMany({ where: { mealId, userId } });
    await prisma.nutritionProgramMeal.delete({ where: { id: mealId } });
    return { deleted: true };
  },

  /**
   * Deactivate / archive the active nutrition program with business-rule enforcement.
   * - No COMPLETED/PARTIAL meals → full archive, remove pending completions
   * - Any COMPLETED/PARTIAL meal → soft archive only (keep history)
   */
  async deactivateNutritionProgram(programId: string, userId: string) {
    const { prisma } = await import('../repositories/prisma');

    const program = await prisma.nutritionProgram.findFirst({ where: { id: programId, userId } });
    if (!program) throw { status: 404, message: 'Kế hoạch dinh dưỡng không tồn tại' };

    const completedOrPartial = await prisma.nutritionMealCompletion.findFirst({
      where: { userId, status: { in: ['COMPLETED', 'PARTIAL'] }, meal: { day: { programId } } },
    });
    const hadCompletedMeals = !!completedOrPartial;

    await prisma.nutritionProgram.update({
      where: { id: programId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });

    if (!hadCompletedMeals) {
      const dayIds = (await prisma.nutritionProgramDay.findMany({ where: { programId }, select: { id: true } })).map((d: any) => d.id);
      if (dayIds.length > 0) {
        const mealIds = (await prisma.nutritionProgramMeal.findMany({ where: { dayId: { in: dayIds } }, select: { id: true } })).map((m: any) => m.id);
        if (mealIds.length > 0) {
          await prisma.nutritionMealCompletion.deleteMany({ where: { userId, mealId: { in: mealIds } } });
        }
      }
    }

    return { archived: true, hadCompletedMeals };
  },

  /**
   * Return a per-day nutrition summary for the given month range.
   * Used by the calendar to colour each day.
   */
  async getMonthlySummary(userId: string, startDate: string, endDate: string) {
    const { prisma } = await import('../repositories/prisma');

    const start = new Date(startDate + 'T00:00:00');
    const end   = new Date(endDate   + 'T23:59:59');

    // Fetch all meal completions in the range
    const completions = await prisma.nutritionMealCompletion.findMany({
      where: {
        userId,
        logDate: { gte: new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())),
                   lte: new Date(Date.UTC(end.getFullYear(),   end.getMonth(),   end.getDate()))   },
      },
      include: {
        meal: {
          include: {
            day: { select: { programId: true } },
          },
        },
      },
    });

    // Group by date string
    const byDate: Record<string, { completed: number; partial: number; skipped: number; total: number; calories: number }> = {};

    for (const c of completions) {
      // logDate is stored as UTC date-only; convert back to YYYY-MM-DD
      const d = c.logDate instanceof Date ? c.logDate : new Date(c.logDate);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
      if (!byDate[key]) byDate[key] = { completed: 0, partial: 0, skipped: 0, total: 0, calories: 0 };
      byDate[key].total += 1;
      if (c.status === 'COMPLETED') byDate[key].completed += 1;
      else if (c.status === 'PARTIAL') byDate[key].partial += 1;
      else if (c.status === 'SKIPPED') byDate[key].skipped += 1;
      byDate[key].calories += c.consumedCalories ?? 0;
    }

    // Convert to array of { date, status, ... }
    return Object.entries(byDate).map(([date, v]) => {
      let status = 'pending';
      const acted = v.completed + v.partial + v.skipped;
      if (acted === v.total && v.total > 0) {
        if (v.completed === v.total) status = 'completed';
        else if (v.skipped === v.total) status = 'skipped';
        else status = 'partial';
      } else if (acted > 0) {
        status = 'in_progress';
      }
      return { date, status, completedMeals: v.completed, partialMeals: v.partial, totalMeals: v.total, calories: v.calories };
    });
  },

  /**
   * Map a calendar date to a day number within the plan.
   * Returns null if the date is before startDate OR after the last plan day.
   * Does NOT cycle — each plan day is tied to a specific calendar date.
   * @param totalDays - number of days in the plan (e.g. 7)
   */
  getDayNumberForDate(startDate: Date, selectedDate: Date, totalDays: number): number | null {
    const startMs = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const selMs   = Date.UTC(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    const diffDays = Math.round((selMs - startMs) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return null;           // before plan starts
    if (diffDays >= totalDays) return null;  // after plan ends (e.g. day 8+ for a 7-day plan)
    return diffDays + 1;                     // Day 1 … Day N
  },

  /** Return today's (or any date's) nutrition task from the active program. */
  async getDailyTask(userId: string, dateStr: string) {
    const { prisma } = await import('../repositories/prisma');

    const selectedDate = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    const logDateOnly = new Date(
      Date.UTC(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()),
    );

    const program = await prisma.nutritionProgram.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: {
        days: {
          orderBy: { dayNumber: 'asc' },
          include: {
            meals: {
              orderBy: { createdAt: 'asc' },
              include: {
                items: { include: { food: true } },
                completions: {
                  where: { userId, logDate: logDateOnly },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const dayStart = new Date(logDateOnly);
    const dayEnd = new Date(logDateOnly);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const dailyLogs = await prisma.nutritionLog.findMany({
      where: {
        userId,
        date: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { createdAt: 'asc' },
    });
    const logsByMealType = new Map<string, any[]>();
    for (const log of dailyLogs) {
      const key = String(log.mealType || '').toLowerCase();
      logsByMealType.set(key, [...(logsByMealType.get(key) ?? []), normalizeLogMealItem(log)]);
    }

    if (!program) {
      return { hasProgram: false, date: dateStr, program: null, day: null, meals: [], actualProgress: null };
    }

    const startDate = program.startDate
      ? new Date(program.startDate)
      : new Date((program as any).createdAt);

    const endDate: Date | null = (program as any).endDate ? new Date((program as any).endDate) : null;
    const repeatEnabled: boolean = (program as any).repeatEnabled === true;
    const totalDays = program.days.length || 7;

    // Shared UTC millisecond values for date comparison
    const startMs = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const selMs   = Date.UTC(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    const diffDays = Math.round((selMs - startMs) / (1000 * 60 * 60 * 24));

    // Check endDate bounds first
    if (endDate) {
      const endMs = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      if (selMs > endMs) {
        const programSummary = { id: program.id, name: program.name, goal: program.goal, dailyCaloriesTarget: program.dailyCaloriesTarget, proteinTargetGrams: program.proteinTargetGrams, carbTargetGrams: program.carbTargetGrams, fatTargetGrams: program.fatTargetGrams };
        return { hasProgram: true, date: dateStr, program: programSummary, day: null, meals: [], actualProgress: null, outOfRange: true, message: 'Kế hoạch dinh dưỡng đã kết thúc vào ngày này.' };
      }
    }

    // Map date to day number
    let dayNumber: number | null;
    if (diffDays < 0) {
      dayNumber = null; // before plan starts
    } else if (repeatEnabled) {
      // Cycle every 7 days (or totalDays)
      dayNumber = (diffDays % totalDays) + 1;
    } else {
      // Strict: only within the plan's 7-day window
      dayNumber = this.getDayNumberForDate(startDate, selectedDate, totalDays);
    }

    if (dayNumber === null) {
      const isBeforeStart = diffDays < 0;
      const programSummary = {
        id: program.id, name: program.name, goal: program.goal,
        dailyCaloriesTarget: program.dailyCaloriesTarget,
        proteinTargetGrams: program.proteinTargetGrams,
        carbTargetGrams: program.carbTargetGrams, fatTargetGrams: program.fatTargetGrams,
        repeatEnabled, endDate: endDate?.toISOString().slice(0, 10) ?? null,
      };
      return {
        hasProgram: true,
        date: dateStr,
        program: programSummary,
        day: null,
        meals: [],
        actualProgress: null,
        outOfRange: true,
        message: isBeforeStart
          ? 'Kế hoạch chưa bắt đầu vào ngày này.'
          : `Ngày này nằm ngoài phạm vi ${totalDays} ngày của kế hoạch dinh dưỡng. Bật "Lặp lại thực đơn" để áp dụng chu kỳ.`,
      };
    }

    const day = program.days.find((d: any) => d.dayNumber === dayNumber);
    if (!day) {
      return { hasProgram: true, date: dateStr, program: { id: program.id, name: program.name, goal: program.goal, dailyCaloriesTarget: program.dailyCaloriesTarget, proteinTargetGrams: program.proteinTargetGrams, carbTargetGrams: program.carbTargetGrams, fatTargetGrams: program.fatTargetGrams }, day: null, meals: [], actualProgress: null };
    }

    let totalCal = 0, totalPro = 0, totalCarb = 0, totalFat = 0;

    const meals = (day.meals as any[]).map((meal: any) => {
      const completion = meal.completions?.[0] ?? null;
      const mealTypeKey = PLAN_TO_LOG_MEAL_TYPE[String(meal.mealType || '').toUpperCase()] ?? String(meal.mealType || '').toLowerCase();
      const planItems = Array.isArray(meal.items) ? meal.items.map(normalizePlanMealItem) : [];
      const logItems = logsByMealType.get(mealTypeKey) ?? [];
      const items = [...planItems, ...logItems];
      const plannedTotals = sumNutritionItems(planItems);
      const tableTotals = sumNutritionItems(items);
      if (completion && completion.status !== 'SKIPPED' && completion.status !== 'PENDING') {
        totalCal  += completion.consumedCalories ?? 0;
        totalPro  += completion.consumedProtein  ?? 0;
        totalCarb += completion.consumedCarbs    ?? 0;
        totalFat  += completion.consumedFat      ?? 0;
      }
      return {
        ...meal,
        calories: Math.round(tableTotals.calories),
        proteinGrams: roundMacro(tableTotals.protein),
        carbGrams: roundMacro(tableTotals.carbs),
        fatGrams: roundMacro(tableTotals.fat),
        plannedTotals: {
          calories: Math.round(plannedTotals.calories),
          protein: roundMacro(plannedTotals.protein),
          carbs: roundMacro(plannedTotals.carbs),
          fat: roundMacro(plannedTotals.fat),
        },
        tableTotals: {
          calories: Math.round(tableTotals.calories),
          protein: roundMacro(tableTotals.protein),
          carbs: roundMacro(tableTotals.carbs),
          fat: roundMacro(tableTotals.fat),
        },
        itemCount: items.length,
        items,
        completions: undefined,
        completion,
      };
    });

    return {
      hasProgram: true,
      date: dateStr,
      program: { id: program.id, name: program.name, goal: program.goal, dailyCaloriesTarget: program.dailyCaloriesTarget, proteinTargetGrams: program.proteinTargetGrams, carbTargetGrams: program.carbTargetGrams, fatTargetGrams: program.fatTargetGrams, repeatEnabled, endDate: endDate?.toISOString().slice(0, 10) ?? null },
      day: { id: day.id, dayNumber: day.dayNumber, title: day.title, totalCalories: day.totalCalories, proteinGrams: day.proteinGrams, carbGrams: day.carbGrams, fatGrams: day.fatGrams },
      meals,
      actualProgress: { calories: Math.round(totalCal), protein: Math.round(totalPro * 10) / 10, carbs: Math.round(totalCarb * 10) / 10, fat: Math.round(totalFat * 10) / 10 },
    };
  },

  /** Mark a meal as COMPLETED / PARTIAL / SKIPPED for a given date.
   *  If `overrideCalories` is provided, it takes precedence over percentConsumed.
   *  percentConsumed can exceed 100 (e.g. 120 = ate 20% more than planned).
   */
  async upsertMealCompletion(userId: string, mealId: string, dateStr: string, body: {
    status: 'COMPLETED' | 'PARTIAL' | 'SKIPPED' | 'PENDING';
    percentConsumed?: number;
    overrideCalories?: number;
    overrideProtein?: number;
    overrideCarbs?: number;
    overrideFat?: number;
    notes?: string;
  }) {
    const { prisma } = await import('../repositories/prisma');

    // Verify meal ownership
    const meal = await prisma.nutritionProgramMeal.findFirst({
      where: { id: mealId },
      include: {
        day: { include: { program: { select: { userId: true, id: true } } } },
        items: true,
      },
    });
    if (!meal) throw { status: 404, message: 'Meal not found' };
    if ((meal as any).day?.program?.userId !== userId) throw { status: 403, message: 'Not authorized' };

    const selectedDate = new Date(dateStr + 'T00:00:00');
    const logDate = new Date(Date.UTC(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()));
    const dayEnd = new Date(logDate);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const logMealType = PLAN_TO_LOG_MEAL_TYPE[String(meal.mealType || '').toUpperCase()] ?? String(meal.mealType || '').toLowerCase();
    const dailyLogs = await prisma.nutritionLog.findMany({
      where: {
        userId,
        mealType: logMealType,
        date: { gte: logDate, lte: dayEnd },
      },
    });
    const mealTotals = sumNutritionItems([
      ...((meal as any).items ?? []).map(normalizePlanMealItem),
      ...dailyLogs.map(normalizeLogMealItem),
    ]);

    // percentConsumed can be 0–999 (e.g. 120 = ate 20% more than planned)
    const rawPct = body.status === 'SKIPPED' ? 0
      : body.status === 'PARTIAL' ? Math.max(0, body.percentConsumed ?? 50)
      : body.status === 'COMPLETED' ? (body.percentConsumed ?? 100)
      : 0;
    const pct = Math.round(rawPct);

    let consumedCalories: number;
    let consumedProtein: number;
    let consumedCarbs: number;
    let consumedFat: number;

    if (body.overrideCalories !== undefined && body.overrideCalories >= 0) {
      // User entered actual calories directly — use overrides, compute pct from calories
      consumedCalories = Math.round(body.overrideCalories);
      consumedProtein  = body.overrideProtein  !== undefined ? Math.round(body.overrideProtein  * 10) / 10 : 0;
      consumedCarbs    = body.overrideCarbs    !== undefined ? Math.round(body.overrideCarbs    * 10) / 10 : 0;
      consumedFat      = body.overrideFat      !== undefined ? Math.round(body.overrideFat      * 10) / 10 : 0;
    } else {
      // Percentage mode — multiply planned macros by factor
      const factor = pct / 100;
      consumedCalories = Math.round((mealTotals.calories ?? 0) * factor);
      consumedProtein  = roundMacro((mealTotals.protein ?? 0) * factor);
      consumedCarbs    = roundMacro((mealTotals.carbs ?? 0) * factor);
      consumedFat      = roundMacro((mealTotals.fat ?? 0) * factor);
    }

    const completion = await prisma.nutritionMealCompletion.upsert({
      where: { nutrition_meal_completion_unique: { userId, mealId, logDate } },
      create: {
        userId,
        mealId,
        logDate,
        status: body.status,
        percentConsumed: pct,
        consumedCalories,
        consumedProtein,
        consumedCarbs,
        consumedFat,
        completedAt: body.status !== 'PENDING' ? new Date() : null,
      },
      update: {
        status: body.status,
        percentConsumed: pct,
        consumedCalories,
        consumedProtein,
        consumedCarbs,
        consumedFat,
        completedAt: body.status !== 'PENDING' ? new Date() : null,
      },
    });

    return { completion, mealId, date: dateStr };
  },

  /** Remove a meal completion (undo / reset to PENDING). */
  async deleteMealCompletion(userId: string, mealId: string, dateStr: string) {
    const { prisma } = await import('../repositories/prisma');

    const selectedDate = new Date(dateStr + 'T00:00:00');
    const logDate = new Date(Date.UTC(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()));

    const existing = await prisma.nutritionMealCompletion.findFirst({
      where: { userId, mealId, logDate },
    });
    if (!existing) throw { status: 404, message: 'Meal completion not found' };

    await prisma.nutritionMealCompletion.delete({ where: { id: existing.id } });
    return { deleted: true };
  },

  async importAiPlan(userId: string, payload: any) {
    const { prisma } = await import('../repositories/prisma');

    if (payload.durationWeeks !== 1) {
      throw { status: 400, message: 'Kế hoạch dinh dưỡng AI hiện chỉ hỗ trợ tối đa 1 tuần.' };
    }
    if (!Array.isArray(payload.weeklySchedule) || payload.weeklySchedule.length !== 7) {
      throw { status: 400, message: 'Kế hoạch dinh dưỡng phải có đúng 7 ngày.' };
    }

    const foodIds = Array.from(new Set(
      payload.weeklySchedule.flatMap((day: any) =>
        Array.isArray(day.meals)
          ? day.meals.flatMap((meal: any) =>
              Array.isArray(meal.items)
                ? meal.items.map((item: any) => item.foodId).filter((id: unknown) => typeof id === 'string' && id)
                : [],
            )
          : [],
      ),
    )) as string[];

    if (foodIds.length > 0) {
      const foundFoods = await prisma.food.findMany({ where: { id: { in: foodIds } }, select: { id: true } });
      const foundFoodIds = new Set(foundFoods.map((food: { id: string }) => food.id));
      const missingFoodIds = foodIds.filter((id) => !foundFoodIds.has(id));
      if (missingFoodIds.length > 0) {
        throw { status: 400, message: `Food not found: ${missingFoodIds.join(', ')}` };
      }
    }

    return await prisma.$transaction(async (tx) => {
      const existing = await tx.nutritionProgram.findFirst({
        where: { userId, sourcePlanId: payload.sourcePlanId },
      });

      if (existing) {
        return {
          createdNutritionPlanId: existing.id,
          createdProgramId: existing.id,
          existingNutritionPlanId: existing.id,
          alreadyExists: true,
          createdDayCount: 0,
          createdMealCount: 0,
          createdItemCount: 0,
          message: 'Kế hoạch này đã được lưu trước đó.',
        };
      }

      if (payload.forceArchive) {
        await tx.nutritionProgram.updateMany({
          where: { userId, status: 'ACTIVE' },
          data: { status: 'ARCHIVED', archivedAt: new Date(), updatedAt: new Date() },
        });
      }

      const program = await tx.nutritionProgram.create({
        data: {
          userId,
          name: (payload.sourcePlanName || 'AI Nutrition Plan').normalize('NFC'),
          goal: (payload.goal || 'General Health').normalize('NFC'),
          durationWeeks: 1,
          mealsPerDay: payload.mealsPerDay || 3,
          dailyCaloriesTarget: payload.dailyCaloriesTarget,
          proteinTargetGrams: payload.proteinTargetGrams,
          carbTargetGrams: payload.carbTargetGrams,
          fatTargetGrams: payload.fatTargetGrams,
          sourcePlanId: payload.sourcePlanId,
          sourceType: 'AI_PLAN',
          status: 'ACTIVE',
          startDate: payload.startDate ? new Date(payload.startDate) : new Date(),
          endDate: payload.endDate ? new Date(payload.endDate) : null,
          repeatEnabled: payload.repeatEnabled === true,
        },
      });

      let createdDayCount = 0;
      let createdMealCount = 0;
      let createdItemCount = 0;

      for (let dayIndex = 0; dayIndex < payload.weeklySchedule.length; dayIndex++) {
        const dayPayload = payload.weeklySchedule[dayIndex];
        const day = await tx.nutritionProgramDay.create({
          data: {
            programId: program.id,
            dayNumber: Number(dayPayload.dayNumber ?? dayPayload.day ?? dayIndex + 1),
            title: (dayPayload.title || `Ngày ${dayIndex + 1}`).normalize('NFC'),
            totalCalories: dayPayload.totalCalories ?? dayPayload.dailyCaloriesTarget,
            proteinGrams: dayPayload.protein ?? dayPayload.proteinGrams ?? dayPayload.proteinTargetGrams,
            carbGrams: dayPayload.carbs ?? dayPayload.carbGrams ?? dayPayload.carbTargetGrams,
            fatGrams: dayPayload.fat ?? dayPayload.fatGrams ?? dayPayload.fatTargetGrams,
          },
        });
        createdDayCount += 1;

        if (!Array.isArray(dayPayload.meals) || dayPayload.meals.length === 0) {
          throw { status: 400, message: 'Mỗi ngày trong kế hoạch dinh dưỡng phải có bữa ăn.' };
        }

        for (const mealPayload of dayPayload.meals) {
          const meal = await tx.nutritionProgramMeal.create({
            data: {
              dayId: day.id,
              mealType: String(mealPayload.mealType || 'SNACK').toUpperCase(),
              title: (mealPayload.title || mealPayload.mealType).normalize('NFC'),
              notes: mealPayload.note || mealPayload.notes ? String(mealPayload.note || mealPayload.notes).normalize('NFC') : null,
              calories: mealPayload.calories ?? mealPayload.totalCalories,
              proteinGrams: mealPayload.protein ?? mealPayload.proteinGrams,
              carbGrams: mealPayload.carbs ?? mealPayload.carbGrams,
              fatGrams: mealPayload.fat ?? mealPayload.fatGrams ?? mealPayload.fats,
            },
          });
          createdMealCount += 1;

          if (!Array.isArray(mealPayload.items) || mealPayload.items.length === 0) {
            throw { status: 400, message: 'Mỗi bữa ăn trong kế hoạch dinh dưỡng phải có thực phẩm.' };
          }

          for (const itemPayload of mealPayload.items) {
            await tx.nutritionProgramMealItem.create({
              data: {
                mealId: meal.id,
                foodId: itemPayload.foodId,
                customFoodName: (itemPayload.customFoodName || itemPayload.name).normalize('NFC'),
                quantity: itemPayload.quantity ?? itemPayload.amount ?? 100,
                unit: itemPayload.unit || 'g',
                calories: itemPayload.calories,
                proteinGrams: itemPayload.protein ?? itemPayload.proteinGrams,
                carbGrams: itemPayload.carbs ?? itemPayload.carbGrams,
                fatGrams: itemPayload.fat ?? itemPayload.fatGrams ?? itemPayload.fats,
                notes: itemPayload.note || itemPayload.notes,
              },
            });
            createdItemCount += 1;
          }
        }
      }

      return {
        createdNutritionPlanId: program.id,
        createdProgramId: program.id,
        createdDayCount,
        createdMealCount,
        createdItemCount,
        alreadyExists: false,
        message: 'Đã lưu kế hoạch dinh dưỡng thành công.',
      };
    });
  },
};

