/**
 * AI Nutrition Cycle Engine (Gymini) — Phase 2 §III/§IX/§XIV canonical
 * consumption tests. `dailySummary` (added in Phase 1) and `actualProgress`
 * (pre-existing) must never disagree, and a meal must never be counted
 * twice or at the wrong scale:
 *   - SKIPPED -> 0, even if items are still listed on the meal
 *   - PARTIAL/COMPLETED with a completion row -> the completion's own
 *     already-scaled consumedCalories/Protein/Carbs/Fat, never re-summed
 *     from raw items (that would double count a PARTIAL meal)
 *   - no completion yet (PENDING/never touched) -> raw item totals
 *     (provisional — "I added food" is itself a logging action)
 *   - a NutritionLog entry whose mealType doesn't match any of the day's
 *     planned meals -> counted exactly once via the unmatched-logs path,
 *     never silently dropped and never double-counted into a meal it
 *     doesn't belong to
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/nutrition-daily-summary.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test",
};

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type NutritionServiceLike = (typeof import("../services/nutrition.service"))["nutritionService"];

let prisma: PrismaClientLike | undefined;
let nutritionService: NutritionServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    nutritionService = (await import("../services/nutrition.service")).nutritionService;
  }
  return { prisma: prisma!, nutritionService: nutritionService! };
}

const TODAY = new Date();
const TODAY_STR = TODAY.toISOString().slice(0, 10);
const TODAY_DATE_ONLY = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth(), TODAY.getUTCDate()));

/** One program, one day (dayNumber 1, aligned to start today), one BREAKFAST
 * meal with a single 400-kcal/30g-protein item. Returns ids needed to
 * attach completions/logs. */
async function seedProgramWithOneMeal(prisma: PrismaClientLike, userId: string) {
  const program = await prisma.nutritionProgram.create({
    data: {
      userId,
      name: "Test Program",
      status: "ACTIVE",
      startDate: TODAY_DATE_ONLY,
      dailyCaloriesTarget: 2000,
      proteinTargetGrams: 150,
      carbTargetGrams: 200,
      fatTargetGrams: 65,
    },
  });
  const day = await prisma.nutritionProgramDay.create({
    data: { programId: program.id, dayNumber: 1, title: "Day 1" },
  });
  const meal = await prisma.nutritionProgramMeal.create({
    data: { dayId: day.id, mealType: "BREAKFAST", title: "Breakfast" },
  });
  await prisma.nutritionProgramMealItem.create({
    data: {
      mealId: meal.id,
      customFoodName: "Ức gà",
      quantity: 200,
      unit: "g",
      calories: 400,
      proteinGrams: 30,
      carbGrams: 0,
      fatGrams: 10,
    },
  });
  return { program, day, meal };
}

async function cleanup(prisma: PrismaClientLike, userId: string) {
  await prisma.nutritionMealCompletion.deleteMany({ where: { userId } });
  await prisma.nutritionLog.deleteMany({ where: { userId } });
  await prisma.nutritionProgram.deleteMany({ where: { userId } });
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

test(
  "no completion yet (PENDING) -> dailySummary counts the raw listed item totals (provisional)",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      await seedProgramWithOneMeal(prisma, userId);
      const result = await nutritionService.getDailyTask(userId, TODAY_STR);
      assert.equal(result.dailySummary?.consumedCalories, 400);
      assert.equal(result.dailySummary?.consumedProtein, 30);
    } finally {
      await cleanup(prisma, userId);
    }
  },
);

test(
  "SKIPPED meal -> counted as 0 in dailySummary even though the item is still listed (PLANNED != CONSUMED)",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      const { meal } = await seedProgramWithOneMeal(prisma, userId);
      await nutritionService.upsertMealCompletion(userId, meal.id, TODAY_STR, { status: "SKIPPED" });
      const result = await nutritionService.getDailyTask(userId, TODAY_STR);
      assert.equal(result.dailySummary?.consumedCalories, 0);
      assert.equal(result.dailySummary?.consumedProtein, 0);
      // the item itself must still be listed/visible (planned != erased)
      assert.equal(result.meals[0].itemCount, 1);
    } finally {
      await cleanup(prisma, userId);
    }
  },
);

