/**
 * AI Coach nutrition actions (2026-09-07, docs/agentic-fitness/
 * 01_NUTRITION_AGENT_TOOLS_PLAN.md) — proves substituteMealItem's real
 * resolution/disambiguation logic against a real seeded NutritionProgram
 * and the real food catalog (needs "Fish, salmon, NFS" + its "cá hồi"
 * Vietnamese alias, same seeded data nutrition-food-substitution.engine
 * .test.ts already assumes).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/nutrition-agent.service.integration.test.ts
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
type NutritionAgentServiceLike = (typeof import("../services/nutrition-agent.service"))["nutritionAgentService"];

let prisma: PrismaClientLike | undefined;
let nutritionAgentService: NutritionAgentServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    nutritionAgentService = (await import("../services/nutrition-agent.service")).nutritionAgentService;
  }
  return { prisma: prisma!, nutritionAgentService: nutritionAgentService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function seedProgram(db: PrismaClientLike, userId: string) {
  const program = await db.nutritionProgram.create({ data: { userId, name: "Agent Substitute Test", status: "ACTIVE" } });
  const day = await db.nutritionProgramDay.create({ data: { programId: program.id, dayNumber: 1 } });
  const meal = await db.nutritionProgramMeal.create({ data: { dayId: day.id, mealType: "LUNCH" } });
  const item = await db.nutritionProgramMealItem.create({
    data: { mealId: meal.id, customFoodName: "Ức gà", quantity: 200, calories: 412, proteinGrams: 51.4, carbGrams: 0, fatGrams: 9 },
  });
  return { program, day, meal, item };
}

async function cleanup(db: PrismaClientLike, programId: string) {
  await db.nutritionProgram.delete({ where: { id: programId } });
}

test(
  "substituteMealItem: applies the SPECIFICALLY named replacement in one call, no confirm step, and the day/meal totals stay correct",
  skipOpts,
  async () => {
    const { prisma: db, nutritionAgentService: svc } = await loadModules();
    const userId = `agent-sub-it-${randomUUID()}`;
    const { program, day, meal, item } = await seedProgram(db, userId);
    try {
      const result = await svc.substituteMealItem(userId, { currentFoodMention: "ức gà", desiredFoodMention: "cá hồi" });
      assert.equal(result.status, "APPLIED");
      if (result.status !== "APPLIED") return;
      assert.ok(result.newFood.foodName.toLowerCase().includes("salmon"));
      assert.equal(result.itemId, item.id);

      const updatedItem = await db.nutritionProgramMealItem.findUniqueOrThrow({ where: { id: item.id } });
      assert.ok(updatedItem.foodId, "must now be linked to a real catalog food, not free text");
      assert.equal(updatedItem.customFoodName, null);

      // Rollup must reflect the NEW item's calories, proving this call went
      // through the fixed updateMealItem path, not a bypass around it.
      const updatedMeal = await db.nutritionProgramMeal.findUniqueOrThrow({ where: { id: meal.id } });
      assert.equal(updatedMeal.calories, updatedItem.calories);
      const updatedDay = await db.nutritionProgramDay.findUniqueOrThrow({ where: { id: day.id } });
      assert.equal(updatedDay.totalCalories, updatedItem.calories);
    } finally {
      await cleanup(db, program.id);
    }
  },
);

test(
  "substituteMealItem: no desiredFoodMention -> falls back to the pool-based REPLACE engine, still applies directly",
  skipOpts,
  async () => {
    const { prisma: db, nutritionAgentService: svc } = await loadModules();
    const userId = `agent-sub-pool-it-${randomUUID()}`;
    const { program, item } = await seedProgram(db, userId);
    try {
      const result = await svc.substituteMealItem(userId, { currentFoodMention: "ức gà" });
      assert.equal(result.status, "APPLIED");
      if (result.status !== "APPLIED") return;
      assert.notEqual(result.newFood.foodName.toLowerCase(), "ức gà");
      const updatedItem = await db.nutritionProgramMealItem.findUniqueOrThrow({ where: { id: item.id } });
      assert.ok(updatedItem.foodId);
    } finally {
      await cleanup(db, program.id);
    }
  },
);

test(
  "substituteMealItem: a mention matching items in TWO different meals returns AMBIGUOUS_MEAL, never guesses",
  skipOpts,
  async () => {
    const { prisma: db, nutritionAgentService: svc } = await loadModules();
    const userId = `agent-sub-ambig-it-${randomUUID()}`;
    const { program, day, item: lunchItem } = await seedProgram(db, userId); // lunch has "Ức gà"
    const dinner = await db.nutritionProgramMeal.create({ data: { dayId: day.id, mealType: "DINNER" } });
    await db.nutritionProgramMealItem.create({
      data: { mealId: dinner.id, customFoodName: "Ức gà áp chảo", quantity: 150, calories: 300, proteinGrams: 38, carbGrams: 0, fatGrams: 6 },
    });
    try {
      const result = await svc.substituteMealItem(userId, { currentFoodMention: "ức gà", desiredFoodMention: "cá hồi" });
      assert.equal(result.status, "AMBIGUOUS_MEAL");
      if (result.status !== "AMBIGUOUS_MEAL") return;
      assert.equal(result.candidates.length, 2);
      assert.ok(result.candidates.some((c) => c.label.includes("Bữa trưa")));
      assert.ok(result.candidates.some((c) => c.label.includes("Bữa tối")));

      // The item itself must be untouched — an ambiguous request never applies anything.
      const untouchedItem = await db.nutritionProgramMealItem.findUniqueOrThrow({ where: { id: lunchItem.id } });
      assert.equal(untouchedItem.customFoodName, "Ức gà");
    } finally {
      await cleanup(db, program.id);
    }
  },
);

test(
  "substituteMealItem: mealHint narrows an otherwise-ambiguous match down to one meal",
  skipOpts,
  async () => {
    const { prisma: db, nutritionAgentService: svc } = await loadModules();
    const userId = `agent-sub-hint-it-${randomUUID()}`;
    const { program, day } = await seedProgram(db, userId); // lunch has "Ức gà"
    const dinner = await db.nutritionProgramMeal.create({ data: { dayId: day.id, mealType: "DINNER" } });
    await db.nutritionProgramMealItem.create({
      data: { mealId: dinner.id, customFoodName: "Ức gà áp chảo", quantity: 150, calories: 300, proteinGrams: 38, carbGrams: 0, fatGrams: 6 },
    });
    try {
      const result = await svc.substituteMealItem(userId, { currentFoodMention: "ức gà", desiredFoodMention: "cá hồi", mealHint: "bữa tối" });
      assert.equal(result.status, "APPLIED");
    } finally {
      await cleanup(db, program.id);
    }
  },
);

test(
  "substituteMealItem: resolvedMealId (the follow-up call after AMBIGUOUS_MEAL) targets exactly that meal",
  skipOpts,
  async () => {
    const { prisma: db, nutritionAgentService: svc } = await loadModules();
    const userId = `agent-sub-resolve-it-${randomUUID()}`;
    const { program, day, item: lunchItem } = await seedProgram(db, userId);
    const dinner = await db.nutritionProgramMeal.create({ data: { dayId: day.id, mealType: "DINNER" } });
    const dinnerItem = await db.nutritionProgramMealItem.create({
      data: { mealId: dinner.id, customFoodName: "Ức gà áp chảo", quantity: 150, calories: 300, proteinGrams: 38, carbGrams: 0, fatGrams: 6 },
    });
    try {
      const result = await svc.substituteMealItem(userId, { currentFoodMention: "ức gà", desiredFoodMention: "cá hồi", resolvedMealId: dinner.id });
      assert.equal(result.status, "APPLIED");
      if (result.status !== "APPLIED") return;
      assert.equal(result.itemId, dinnerItem.id);

      const untouchedLunchItem = await db.nutritionProgramMealItem.findUniqueOrThrow({ where: { id: lunchItem.id } });
      assert.equal(untouchedLunchItem.customFoodName, "Ức gà", "resolving to the dinner meal must never touch lunch's item");
    } finally {
      await cleanup(db, program.id);
    }
  },
);

test(
  "substituteMealItem: no match at all in the active plan returns NOT_FOUND, never a 500",
  skipOpts,
  async () => {
    const { prisma: db, nutritionAgentService: svc } = await loadModules();
    const userId = `agent-sub-notfound-it-${randomUUID()}`;
    const { program } = await seedProgram(db, userId);
    try {
      const result = await svc.substituteMealItem(userId, { currentFoodMention: "bánh flan" });
      assert.equal(result.status, "NOT_FOUND");
    } finally {
      await cleanup(db, program.id);
    }
  },
);

test(
  "substituteMealItem: a meal already marked COMPLETED is excluded and reported LOCKED, never silently edited",
  skipOpts,
  async () => {
    const { prisma: db, nutritionAgentService: svc } = await loadModules();
    const userId = `agent-sub-locked-it-${randomUUID()}`;
    const { program, meal, item } = await seedProgram(db, userId);
    await db.nutritionMealCompletion.create({
      data: { userId, mealId: meal.id, logDate: new Date(), status: "COMPLETED", percentConsumed: 100 },
    });
    try {
      const result = await svc.substituteMealItem(userId, { currentFoodMention: "ức gà" });
      assert.equal(result.status, "LOCKED");
      const untouchedItem = await db.nutritionProgramMealItem.findUniqueOrThrow({ where: { id: item.id } });
      assert.equal(untouchedItem.customFoodName, "Ức gà");
    } finally {
      await cleanup(db, program.id);
    }
  },
);

test(
  "substituteMealItem: no active program at all returns NO_ACTIVE_PROGRAM, never a 500",
  skipOpts,
  async () => {
    const { nutritionAgentService: svc } = await loadModules();
    const userId = `agent-sub-noprogram-it-${randomUUID()}`;
    const result = await svc.substituteMealItem(userId, { currentFoodMention: "ức gà" });
    assert.equal(result.status, "NO_ACTIVE_PROGRAM");
  },
);
