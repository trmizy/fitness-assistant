/**
 * Integration tests for the Adaptive Nutrition Decision Engine's
 * apply/versioning workflow (Phase 2, spec §14/§15/§28/§29) — real DB, real
 * training-cycle.service.ts, real NutritionGoal versioning (Phase 1).
 *
 * Covers what the pure engine unit tests (nutrition-decision.engine.test.ts)
 * cannot: that accepting a PROPOSE_ADJUSTMENT actually creates exactly one
 * new NutritionGoal version, that rejecting never touches NutritionGoal at
 * all, and that concurrent accept attempts can't double-apply.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/nutrition-adaptive-apply.integration.test.ts
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
type TrainingCycleServiceLike = (typeof import("../services/training-cycle.service"))["trainingCycleService"];
type NutritionRepoLike = (typeof import("../repositories/nutrition.repository"))["nutritionRepository"];

let prisma: PrismaClientLike | undefined;
let trainingCycleService: TrainingCycleServiceLike | undefined;
let nutritionRepository: NutritionRepoLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    trainingCycleService = (await import("../services/training-cycle.service")).trainingCycleService;
    nutritionRepository = (await import("../repositories/nutrition.repository")).nutritionRepository;
  }
  return { prisma: prisma!, trainingCycleService: trainingCycleService!, nutritionRepository: nutritionRepository! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

/** Builds a CycleAssessment row directly (bypassing the full evaluate()
 * pipeline, which needs real cross-service InBody/profile data) with a
 * PROPOSE_ADJUSTMENT-shaped nutrition decision already attached — isolates
 * this test to exactly what it's verifying: the apply/versioning workflow,
 * not the engine's own decision logic (already covered by
 * nutrition-decision.engine.test.ts). */
async function seedCycleWithNutritionProposal(
  db: PrismaClientLike,
  userId: string,
  proposedChanges: { calories: number; protein: number; carbs: number; fat: number } | null,
) {
  const cycle = await db.trainingCycle.create({
    data: {
      userId,
      startDate: new Date(),
      endDate: new Date(Date.now() + 28 * 86_400_000),
      durationDays: 28,
      status: "ACTIVE",
    },
  });
  const assessment = await db.cycleAssessment.create({
    data: {
      cycleId: cycle.id,
      assessmentVersion: 1,
      status: "COMPLETED",
      decision: "KEEP",
      nutritionDecision: proposedChanges ? "PROPOSE_ADJUSTMENT" : "KEEP_PLAN",
      nutritionConfidence: "HIGH",
      nutritionProposedChanges: proposedChanges as any,
      nutritionReasonCodes: proposedChanges ? (["WEIGHT_LOSS_PLATEAUED_OR_TOO_SLOW"] as any) : ([] as any),
      nutritionRequiresConfirmation: !!proposedChanges,
    },
  });
  return { cycle, assessment };
}

test("accepting a PROPOSE_ADJUSTMENT creates exactly one new ACTIVE NutritionGoal version, superseding the old one", skipOpts, async () => {
  const { prisma: db, trainingCycleService: service, nutritionRepository: repo } = await loadModules();
  const userId = randomUUID();
  try {
    const v1 = await repo.upsertGoal(userId, { calories: 2000, protein: 150, carbs: 200, fat: 60 }, { triggeredBy: "ONBOARDING" });
    const { cycle, assessment } = await seedCycleWithNutritionProposal(db, userId, {
      calories: 1850,
      protein: 150,
      carbs: 170,
      fat: 60,
    });

    const reviewed = await service.acceptNutritionRecommendation(cycle.id, userId, assessment.id);
    assert.equal((reviewed as any).nutritionUserDecision, "ACCEPTED");
    assert.ok((reviewed as any).appliedNutritionGoalId, "expected appliedNutritionGoalId to be set");

    const activeRows = await db.nutritionGoal.findMany({ where: { userId, status: "ACTIVE" } });
    assert.equal(activeRows.length, 1, "exactly one ACTIVE row must exist after apply");
    assert.equal(activeRows[0].calories, 1850);
    assert.equal(activeRows[0].triggeredBy, "AI_ADAPTIVE");

    const supersededV1 = await db.nutritionGoal.findUnique({ where: { id: v1.id } });
    assert.equal(supersededV1?.status, "SUPERSEDED", "the old version must be superseded, never deleted");
    assert.equal(supersededV1?.calories, 2000, "the superseded row's own values must never be mutated");
  } finally {
    await db!.nutritionGoal.deleteMany({ where: { userId } });
    await db!.cycleAssessment.deleteMany({ where: { cycleId: { in: (await db!.trainingCycle.findMany({ where: { userId }, select: { id: true } })).map((c) => c.id) } } });
    await db!.trainingCycle.deleteMany({ where: { userId } });
  }
});

