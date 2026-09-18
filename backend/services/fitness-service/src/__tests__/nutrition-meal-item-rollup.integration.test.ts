/**
 * Found 2026-09-07 while planning the AI-coach nutrition food-substitution
 * agent action (docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_PLAN.md):
 * addMealItem/updateMealItem/deleteMealItem each wrote the single
 * NutritionProgramMealItem row but never recomputed the parent
 * NutritionProgramMeal.calories/proteinGrams/carbGrams/fatGrams or
 * NutritionProgramDay.totalCalories/... rollup columns — and the frontend
 * (CurrentNutritionProgram.tsx, NutritionPage.tsx) displays those stored
 * rollup fields directly, not a client-side re-sum. Any item edit left the
 * displayed daily/meal kcal stale. This proves the fix
 * (nutrition.service.ts's recomputeMealAndDayTotals, called inside the same
 * transaction as each mutation) against a real seeded plan.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/nutrition-meal-item-rollup.integration.test.ts
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
  timeout: 60_000,
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

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

/** Seeds a minimal real program: 1 day, 1 meal, 2 items (100 + 50 kcal). */
async function seedProgram(db: PrismaClientLike, userId: string) {
  const program = await db.nutritionProgram.create({
    data: { userId, name: "Rollup Test Program", status: "ACTIVE" },
  });
  const day = await db.nutritionProgramDay.create({
    data: { programId: program.id, dayNumber: 1, totalCalories: 150, proteinGrams: 20, carbGrams: 10, fatGrams: 5 },
  });
  const meal = await db.nutritionProgramMeal.create({
    data: { dayId: day.id, mealType: "LUNCH", calories: 150, proteinGrams: 20, carbGrams: 10, fatGrams: 5 },
  });
  const itemA = await db.nutritionProgramMealItem.create({
    data: { mealId: meal.id, customFoodName: "Ức gà", quantity: 100, calories: 100, proteinGrams: 15, carbGrams: 5, fatGrams: 2 },
  });
  const itemB = await db.nutritionProgramMealItem.create({
    data: { mealId: meal.id, customFoodName: "Cơm trắng", quantity: 100, calories: 50, proteinGrams: 5, carbGrams: 5, fatGrams: 3 },
  });
  return { program, day, meal, itemA, itemB };
}

async function cleanup(db: PrismaClientLike, programId: string) {
  await db.nutritionProgram.delete({ where: { id: programId } }); // cascades day/meal/item
}

test(
  "updateMealItem recomputes the parent meal AND day totals, not just the item itself",
  skipOpts,
  async () => {
    const { prisma: db, nutritionService: svc } = await loadModules();
    const userId = `rollup-it-${randomUUID()}`;
    const { program, day, meal, itemA } = await seedProgram(db, userId);
    try {
      // Swap item A's 100 kcal / 15g protein for a 200 kcal / 30g protein food
      // (e.g. a substitute engine picking a bigger cá hồi portion) — meal
      // total should become 150 -> 250, day total should follow the same way.
      await svc.updateMealItem(itemA.id, userId, { calories: 200, protein: 30, carbs: 5, fat: 10 });

      const updatedMeal = await db.nutritionProgramMeal.findUniqueOrThrow({ where: { id: meal.id } });
      assert.equal(updatedMeal.calories, 250, "meal.calories must reflect the new item total (200+50), not the stale 150");
      assert.equal(updatedMeal.proteinGrams, 35, "meal.proteinGrams must reflect 30(new)+5(unchanged sibling)");

      const updatedDay = await db.nutritionProgramDay.findUniqueOrThrow({ where: { id: day.id } });
      assert.equal(updatedDay.totalCalories, 250, "day.totalCalories must follow the meal it contains");
      assert.equal(updatedDay.proteinGrams, 35);
    } finally {
      await cleanup(db, program.id);
    }
  },
);

test(
  "addMealItem recomputes meal/day totals to include the new item",
  skipOpts,
  async () => {
    const { prisma: db, nutritionService: svc } = await loadModules();
    const userId = `rollup-add-it-${randomUUID()}`;
    const { program, day, meal } = await seedProgram(db, userId);
    try {
      await svc.addMealItem(meal.id, userId, { customFoodName: "Rau xanh", calories: 30, protein: 2, carbs: 5, fat: 0 });

      const updatedMeal = await db.nutritionProgramMeal.findUniqueOrThrow({ where: { id: meal.id } });
      assert.equal(updatedMeal.calories, 180, "150 (original 2 items) + 30 (new item)");

      const updatedDay = await db.nutritionProgramDay.findUniqueOrThrow({ where: { id: day.id } });
      assert.equal(updatedDay.totalCalories, 180);
    } finally {
      await cleanup(db, program.id);
    }
  },
);

test(
  "deleteMealItem recomputes meal/day totals to exclude the removed item",
  skipOpts,
  async () => {
    const { prisma: db, nutritionService: svc } = await loadModules();
    const userId = `rollup-del-it-${randomUUID()}`;
    const { program, day, meal, itemB } = await seedProgram(db, userId);
    try {
      await svc.deleteMealItem(itemB.id, userId); // removes the 50kcal item, 100kcal remains

      const updatedMeal = await db.nutritionProgramMeal.findUniqueOrThrow({ where: { id: meal.id } });
      assert.equal(updatedMeal.calories, 100, "only item A's 100 kcal should remain");

      const updatedDay = await db.nutritionProgramDay.findUniqueOrThrow({ where: { id: day.id } });
      assert.equal(updatedDay.totalCalories, 100);
    } finally {
      await cleanup(db, program.id);
    }
  },
);

test(
  "day total correctly sums MULTIPLE meals, not just the one that was edited",
  skipOpts,
  async () => {
    const { prisma: db, nutritionService: svc } = await loadModules();
    const userId = `rollup-multi-it-${randomUUID()}`;
    const { program, day, meal: lunchMeal, itemA } = await seedProgram(db, userId); // lunch: 150 kcal
    const breakfast = await db.nutritionProgramMeal.create({
      data: { dayId: day.id, mealType: "BREAKFAST", calories: 200, proteinGrams: 10, carbGrams: 20, fatGrams: 5 },
    });
    await db.nutritionProgramMealItem.create({
      data: { mealId: breakfast.id, customFoodName: "Bánh mì", quantity: 100, calories: 200, proteinGrams: 10, carbGrams: 20, fatGrams: 5 },
    });
    try {
      // Day should start at lunch(150) + breakfast(200) = 350, even though
      // day.totalCalories was seeded as 150 (only lunch) — prove the very
      // first edit anywhere on the day corrects the whole day, not just
      // adds a delta on top of a possibly-already-wrong seed value.
      await svc.updateMealItem(itemA.id, userId, { calories: 120 }); // lunch item A: 100 -> 120

      const updatedLunch = await db.nutritionProgramMeal.findUniqueOrThrow({ where: { id: lunchMeal.id } });
      assert.equal(updatedLunch.calories, 170, "lunch: 120(A) + 50(B, unchanged)");

      const updatedDay = await db.nutritionProgramDay.findUniqueOrThrow({ where: { id: day.id } });
      assert.equal(updatedDay.totalCalories, 370, "day: 170(lunch, recomputed) + 200(breakfast, untouched but included)");
    } finally {
      await cleanup(db, program.id);
    }
  },
);
