/**
 * AI Nutrition Cycle Engine (Gymini) — spec §IV/§VI/§XLI/§XLIII/§XLIV.
 * Covers: initial plan auto-creation from profile alone (no InBody needed),
 * insufficient-data handling, idempotency (a refresh/retry never creates a
 * duplicate active cycle/goal), and reuse of a pre-existing active cycle.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/nutrition-onboarding-bootstrap.integration.test.ts
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
type BootstrapModule = typeof import("../services/nutrition-onboarding-bootstrap.service");
type NutritionRepoLike = (typeof import("../repositories/nutrition.repository"))["nutritionRepository"];

let prisma: PrismaClientLike | undefined;
let bootstrap: BootstrapModule | undefined;
let nutritionRepository: NutritionRepoLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    bootstrap = await import("../services/nutrition-onboarding-bootstrap.service");
    nutritionRepository = (await import("../repositories/nutrition.repository")).nutritionRepository;
  }
  return { prisma: prisma!, bootstrap: bootstrap!, nutritionRepository: nutritionRepository! };
}

const FAKE_PROFILE = {
  goal: "WEIGHT_LOSS" as const,
  currentWeight: 113.6,
  startingWeight: 113.6,
  targetWeight: 80,
  experienceLevel: "BEGINNER" as const,
  competesInSport: false,
  injuries: [] as string[],
  age: 22,
  gender: "MALE" as const,
  heightCm: 178,
  activityLevel: "SEDENTARY" as const,
  hasCompletedOnboarding: true,
  nutritionBudgetLevel: "LOW",
};

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

test(
  "spec §XLI scenario: full profile, no InBody -> creates an ACTIVE cycle + ACTIVE goal linked together, and an explainability audit row",
  skipOpts,
  async () => {
    const { prisma, bootstrap, nutritionRepository } = await loadModules();
    const userId = randomUUID();
    const originalDeps = { ...bootstrap.nutritionBootstrapDeps };
    let queuedPayload: unknown = null;
    Object.assign(bootstrap.nutritionBootstrapDeps, {
      fetchUserProfile: async () => FAKE_PROFILE,
      fetchLatestInBodyOnOrBefore: async () => null,
      queueInitialNutritionPlanSafe: async (_userId: string, payload: unknown) => {
        queuedPayload = payload;
        return { planId: "fake-plan", jobId: "fake-job", status: "QUEUED" };
      },
      createPersistentNotification: async () => {},
    });

    try {
      const result = await bootstrap.bootstrapNutritionForUser(userId);
      assert.equal(result.status, "created");
      if (result.status !== "created") return;

      assert.ok(result.calories > 0);
      assert.ok(result.protein > 0);
      assert.equal(result.cycleCreated, true);
      assert.ok(queuedPayload, "must fire the async AI meal-plan generation");

      const activeCycles = await prisma.trainingCycle.findMany({ where: { userId, status: "ACTIVE" } });
      assert.equal(activeCycles.length, 1, "exactly one ACTIVE cycle");
      assert.equal(activeCycles[0].id, result.cycleId);

      const goal = await nutritionRepository.findGoalByUserId(userId);
      assert.ok(goal);
      assert.equal(goal!.id, result.goalId);
      assert.equal(goal!.triggeredBy, "ONBOARDING");
      assert.equal((goal as any).trainingCycleId, result.cycleId, "NutritionGoal must be linked to the cycle it was created for");

      const audits = await prisma.recommendationAudit.findMany({
        where: { userId, engineVersion: "nutrition-bootstrap-v1" },
      });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].decision, "INITIAL_PLAN_CREATED");
      assert.ok(Array.isArray(audits[0].reasonCodes) && (audits[0].reasonCodes as unknown as string[]).length > 0);
      assert.ok(audits[0].aiSummary && audits[0].aiSummary.length > 0, "must have a human-readable explanation (spec §XXVIII)");

      // Idempotency: calling again must NOT create a second active cycle/goal.
      const second = await bootstrap.bootstrapNutritionForUser(userId);
      assert.equal(second.status, "already_initialized");
      const activeCyclesAfter = await prisma.trainingCycle.findMany({ where: { userId, status: "ACTIVE" } });
      assert.equal(activeCyclesAfter.length, 1, "refresh/retry must never create a second active cycle");
      const historyAfter = await nutritionRepository.findGoalHistoryByUserId(userId);
      assert.equal(historyAfter.length, 1, "refresh/retry must never create a second goal version");
    } finally {
      Object.assign(bootstrap.nutritionBootstrapDeps, originalDeps);
      await prisma.recommendationAudit.deleteMany({ where: { userId } });
      await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${userId}`;
      await prisma.trainingCycle.deleteMany({ where: { userId } });
    }
  },
);

test(
  "missing required profile fields -> insufficient_data, creates nothing (no cycle, no goal)",
  skipOpts,
  async () => {
    const { prisma, bootstrap, nutritionRepository } = await loadModules();
    const userId = randomUUID();
    const originalDeps = { ...bootstrap.nutritionBootstrapDeps };
    Object.assign(bootstrap.nutritionBootstrapDeps, {
      fetchUserProfile: async () => ({ goal: "WEIGHT_LOSS", currentWeight: 70 }), // missing age/gender/heightCm/activityLevel
      fetchLatestInBodyOnOrBefore: async () => null,
      queueInitialNutritionPlanSafe: async () => {
        throw new Error("must never be called when data is insufficient");
      },
      createPersistentNotification: async () => {},
    });

    try {
      const result = await bootstrap.bootstrapNutritionForUser(userId);
      assert.equal(result.status, "insufficient_data");
      if (result.status !== "insufficient_data") return;
      assert.deepEqual(result.missingFields.sort(), ["activityLevel", "age", "gender", "heightCm"]);

      const activeCycles = await prisma.trainingCycle.findMany({ where: { userId } });
      assert.equal(activeCycles.length, 0);
      const goal = await nutritionRepository.findGoalByUserId(userId);
      assert.equal(goal, null);
    } finally {
      Object.assign(bootstrap.nutritionBootstrapDeps, originalDeps);
    }
  },
);

test(
  "reuses a pre-existing ACTIVE cycle instead of creating a second one",
  skipOpts,
  async () => {
    const { prisma, bootstrap, nutritionRepository } = await loadModules();
    const userId = randomUUID();
    const originalDeps = { ...bootstrap.nutritionBootstrapDeps };
    Object.assign(bootstrap.nutritionBootstrapDeps, {
      fetchUserProfile: async () => FAKE_PROFILE,
      fetchLatestInBodyOnOrBefore: async () => null,
      queueInitialNutritionPlanSafe: async () => ({ planId: "p", jobId: "j", status: "QUEUED" }),
      createPersistentNotification: async () => {},
    });

    const existingCycle = await prisma.trainingCycle.create({
      data: {
        userId,
        cycleIndex: 1,
        startDate: new Date(),
        endDate: new Date(Date.now() + 28 * 86_400_000),
        durationDays: 28,
        goal: "WEIGHT_LOSS",
        status: "ACTIVE",
        name: "Pre-existing cycle from a training-only flow",
      },
    });

    try {
      const result = await bootstrap.bootstrapNutritionForUser(userId);
      assert.equal(result.status, "created");
      if (result.status !== "created") return;
      assert.equal(result.cycleCreated, false, "must reuse, not recreate, the existing active cycle");
      assert.equal(result.cycleId, existingCycle.id);

      const goal = await nutritionRepository.findGoalByUserId(userId);
      assert.equal((goal as any).trainingCycleId, existingCycle.id);
    } finally {
      Object.assign(bootstrap.nutritionBootstrapDeps, originalDeps);
      await prisma.recommendationAudit.deleteMany({ where: { userId } });
      await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${userId}`;
      await prisma.trainingCycle.deleteMany({ where: { userId } });
    }
  },
);

test(
  "CONCURRENCY (Phase 2 §II): 10 simultaneous bootstrap calls for the same brand-new user -> exactly one ACTIVE cycle and one ACTIVE goal survive, none crash unhandled",
  skipOpts,
  async () => {
    const { prisma, bootstrap } = await loadModules();
    const userId = randomUUID();
    const originalDeps = { ...bootstrap.nutritionBootstrapDeps };
    Object.assign(bootstrap.nutritionBootstrapDeps, {
      fetchUserProfile: async () => FAKE_PROFILE,
      fetchLatestInBodyOnOrBefore: async () => null,
      queueInitialNutritionPlanSafe: async () => ({ planId: "p", jobId: "j", status: "QUEUED" }),
      createPersistentNotification: async () => {},
    });

    try {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => bootstrap.bootstrapNutritionForUser(userId)),
      );

      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(rejected.length, 0, "no concurrent bootstrap call should throw an unhandled error");

      const activeCycles = await prisma.trainingCycle.findMany({ where: { userId, status: "ACTIVE" } });
      assert.equal(activeCycles.length, 1, "exactly one ACTIVE cycle must survive 10-way concurrency");

      const activeGoals = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM nutrition_goals WHERE user_id = ${userId} AND status = 'ACTIVE'
      `;
      assert.equal(activeGoals.length, 1, "exactly one ACTIVE goal must survive 10-way concurrency");

      // A real user-facing retry (double-click, flaky network retry) must
      // land on a clean, resolvable outcome for every attempt — either
      // "created" (the winner) or "already_initialized" (every other
      // attempt), never a thrown error the frontend has to guess about.
      const outcomes = results.map((r) => (r as PromiseFulfilledResult<any>).value.status);
      assert.ok(outcomes.every((s) => s === "created" || s === "already_initialized"));
    } finally {
      Object.assign(bootstrap.nutritionBootstrapDeps, originalDeps);
      await prisma.recommendationAudit.deleteMany({ where: { userId } });
      await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${userId}`;
      await prisma.trainingCycle.deleteMany({ where: { userId } });
    }
  },
);

test(
  "SAFETY (Phase 2 §I): a profile with reported screening flags gets a maintenance-only target, professionalReviewRequired=true, and a consultation reason — never the full WEIGHT_LOSS deficit",
  skipOpts,
  async () => {
    const { prisma, bootstrap, nutritionRepository } = await loadModules();
    const userId = randomUUID();
    const originalDeps = { ...bootstrap.nutritionBootstrapDeps };
    Object.assign(bootstrap.nutritionBootstrapDeps, {
      fetchUserProfile: async () => ({
        ...FAKE_PROFILE,
        safetyScreeningStatus: "FOLLOW_UP_SUGGESTED",
        safetyScreeningFlags: ["heart_condition"],
      }),
      fetchLatestInBodyOnOrBefore: async () => null,
      queueInitialNutritionPlanSafe: async () => ({ planId: "p", jobId: "j", status: "QUEUED" }),
      createPersistentNotification: async () => {},
    });

    try {
      const result = await bootstrap.bootstrapNutritionForUser(userId);
      assert.equal(result.status, "created");
      if (result.status !== "created") return;
      assert.equal(result.professionalReviewRequired, true);
      assert.equal(result.safetyScreeningStatus, "FOLLOW_UP_SUGGESTED");

      // maintenance = bmr * 1.2 (sedentary); a real WEIGHT_LOSS deficit
      // would be noticeably lower than this — assert we got maintenance,
      // not the aggressive number a non-flagged user with the same
      // profile would receive.
      const compareUserId = randomUUID();
      let unflaggedResult: Awaited<ReturnType<typeof bootstrap.bootstrapNutritionForUser>>;
      Object.assign(bootstrap.nutritionBootstrapDeps, {
        fetchUserProfile: async () => FAKE_PROFILE,
      });
      try {
        unflaggedResult = await bootstrap.bootstrapNutritionForUser(compareUserId);
      } finally {
        await prisma.recommendationAudit.deleteMany({ where: { userId: compareUserId } });
        await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${compareUserId}`;
        await prisma.trainingCycle.deleteMany({ where: { userId: compareUserId } });
      }
      assert.equal(unflaggedResult.status, "created");
      if (unflaggedResult.status === "created") {
        assert.ok(
          result.calories > unflaggedResult.calories,
          "the flagged (maintenance-only) profile must receive MORE calories than the same profile's real WEIGHT_LOSS deficit would",
        );
      }

      const goal = await nutritionRepository.findGoalByUserId(userId);
      assert.ok(goal!.reason?.includes("chuyên gia") || goal!.reason?.includes("bác sĩ"));

      const audits = await prisma.recommendationAudit.findMany({
        where: { userId, engineVersion: "nutrition-bootstrap-v1" },
      });
      assert.equal(audits.length, 1);
      assert.ok((audits[0].reasonCodes as unknown as string[]).includes("SAFETY_SCREENING_PROFESSIONAL_REVIEW_REQUIRED"));
    } finally {
      Object.assign(bootstrap.nutritionBootstrapDeps, originalDeps);
      await prisma.recommendationAudit.deleteMany({ where: { userId } });
      await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${userId}`;
      await prisma.trainingCycle.deleteMany({ where: { userId } });
    }
  },
);

test(
  "SAFETY: unscreened (UNKNOWN) profile does NOT get flagged for review — matches the existing 'warn on reported risk, never on missing data' policy",
  skipOpts,
  async () => {
    const { prisma, bootstrap } = await loadModules();
    const userId = randomUUID();
    const originalDeps = { ...bootstrap.nutritionBootstrapDeps };
    Object.assign(bootstrap.nutritionBootstrapDeps, {
      fetchUserProfile: async () => ({ ...FAKE_PROFILE, safetyScreeningStatus: undefined, safetyScreeningFlags: undefined }),
      fetchLatestInBodyOnOrBefore: async () => null,
      queueInitialNutritionPlanSafe: async () => ({ planId: "p", jobId: "j", status: "QUEUED" }),
      createPersistentNotification: async () => {},
    });

    try {
      const result = await bootstrap.bootstrapNutritionForUser(userId);
      assert.equal(result.status, "created");
      if (result.status !== "created") return;
      assert.equal(result.professionalReviewRequired, false);
      assert.equal(result.safetyScreeningStatus, "UNKNOWN");
    } finally {
      Object.assign(bootstrap.nutritionBootstrapDeps, originalDeps);
      await prisma.recommendationAudit.deleteMany({ where: { userId } });
      await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${userId}`;
      await prisma.trainingCycle.deleteMany({ where: { userId } });
    }
  },
);