test("rejecting a PROPOSE_ADJUSTMENT never creates or changes any NutritionGoal row", skipOpts, async () => {
  const { prisma: db, trainingCycleService: service, nutritionRepository: repo } = await loadModules();
  const userId = randomUUID();
  try {
    await repo.upsertGoal(userId, { calories: 2000, protein: 150, carbs: 200, fat: 60 }, { triggeredBy: "ONBOARDING" });
    const { cycle, assessment } = await seedCycleWithNutritionProposal(db, userId, {
      calories: 1850,
      protein: 150,
      carbs: 170,
      fat: 60,
    });

    const reviewed = await service.rejectNutritionRecommendation(cycle.id, userId, assessment.id);
    assert.equal((reviewed as any).nutritionUserDecision, "REJECTED");
    assert.equal((reviewed as any).appliedNutritionGoalId, null);

    const allRows = await db.nutritionGoal.findMany({ where: { userId } });
    assert.equal(allRows.length, 1, "no new row created");
    assert.equal(allRows[0].status, "ACTIVE");
    assert.equal(allRows[0].calories, 2000, "the original prescription must be completely untouched");
  } finally {
    await db!.nutritionGoal.deleteMany({ where: { userId } });
    await db!.cycleAssessment.deleteMany({ where: { cycleId: { in: (await db!.trainingCycle.findMany({ where: { userId }, select: { id: true } })).map((c) => c.id) } } });
    await db!.trainingCycle.deleteMany({ where: { userId } });
  }
});

test("a second accept on an already-reviewed nutrition recommendation is rejected (409), not silently re-applied", skipOpts, async () => {
  const { prisma: db, trainingCycleService: service, nutritionRepository: repo } = await loadModules();
  const userId = randomUUID();
  try {
    await repo.upsertGoal(userId, { calories: 2000, protein: 150, carbs: 200, fat: 60 }, { triggeredBy: "ONBOARDING" });
    const { cycle, assessment } = await seedCycleWithNutritionProposal(db, userId, {
      calories: 1850,
      protein: 150,
      carbs: 170,
      fat: 60,
    });

    await service.acceptNutritionRecommendation(cycle.id, userId, assessment.id);
    await assert.rejects(
      () => service.acceptNutritionRecommendation(cycle.id, userId, assessment.id),
      (err: any) => err.status === 409,
    );

    const activeRows = await db.nutritionGoal.findMany({ where: { userId, status: "ACTIVE" } });
    assert.equal(activeRows.length, 1, "a rejected retry must not create a second version");
  } finally {
    await db!.nutritionGoal.deleteMany({ where: { userId } });
    await db!.cycleAssessment.deleteMany({ where: { cycleId: { in: (await db!.trainingCycle.findMany({ where: { userId }, select: { id: true } })).map((c) => c.id) } } });
    await db!.trainingCycle.deleteMany({ where: { userId } });
  }
});

