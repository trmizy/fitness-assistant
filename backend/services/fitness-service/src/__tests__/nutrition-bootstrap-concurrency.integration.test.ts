/**
 * Nutrition bootstrap concurrency (targeted remediation).
 * Concurrent first-time bootstrap callers for ONE user must behave as one idempotent operation:
 * exactly 1 ACTIVE goal, 1 ACTIVE cycle, every caller fulfilled (no P2010/23505 escaping), and the
 * non-idempotent side effects (audit row, meal-plan queue, notification) run exactly once.
 * The nutrition_goals_user_id_active_unique index is NOT touched — it stays the last line of defence.
 *
 * Run (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true INTERNAL_SERVICE_SECRET=test_internal_service_secret_32_chars_minimum \
 *     npx tsx --test --test-force-exit src/__tests__/nutrition-bootstrap-concurrency.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canRun = /(_test|postgres-test)/i.test(url);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
process.env.INTERNAL_SERVICE_SECRET ||= "test_internal_service_secret_32_chars_minimum";
process.env.FITNESS_DISABLE_REDIS ||= "true";
const skipOpts = { skip: canRun ? false : "Set FITNESS_DATABASE_URL to a *_test database" };

const PROFILE = {
  goal: "WEIGHT_LOSS" as const, currentWeight: 113.6, startingWeight: 113.6, targetWeight: 80,
  experienceLevel: "BEGINNER" as const, competesInSport: false, injuries: [] as string[], age: 22,
  gender: "MALE" as const, heightCm: 178, activityLevel: "SEDENTARY" as const,
  hasCompletedOnboarding: true, nutritionBudgetLevel: "LOW",
};

async function setup() {
  const { prisma } = await import("../repositories/prisma");
  const bootstrap = await import("../services/nutrition-onboarding-bootstrap.service");
  const { nutritionRepository } = await import("../repositories/nutrition.repository");
  const counters = { queued: 0, notified: 0 };
  const original = { ...bootstrap.nutritionBootstrapDeps };
  Object.assign(bootstrap.nutritionBootstrapDeps, {
    fetchUserProfile: async () => PROFILE,
    fetchLatestInBodyOnOrBefore: async () => null,
    queueInitialNutritionPlanSafe: async () => { counters.queued += 1; return { planId: "p", jobId: "j", status: "QUEUED" }; },
    createPersistentNotification: async () => { counters.notified += 1; },
  });
  return { prisma, bootstrap, nutritionRepository, counters, restore: () => Object.assign(bootstrap.nutritionBootstrapDeps, original) };
}

async function cleanup(prisma: Awaited<ReturnType<typeof setup>>["prisma"], userId: string) {
  await prisma.recommendationAudit.deleteMany({ where: { userId } });
  await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${userId}`;
  await prisma.trainingCycle.deleteMany({ where: { userId } });
}

async function state(prisma: Awaited<ReturnType<typeof setup>>["prisma"], userId: string) {
  const goals = await prisma.$queryRaw<Array<{ id: string; status: string; calories: number; protein: number; carbs: number; fat: number }>>`
    SELECT id, status, calories, protein, carbs, fat FROM nutrition_goals WHERE user_id = ${userId}`;
  return {
    activeGoals: goals.filter((g) => g.status === "ACTIVE"),
    allGoals: goals,
    activeCycles: await prisma.trainingCycle.count({ where: { userId, status: "ACTIVE" } }),
    audits: await prisma.recommendationAudit.count({ where: { userId, decision: "INITIAL_PLAN_CREATED" } }),
  };
}

test("10 same-user concurrent first-time bootstraps: 10 fulfilled, 1 ACTIVE goal/cycle, side effects once (x30 rounds = 300 calls)", skipOpts, async () => {
  const { prisma, bootstrap, counters, restore } = await setup();
  try {
    for (let round = 0; round < 30; round += 1) {
      const userId = randomUUID();
      counters.queued = 0; counters.notified = 0;
      try {
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => bootstrap.bootstrapNutritionForUser(userId)));
        const rejected = results.filter((r) => r.status === "rejected");
        assert.equal(rejected.length, 0, `round ${round}: ${rejected.map((r) => String((r as PromiseRejectedResult).reason?.message)).join("|")}`);
        const values = results.map((r) => (r as PromiseFulfilledResult<any>).value);
        const s = await state(prisma, userId);
        assert.equal(s.activeGoals.length, 1);
        assert.equal(s.allGoals.length, 1, "no churn: no superseded rows");
        assert.equal(s.activeCycles, 1);
        assert.equal(s.audits, 1, "audit written once");
        assert.equal(counters.queued, 1, "meal-plan job queued once");
        assert.equal(counters.notified, 1, "notification once");
        assert.equal(values.filter((v) => v.status === "created").length, 1, "exactly one creator");
        for (const v of values) assert.equal(v.goalId ?? null, s.activeGoals[0].id, "every caller converges on the winning goal");
        // Target authority unchanged: persisted goal == the pure engine's prescription for this profile.
        const { computeInitialNutritionPrescription } = await import("../services/nutrition-bootstrap.engine");
        const rx = computeInitialNutritionPrescription({
          weightKg: PROFILE.currentWeight, heightCm: PROFILE.heightCm, age: PROFILE.age, gender: PROFILE.gender,
          goal: PROFILE.goal, activityLevel: PROFILE.activityLevel, experienceLevel: PROFILE.experienceLevel,
          measuredBmr: null, useMaintenanceOnly: false,
        } as any);
        assert.deepEqual([s.activeGoals[0].calories, s.activeGoals[0].protein, s.activeGoals[0].carbs, s.activeGoals[0].fat], [rx.targetCalories, rx.proteinGrams, rx.carbGrams, rx.fatGrams]);
      } finally { await cleanup(prisma, userId); }
    }
  } finally { restore(); }
});

test("existing ACTIVE goal: concurrent/repeated bootstrap is a no-op (same goal, no churn, no side effects)", skipOpts, async () => {
  const { prisma, bootstrap, nutritionRepository, counters, restore } = await setup();
  const userId = randomUUID();
  try {
    const seeded = await nutritionRepository.upsertGoal(userId, { calories: 2500, protein: 150, carbs: 300, fat: 70 }, { triggeredBy: "MANUAL" });
    const results = await Promise.all(Array.from({ length: 10 }, () => bootstrap.bootstrapNutritionForUser(userId)));
    for (const r of results) assert.deepEqual(r, { status: "already_initialized", goalId: seeded.id });
    const s = await state(prisma, userId);
    assert.equal(s.allGoals.length, 1);
    assert.equal(s.activeGoals[0].id, seeded.id);
    assert.equal(s.activeGoals[0].calories, 2500);
    assert.equal(counters.queued + counters.notified + s.audits, 0);
  } finally { await cleanup(prisma, userId); restore(); }
});

test("partial-state recovery: ACTIVE cycle already present but no goal -> concurrent bootstraps converge to 1 goal on that cycle", skipOpts, async () => {
  const { prisma, bootstrap, restore } = await setup();
  const userId = randomUUID();
  try {
    const first = await bootstrap.bootstrapNutritionForUser(userId);
    assert.equal(first.status, "created");
    // Simulate a crash after the cycle but before the goal: drop goal + audit, keep cycle.
    await prisma.recommendationAudit.deleteMany({ where: { userId } });
    await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${userId}`;
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => bootstrap.bootstrapNutritionForUser(userId)));
    assert.equal(results.filter((r) => r.status === "rejected").length, 0);
    const s = await state(prisma, userId);
    assert.equal(s.activeGoals.length, 1);
    assert.equal(s.activeCycles, 1);
    const cycle = await prisma.trainingCycle.findFirst({ where: { userId, status: "ACTIVE" } });
    const [g] = await prisma.$queryRaw<Array<{ training_cycle_id: string }>>`SELECT training_cycle_id FROM nutrition_goals WHERE user_id = ${userId} AND status='ACTIVE'`;
    assert.equal(g.training_cycle_id, cycle!.id);
  } finally { await cleanup(prisma, userId); restore(); }
});

test("failure injection: a failure inside the create transaction leaves no partial goal, and a retry converges", skipOpts, async () => {
  const { prisma, bootstrap, nutritionRepository, restore } = await setup();
  const userId = randomUUID();
  try {
    // Invalid FK-less failure: NULL calories violates NOT NULL after the lock -> tx rolls back.
    await assert.rejects(() => nutritionRepository.createFirstActiveGoalIfAbsent(userId, { calories: null as any, protein: 1, carbs: 1, fat: 1 }, {}));
    assert.equal((await state(prisma, userId)).allGoals.length, 0, "no partial authoritative state");
    // Lock was released with the aborted tx: a normal bootstrap succeeds.
    const r = await bootstrap.bootstrapNutritionForUser(userId);
    assert.equal(r.status, "created");
    assert.equal((await state(prisma, userId)).activeGoals.length, 1);
  } finally { await cleanup(prisma, userId); restore(); }
});

test("unexpected DB errors are NOT swallowed (only the lock+re-read reconciles the expected race)", skipOpts, async () => {
  const { prisma, bootstrap, restore } = await setup();
  const userId = randomUUID();
  const orig = (await import("../repositories/nutrition.repository")).nutritionRepository.createFirstActiveGoalIfAbsent;
  const repo = (await import("../repositories/nutrition.repository")).nutritionRepository;
  try {
    repo.createFirstActiveGoalIfAbsent = async () => { throw new Error("connection reset"); };
    await assert.rejects(() => bootstrap.bootstrapNutritionForUser(userId), /connection reset/);
  } finally { repo.createFirstActiveGoalIfAbsent = orig; await cleanup(prisma, userId); restore(); }
});

test("cross-user: 10 different users bootstrap concurrently, each gets its own goal; lock scope is per user", skipOpts, async () => {
  const { prisma, bootstrap, restore } = await setup();
  const users = Array.from({ length: 10 }, () => randomUUID());
  try {
    const t0 = Date.now();
    const results = await Promise.allSettled(users.flatMap((u) => [bootstrap.bootstrapNutritionForUser(u), bootstrap.bootstrapNutritionForUser(u)]));
    const ms = Date.now() - t0;
    assert.equal(results.filter((r) => r.status === "rejected").length, 0);
    for (const u of users) {
      const s = await state(prisma, u);
      assert.equal(s.activeGoals.length, 1);
      assert.equal(s.activeCycles, 1);
    }
    console.log(`[perf] 10 users x 2 concurrent bootstraps: ${ms}ms`);
    // Different keys => different advisory locks: a held lock for user A must not block user B.
    const a = randomUUID(); const b = randomUUID();
    let releaseA!: () => void;
    const holdA = new Promise<void>((res) => { releaseA = res; });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"nutrition-bootstrap:" + a}, 0))`;
      await holdA;
    }, { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 200));
    const outcome = await Promise.race([
      bootstrap.bootstrapNutritionForUser(b).then(() => "b-done"),
      new Promise((r) => setTimeout(() => r("blocked"), 8000)),
    ]);
    assert.equal(outcome, "b-done", "user B must not wait on user A's lock");
    users.push(a, b);
    releaseA(); await holder;
  } finally { for (const u of users) await cleanup(prisma, u); restore(); }
});

test("HTTP: 10 concurrent POST /internal/onboarding/bootstrap-nutrition -> all 200, no 500, one ACTIVE goal", skipOpts, async () => {
  const { prisma, restore } = await setup();
  const { default: app } = await import("../app");
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const userId = randomUUID();
  try {
    const responses = await Promise.all(Array.from({ length: 10 }, () =>
      fetch(`http://127.0.0.1:${port}/internal/onboarding/bootstrap-nutrition`, {
        method: "POST",
        headers: { "x-internal-token": process.env.INTERNAL_SERVICE_SECRET!, "x-user-id": userId, "content-type": "application/json" },
        body: "{}",
      })));
    const statuses = responses.map((r) => r.status);
    assert.deepEqual(statuses, Array(10).fill(200), `statuses: ${statuses.join(",")}`);
    const bodies = await Promise.all(responses.map((r) => r.json() as Promise<any>));
    assert.ok(bodies.every((b) => b.success === true));
    assert.equal(bodies.filter((b) => b.data.status === "created").length, 1);
    assert.equal((await state(prisma, userId)).activeGoals.length, 1);
  } finally { server.close(); await cleanup(prisma, userId); restore(); }
});

test.after(async () => {
  const { prisma } = await import("../repositories/prisma");
  await prisma.$disconnect();
});
