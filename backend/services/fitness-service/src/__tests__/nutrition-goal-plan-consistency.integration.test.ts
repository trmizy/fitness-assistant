/**
 * Integration tests for nutrition-goal-plan-consistency.service.ts — real
 * gap found in docs/audit/nutrition-ai-current-flow-audit.md (câu 6):
 * NutritionGoal and NutritionProgram are two independently-versioned
 * models with zero synchronization. These tests seed real rows into the
 * isolated *_test database (never gymcoach_fitness) and verify the
 * detector's status/mismatch output against them — nothing here ever
 * archives/mutates the seeded rows itself (the service is read-only).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/nutrition-goal-plan-consistency.integration.test.ts
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
type NutritionRepoLike = (typeof import("../repositories/nutrition.repository"))["nutritionRepository"];
type ConsistencyServiceLike =
  (typeof import("../services/nutrition-goal-plan-consistency.service"))["nutritionGoalPlanConsistencyService"];

let prisma: PrismaClientLike | undefined;
let nutritionRepository: NutritionRepoLike | undefined;
let consistencyService: ConsistencyServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const repoModule = await import("../repositories/nutrition.repository");
    const serviceModule = await import("../services/nutrition-goal-plan-consistency.service");
    prisma = prismaModule.prisma;
    nutritionRepository = repoModule.nutritionRepository;
    consistencyService = serviceModule.nutritionGoalPlanConsistencyService;
  }
  return { prisma: prisma!, nutritionRepository: nutritionRepository!, consistencyService: consistencyService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

// NOTE: uses `in` checks rather than `??` defaults — `overrides.foo ?? X`
// would silently replace an explicitly-passed `null` with the default,
// which defeats tests that need a genuinely-null field (e.g. the
// LOW_CONFIDENCE legacy-program case below).
async function seedProgram(
  prisma: PrismaClientLike,
  userId: string,
  overrides: Partial<{
    dailyCaloriesTarget: number | null;
    proteinTargetGrams: number | null;
    carbTargetGrams: number | null;
    fatTargetGrams: number | null;
    sourceGoalId: string | null;
  }> = {},
) {
  return prisma.nutritionProgram.create({
    data: {
      userId,
      name: "Test Program",
      status: "ACTIVE",
      dailyCaloriesTarget: "dailyCaloriesTarget" in overrides ? overrides.dailyCaloriesTarget! : 2000,
      proteinTargetGrams: "proteinTargetGrams" in overrides ? overrides.proteinTargetGrams! : 150,
      carbTargetGrams: "carbTargetGrams" in overrides ? overrides.carbTargetGrams! : 200,
      fatTargetGrams: "fatTargetGrams" in overrides ? overrides.fatTargetGrams! : 65,
      sourceGoalId: overrides.sourceGoalId,
    },
  });
}

async function cleanup(prisma: PrismaClientLike, userId: string) {
  await prisma.nutritionProgram.deleteMany({ where: { userId } });
  await prisma.nutritionGoal.deleteMany({ where: { userId } });
}

test("NO_ACTIVE_GOAL: user with no goal at all", skipOpts, async () => {
  const { prisma, consistencyService } = await loadModules();
  const userId = randomUUID();
  try {
    const result = await consistencyService.compute(userId);
    assert.equal(result.status, "NO_ACTIVE_GOAL");
    assert.equal(result.activeGoal, null);
  } finally {
    await cleanup(prisma, userId);
  }
});

test("NO_ACTIVE_PROGRAM: user has a goal but no active program", skipOpts, async () => {
  const { prisma, nutritionRepository, consistencyService } = await loadModules();
  const userId = randomUUID();
  try {
    await nutritionRepository.upsertGoal(userId, { calories: 2000, protein: 150, carbs: 200, fat: 65 });
    const result = await consistencyService.compute(userId);
    assert.equal(result.status, "NO_ACTIVE_PROGRAM");
    assert.ok(result.activeGoal);
  } finally {
    await cleanup(prisma, userId);
  }
});

test("MATCHED: program's own target fields equal the active goal within tolerance", skipOpts, async () => {
  const { prisma, nutritionRepository, consistencyService } = await loadModules();
  const userId = randomUUID();
  try {
    const goal = await nutritionRepository.upsertGoal(userId, {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 65,
    });
    await seedProgram(prisma, userId, { sourceGoalId: goal.id });
    const result = await consistencyService.compute(userId);
    assert.equal(result.status, "MATCHED");
    assert.equal(result.mismatches.length, 0);
  } finally {
    await cleanup(prisma, userId);
  }
});

test("MACRO_MISMATCH: calories differ beyond the 5%/100kcal tolerance after goal changes", skipOpts, async () => {
  const { prisma, nutritionRepository, consistencyService } = await loadModules();
  const userId = randomUUID();
  try {
    await nutritionRepository.upsertGoal(userId, { calories: 2000, protein: 150, carbs: 200, fat: 65 });
    // Program was built from the OLD goal (before the change below).
    await seedProgram(prisma, userId, {
      dailyCaloriesTarget: 2000,
      proteinTargetGrams: 150,
      carbTargetGrams: 200,
      fatTargetGrams: 65,
    });
    // User changes their goal significantly — the real-world scenario this
    // whole feature exists for. fat 65->75 is also a real mismatch here
    // (diff 10 > tolerance max(75*0.1, 5)=7.5), so all 4 fields are
    // expected to be flagged, not just 3.
    await nutritionRepository.upsertGoal(userId, { calories: 2600, protein: 190, carbs: 260, fat: 75 });

    const result = await consistencyService.compute(userId);
    assert.equal(result.status, "MACRO_MISMATCH");
    const fields = result.mismatches.map((m) => m.field).sort();
    assert.deepEqual(fields, ["calories", "carbs", "fat", "protein"]);
    const caloriesMismatch = result.mismatches.find((m) => m.field === "calories")!;
    assert.equal(caloriesMismatch.planValue, 2000);
    assert.equal(caloriesMismatch.goalValue, 2600);
  } finally {
    await cleanup(prisma, userId);
  }
});

test("within-tolerance small differences do NOT count as mismatch (5%/100kcal, 10%/10g, 10%/5g floors)", skipOpts, async () => {
  const { prisma, nutritionRepository, consistencyService } = await loadModules();
  const userId = randomUUID();
  try {
    const goal = await nutritionRepository.upsertGoal(userId, {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 65,
    });
    // 2050 vs 2000 = 50kcal diff, well within the 100kcal floor.
    // 155 vs 150 protein = 5g diff, within the 10g floor.
    await seedProgram(prisma, userId, {
      dailyCaloriesTarget: 2050,
      proteinTargetGrams: 155,
      carbTargetGrams: 205,
      fatTargetGrams: 67,
      sourceGoalId: goal.id,
    });
    const result = await consistencyService.compute(userId);
    assert.equal(result.status, "MATCHED", `Expected MATCHED but got ${result.status}: ${JSON.stringify(result.mismatches)}`);
  } finally {
    await cleanup(prisma, userId);
  }
});

test("STALE_GOAL_CHANGED: numbers still coincidentally match, but sourceGoalId points to a superseded goal", skipOpts, async () => {
  const { prisma, nutritionRepository, consistencyService } = await loadModules();
  const userId = randomUUID();
  try {
    const v1 = await nutritionRepository.upsertGoal(userId, {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 65,
    });
    await seedProgram(prisma, userId, { sourceGoalId: v1.id });
    // New goal version with the SAME numbers (e.g. user just changed the
    // reason/triggeredBy, or re-saved) — macro-wise still matched, but the
    // association is stale.
    await nutritionRepository.upsertGoal(userId, {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 65,
    });

    const result = await consistencyService.compute(userId);
    assert.equal(result.status, "STALE_GOAL_CHANGED");
  } finally {
    await cleanup(prisma, userId);
  }
});

test("LOW_CONFIDENCE: legacy program with no target fields at all (created before this feature existed)", skipOpts, async () => {
  const { prisma, nutritionRepository, consistencyService } = await loadModules();
  const userId = randomUUID();
  try {
    await nutritionRepository.upsertGoal(userId, { calories: 2000, protein: 150, carbs: 200, fat: 65 });
    await seedProgram(prisma, userId, {
      dailyCaloriesTarget: null,
      proteinTargetGrams: null,
      carbTargetGrams: null,
      fatTargetGrams: null,
    });
    const result = await consistencyService.compute(userId);
    assert.equal(result.status, "LOW_CONFIDENCE");
  } finally {
    await cleanup(prisma, userId);
  }
});

test("legacy program with NO sourceGoalId (created before the column existed) still works via macro-value fallback, no crash", skipOpts, async () => {
  const { prisma, nutritionRepository, consistencyService } = await loadModules();
  const userId = randomUUID();
  try {
    await nutritionRepository.upsertGoal(userId, { calories: 2000, protein: 150, carbs: 200, fat: 65 });
    // sourceGoalId intentionally omitted — simulates a pre-migration row.
    await seedProgram(prisma, userId, {});
    const result = await consistencyService.compute(userId);
    // No sourceGoalId to compare against -> can't detect staleness via the
    // link, but numbers match -> MATCHED, not a crash or false mismatch.
    assert.equal(result.status, "MATCHED");
  } finally {
    await cleanup(prisma, userId);
  }
});

test("upsertGoal creates a stale plan, then importing a new AI plan links sourceGoalId to the CURRENT active goal", skipOpts, async () => {
  const { prisma, nutritionRepository, consistencyService } = await loadModules();
  const userId = randomUUID();
  try {
    const { nutritionService } = await import("../services/nutrition.service");
    const goal = await nutritionRepository.upsertGoal(userId, {
      calories: 2200,
      protein: 160,
      carbs: 220,
      fat: 70,
    });

    const foodRow = await prisma.food.findFirst({ select: { id: true } });
    assert.ok(foodRow, "expected at least one Food row to exist for this test");

    const weeklySchedule = Array.from({ length: 7 }, (_, i) => ({
      dayNumber: i + 1,
      meals: [
        {
          mealType: "BREAKFAST",
          items: [
            {
              foodId: foodRow!.id,
              name: "Test food",
              quantity: 100,
              calories: 100,
              protein: 10,
              carbs: 10,
              fat: 2,
            },
          ],
        },
      ],
    }));

    const result = await nutritionService.importAiPlan(userId, {
      sourcePlanId: `test-plan-${randomUUID()}`,
      sourcePlanName: "Test AI Plan",
      goal: "muscle_gain",
      durationWeeks: 1,
      mealsPerDay: 1,
      dailyCaloriesTarget: 2200,
      proteinTargetGrams: 160,
      carbTargetGrams: 220,
      fatTargetGrams: 70,
      weeklySchedule,
      forceArchive: true,
    });
    assert.ok(!result.alreadyExists);

    const program = await prisma.nutritionProgram.findFirst({ where: { userId, status: "ACTIVE" } });
    assert.equal(program?.sourceGoalId, goal.id, "importAiPlan must link the program to the currently-active goal");

    const consistency = await consistencyService.compute(userId);
    assert.equal(consistency.status, "MATCHED");
  } finally {
    await cleanup(prisma, userId);
  }
});

// Gymini Adaptive Cycle Transition Continuity §20 — a historical
// NutritionProgram must stay pinned to the NutritionGoal version it was
// actually built from, even after the user's goal is superseded to a new
// version and a second program is created. sourceGoalId is written once,
// at program-creation time (nutrition.service.ts) — nothing anywhere
// re-stamps it when the goal later changes, so P1 must keep V1 forever.
test("V1->V2 goal versioning: an older NutritionProgram (P1) keeps sourceGoalId=V1 forever; a newer program (P2) gets sourceGoalId=V2", skipOpts, async () => {
  const { prisma, nutritionRepository, consistencyService } = await loadModules();
  const userId = randomUUID();
  try {
    const v1 = await nutritionRepository.upsertGoal(userId, { calories: 2000, protein: 150, carbs: 200, fat: 65 });
    const p1 = await seedProgram(prisma, userId, {
      dailyCaloriesTarget: 2000, proteinTargetGrams: 150, carbTargetGrams: 200, fatTargetGrams: 65,
      sourceGoalId: v1.id,
    });

    // Real versioning transition — upsertGoal's own atomic SUPERSEDE+INSERT.
    const v2 = await nutritionRepository.upsertGoal(userId, { calories: 2400, protein: 180, carbs: 240, fat: 70 });
    assert.notEqual(v2.id, v1.id);

    // P1 must not be silently rewritten by the goal change.
    const p1AfterGoalChange = await prisma.nutritionProgram.findUnique({ where: { id: p1.id } });
    assert.equal(p1AfterGoalChange?.sourceGoalId, v1.id, "an older program must never be re-pointed to a newer goal version");

    // A real detector run against the now-stale P1 must flag it, never
    // silently treat V2 as if it always matched P1. P1's own macros (built
    // from V1) also genuinely differ from V2's numbers here, so the real
    // engine reports the more specific MACRO_MISMATCH rather than
    // STALE_GOAL_CHANGED (which is reserved for the case where the numbers
    // still coincidentally match despite the sourceGoalId pointing at a
    // superseded goal — see the dedicated test above for that case).
    const staleCheck = await consistencyService.compute(userId);
    assert.equal(staleCheck.status, "MACRO_MISMATCH");

    // Archive P1 (mirrors the real save flow's forceArchive behavior) and
    // create P2 sourced from the CURRENT active goal (V2) — the real
    // "regenerate" path a user takes after seeing the stale-plan banner.
    await prisma.nutritionProgram.update({ where: { id: p1.id }, data: { status: "ARCHIVED" } });
    const p2 = await seedProgram(prisma, userId, {
      dailyCaloriesTarget: 2400, proteinTargetGrams: 180, carbTargetGrams: 240, fatTargetGrams: 70,
      sourceGoalId: v2.id,
    });

    const p1Final = await prisma.nutritionProgram.findUnique({ where: { id: p1.id } });
    const p2Final = await prisma.nutritionProgram.findUnique({ where: { id: p2.id } });
    assert.equal(p1Final?.sourceGoalId, v1.id, "P1 must remain tied to V1 even after P2 exists");
    assert.equal(p2Final?.sourceGoalId, v2.id, "P2 must be tied to the goal it was actually generated from (V2)");

    // Calories/macros stay authoritative on NutritionGoal itself — the
    // meal-plan program never silently supersedes the goal's own numbers.
    const activeGoal = await nutritionRepository.findGoalByUserId(userId);
    assert.equal(activeGoal?.id, v2.id);
    assert.equal(activeGoal?.calories, 2400);

    const finalCheck = await consistencyService.compute(userId);
    assert.equal(finalCheck.status, "MATCHED", "P2 (built from V2) must now match the current active goal (V2)");
  } finally {
    await cleanup(prisma, userId);
  }
});
