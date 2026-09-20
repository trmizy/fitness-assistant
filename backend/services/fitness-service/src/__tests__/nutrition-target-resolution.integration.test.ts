/**
 * AI Coach product remediation M3 — resolveNutritionTargetForUser is the
 * READ-ONLY authoritative target the chat's standalone nutrition generation
 * must use: the ACTIVE NutritionGoal if one exists, else the SAME
 * deterministic initial prescription bootstrap computes. Never a new formula,
 * never a write.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/nutrition-target-resolution.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
const skipOpts = { skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test" };

type BootstrapModule = typeof import("../services/nutrition-onboarding-bootstrap.service");
let prisma: (typeof import("../repositories/prisma"))["prisma"] | undefined;
let bootstrap: BootstrapModule | undefined;
let nutritionRepository: (typeof import("../repositories/nutrition.repository"))["nutritionRepository"] | undefined;
async function load() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    bootstrap = await import("../services/nutrition-onboarding-bootstrap.service");
    nutritionRepository = (await import("../repositories/nutrition.repository")).nutritionRepository;
  }
  return { prisma: prisma!, bootstrap: bootstrap!, nutritionRepository: nutritionRepository! };
}
test.after(async () => { if (prisma) await prisma.$disconnect(); });

// The exact Codex product-E2E fixture: 75kg / 170cm / 28 / female / moderately active / beginner / weight loss.
const PROFILE = {
  goal: "WEIGHT_LOSS" as const, currentWeight: 75, startingWeight: 75, experienceLevel: "BEGINNER" as const, competesInSport: false,
  injuries: [] as string[], age: 28, gender: "FEMALE" as const, heightCm: 170, activityLevel: "MODERATELY_ACTIVE" as const, hasCompletedOnboarding: true,
};

async function withStubs(profile: unknown, fn: (ctx: Awaited<ReturnType<typeof load>>, userId: string) => Promise<void>) {
  const ctx = await load();
  const userId = randomUUID();
  const original = { ...ctx.bootstrap.nutritionBootstrapDeps };
  Object.assign(ctx.bootstrap.nutritionBootstrapDeps, {
    fetchUserProfile: async () => profile, fetchLatestInBodyOnOrBefore: async () => null,
    queueInitialNutritionPlanSafe: async () => ({ planId: "p", jobId: "j", status: "QUEUED" }), createPersistentNotification: async () => {},
  });
  try { await fn(ctx, userId); } finally {
    Object.assign(ctx.bootstrap.nutritionBootstrapDeps, original);
    await ctx.prisma.recommendationAudit.deleteMany({ where: { userId } });
    await ctx.prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${userId}`;
    await ctx.prisma.trainingCycle.deleteMany({ where: { userId } });
  }
}

test("no goal -> COMPUTED via the bootstrap engine (1992/128/246/55 for the Codex fixture), and NOTHING is written", skipOpts, async () => {
  await withStubs(PROFILE, async ({ bootstrap, nutritionRepository, prisma }, userId) => {
    const t = await bootstrap.resolveNutritionTargetForUser(userId);
    assert.equal(t.status, "COMPUTED");
    if (t.status !== "COMPUTED") return;
    assert.deepEqual([t.calories, t.protein, t.carbs, t.fat], [1992, 128, 246, 55]);
    assert.equal(await nutritionRepository.findGoalByUserId(userId), null, "read-only: must not create a goal");
    assert.equal(await prisma.trainingCycle.count({ where: { userId } }), 0, "read-only: must not create a cycle");
  });
});

test("the resolved COMPUTED target equals exactly what bootstrap then persists (no competing prescription)", skipOpts, async () => {
  await withStubs(PROFILE, async ({ bootstrap, nutritionRepository }, userId) => {
    const t = await bootstrap.resolveNutritionTargetForUser(userId);
    const created = await bootstrap.bootstrapNutritionForUser(userId);
    assert.equal(created.status, "created");
    if (t.status !== "COMPUTED" || created.status !== "created") return;
    assert.deepEqual([created.calories, created.protein, created.carbs, created.fat], [t.calories, t.protein, t.carbs, t.fat]);
    const goal = await nutritionRepository.findGoalByUserId(userId);
    assert.deepEqual([goal!.calories, goal!.protein, goal!.carbs, goal!.fat], [t.calories, t.protein, t.carbs, t.fat]);
  });
});

test("an ACTIVE NutritionGoal always wins over a recomputation", skipOpts, async () => {
  await withStubs(PROFILE, async ({ bootstrap, nutritionRepository }, userId) => {
    await nutritionRepository.upsertGoal(userId, { calories: 1800, protein: 150, carbs: 180, fat: 53, waterMl: 2500, goalMode: "MANUAL" } as any, { reason: "test", triggeredBy: "USER" } as any);
    const t = await bootstrap.resolveNutritionTargetForUser(userId);
    assert.equal(t.status, "ACTIVE_GOAL");
    if (t.status !== "ACTIVE_GOAL") return;
    assert.deepEqual([t.calories, t.protein, t.carbs, t.fat], [1800, 150, 180, 53]);
    assert.ok(t.goalId);
  });
});

test("incomplete profile -> insufficient_data with the missing fields; never a guessed target", skipOpts, async () => {
  await withStubs({ ...PROFILE, heightCm: null, age: null }, async ({ bootstrap }, userId) => {
    const t = await bootstrap.resolveNutritionTargetForUser(userId);
    assert.equal(t.status, "insufficient_data");
    if (t.status === "insufficient_data") assert.ok(t.missingFields.includes("heightCm") && t.missingFields.includes("age"));
  });
});
