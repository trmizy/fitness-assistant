/**
 * Regression tests for NutritionGoal versioning (real-time body profile /
 * evidence-based adaptive nutrition refactor, spec §24, §47): a calorie/
 * macro prescription change must supersede the old version, never
 * overwrite it in place — mirrors PersonalizedServicePlanVersion's
 * DELIVERED/ACCEPTED/SUPERSEDED pattern (ai-service).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/nutrition-goal-versioning.integration.test.ts
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
type NutritionServiceLike = (typeof import("../services/nutrition.service"))["nutritionService"];

let prisma: PrismaClientLike | undefined;
let nutritionRepository: NutritionRepoLike | undefined;
let nutritionService: NutritionServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const repoModule = await import("../repositories/nutrition.repository");
    const serviceModule = await import("../services/nutrition.service");
    prisma = prismaModule.prisma;
    nutritionRepository = repoModule.nutritionRepository;
    nutritionService = serviceModule.nutritionService;
  }
  return { prisma: prisma!, nutritionRepository: nutritionRepository!, nutritionService: nutritionService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

test(
  "upsertGoal: a second call supersedes the first version instead of overwriting it — both rows survive",
  skipOpts,
  async () => {
    const { prisma, nutritionRepository } = await loadModules();
    const userId = randomUUID();
    try {
      const v1 = await nutritionRepository.upsertGoal(
        userId,
        { calories: 2100, protein: 150, carbs: 220, fat: 65 },
        { triggeredBy: "ONBOARDING" },
      );
      const v2 = await nutritionRepository.upsertGoal(
        userId,
        { calories: 1950, protein: 160, carbs: 180, fat: 60 },
        { reason: "Weight-loss plateau after 3 weeks", triggeredBy: "AI_ADAPTIVE" },
      );

      assert.notEqual(v1.id, v2.id, "a new row must be created, not the same row updated in place");

      const history = await nutritionRepository.findGoalHistoryByUserId(userId);
      assert.equal(history.length, 2, "both versions must still exist in history");

      const stored1 = history.find((h) => h.id === v1.id)!;
      const stored2 = history.find((h) => h.id === v2.id)!;
      assert.equal(stored1.status, "SUPERSEDED");
      assert.equal(stored1.calories, 2100, "the superseded row's own values are never mutated");
      assert.equal(stored2.status, "ACTIVE");
      assert.equal(stored2.calories, 1950);
      assert.equal(stored2.reason, "Weight-loss plateau after 3 weeks");
      assert.equal(stored2.triggeredBy, "AI_ADAPTIVE");

      // The only-ACTIVE-row lookup reflects the current prescription.
      const current = await nutritionRepository.findGoalByUserId(userId);
      assert.equal(current?.id, v2.id);
      assert.equal(current?.calories, 1950);
    } finally {
      await prisma.nutritionGoal.deleteMany({ where: { userId } });
    }
  },
);

test(
  "upsertGoal: three successive changes leave exactly one ACTIVE row and a full ordered history",
  skipOpts,
  async () => {
    const { prisma, nutritionRepository } = await loadModules();
    const userId = randomUUID();
    try {
      await nutritionRepository.upsertGoal(userId, { calories: 2100, protein: 150, carbs: 220, fat: 65 });
      await nutritionRepository.upsertGoal(userId, { calories: 2000, protein: 155, carbs: 200, fat: 62 });
      const v3 = await nutritionRepository.upsertGoal(userId, { calories: 1900, protein: 160, carbs: 180, fat: 60 });

      const activeRows = await prisma.nutritionGoal.findMany({ where: { userId, status: "ACTIVE" } });
      assert.equal(activeRows.length, 1);
      assert.equal(activeRows[0].id, v3.id);

      const history = await nutritionRepository.findGoalHistoryByUserId(userId);
      assert.equal(history.length, 3);
      assert.deepEqual(
        history.map((h) => h.calories),
        [1900, 2000, 2100], // newest first
      );
    } finally {
      await prisma.nutritionGoal.deleteMany({ where: { userId } });
    }
  },
);

// Part 4 (Recommended vs Custom goal) — real gap flagged in
// docs/research/nutrition-ai-product-and-expert-review.md #9: UI didn't
// distinguish app-calculated goals from hand-entered ones.
test(
  "upsertGoal: goalMode defaults to RECOMMENDED when omitted, and CUSTOM is persisted + retrievable when explicitly set",
  skipOpts,
  async () => {
    const { prisma, nutritionRepository } = await loadModules();
    const userId = randomUUID();
    try {
      const recommended = await nutritionRepository.upsertGoal(userId, {
        calories: 2100,
        protein: 150,
        carbs: 220,
        fat: 65,
      });
      assert.equal(recommended.goalMode, "RECOMMENDED");

      const custom = await nutritionRepository.upsertGoal(userId, {
        calories: 1900,
        protein: 160,
        carbs: 180,
        fat: 60,
        goalMode: "CUSTOM",
      });
      assert.equal(custom.goalMode, "CUSTOM");

      const current = await nutritionRepository.findGoalByUserId(userId);
      assert.equal(current?.goalMode, "CUSTOM");

      const history = await nutritionRepository.findGoalHistoryByUserId(userId);
      assert.deepEqual(
        history.map((h) => h.goalMode),
        ["CUSTOM", "RECOMMENDED"], // newest first
      );
    } finally {
      await prisma.nutritionGoal.deleteMany({ where: { userId } });
    }
  },
);

// Safety-floor audit (2026-09-07) — the client's own PUT /nutrition/goals
// save previously had NO calorie floor at all (only `.positive()`), the
// weakest of three inconsistent numbers in this codebase (see
// nutrition-goal-macro-validator.ts's assertCalorieFloor doc comment for
// the full picture). This exercises the real SERVICE (nutritionService.
// upsertGoal), not just the repository, since the floor check lives at
// the service layer.

test(
  "SAFETY: nutritionService.upsertGoal rejects a below-floor save (400) and never persists it",
  skipOpts,
  async () => {
    const { prisma, nutritionService, nutritionRepository: repo } = await loadModules();
    const userId = randomUUID();
    try {
      await assert.rejects(
        // 60*4+60*4+47*9 = 903, within the 50kcal tolerance of 900 — this
        // ISN'T also a macro mismatch; this test is specifically about the
        // floor, not the (separately tested) macro-consistency check.
        () => nutritionService.upsertGoal(userId, { calories: 900, protein: 60, carbs: 60, fat: 47 } as any),
        (err: any) => err.status === 400 && err.code === "NUTRITION_GOAL_BELOW_SAFETY_FLOOR",
      );
      const goal = await repo.findGoalByUserId(userId);
      assert.equal(goal, null, "a rejected below-floor save must never create a NutritionGoal row");
    } finally {
      await prisma.nutritionGoal.deleteMany({ where: { userId } });
    }
  },
);

test(
  "SAFETY: nutritionService.upsertGoal accepts a save exactly at the shared floor",
  skipOpts,
  async () => {
    const { prisma, nutritionService, nutritionRepository: repo } = await loadModules();
    const { cycleThresholds } = await import("../config/cycle-thresholds.config");
    const floor = cycleThresholds.nutritionAdaptive.minPrescriptionCalories;
    const userId = randomUUID();
    try {
      // protein*4+carb*4+fat*9 must land within 50kcal of `floor`.
      const protein = 100;
      const fat = 40;
      const remaining = floor - protein * 4 - fat * 9;
      const carbs = Math.round(remaining / 4);
      const result = await nutritionService.upsertGoal(userId, { calories: floor, protein, carbs, fat } as any);
      assert.equal((result as any).goal.calories, floor);
      const stored = await repo.findGoalByUserId(userId);
      assert.equal(stored?.calories, floor);
    } finally {
      await prisma.nutritionGoal.deleteMany({ where: { userId } });
    }
  },
);