test("CONCURRENCY: two simultaneous accept calls for the same recommendation apply exactly once, never twice", skipOpts, async () => {
  const { prisma: db, trainingCycleService: service, nutritionRepository: repo } = await loadModules();
  const userId = randomUUID();
  try {
    await repo.upsertGoal(userId, { calories: 2000, protein: 150, carbs: 200, fat: 60 }, { triggeredBy: "ONBOARDING" });
    const { cycle, assessment } = await seedCycleWithNutritionProposal(db, userId, {
      calories: 1850,
      protein: 150,
      carbs: 170,
      fat: 60,
    });

    const results = await Promise.allSettled([
      service.acceptNutritionRecommendation(cycle.id, userId, assessment.id),
      service.acceptNutritionRecommendation(cycle.id, userId, assessment.id),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one concurrent accept must win");
    assert.equal(rejected.length, 1, "the other must lose with a real error, not silently double-apply");

    const activeRows = await db.nutritionGoal.findMany({ where: { userId, status: "ACTIVE" } });
    assert.equal(activeRows.length, 1, "concurrent accepts must never produce two ACTIVE versions");
    const allRows = await db.nutritionGoal.findMany({ where: { userId } });
    assert.equal(allRows.length, 2, "exactly v1 (superseded) + v2 (active) — never a stray third row from a race");
  } finally {
    await db!.nutritionGoal.deleteMany({ where: { userId } });
    await db!.cycleAssessment.deleteMany({ where: { cycleId: { in: (await db!.trainingCycle.findMany({ where: { userId }, select: { id: true } })).map((c) => c.id) } } });
    await db!.trainingCycle.deleteMany({ where: { userId } });
  }
});

// Test-assumption correction: originally expected "accepting a KEEP_PLAN
// assessment 404s". Re-reading the actual business rule
// (reviewNutritionRecommendation in training-cycle.service.ts): a 404 is
// for "no assessment found" / "this assessment never got a nutrition
// evaluation at all" (nutritionDecision is null) — NOT for "the decision
// happened to be KEEP_PLAN". Acknowledging a KEEP_PLAN recommendation is a
// legitimate no-op accept (nothing to apply since proposedChanges is
// null), not an error. Fixed the test to verify that real behavior instead
// of a wrong assumption (spec §46 — assumption was wrong, so the TEST was
// corrected, not the product).
test("accepting a KEEP_PLAN assessment succeeds as a no-op acknowledgment — never fabricates a NutritionGoal version", skipOpts, async () => {
  const { prisma: db, trainingCycleService: service } = await loadModules();
  const userId = randomUUID();
  try {
    const { cycle, assessment } = await seedCycleWithNutritionProposal(db, userId, null);
    const reviewed = await service.acceptNutritionRecommendation(cycle.id, userId, assessment.id);
    assert.equal((reviewed as any).nutritionUserDecision, "ACCEPTED");
    assert.equal((reviewed as any).appliedNutritionGoalId, null, "KEEP_PLAN has nothing to apply — no version should ever be created");

    const anyRows = await db.nutritionGoal.findMany({ where: { userId } });
    assert.equal(anyRows.length, 0, "no NutritionGoal row should be fabricated out of a KEEP_PLAN acknowledgment");
  } finally {
    await db!.cycleAssessment.deleteMany({ where: { cycleId: { in: (await db!.trainingCycle.findMany({ where: { userId }, select: { id: true } })).map((c) => c.id) } } });
    await db!.trainingCycle.deleteMany({ where: { userId } });
  }
});

test("accepting an assessment that never got a nutrition evaluation at all (nutritionDecision is null) 404s", skipOpts, async () => {
  const { prisma: db, trainingCycleService: service } = await loadModules();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: { userId, startDate: new Date(), endDate: new Date(Date.now() + 28 * 86_400_000), durationDays: 28, status: "ACTIVE" },
    });
    const assessment = await db.cycleAssessment.create({
      data: { cycleId: cycle.id, assessmentVersion: 1, status: "COMPLETED", decision: "KEEP" }, // no nutritionDecision at all
    });
    await assert.rejects(
      () => service.acceptNutritionRecommendation(cycle.id, userId, assessment.id),
      (err: any) => err.status === 404,
    );
  } finally {
    await db!.cycleAssessment.deleteMany({ where: { cycleId: { in: (await db!.trainingCycle.findMany({ where: { userId }, select: { id: true } })).map((c) => c.id) } } });
    await db!.trainingCycle.deleteMany({ where: { userId } });
  }
});
