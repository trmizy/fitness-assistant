import { nutritionRepository } from "../repositories/nutrition.repository";
import type { CreateNutritionDto } from "../models/fitness.models";
import type { UpsertNutritionGoalDto } from "../models/fitness.models";
import { checkNutritionGoalMacroConsistency, assertCalorieFloor } from "./nutrition-goal-macro-validator";
import { nutritionGoalPlanConsistencyService } from "./nutrition-goal-plan-consistency.service";
import { buildFoodSuggestions, dietaryPreferenceToVegetarianMode, type BudgetLevel } from "./nutrition-food-suggestion.engine";
import { findFoodSubstitute, type SubstituteMode } from "./nutrition-food-substitution.engine";
import { isVietnameseRegion } from "../config/vietnamese-region-food.config";
import { fetchUserProfile } from "../clients/user.client";

const DEFAULT_NUTRITION_GOAL = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 65,
  waterMl: null as number | null,
  goalMode: "RECOMMENDED" as const,
};

const PLAN_TO_LOG_MEAL_TYPE: Record<string, string> = {
  BREAKFAST: "breakfast",
  LUNCH: "lunch",
  DINNER: "dinner",
  SNACK: "snack",
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

/**
 * Found 2026-09-07 (AI agent food-substitution work): addMealItem/
 * updateMealItem/deleteMealItem each write the single NutritionProgramMealItem
 * row but never touched the parent NutritionProgramMeal.calories/proteinGrams/
 * carbGrams/fatGrams or NutritionProgramDay.totalCalories/... rollup columns —
 * so any edit (manual, or via the new AI substitute action) left those stored
 * totals stale, and the frontend (CurrentNutritionProgram.tsx, NutritionPage.tsx)
 * displays those stored fields directly, not a client-side re-sum. This is a
 * real, pre-existing gap, independent of the agent feature — it just would
 * have been directly exposed by it.
 *
 * At PLAN CREATION time (createProgramFromPlan below) the day/meal totals are
 * trusted verbatim from the AI-generated payload rather than summed — a
 * deliberate "trust the source, it already did the math" choice for that one
 * path. Any edit AFTER creation breaks that trust, so it must be re-derived
 * from the real items, not left stale or re-copied from the edit request.
 *
 * Call within the same transaction as the item mutation that triggered it,
 * passing the mealId whose item just changed — recomputes that meal from its
 * live items, then that meal's day from ALL of the day's now-current meals.
 */
async function recomputeMealAndDayTotals(tx: any, mealId: string): Promise<void> {
  const meal = await tx.nutritionProgramMeal.findUnique({
    where: { id: mealId },
    include: { items: true },
  });
  if (!meal) return; // meal itself was deleted in the same transaction — nothing to roll up
  const mealTotals = sumNutritionItems(meal.items);
  await tx.nutritionProgramMeal.update({
    where: { id: mealId },
    data: {
      calories: Math.round(mealTotals.calories),
      proteinGrams: roundMacro(mealTotals.protein),
      carbGrams: roundMacro(mealTotals.carbs),
      fatGrams: roundMacro(mealTotals.fat),
    },
  });

  // Re-fetch ALL of the day's meals fresh (not the `meal` object above,
  // which is now stale for this one meal after the update just above it) so
  // the day total reflects the meal we just recomputed plus every sibling.
  const freshMeals = await tx.nutritionProgramMeal.findMany({ where: { dayId: meal.dayId } });
  const dayTotals = sumNutritionItems(freshMeals);
  await tx.nutritionProgramDay.update({
    where: { id: meal.dayId },
    data: {
      totalCalories: Math.round(dayTotals.calories),
      proteinGrams: roundMacro(dayTotals.protein),
      carbGrams: roundMacro(dayTotals.carbs),
      fatGrams: roundMacro(dayTotals.fat),
    },
  });
}

function normalizePlanMealItem(item: any) {
  return {
    ...item,
    id: item.id,
    sourceType: "PLAN_ITEM",
    programMealItemId: item.id,
    logItemId: null,
    foodId: item.foodId ?? item.food?.id ?? null,
    customFoodName: item.customFoodName ?? null,
    foodName: item.customFoodName || item.food?.name || "Mon an",
    quantity: item.quantity ?? 100,
    unit: item.unit ?? "g",
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

/**
 * AI Nutrition Cycle Engine (Gymini) — "how much do I have left today"
 * (spec §XI/§XXV). `target` prefers the active plan's own daily targets
 * (what the user is actually following this specific day) and falls back
 * to the standing NutritionGoal prescription when there's no plan for this
 * date (spec §IV: nutrition must be usable even before any plan/InBody
 * exists — the deterministic goal alone is enough to compute this).
 * `remaining` is intentionally signed (can go negative) rather than
 * clamped at 0 — the frontend decides how to phrase "you're over target"
 * vs. hiding a negative number; this function only computes, never
 * presents (spec §IX's determinism/AI-presentation split).
 */
function buildDailySummary(
  target: { calories: number; protein: number; carbs: number; fat: number } | null,
  consumed: { calories: number; protein: number; carbs: number; fat: number },
) {
  if (!target) return null;
  return {
    targetCalories: Math.round(target.calories),
    targetProtein: roundMacro(target.protein),
    targetCarbs: roundMacro(target.carbs),
    targetFat: roundMacro(target.fat),
    consumedCalories: Math.round(consumed.calories),
    consumedProtein: roundMacro(consumed.protein),
    consumedCarbs: roundMacro(consumed.carbs),
    consumedFat: roundMacro(consumed.fat),
    remainingCalories: Math.round(target.calories - consumed.calories),
    remainingProtein: roundMacro(target.protein - consumed.protein),
    remainingCarbs: roundMacro(target.carbs - consumed.carbs),
    remainingFat: roundMacro(target.fat - consumed.fat),
  };
}

function normalizeLogMealItem(log: any) {
  return {
    id: log.id,
    sourceType: "LOG_ITEM",
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
    if (!log) throw { status: 404, message: "Nutrition log not found" };
    await nutritionRepository.delete(id);
    return { message: "Nutrition log deleted" };
  },

  // PATCH /nutrition/:id - owner-only partial update of a snapshot row.
  // NutritionLog stores macros directly (not auto-computed from Food), so we accept
  // edits on the snapshot fields consistent with create. We do NOT recompute macros.
  async updateLog(id: string, userId: string, data: any) {
    const existing = await nutritionRepository.findOne(id, userId);
    if (!existing) throw { status: 404, message: "Nutrition log not found" };
    return nutritionRepository.update(id, data);
  },

  async getGoal(userId: string) {
    const goal = await nutritionRepository.findGoalByUserId(userId);
    return goal ?? DEFAULT_NUTRITION_GOAL;
  },

  async upsertGoal(userId: string, data: UpsertNutritionGoalDto) {
    // Root-cause fix (AI-nutrition bug report): never persist a target
    // whose own macros don't add up to its own calorie figure — this is
    // the exact "3000 kcal next to 150P/200C/65F (=1985 kcal)" case. The
    // client must reconcile before saving; we compute the actual number so
    // the error message is directly actionable instead of a generic 400.
    const check = checkNutritionGoalMacroConsistency(
      data.calories,
      data.protein,
      data.carbs,
      data.fat,
    );
    if (!check.consistent) {
      throw {
        status: 400,
        message: `Mục tiêu không nhất quán: ${data.protein}g protein + ${data.carbs}g carb + ${data.fat}g fat = ${check.computedCalories} kcal, không khớp với ${data.calories} kcal đã nhập (chênh ${Math.abs(check.discrepancyKcal)} kcal). Vui lòng điều chỉnh calo hoặc macro cho khớp trước khi lưu.`,
        code: "NUTRITION_GOAL_MACRO_MISMATCH",
        computedCalories: check.computedCalories,
      };
    }
    // Safety-floor audit (2026-09-07) — this manual self-edit path is a
    // direct client-typed number, previously with no floor at all (only
    // `.positive()` in the Zod schema); see assertCalorieFloor's own doc
    // comment for the full inconsistency this closes.
    assertCalorieFloor(data.calories, "CLIENT");
    const goal = await nutritionRepository.upsertGoal(userId, data);

    // Goal <-> Plan sync gap (docs/audit/nutrition-ai-current-flow-audit.md,
    // câu 6): saving a new goal never touches the active program, so tell
    // the caller right away whether the (now possibly-stale) active plan
    // still matches — the UI can show a warning immediately instead of the
    // user only finding out later. This call is read-only — it never
    // archives/regenerates the plan itself.
    const planConsistency = await nutritionGoalPlanConsistencyService.compute(userId);

    return { goal, planConsistency };
  },

  // Phase 2 — minimal version-history view (spec: "Current/Previous/Changed
  // date/Reason"). The repository query already existed (Phase 1) but was
  // never surfaced by a route — this is that missing wiring, not new
  // versioning logic.
  async getGoalHistory(userId: string) {
    return nutritionRepository.findGoalHistoryByUserId(userId);
  },

  // Goal <-> Plan sync gap (docs/audit/nutrition-ai-current-flow-audit.md,
  // câu 6) — read-only.
  async getGoalPlanConsistency(userId: string) {
    return nutritionGoalPlanConsistencyService.compute(userId);
  },

  async getCurrentProgram(userId: string) {
    const { prisma } = await import("../repositories/prisma");
    const program = await prisma.nutritionProgram.findFirst({
      where: { userId, status: "ACTIVE" },
      include: {
        days: {
          orderBy: { dayNumber: "asc" },
          include: {
            meals: {
              orderBy: { createdAt: "asc" },
              include: {
                items: {
                  include: { food: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return program;
  },

  async updateProgram(id: string, userId: string, data: any) {
    const { prisma } = await import("../repositories/prisma");
    const existing = await prisma.nutritionProgram.findFirst({
      where: { id, userId },
    });
    if (!existing)
      throw { status: 404, message: "Nutrition program not found" };
    const patch: any = {};
    if (typeof data.name === "string") patch.name = data.name.trim();
    if (typeof data.goal === "string") patch.goal = data.goal.trim();
    if (typeof data.dailyCaloriesTarget === "number")
      patch.dailyCaloriesTarget = data.dailyCaloriesTarget;
    if (typeof data.proteinTargetGrams === "number")
      patch.proteinTargetGrams = data.proteinTargetGrams;
    if (typeof data.carbTargetGrams === "number")
      patch.carbTargetGrams = data.carbTargetGrams;
    if (typeof data.fatTargetGrams === "number")
      patch.fatTargetGrams = data.fatTargetGrams;
    return prisma.nutritionProgram.update({ where: { id }, data: patch });
  },

  async deleteProgram(id: string, userId: string) {
    const { prisma } = await import("../repositories/prisma");
    const existing = await prisma.nutritionProgram.findFirst({
      where: { id, userId },
    });
    if (!existing)
      throw { status: 404, message: "Nutrition program not found" };
    return prisma.nutritionProgram.update({
      where: { id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
  },

  async addMealItem(mealId: string, userId: string, data: any) {
    const { prisma } = await import("../repositories/prisma");
    const meal = await prisma.nutritionProgramMeal.findFirst({
      where: { id: mealId },
      include: { day: { include: { program: { select: { userId: true } } } } },
    });
    if (!meal) throw { status: 404, message: "Meal not found" };
    if ((meal as any).day?.program?.userId !== userId)
      throw { status: 403, message: "Not authorized" };

    if (data.foodId) {
      const food = await prisma.food.findUnique({ where: { id: data.foodId } });
      if (!food) throw { status: 400, message: "Food not found in catalog" };
    }

    return prisma.$transaction(async (tx: any) => {
      const created = await tx.nutritionProgramMealItem.create({
        data: {
          mealId,
          foodId: data.foodId || null,
          customFoodName: data.customFoodName || data.name || null,
          quantity: typeof data.quantity === "number" ? data.quantity : 100,
          unit: data.unit || "g",
          calories: typeof data.calories === "number" ? data.calories : 0,
          proteinGrams:
            typeof data.protein === "number"
              ? data.protein
              : typeof data.proteinGrams === "number"
                ? data.proteinGrams
                : 0,
          carbGrams:
            typeof data.carbs === "number"
              ? data.carbs
              : typeof data.carbGrams === "number"
                ? data.carbGrams
                : 0,
          fatGrams:
            typeof data.fat === "number"
              ? data.fat
              : typeof data.fatGrams === "number"
                ? data.fatGrams
                : 0,
          notes: data.notes || null,
        },
        include: { food: true },
      });
      await recomputeMealAndDayTotals(tx, mealId);
      return created;
    });
  },

  async updateMealItem(itemId: string, userId: string, data: any) {
    const { prisma } = await import("../repositories/prisma");
    const item = await prisma.nutritionProgramMealItem.findFirst({
      where: { id: itemId },
      include: {
        meal: {
          include: {
            day: { include: { program: { select: { userId: true } } } },
          },
        },
      },
    });
    if (!item) throw { status: 404, message: "Meal item not found" };
    if ((item as any).meal?.day?.program?.userId !== userId)
      throw { status: 403, message: "Not authorized" };
    const lockedCompletion = await prisma.nutritionMealCompletion.findFirst({
      where: {
        userId,
        mealId: (item as any).mealId,
        status: { in: ["COMPLETED", "PARTIAL"] },
      },
    });
    if (lockedCompletion)
      throw {
        status: 409,
        message: "Cannot edit items from a completed or partial meal",
      };

    if (data.foodId) {
      const food = await prisma.food.findUnique({ where: { id: data.foodId } });
      if (!food) throw { status: 400, message: "Food not found in catalog" };
    }

    const patch: any = {};
    if (data.foodId !== undefined) patch.foodId = data.foodId;
    if (data.customFoodName !== undefined)
      patch.customFoodName = data.customFoodName;
    if (typeof data.quantity === "number") patch.quantity = data.quantity;
    if (data.unit !== undefined) patch.unit = data.unit;
    if (typeof data.calories === "number") patch.calories = data.calories;
    if (typeof data.protein === "number") patch.proteinGrams = data.protein;
    if (typeof data.proteinGrams === "number")
      patch.proteinGrams = data.proteinGrams;
    if (typeof data.carbs === "number") patch.carbGrams = data.carbs;
    if (typeof data.carbGrams === "number") patch.carbGrams = data.carbGrams;
    if (typeof data.fat === "number") patch.fatGrams = data.fat;
    if (typeof data.fatGrams === "number") patch.fatGrams = data.fatGrams;
    if (data.notes !== undefined) patch.notes = data.notes;

    return prisma.$transaction(async (tx: any) => {
      const updated = await tx.nutritionProgramMealItem.update({
        where: { id: itemId },
        data: patch,
        include: { food: true },
      });
      await recomputeMealAndDayTotals(tx, (item as any).mealId);
      return updated;
    });
  },

  async deleteMealItem(itemId: string, userId: string) {
    const { prisma } = await import("../repositories/prisma");
    const item = await prisma.nutritionProgramMealItem.findFirst({
      where: { id: itemId },
      include: {
        meal: {
          include: {
            day: { include: { program: { select: { userId: true } } } },
          },
        },
      },
    });
    if (!item) throw { status: 404, message: "Meal item not found" };
    if ((item as any).meal?.day?.program?.userId !== userId)
      throw { status: 403, message: "Not authorized" };
    const lockedCompletion = await prisma.nutritionMealCompletion.findFirst({
      where: {
        userId,
        mealId: (item as any).mealId,
        status: { in: ["COMPLETED", "PARTIAL"] },
      },
    });
    if (lockedCompletion)
      throw {
        status: 409,
        message: "Cannot delete items from a completed or partial meal",
      };
    return prisma.$transaction(async (tx: any) => {
      const deleted = await tx.nutritionProgramMealItem.delete({ where: { id: itemId } });
      await recomputeMealAndDayTotals(tx, (item as any).mealId);
      return deleted;
    });
  },

  /**
   * Delete a planned meal from the program.
   * COMPLETED or PARTIAL -> blocked. PENDING / SKIPPED -> allowed.
   */
  async deletePlanMeal(mealId: string, userId: string) {
    const { prisma } = await import("../repositories/prisma");

    const meal = await prisma.nutritionProgramMeal.findFirst({
      where: { id: mealId },
      include: { day: { include: { program: { select: { userId: true } } } } },
    });
    if (!meal) throw { status: 404, message: "Meal not found" };
    if ((meal as any).day?.program?.userId !== userId)
      throw { status: 403, message: "Forbidden" };

    const blockedCompletion = await prisma.nutritionMealCompletion.findFirst({
      where: { mealId, userId, status: { in: ["COMPLETED", "PARTIAL"] } },
    });
    if (blockedCompletion) {
      throw {
        status: 409,
        message: "Cannot delete a meal that already has consumption history.",
      };
    }

    await prisma.nutritionMealCompletion.deleteMany({
      where: { mealId, userId },
    });
    await prisma.nutritionProgramMeal.delete({ where: { id: mealId } });
    return { deleted: true };
  },

  /**
   * Deactivate / archive the active nutrition program with business-rule enforcement.
   * - No COMPLETED/PARTIAL meals -> full archive, remove pending completions
   * - Any COMPLETED/PARTIAL meal -> soft archive only (keep history)
   */
  async deactivateNutritionProgram(programId: string, userId: string) {
    const { prisma } = await import("../repositories/prisma");

    const program = await prisma.nutritionProgram.findFirst({
      where: { id: programId, userId },
    });
    if (!program) throw { status: 404, message: "Nutrition plan not found" };

    const completedOrPartial = await prisma.nutritionMealCompletion.findFirst({
      where: {
        userId,
        status: { in: ["COMPLETED", "PARTIAL"] },
        meal: { day: { programId } },
      },
    });
    const hadCompletedMeals = !!completedOrPartial;

    await prisma.nutritionProgram.update({
      where: { id: programId },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });

    if (!hadCompletedMeals) {
      const dayIds = (
        await prisma.nutritionProgramDay.findMany({
          where: { programId },
          select: { id: true },
        })
      ).map((d: any) => d.id);
      if (dayIds.length > 0) {
        const mealIds = (
          await prisma.nutritionProgramMeal.findMany({
            where: { dayId: { in: dayIds } },
            select: { id: true },
          })
        ).map((m: any) => m.id);
        if (mealIds.length > 0) {
          await prisma.nutritionMealCompletion.deleteMany({
            where: { userId, mealId: { in: mealIds } },
          });
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
    const { prisma } = await import("../repositories/prisma");

    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T23:59:59");

    // Fetch all meal completions in the range
    const completions = await prisma.nutritionMealCompletion.findMany({
      where: {
        userId,
        logDate: {
          gte: new Date(
            Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()),
          ),
          lte: new Date(
            Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()),
          ),
        },
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
    const byDate: Record<
      string,
      {
        completed: number;
        partial: number;
        skipped: number;
        total: number;
        calories: number;
      }
    > = {};

    for (const c of completions) {
      // logDate is stored as UTC date-only; convert back to YYYY-MM-DD
      const d = c.logDate instanceof Date ? c.logDate : new Date(c.logDate);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      if (!byDate[key])
        byDate[key] = {
          completed: 0,
          partial: 0,
          skipped: 0,
          total: 0,
          calories: 0,
        };
      byDate[key].total += 1;
      if (c.status === "COMPLETED") byDate[key].completed += 1;
      else if (c.status === "PARTIAL") byDate[key].partial += 1;
      else if (c.status === "SKIPPED") byDate[key].skipped += 1;
      byDate[key].calories += c.consumedCalories ?? 0;
    }

    // Convert to array of { date, status, ... }
    return Object.entries(byDate).map(([date, v]) => {
      let status = "pending";
      const acted = v.completed + v.partial + v.skipped;
      if (acted === v.total && v.total > 0) {
        if (v.completed === v.total) status = "completed";
        else if (v.skipped === v.total) status = "skipped";
        else status = "partial";
      } else if (acted > 0) {
        status = "in_progress";
      }
      return {
        date,
        status,
        completedMeals: v.completed,
        partialMeals: v.partial,
        totalMeals: v.total,
        calories: v.calories,
      };
    });
  },

  /**
   * Map a calendar date to a day number within the plan.
   * Returns null if the date is before startDate OR after the last plan day.
   * Does NOT cycle - each plan day is tied to a specific calendar date.
   * @param totalDays - number of days in the plan (e.g. 7)
   */
  getDayNumberForDate(
    startDate: Date,
    selectedDate: Date,
    totalDays: number,
  ): number | null {
    const startMs = Date.UTC(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate(),
    );
    const selMs = Date.UTC(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
    );
    const diffDays = Math.round((selMs - startMs) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return null; // before plan starts
    if (diffDays >= totalDays) return null; // after plan ends (e.g. day 8+ for a 7-day plan)
    return diffDays + 1; // Day 1 ... Day N
  },

  /** Return today's (or any date's) nutrition task from the active program. */
  async getDailyTask(userId: string, dateStr: string) {
    const { prisma } = await import("../repositories/prisma");

    const selectedDate = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
    const logDateOnly = new Date(
      Date.UTC(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
      ),
    );

    const program = await prisma.nutritionProgram.findFirst({
      where: { userId, status: "ACTIVE" },
      include: {
        days: {
          orderBy: { dayNumber: "asc" },
          include: {
            meals: {
              orderBy: { createdAt: "asc" },
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
      orderBy: { createdAt: "desc" },
    });

    const dayStart = new Date(logDateOnly);
    const dayEnd = new Date(logDateOnly);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const dailyLogs = await prisma.nutritionLog.findMany({
      where: {
        userId,
        date: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { createdAt: "asc" },
    });
    const logsByMealType = new Map<string, any[]>();
    for (const log of dailyLogs) {
      const key = String(log.mealType || "").toLowerCase();
      logsByMealType.set(key, [
        ...(logsByMealType.get(key) ?? []),
        normalizeLogMealItem(log),
      ]);
    }

    // AI Nutrition Cycle Engine (Gymini) — the standing NutritionGoal is the
    // dailySummary target fallback whenever there's no active plan (or the
    // selected date falls outside it), and the sole target when there's no
    // plan at all (spec §IV: Nutrition must be usable from profile alone).
    const activeGoal = await nutritionRepository.findGoalByUserId(userId);
    const goalTarget = activeGoal
      ? { calories: activeGoal.calories, protein: activeGoal.protein, carbs: activeGoal.carbs, fat: activeGoal.fat }
      : null;

    if (!program) {
      // No structured plan at all — every logged item for the day came
      // through the free-text diary (NutritionLog), never merged into any
      // meal's items above.
      const allLogTotals = sumNutritionItems(dailyLogs.map(normalizeLogMealItem));
      return {
        hasProgram: false,
        date: dateStr,
        program: null,
        day: null,
        meals: [],
        actualProgress: null,
        dailySummary: buildDailySummary(goalTarget, allLogTotals),
      };
    }

    const startDate = program.startDate
      ? new Date(program.startDate)
      : new Date((program as any).createdAt);

    const endDate: Date | null = (program as any).endDate
      ? new Date((program as any).endDate)
      : null;
    const repeatEnabled: boolean = (program as any).repeatEnabled === true;
    const totalDays = program.days.length || 7;

    // Shared UTC millisecond values for date comparison
    const startMs = Date.UTC(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate(),
    );
    const selMs = Date.UTC(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
    );
    const diffDays = Math.round((selMs - startMs) / (1000 * 60 * 60 * 24));

    // Check endDate bounds first
    if (endDate) {
      const endMs = Date.UTC(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate(),
      );
      if (selMs > endMs) {
        const programSummary = {
          id: program.id,
          name: program.name,
          goal: program.goal,
          dailyCaloriesTarget: program.dailyCaloriesTarget,
          proteinTargetGrams: program.proteinTargetGrams,
          carbTargetGrams: program.carbTargetGrams,
          fatTargetGrams: program.fatTargetGrams,
        };
        return {
          hasProgram: true,
          date: dateStr,
          program: programSummary,
          day: null,
          meals: [],
          actualProgress: null,
          outOfRange: true,
          message: "Nutrition plan has ended for this date.",
          dailySummary: buildDailySummary(
            goalTarget ?? {
              calories: program.dailyCaloriesTarget ?? 0,
              protein: program.proteinTargetGrams ?? 0,
              carbs: program.carbTargetGrams ?? 0,
              fat: program.fatTargetGrams ?? 0,
            },
            sumNutritionItems(dailyLogs.map(normalizeLogMealItem)),
          ),
        };
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
        id: program.id,
        name: program.name,
        goal: program.goal,
        dailyCaloriesTarget: program.dailyCaloriesTarget,
        proteinTargetGrams: program.proteinTargetGrams,
        carbTargetGrams: program.carbTargetGrams,
        fatTargetGrams: program.fatTargetGrams,
        repeatEnabled,
        endDate: endDate?.toISOString().slice(0, 10) ?? null,
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
          ? "Nutrition plan has not started on this date."
          : `This date is outside the ${totalDays}-day nutrition plan range. Enable repeat menu to apply the cycle.`,
        dailySummary: buildDailySummary(
          goalTarget ?? {
            calories: program.dailyCaloriesTarget ?? 0,
            protein: program.proteinTargetGrams ?? 0,
            carbs: program.carbTargetGrams ?? 0,
            fat: program.fatTargetGrams ?? 0,
          },
          sumNutritionItems(dailyLogs.map(normalizeLogMealItem)),
        ),
      };
    }

    const day = program.days.find((d: any) => d.dayNumber === dayNumber);
    if (!day) {
      return {
        hasProgram: true,
        date: dateStr,
        program: {
          id: program.id,
          name: program.name,
          goal: program.goal,
          dailyCaloriesTarget: program.dailyCaloriesTarget,
          proteinTargetGrams: program.proteinTargetGrams,
          carbTargetGrams: program.carbTargetGrams,
          fatTargetGrams: program.fatTargetGrams,
        },
        day: null,
        meals: [],
        actualProgress: null,
        dailySummary: buildDailySummary(
          goalTarget ?? {
            calories: program.dailyCaloriesTarget ?? 0,
            protein: program.proteinTargetGrams ?? 0,
            carbs: program.carbTargetGrams ?? 0,
            fat: program.fatTargetGrams ?? 0,
          },
          sumNutritionItems(dailyLogs.map(normalizeLogMealItem)),
        ),
      };
    }

    let totalCal = 0,
      totalPro = 0,
      totalCarb = 0,
      totalFat = 0;

    // AI Nutrition Cycle Engine (Gymini) — every meal-type key this day's
    // plan actually has a slot for; a NutritionLog entry logged under any
    // OTHER meal type (e.g. "snack" when the plan has no snack) never gets
    // merged into `items` above, so it must be added to dailySummary's
    // consumed total separately below, or it silently vanishes.
    const matchedMealTypeKeys = new Set(
      (day.meals as any[]).map(
        (meal: any) =>
          PLAN_TO_LOG_MEAL_TYPE[String(meal.mealType || "").toUpperCase()] ??
          String(meal.mealType || "").toLowerCase(),
      ),
    );
    let tableTotalsSum = { calories: 0, protein: 0, carbs: 0, fat: 0 };

    const meals = (day.meals as any[]).map((meal: any) => {
      const completion = meal.completions?.[0] ?? null;
      const mealTypeKey =
        PLAN_TO_LOG_MEAL_TYPE[String(meal.mealType || "").toUpperCase()] ??
        String(meal.mealType || "").toLowerCase();
      const planItems = Array.isArray(meal.items)
        ? meal.items.map(normalizePlanMealItem)
        : [];
      const logItems = logsByMealType.get(mealTypeKey) ?? [];
      const items = [...planItems, ...logItems];
      const plannedTotals = sumNutritionItems(planItems);
      const tableTotals = sumNutritionItems(items);

      // Unify-the-two-write-paths fix (found auditing "log food after
      // marking a meal complete"): upsertMealCompletion freezes
      // consumedCalories/etc at the moment it's called, computed from
      // whatever NutritionLog rows existed for this mealType+date THEN. A
      // NutritionLog created afterwards for the SAME mealType+date (the
      // free-text "Add food" form, or applyFoodSuggestion's "Thêm bữa
      // này") already shows up in `items`/`tableTotals` above (so the UI
      // looks like it was recorded) but was previously invisible to
      // consumedTotals — logging food after completing a meal silently
      // undercounted it. Never rewritten in place (that would risk
      // clobbering an explicit overrideCalories the user typed, which
      // isn't distinguishable from a percent-derived figure on this row)
      // — instead, anything logged strictly after the completion's own
      // last write is treated as a pure addition on top of the frozen
      // snapshot, using the exact same raw rows (pre-normalization, so
      // their real createdAt survives) that built logItems above.
      const rawLogsForMeal = dailyLogs.filter(
        (log: any) => String(log.mealType || "").toLowerCase() === mealTypeKey,
      );
      const loggedAfterCompletion = completion
        ? rawLogsForMeal.filter(
            (log: any) => new Date(log.createdAt).getTime() > new Date(completion.updatedAt).getTime(),
          )
        : [];
      const extraSinceCompletion =
        loggedAfterCompletion.length > 0
          ? sumNutritionItems(loggedAfterCompletion.map(normalizeLogMealItem))
          : { calories: 0, protein: 0, carbs: 0, fat: 0 };

      // AI Nutrition Cycle Engine (Gymini) — canonical PLANNED-vs-CONSUMED
      // rule (Phase 2 §III/§IX). `tableTotals` is what's PLANNED/LISTED for
      // this meal; how much of it actually counts as CONSUMED depends on
      // completion status, computed once here and reused by both
      // `dailySummary` and `actualProgress` so they can never disagree:
      //   SKIPPED            -> 0, regardless of listed items (explicit
      //                          "I did not eat this" overrides the list)
      //   COMPLETED / PARTIAL -> completion.consumedCalories/Protein/Carbs/Fat
      //                          (already scaled by percentConsumed or the
      //                          user's own override at upsertMealCompletion
      //                          time — the canonical, single-computed figure;
      //                          summing tableTotals again here would double count
      //                          a PARTIAL meal, or ignore an explicit override)
      //                          PLUS anything logged after that snapshot
      //                          was frozen (see extraSinceCompletion above).
      //   no completion / PENDING -> tableTotals (provisional: items were
      //                          added but the user hasn't explicitly marked
      //                          the meal one way or the other yet)
      const consumedTotals =
        completion && completion.status === "SKIPPED"
          ? { calories: 0, protein: 0, carbs: 0, fat: 0 }
          : completion && (completion.status === "COMPLETED" || completion.status === "PARTIAL")
            ? {
                calories: (completion.consumedCalories ?? 0) + extraSinceCompletion.calories,
                protein: (completion.consumedProtein ?? 0) + extraSinceCompletion.protein,
                carbs: (completion.consumedCarbs ?? 0) + extraSinceCompletion.carbs,
                fat: (completion.consumedFat ?? 0) + extraSinceCompletion.fat,
              }
            : tableTotals;

      tableTotalsSum.calories += consumedTotals.calories;
      tableTotalsSum.protein += consumedTotals.protein;
      tableTotalsSum.carbs += consumedTotals.carbs;
      tableTotalsSum.fat += consumedTotals.fat;
      if (
        completion &&
        completion.status !== "SKIPPED" &&
        completion.status !== "PENDING"
      ) {
        totalCal += consumedTotals.calories;
        totalPro += consumedTotals.protein;
        totalCarb += consumedTotals.carbs;
        totalFat += consumedTotals.fat;
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

    const unmatchedLogs = dailyLogs.filter((log: any) => {
      const key = String(log.mealType || "").toLowerCase();
      return !matchedMealTypeKeys.has(key);
    });
    if (unmatchedLogs.length > 0) {
      const unmatchedTotals = sumNutritionItems(unmatchedLogs.map(normalizeLogMealItem));
      tableTotalsSum.calories += unmatchedTotals.calories;
      tableTotalsSum.protein += unmatchedTotals.protein;
      tableTotalsSum.carbs += unmatchedTotals.carbs;
      tableTotalsSum.fat += unmatchedTotals.fat;
    }

    const dayTarget = {
      calories: day.totalCalories ?? program.dailyCaloriesTarget ?? goalTarget?.calories ?? 0,
      protein: day.proteinGrams ?? program.proteinTargetGrams ?? goalTarget?.protein ?? 0,
      carbs: day.carbGrams ?? program.carbTargetGrams ?? goalTarget?.carbs ?? 0,
      fat: day.fatGrams ?? program.fatTargetGrams ?? goalTarget?.fat ?? 0,
    };

    return {
      hasProgram: true,
      date: dateStr,
      program: {
        id: program.id,
        name: program.name,
        goal: program.goal,
        dailyCaloriesTarget: program.dailyCaloriesTarget,
        proteinTargetGrams: program.proteinTargetGrams,
        carbTargetGrams: program.carbTargetGrams,
        fatTargetGrams: program.fatTargetGrams,
        repeatEnabled,
        endDate: endDate?.toISOString().slice(0, 10) ?? null,
      },
      day: {
        id: day.id,
        dayNumber: day.dayNumber,
        title: day.title,
        totalCalories: day.totalCalories,
        proteinGrams: day.proteinGrams,
        carbGrams: day.carbGrams,
        fatGrams: day.fatGrams,
      },
      meals,
      actualProgress: {
        calories: Math.round(totalCal),
        protein: Math.round(totalPro * 10) / 10,
        carbs: Math.round(totalCarb * 10) / 10,
        fat: Math.round(totalFat * 10) / 10,
      },
      dailySummary: buildDailySummary(dayTarget, tableTotalsSum),
    };
  },

  // AI Nutrition Cycle Engine (Gymini) — Phase 2 §III/§IX/canonical source
  // of truth. Reuses getDailyTask's dailySummary (already the single
  // correct consumed-totals computation, respecting SKIPPED/PARTIAL/
  // COMPLETED completion status so nothing is double-counted) for each of
  // the last `days` calendar days, so any consumer that needs "how much did
  // this user actually eat recently" (AI chat context, adherence, a future
  // trends chart) reads the EXACT same numbers the Nutrition dashboard
  // shows — never a second, independently-aggregated total that can
  // silently drift from it (the AI chat's own nutritionHistory context
  // previously only ever read raw NutritionLog rows, missing anything
  // logged via the structured meal-item flow entirely).
  async getDailyConsumptionHistory(userId: string, days: number) {
    const clampedDays = Math.max(1, Math.min(30, Math.trunc(days) || 7));
    const today = new Date();
    const results: Array<{
      date: string;
      hasProgram: boolean;
      targetCalories: number | null;
      targetProtein: number | null;
      consumedCalories: number | null;
      consumedProtein: number | null;
      consumedCarbs: number | null;
      consumedFat: number | null;
    }> = [];
    for (let i = 0; i < clampedDays; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const day = await this.getDailyTask(userId, dateStr);
      results.push({
        date: dateStr,
        hasProgram: day.hasProgram,
        targetCalories: day.dailySummary?.targetCalories ?? null,
        targetProtein: day.dailySummary?.targetProtein ?? null,
        consumedCalories: day.dailySummary?.consumedCalories ?? null,
        consumedProtein: day.dailySummary?.consumedProtein ?? null,
        consumedCarbs: day.dailySummary?.consumedCarbs ?? null,
        consumedFat: day.dailySummary?.consumedFat ?? null,
      });
    }
    return results;
  },

  // AI Nutrition Cycle Engine (Gymini) — spec §XII/§XIII. `budgetLevelOverride`
  // lets a caller who already has the profile loaded skip the extra
  // cross-service round trip; omitted, this falls back to the user's saved
  // UserProfile.nutritionBudgetLevel (defaulting to NORMAL if never set).
  async getFoodSuggestions(userId: string, dateStr: string, budgetLevelOverride?: string) {
    const daily = await this.getDailyTask(userId, dateStr);
    const remainingCalories = daily.dailySummary?.remainingCalories ?? 0;
    const remainingProtein = daily.dailySummary?.remainingProtein ?? 0;

    // One profile fetch covers budget, region, and dietary preference —
    // never three separate cross-service round trips for one page load.
    const profile = await fetchUserProfile(userId);

    let budgetLevel = (budgetLevelOverride?.toUpperCase() as BudgetLevel | undefined) ?? undefined;
    if (!budgetLevel || !["LOW", "NORMAL", "FLEXIBLE"].includes(budgetLevel)) {
      const saved = (profile?.nutritionBudgetLevel ?? "NORMAL").toUpperCase();
      budgetLevel = (["LOW", "NORMAL", "FLEXIBLE"].includes(saved) ? saved : "NORMAL") as BudgetLevel;
    }
    const region = isVietnameseRegion(profile?.region) ? profile!.region : null;
    const vegetarianMode = dietaryPreferenceToVegetarianMode(profile?.dietaryPreference);

    const options = await buildFoodSuggestions(remainingCalories, remainingProtein, budgetLevel, region, vegetarianMode);
    return {
      date: dateStr,
      remainingCalories,
      remainingProtein,
      budgetLevel,
      region,
      options,
    };
  },

  // Smart Substitute variants (Production Hardening report §16) — swap ONE
  // food item for a different one, cheaper, higher-protein, or vegetarian.
  // Region + dietaryPreference come from the SAME profile snapshot pattern
  // as getFoodSuggestions above; an explicit per-call override lets the
  // frontend preview "what if I were in Miền Trung" without changing the
  // user's saved profile (used by the Settings-less quick-try flow, if
  // any — today only the saved profile value is actually sent).
  async getFoodSubstitute(
    userId: string,
    item: { foodId?: string | null; foodName: string; quantityG: number; calories: number; protein: number },
    mode: SubstituteMode,
  ) {
    const profile = await fetchUserProfile(userId);
    const budgetLevel = (["LOW", "NORMAL", "FLEXIBLE"].includes((profile?.nutritionBudgetLevel ?? "").toUpperCase())
      ? (profile!.nutritionBudgetLevel as string).toUpperCase()
      : "NORMAL") as BudgetLevel;
    const region = isVietnameseRegion(profile?.region) ? profile!.region : null;
    const vegetarianMode = dietaryPreferenceToVegetarianMode(profile?.dietaryPreference);

    return findFoodSubstitute({
      currentFoodId: item.foodId ?? null,
      currentFoodName: item.foodName,
      currentQuantityG: item.quantityG,
      currentCalories: item.calories,
      currentProtein: item.protein,
      mode,
      budgetLevel,
      region,
      vegetarianMode,
    });
  },

  // AI Nutrition Cycle Engine (Gymini) — Phase 2 §VI "Add this suggestion":
  // a suggested combo isn't tied to any specific planned meal slot (it's
  // "what to eat next", not "what's for breakfast"), so this logs it via
  // the free-text NutritionLog path (one row per item) rather than
  // requiring a NutritionProgramMealItem/mealId — works identically for a
  // user with or without an active NutritionProgram, and is already
  // correctly picked up by getDailyTask's canonical dailySummary (either
  // merged into a matching planned meal, or counted via the unmatched-logs
  // path — see nutrition-daily-summary.integration.test.ts). Never a fake
  // success: each item is a real, separately-persisted NutritionLog row;
  // if any single insert fails the caller gets a real error, not a
  // best-effort partial silently reported as success.
  async applyFoodSuggestion(
    userId: string,
    dateStr: string,
    items: Array<{ foodName: string; quantityG: number; calories: number; protein: number; carbs: number; fat: number }>,
  ) {
    if (!Array.isArray(items) || items.length === 0) {
      throw { status: 400, message: "items must be a non-empty array" };
    }
    const hour = new Date().getHours();
    const mealType = hour < 10 ? "breakfast" : hour < 15 ? "lunch" : hour < 19 ? "dinner" : "snack";
    const created = [];
    for (const item of items) {
      const row = await nutritionRepository.create(userId, {
        date: dateStr,
        mealType,
        foodName: `${item.foodName} (${Math.round(item.quantityG)}g)`,
        calories: Math.round(item.calories),
        protein: item.protein,
        carbs: item.carbs,
        fats: item.fat,
        notes: "Từ gợi ý món ăn của Gymini",
      });
      created.push(row);
    }
    return created;
  },

  /** Mark a meal as COMPLETED / PARTIAL / SKIPPED for a given date.
   *  If `overrideCalories` is provided, it takes precedence over percentConsumed.
   *  percentConsumed can exceed 100 (e.g. 120 = ate 20% more than planned).
   */
  async upsertMealCompletion(
    userId: string,
    mealId: string,
    dateStr: string,
    body: {
      status: "COMPLETED" | "PARTIAL" | "SKIPPED" | "PENDING";
      percentConsumed?: number;
      overrideCalories?: number;
      overrideProtein?: number;
      overrideCarbs?: number;
      overrideFat?: number;
      notes?: string;
    },
  ) {
    const { prisma } = await import("../repositories/prisma");

    // Verify meal ownership
    const meal = await prisma.nutritionProgramMeal.findFirst({
      where: { id: mealId },
      include: {
        day: { include: { program: { select: { userId: true, id: true } } } },
        items: true,
      },
    });
    if (!meal) throw { status: 404, message: "Meal not found" };
    if ((meal as any).day?.program?.userId !== userId)
      throw { status: 403, message: "Not authorized" };

    const selectedDate = new Date(dateStr + "T00:00:00");
    const logDate = new Date(
      Date.UTC(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
      ),
    );
    const dayEnd = new Date(logDate);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const logMealType =
      PLAN_TO_LOG_MEAL_TYPE[String(meal.mealType || "").toUpperCase()] ??
      String(meal.mealType || "").toLowerCase();
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

    // percentConsumed can be 0-999 (e.g. 120 = ate 20% more than planned)
    const rawPct =
      body.status === "SKIPPED"
        ? 0
        : body.status === "PARTIAL"
          ? Math.max(0, body.percentConsumed ?? 50)
          : body.status === "COMPLETED"
            ? (body.percentConsumed ?? 100)
            : 0;
    const pct = Math.round(rawPct);

    let consumedCalories: number;
    let consumedProtein: number;
    let consumedCarbs: number;
    let consumedFat: number;

    if (body.overrideCalories !== undefined && body.overrideCalories >= 0) {
      // User entered actual calories directly - use overrides, compute pct from calories
      consumedCalories = Math.round(body.overrideCalories);
      consumedProtein =
        body.overrideProtein !== undefined
          ? Math.round(body.overrideProtein * 10) / 10
          : 0;
      consumedCarbs =
        body.overrideCarbs !== undefined
          ? Math.round(body.overrideCarbs * 10) / 10
          : 0;
      consumedFat =
        body.overrideFat !== undefined
          ? Math.round(body.overrideFat * 10) / 10
          : 0;
    } else {
      // Percentage mode - multiply planned macros by factor
      const factor = pct / 100;
      consumedCalories = Math.round((mealTotals.calories ?? 0) * factor);
      consumedProtein = roundMacro((mealTotals.protein ?? 0) * factor);
      consumedCarbs = roundMacro((mealTotals.carbs ?? 0) * factor);
      consumedFat = roundMacro((mealTotals.fat ?? 0) * factor);
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
        completedAt: body.status !== "PENDING" ? new Date() : null,
      },
      update: {
        status: body.status,
        percentConsumed: pct,
        consumedCalories,
        consumedProtein,
        consumedCarbs,
        consumedFat,
        completedAt: body.status !== "PENDING" ? new Date() : null,
      },
    });

    return { completion, mealId, date: dateStr };
  },

  /** Remove a meal completion (undo / reset to PENDING). */
  async deleteMealCompletion(userId: string, mealId: string, dateStr: string) {
    const { prisma } = await import("../repositories/prisma");

    const selectedDate = new Date(dateStr + "T00:00:00");
    const logDate = new Date(
      Date.UTC(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
      ),
    );

    const existing = await prisma.nutritionMealCompletion.findFirst({
      where: { userId, mealId, logDate },
    });
    if (!existing) throw { status: 404, message: "Meal completion not found" };

    await prisma.nutritionMealCompletion.delete({ where: { id: existing.id } });
    return { deleted: true };
  },

  async importAiPlan(userId: string, payload: any) {
    const { prisma } = await import("../repositories/prisma");

    if (payload.durationWeeks !== 1) {
      throw {
        status: 400,
        message: "AI nutrition plans currently support up to 1 week.",
      };
    }
    if (
      !Array.isArray(payload.weeklySchedule) ||
      payload.weeklySchedule.length !== 7
    ) {
      throw {
        status: 400,
        message: "Nutrition plan must contain exactly 7 days.",
      };
    }

    const foodIds = Array.from(
      new Set(
        payload.weeklySchedule.flatMap((day: any) =>
          Array.isArray(day.meals)
            ? day.meals.flatMap((meal: any) =>
                Array.isArray(meal.items)
                  ? meal.items
                      .map((item: any) => item.foodId)
                      .filter((id: unknown) => typeof id === "string" && id)
                  : [],
              )
            : [],
        ),
      ),
    ) as string[];

    if (foodIds.length > 0) {
      const foundFoods = await prisma.food.findMany({
        where: { id: { in: foodIds } },
        select: { id: true },
      });
      const foundFoodIds = new Set(
        foundFoods.map((food: { id: string }) => food.id),
      );
      const missingFoodIds = foodIds.filter((id) => !foundFoodIds.has(id));
      if (missingFoodIds.length > 0) {
        throw {
          status: 400,
          message: `Food not found: ${missingFoodIds.join(", ")}`,
        };
      }
    }

    // Goal <-> Plan sync gap (docs/audit/nutrition-ai-current-flow-audit.md,
    // câu 6): record which goal was active at import time, purely for
    // traceability — nutrition-goal-plan-consistency.service.ts uses this
    // to detect "this plan's association is stale" even when the numbers
    // still coincidentally match. Never blocks import if there's no active
    // goal (activeGoal stays null, sourceGoalId stays null on the program).
    const activeGoal = await nutritionRepository.findGoalByUserId(userId);

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
          message: "This plan was already saved.",
        };
      }

      if (payload.forceArchive) {
        await tx.nutritionProgram.updateMany({
          where: { userId, status: "ACTIVE" },
          data: {
            status: "ARCHIVED",
            archivedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      const program = await tx.nutritionProgram.create({
        data: {
          userId,
          name: (payload.sourcePlanName || "AI Nutrition Plan").normalize(
            "NFC",
          ),
          goal: (payload.goal || "General Health").normalize("NFC"),
          durationWeeks: 1,
          mealsPerDay: payload.mealsPerDay || 3,
          dailyCaloriesTarget: payload.dailyCaloriesTarget,
          proteinTargetGrams: payload.proteinTargetGrams,
          carbTargetGrams: payload.carbTargetGrams,
          fatTargetGrams: payload.fatTargetGrams,
          sourcePlanId: payload.sourcePlanId,
          sourceGoalId: activeGoal?.id ?? null,
          sourceType: "AI_PLAN",
          status: "ACTIVE",
          startDate: payload.startDate
            ? new Date(payload.startDate)
            : new Date(),
          endDate: payload.endDate ? new Date(payload.endDate) : null,
          repeatEnabled: payload.repeatEnabled === true,
        },
      });

      let createdDayCount = 0;
      let createdMealCount = 0;
      let createdItemCount = 0;

      for (
        let dayIndex = 0;
        dayIndex < payload.weeklySchedule.length;
        dayIndex++
      ) {
        const dayPayload = payload.weeklySchedule[dayIndex];
        const day = await tx.nutritionProgramDay.create({
          data: {
            programId: program.id,
            dayNumber: Number(
              dayPayload.dayNumber ?? dayPayload.day ?? dayIndex + 1,
            ),
            title: (dayPayload.title || `Day ${dayIndex + 1}`).normalize("NFC"),
            totalCalories:
              dayPayload.totalCalories ?? dayPayload.dailyCaloriesTarget,
            proteinGrams:
              dayPayload.protein ??
              dayPayload.proteinGrams ??
              dayPayload.proteinTargetGrams,
            carbGrams:
              dayPayload.carbs ??
              dayPayload.carbGrams ??
              dayPayload.carbTargetGrams,
            fatGrams:
              dayPayload.fat ??
              dayPayload.fatGrams ??
              dayPayload.fatTargetGrams,
          },
        });
        createdDayCount += 1;

        if (!Array.isArray(dayPayload.meals) || dayPayload.meals.length === 0) {
          throw {
            status: 400,
            message: "Each nutrition plan day must include meals.",
          };
        }

        for (const mealPayload of dayPayload.meals) {
          const meal = await tx.nutritionProgramMeal.create({
            data: {
              dayId: day.id,
              mealType: String(mealPayload.mealType || "SNACK").toUpperCase(),
              title: (mealPayload.title || mealPayload.mealType).normalize(
                "NFC",
              ),
              notes:
                mealPayload.note || mealPayload.notes
                  ? String(mealPayload.note || mealPayload.notes).normalize(
                      "NFC",
                    )
                  : null,
              calories: mealPayload.calories ?? mealPayload.totalCalories,
              proteinGrams: mealPayload.protein ?? mealPayload.proteinGrams,
              carbGrams: mealPayload.carbs ?? mealPayload.carbGrams,
              fatGrams:
                mealPayload.fat ?? mealPayload.fatGrams ?? mealPayload.fats,
            },
          });
          createdMealCount += 1;

          if (
            !Array.isArray(mealPayload.items) ||
            mealPayload.items.length === 0
          ) {
            throw {
              status: 400,
              message: "Each nutrition plan meal must include foods.",
            };
          }

          for (const itemPayload of mealPayload.items) {
            await tx.nutritionProgramMealItem.create({
              data: {
                mealId: meal.id,
                foodId: itemPayload.foodId,
                customFoodName: (
                  itemPayload.customFoodName || itemPayload.name
                ).normalize("NFC"),
                quantity: itemPayload.quantity ?? itemPayload.amount ?? 100,
                unit: itemPayload.unit || "g",
                calories: itemPayload.calories,
                proteinGrams: itemPayload.protein ?? itemPayload.proteinGrams,
                carbGrams: itemPayload.carbs ?? itemPayload.carbGrams,
                fatGrams:
                  itemPayload.fat ?? itemPayload.fatGrams ?? itemPayload.fats,
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
        message: "Nutrition plan saved successfully.",
      };
    });
  },
};