test(
  "PARTIAL meal (percentConsumed=50) -> dailySummary counts exactly half, not the full listed amount (no double count)",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      const { meal } = await seedProgramWithOneMeal(prisma, userId);
      await nutritionService.upsertMealCompletion(userId, meal.id, TODAY_STR, {
        status: "PARTIAL",
        percentConsumed: 50,
      });
      const result = await nutritionService.getDailyTask(userId, TODAY_STR);
      assert.equal(result.dailySummary?.consumedCalories, 200);
      assert.equal(result.dailySummary?.consumedProtein, 15);
      // must agree with the pre-existing actualProgress field — never a
      // second, disagreeing total for the same underlying data
      assert.equal(result.actualProgress?.calories, result.dailySummary?.consumedCalories);
    } finally {
      await cleanup(prisma, userId);
    }
  },
);

test(
  "COMPLETED meal with an explicit override -> dailySummary uses the override, not the raw listed sum",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      const { meal } = await seedProgramWithOneMeal(prisma, userId);
      await nutritionService.upsertMealCompletion(userId, meal.id, TODAY_STR, {
        status: "COMPLETED",
        overrideCalories: 550,
        overrideProtein: 40,
      });
      const result = await nutritionService.getDailyTask(userId, TODAY_STR);
      assert.equal(result.dailySummary?.consumedCalories, 550);
      assert.equal(result.dailySummary?.consumedProtein, 40);
    } finally {
      await cleanup(prisma, userId);
    }
  },
);

test(
  "a NutritionLog entry matching the meal's mealType merges into that meal's items and is counted once, not twice",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      await seedProgramWithOneMeal(prisma, userId);
      await prisma.nutritionLog.create({
        data: {
          userId,
          date: TODAY,
          mealType: "breakfast",
          foodName: "Trứng luộc",
          calories: 150,
          protein: 12,
          carbs: 1,
          fats: 10,
        },
      });
      const result = await nutritionService.getDailyTask(userId, TODAY_STR);
      // 400 (plan item, PENDING -> raw) + 150 (log merged into the same meal) = 550, exactly once
      assert.equal(result.dailySummary?.consumedCalories, 550);
      assert.equal(result.meals[0].itemCount, 2);
    } finally {
      await cleanup(prisma, userId);
    }
  },
);

test(
  "getDailyConsumptionHistory reuses the same canonical dailySummary per day — AI/adherence never sees a different total than the dashboard",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      await seedProgramWithOneMeal(prisma, userId);
      const history = await nutritionService.getDailyConsumptionHistory(userId, 3);
      assert.equal(history.length, 3);
      const todayEntry = history.find((h) => h.date === TODAY_STR);
      assert.ok(todayEntry);
      assert.equal(todayEntry!.consumedCalories, 400);
      assert.equal(todayEntry!.targetCalories, 2000);
    } finally {
      await cleanup(prisma, userId);
    }
  },
);

test(
  "Phase 2 §VI: applyFoodSuggestion persists real NutritionLog rows that immediately show up in dailySummary — never a fake success",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      await seedProgramWithOneMeal(prisma, userId); // 400 kcal PENDING baseline
      const created = await nutritionService.applyFoodSuggestion(userId, TODAY_STR, [
        { foodName: "Đậu hũ", quantityG: 200, calories: 150, protein: 16, carbs: 4, fat: 8 },
        { foodName: "Cơm trắng", quantityG: 150, calories: 195, protein: 4, carbs: 43, fat: 0.5 },
      ]);
      assert.equal(created.length, 2, "must create exactly one row per suggested item");

      const result = await nutritionService.getDailyTask(userId, TODAY_STR);
      // 400 (plan item) + 150 + 195 = 745, immediately reflected
      assert.equal(result.dailySummary?.consumedCalories, 745);
    } finally {
      await cleanup(prisma, userId);
    }
  },
);

test(
  "applyFoodSuggestion rejects an empty items array (400) rather than silently succeeding",
  skipOpts,
  async () => {
    const { nutritionService } = await loadModules();
    await assert.rejects(
      () => nutritionService.applyFoodSuggestion(randomUUID(), TODAY_STR, []),
      (err: any) => err.status === 400,
    );
  },
);

