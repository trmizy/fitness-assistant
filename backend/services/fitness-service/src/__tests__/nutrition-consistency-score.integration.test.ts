/**
 * Integration tests for computeNutritionConsistencyScore (cycle-metrics.engine.ts),
 * added as part of feeding a real nutrition signal into the Training Cycle
 * Decision Engine (see docs/TRAINING_CYCLE_DECISION_ENGINE.md §2.2 — the
 * engine previously had no nutrition input at all).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/nutrition-consistency-score.integration.test.ts
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
type ComputeNutritionConsistencyScoreLike = (typeof import("../services/cycle-metrics.engine"))["computeNutritionConsistencyScore"];

let prisma: PrismaClientLike | undefined;
let computeNutritionConsistencyScore: ComputeNutritionConsistencyScoreLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const engineModule = await import("../services/cycle-metrics.engine");
    prisma = prismaModule.prisma;
    computeNutritionConsistencyScore = engineModule.computeNutritionConsistencyScore;
  }
  return { prisma: prisma!, computeNutritionConsistencyScore: computeNutritionConsistencyScore! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

/** Seeds one NutritionProgram -> Day -> Meal chain, returns the mealId to
 * attach NutritionMealCompletion rows to. */
async function seedMeal(db: PrismaClientLike, userId: string) {
  const program = await db.nutritionProgram.create({
    data: { userId, name: "Test Program", status: "ACTIVE" },
  });
  const day = await db.nutritionProgramDay.create({
    data: { programId: program.id, dayNumber: 1 },
  });
  const meal = await db.nutritionProgramMeal.create({
    data: { dayId: day.id, mealType: "BREAKFAST" },
  });
  return meal.id;
}

test(
  "computeNutritionConsistencyScore: returns null (never 0) when nothing was logged at all in the window",
  skipOpts,
  async () => {
    const { computeNutritionConsistencyScore } = await loadModules();
    const userId = randomUUID();
    const score = await computeNutritionConsistencyScore({
      userId,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      asOf: new Date(Date.UTC(2026, 0, 8)),
    });
    assert.equal(score, null);
  },
);

test(
  "computeNutritionConsistencyScore: logging every day at exactly the calorie target scores near 1",
  skipOpts,
  async () => {
    const { prisma, computeNutritionConsistencyScore } = await loadModules();
    const userId = randomUUID();
    const mealId = await seedMeal(prisma, userId);
    await prisma.nutritionGoal.create({ data: { userId, calories: 2000, protein: 150, carbs: 200, fat: 65 } });

    const start = new Date(Date.UTC(2026, 0, 1));
    for (let i = 0; i < 7; i++) {
      const logDate = new Date(Date.UTC(2026, 0, 1 + i));
      await prisma.nutritionMealCompletion.create({
        data: { userId, mealId, logDate, status: "COMPLETED", consumedCalories: 2000 },
      });
    }
    const asOf = new Date(Date.UTC(2026, 0, 7));

    const score = await computeNutritionConsistencyScore({ userId, startDate: start, asOf });
    assert.ok(score !== null && score >= 0.95, `expected near-perfect score, got ${score}`);

    await prisma.nutritionMealCompletion.deleteMany({ where: { userId } });
    await prisma.nutritionGoal.deleteMany({ where: { userId } });
  },
);

test(
  "computeNutritionConsistencyScore: logging only 2 of 7 days scores low even if calories matched target on those days",
  skipOpts,
  async () => {
    const { prisma, computeNutritionConsistencyScore } = await loadModules();
    const userId = randomUUID();
    const mealId = await seedMeal(prisma, userId);
    await prisma.nutritionGoal.create({ data: { userId, calories: 2000, protein: 150, carbs: 200, fat: 65 } });

    const start = new Date(Date.UTC(2026, 0, 1));
    for (const dayOffset of [0, 1]) {
      const logDate = new Date(Date.UTC(2026, 0, 1 + dayOffset));
      await prisma.nutritionMealCompletion.create({
        data: { userId, mealId, logDate, status: "COMPLETED", consumedCalories: 2000 },
      });
    }
    const asOf = new Date(Date.UTC(2026, 0, 7)); // 7-day window, only 2 days logged

    const score = await computeNutritionConsistencyScore({ userId, startDate: start, asOf });
    assert.ok(score !== null && score < 0.4, `expected a low score from sparse logging, got ${score}`);

    await prisma.nutritionMealCompletion.deleteMany({ where: { userId } });
    await prisma.nutritionGoal.deleteMany({ where: { userId } });
  },
);

test(
  "computeNutritionConsistencyScore: SKIPPED-only days don't count as logged",
  skipOpts,
  async () => {
    const { prisma, computeNutritionConsistencyScore } = await loadModules();
    const userId = randomUUID();
    const mealId = await seedMeal(prisma, userId);

    await prisma.nutritionMealCompletion.create({
      data: {
        userId,
        mealId,
        logDate: new Date(Date.UTC(2026, 0, 1)),
        status: "SKIPPED",
      },
    });
    const score = await computeNutritionConsistencyScore({
      userId,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      asOf: new Date(Date.UTC(2026, 0, 1)),
    });
    assert.equal(score, null, "a day with only a SKIPPED completion row must not count as 'logged'");

    await prisma.nutritionMealCompletion.deleteMany({ where: { userId } });
  },
);