test(
  "unify-write-paths: a NutritionLog added AFTER a meal is marked COMPLETED (percent-based) still counts — it doesn't vanish into the frozen snapshot",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      const { meal } = await seedProgramWithOneMeal(prisma, userId);
      // Mark breakfast fully COMPLETED (100% of the 400-kcal item) BEFORE
      // any extra food is logged for that meal.
      await nutritionService.upsertMealCompletion(userId, meal.id, TODAY_STR, { status: "COMPLETED" });
      let result = await nutritionService.getDailyTask(userId, TODAY_STR);
      assert.equal(result.dailySummary?.consumedCalories, 400, "sanity: completion alone is 400");

      // Now the user logs an extra snack-y item under the SAME mealType
      // (breakfast) — e.g. via the free-text "Add food" form or
      // applyFoodSuggestion — strictly after the completion was written.
      await prisma.nutritionLog.create({
        data: {
          userId,
          date: TODAY,
          mealType: "breakfast",
          foodName: "Sữa chua",
          calories: 120,
          protein: 8,
          carbs: 10,
          fats: 4,
        },
      });

      result = await nutritionService.getDailyTask(userId, TODAY_STR);
      assert.equal(
        result.dailySummary?.consumedCalories,
        520,
        "the post-completion log (120) must be ADDED on top of the frozen completion snapshot (400), not lost",
      );
      assert.equal(result.actualProgress?.calories, 520, "actualProgress must agree with dailySummary");
      // the completion row itself is never rewritten — it stays the
      // historical record of what was true when the user completed it
      const stored = await prisma.nutritionMealCompletion.findFirst({ where: { userId, mealId: meal.id } });
      assert.equal(stored?.consumedCalories, 400, "the completion row itself must not be silently mutated");
    } finally {
      await cleanup(prisma, userId);
    }
  },
);

test(
  "unify-write-paths: a NutritionLog added AFTER a meal is marked COMPLETED with an explicit override still adds on top — the override itself is never overwritten",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      const { meal } = await seedProgramWithOneMeal(prisma, userId);
      await nutritionService.upsertMealCompletion(userId, meal.id, TODAY_STR, {
        status: "COMPLETED",
        overrideCalories: 550,
        overrideProtein: 40,
      });
      await prisma.nutritionLog.create({
        data: {
          userId,
          date: TODAY,
          mealType: "breakfast",
          foodName: "Trái cây",
          calories: 60,
          protein: 1,
          carbs: 15,
          fats: 0,
        },
      });
      const result = await nutritionService.getDailyTask(userId, TODAY_STR);
      assert.equal(result.dailySummary?.consumedCalories, 610, "override (550) + post-completion log (60)");
      const stored = await prisma.nutritionMealCompletion.findFirst({ where: { userId, mealId: meal.id } });
      assert.equal(stored?.consumedCalories, 550, "the user's explicit override must survive untouched");
    } finally {
      await cleanup(prisma, userId);
    }
  },
);

test(
  "unify-write-paths: a NutritionLog created BEFORE a COMPLETED meal's snapshot was already folded in — logging it again after must not double count",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      const { meal } = await seedProgramWithOneMeal(prisma, userId);
      // Log BEFORE completing — upsertMealCompletion's own mealTotals read
      // already folds this in (see the pre-existing "merges into that
      // meal's items" test above), so consumedCalories should already be
      // 400+150=550 the moment the meal is marked COMPLETED.
      await prisma.nutritionLog.create({
        data: {
          userId,
          date: TODAY,
          mealType: "breakfast",
          foodName: "Trứng luộc",
          calories: 150,
          protein: 12,
          carbs: 1,
          fats: 10,
        },
      });
      await nutritionService.upsertMealCompletion(userId, meal.id, TODAY_STR, { status: "COMPLETED" });
      const result = await nutritionService.getDailyTask(userId, TODAY_STR);
      assert.equal(
        result.dailySummary?.consumedCalories,
        550,
        "a log already folded into the completion snapshot must not also be added again as 'post-completion'",
      );
    } finally {
      await cleanup(prisma, userId);
    }
  },
);

test(
  "a NutritionLog entry whose mealType has no matching planned meal (e.g. snack) is still counted exactly once via the unmatched-logs path",
  skipOpts,
  async () => {
    const { prisma, nutritionService } = await loadModules();
    const userId = randomUUID();
    try {
      await seedProgramWithOneMeal(prisma, userId); // only has a BREAKFAST meal
      await prisma.nutritionLog.create({
        data: {
          userId,
          date: TODAY,
          mealType: "snack",
          foodName: "Chuối",
          calories: 90,
          protein: 1,
          carbs: 23,
          fats: 0,
        },
      });
      const result = await nutritionService.getDailyTask(userId, TODAY_STR);
      assert.equal(result.dailySummary?.consumedCalories, 400 + 90);
    } finally {
      await cleanup(prisma, userId);
    }
  },
);
