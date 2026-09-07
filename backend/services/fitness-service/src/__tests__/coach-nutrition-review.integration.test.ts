/**
 * Phase 2 (PT nutrition workflow, spec §XXIII / Phase 2 §IV) integration
 * coverage for coach.service.ts's PT Approve/Modify/Reject on a client's
 * AI nutrition recommendation — real DB, real training-cycle.service.ts
 * concurrency-safe claim logic, cross-service PT-client relationship check
 * stubbed via coachDeps (same convention as coach.service.integration.test.ts).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/coach-nutrition-review.integration.test.ts
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
type CoachServiceModule = typeof import("../services/coach.service");
type TrainingCycleServiceLike = (typeof import("../services/training-cycle.service"))["trainingCycleService"];
type NutritionRepoLike = (typeof import("../repositories/nutrition.repository"))["nutritionRepository"];

let prisma: PrismaClientLike | undefined;
let coachModule: CoachServiceModule | undefined;
let trainingCycleService: TrainingCycleServiceLike | undefined;
let nutritionRepository: NutritionRepoLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    coachModule = await import("../services/coach.service");
    trainingCycleService = (await import("../services/training-cycle.service")).trainingCycleService;
    nutritionRepository = (await import("../repositories/nutrition.repository")).nutritionRepository;
  }
  return {
    prisma: prisma!,
    coachService: coachModule!.coachService,
    coachDeps: coachModule!.coachDeps,
    trainingCycleService: trainingCycleService!,
    nutritionRepository: nutritionRepository!,
  };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
  // Same open-handle cleanup as coach.service.integration.test.ts — this
  // file also imports coach.service.ts -> training-cycle.service.ts /
  // workout.service.ts, both of which open long-lived Redis connections
  // as module-level side effects.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const { redisClient } = await import("../repositories/redis");
  try {
    await redisClient.quit();
  } catch {
    /* already closed */
  }
  const { workoutQueue } = await import("../services/workout.service");
  try {
    await workoutQueue.close();
  } catch {
    /* already closed */
  }
});

async function seedCycleWithNutritionProposal(
  db: PrismaClientLike,
  clientUserId: string,
  proposedChanges: { calories: number; protein: number; carbs: number; fat: number } | null,
) {
  const cycle = await db.trainingCycle.create({
    data: {
      userId: clientUserId,
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

async function cleanup(db: PrismaClientLike, clientUserId: string) {
  await db.recommendationAudit.deleteMany({ where: { userId: clientUserId } });
  await db.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${clientUserId}`;
  await db.cycleAssessment.deleteMany({ where: { cycle: { userId: clientUserId } } });
  await db.trainingCycle.deleteMany({ where: { userId: clientUserId } });
}

// ── Authorization ────────────────────────────────────────────────────────────

test(
  "approve/modify/reject all reject (403) when there is no active PT-client relationship, and never touch the assessment or NutritionGoal",
  skipOpts,
  async () => {
    const { prisma: db, coachService, coachDeps } = await loadModules();
    const clientUserId = `client-${randomUUID()}`;
    const ptUserId = `pt-${randomUUID()}`;
    const original = coachDeps.isActivePtClientRelationship;
    coachDeps.isActivePtClientRelationship = async () => false;
    try {
      const { cycle } = await seedCycleWithNutritionProposal(db, clientUserId, {
        calories: 1950,
        protein: 145,
        carbs: 180,
        fat: 60,
      });
      await assert.rejects(
        () => coachService.approveNutritionRecommendation(ptUserId, clientUserId, cycle.id),
        (err: any) => err.status === 403,
      );
      await assert.rejects(
        () => coachService.rejectNutritionRecommendation(ptUserId, clientUserId, cycle.id),
        (err: any) => err.status === 403,
      );
      await assert.rejects(
        () =>
          coachService.modifyNutritionRecommendation(ptUserId, clientUserId, cycle.id, {
            calories: 2000,
            protein: 150,
            carbs: 200,
            fat: 65,
          }),
        (err: any) => err.status === 403,
      );
      const goal = await (await loadModules()).nutritionRepository.findGoalByUserId(clientUserId);
      assert.equal(goal, null, "an unauthorized PT must never create a NutritionGoal version");
    } finally {
      coachDeps.isActivePtClientRelationship = original;
      await cleanup(db, clientUserId);
    }
  },
);

// ── Approve ──────────────────────────────────────────────────────────────────

test(
  "authorized PT approve: applies the AI's own proposedChanges, triggeredBy=PT, reviewedByRole=PT",
  skipOpts,
  async () => {
    const { prisma: db, coachService, coachDeps, nutritionRepository: repo } = await loadModules();
    const clientUserId = `client-${randomUUID()}`;
    const ptUserId = `pt-${randomUUID()}`;
    const original = coachDeps.isActivePtClientRelationship;
    coachDeps.isActivePtClientRelationship = async () => true;
    try {
      await repo.upsertGoal(clientUserId, { calories: 2000, protein: 150, carbs: 200, fat: 65 }, { triggeredBy: "ONBOARDING" });
      const { cycle, assessment } = await seedCycleWithNutritionProposal(db, clientUserId, {
        calories: 1900,
        protein: 150,
        carbs: 170,
        fat: 60,
      });

      const result: any = await coachService.approveNutritionRecommendation(ptUserId, clientUserId, cycle.id);
      assert.equal(result.nutritionUserDecision, "ACCEPTED");
      assert.equal(result.nutritionReviewedByRole, "PT");
      assert.equal(result.nutritionReviewedByUserId, ptUserId);

      const goal = await repo.findGoalByUserId(clientUserId);
      assert.equal(goal!.calories, 1900, "must apply the AI's own proposed numbers, not invent new ones");
      assert.equal(goal!.triggeredBy, "PT");
      assert.equal((goal as any).sourceAssessmentId, assessment.id);
      assert.ok((goal as any).previousGoalId, "must link back to the goal it superseded");
    } finally {
      coachDeps.isActivePtClientRelationship = original;
      await cleanup(db, clientUserId);
    }
  },
);

// ── Modify ───────────────────────────────────────────────────────────────────

test(
  "authorized PT modify: applies the PT's OWN numbers, never the AI's proposedChanges — spec example (AI 1900 -> PT 1950)",
  skipOpts,
  async () => {
    const { prisma: db, coachService, coachDeps, nutritionRepository: repo } = await loadModules();
    const clientUserId = `client-${randomUUID()}`;
    const ptUserId = `pt-${randomUUID()}`;
    const original = coachDeps.isActivePtClientRelationship;
    coachDeps.isActivePtClientRelationship = async () => true;
    try {
      await repo.upsertGoal(clientUserId, { calories: 2000, protein: 150, carbs: 200, fat: 65 }, { triggeredBy: "ONBOARDING" });
      const { cycle } = await seedCycleWithNutritionProposal(db, clientUserId, {
        calories: 1900,
        protein: 150,
        carbs: 170,
        fat: 60,
      });

      const result: any = await coachService.modifyNutritionRecommendation(
        ptUserId,
        clientUserId,
        cycle.id,
        { calories: 1950, protein: 145, carbs: 208, fat: 60 },
        undefined,
        "Giữ calo cao hơn AI đề xuất do lịch tập nặng hơn.",
      );
      assert.equal(result.nutritionUserDecision, "MODIFIED_BY_PT");
      assert.equal(result.nutritionPtNote, "Giữ calo cao hơn AI đề xuất do lịch tập nặng hơn.");

      const goal = await repo.findGoalByUserId(clientUserId);
      assert.equal(goal!.calories, 1950, "must use the PT's own number, not the AI's 1900");
      assert.equal(goal!.triggeredBy, "PT");
      assert.equal((goal as any).createdByUserId, ptUserId);
    } finally {
      coachDeps.isActivePtClientRelationship = original;
      await cleanup(db, clientUserId);
    }
  },
);

test("modify without a modifiedGoal payload is rejected (400), not silently applied", skipOpts, async () => {
  const { prisma: db, trainingCycleService: svc, coachDeps } = await loadModules();
  const clientUserId = `client-${randomUUID()}`;
  const ptUserId = `pt-${randomUUID()}`;
  const original = coachDeps.isActivePtClientRelationship;
  try {
    const { cycle } = await seedCycleWithNutritionProposal(db, clientUserId, { calories: 1900, protein: 150, carbs: 170, fat: 60 });
    await assert.rejects(
      () => svc.ptReviewNutritionRecommendation(ptUserId, clientUserId, cycle.id, "MODIFIED_BY_PT", {}),
      (err: any) => err.status === 400,
    );
  } finally {
    coachDeps.isActivePtClientRelationship = original;
    await cleanup(db, clientUserId);
  }
});

// Safety-floor audit (2026-09-07) — a PT modify used to skip both the
// macro-consistency check AND enforce a different (800, uncommented)
// floor than the deterministic engines' real 1200. See
// nutrition-goal-macro-validator.ts's assertCalorieFloor doc comment.

test("PT modify below the shared safety floor is rejected (400) — CRITICALLY, the assessment stays PENDING and retryable, not stuck", skipOpts, async () => {
  const { prisma: db, trainingCycleService: svc, coachDeps } = await loadModules();
  const clientUserId = `client-${randomUUID()}`;
  const ptUserId = `pt-${randomUUID()}`;
  const original = coachDeps.isActivePtClientRelationship;
  try {
    const { cycle, assessment } = await seedCycleWithNutritionProposal(db, clientUserId, {
      calories: 1900,
      protein: 150,
      carbs: 170,
      fat: 60,
    });
    await assert.rejects(
      () =>
        svc.ptReviewNutritionRecommendation(ptUserId, clientUserId, cycle.id, "MODIFIED_BY_PT", {
          modifiedGoal: { calories: 900, protein: 60, carbs: 60, fat: 47 }, // 60*4+60*4+47*9=903, internally consistent (within 50kcal) but below the floor
        }),
      (err: any) => err.status === 400 && err.code === "NUTRITION_GOAL_BELOW_SAFETY_FLOOR",
    );
    // The critical ordering guarantee: validation ran BEFORE the atomic
    // claim, so this PT's typo did NOT burn the assessment's one-time
    // PENDING state. A real, valid modify attempt right after must still
    // succeed — if the row got claimed by the failed attempt, this second
    // call would 409 instead.
    const stillPending = await db.cycleAssessment.findUnique({ where: { id: assessment.id } });
    assert.equal(stillPending?.nutritionUserDecision, "PENDING", "a rejected modify must never consume the one-time PENDING claim");

    const retried: any = await svc.ptReviewNutritionRecommendation(ptUserId, clientUserId, cycle.id, "MODIFIED_BY_PT", {
      modifiedGoal: { calories: 1950, protein: 145, carbs: 208, fat: 60 },
    });
    assert.equal(retried.nutritionUserDecision, "MODIFIED_BY_PT", "a valid retry after the rejected attempt must succeed");
  } finally {
    coachDeps.isActivePtClientRelationship = original;
    await cleanup(db, clientUserId);
  }
});

test("PT modify with internally-inconsistent macros is rejected (400) before the atomic claim, same as a below-floor value", skipOpts, async () => {
  const { prisma: db, trainingCycleService: svc, coachDeps } = await loadModules();
  const clientUserId = `client-${randomUUID()}`;
  const ptUserId = `pt-${randomUUID()}`;
  const original = coachDeps.isActivePtClientRelationship;
  try {
    const { cycle, assessment } = await seedCycleWithNutritionProposal(db, clientUserId, {
      calories: 1900,
      protein: 150,
      carbs: 170,
      fat: 60,
    });
    await assert.rejects(
      () =>
        svc.ptReviewNutritionRecommendation(ptUserId, clientUserId, cycle.id, "MODIFIED_BY_PT", {
          // 150*4+200*4+65*9=1985, stated 3000 -> the exact original bug-report case
          modifiedGoal: { calories: 3000, protein: 150, carbs: 200, fat: 65 },
        }),
      (err: any) => err.status === 400 && err.code === "NUTRITION_GOAL_MACRO_MISMATCH",
    );
    const stillPending = await db.cycleAssessment.findUnique({ where: { id: assessment.id } });
    assert.equal(stillPending?.nutritionUserDecision, "PENDING");
  } finally {
    coachDeps.isActivePtClientRelationship = original;
    await cleanup(db, clientUserId);
  }
});

// ── Reject ───────────────────────────────────────────────────────────────────

test("authorized PT reject: never creates a NutritionGoal version, records the note", skipOpts, async () => {
  const { prisma: db, coachService, coachDeps, nutritionRepository: repo } = await loadModules();
  const clientUserId = `client-${randomUUID()}`;
  const ptUserId = `pt-${randomUUID()}`;
  const original = coachDeps.isActivePtClientRelationship;
  coachDeps.isActivePtClientRelationship = async () => true;
  try {
    await repo.upsertGoal(clientUserId, { calories: 2000, protein: 150, carbs: 200, fat: 65 }, { triggeredBy: "ONBOARDING" });
    const { cycle } = await seedCycleWithNutritionProposal(db, clientUserId, { calories: 1900, protein: 150, carbs: 170, fat: 60 });

    const result: any = await coachService.rejectNutritionRecommendation(
      ptUserId,
      clientUserId,
      cycle.id,
      undefined,
      "Client vẫn cần giữ nguyên calo hiện tại theo chỉ định bác sĩ.",
    );
    assert.equal(result.nutritionUserDecision, "REJECTED");
    assert.equal(result.nutritionPtNote, "Client vẫn cần giữ nguyên calo hiện tại theo chỉ định bác sĩ.");

    const history = await repo.findGoalHistoryByUserId(clientUserId);
    assert.equal(history.length, 1, "REJECTED must never create a new goal version");
    assert.equal(history[0].calories, 2000);
  } finally {
    coachDeps.isActivePtClientRelationship = original;
    await cleanup(db, clientUserId);
  }
});

// ── Conflict handling / idempotency (Phase 2 §XII) ──────────────────────────

test(
  "CONFLICT: a PT modify claims the recommendation first — the client's later accept on the same assessment is rejected (409) and does NOT overwrite the PT's version",
  skipOpts,
  async () => {
    const { prisma: db, coachService, coachDeps, trainingCycleService: svc, nutritionRepository: repo } = await loadModules();
    const clientUserId = `client-${randomUUID()}`;
    const ptUserId = `pt-${randomUUID()}`;
    const original = coachDeps.isActivePtClientRelationship;
    coachDeps.isActivePtClientRelationship = async () => true;
    try {
      await repo.upsertGoal(clientUserId, { calories: 2000, protein: 150, carbs: 200, fat: 65 }, { triggeredBy: "ONBOARDING" });
      const { cycle } = await seedCycleWithNutritionProposal(db, clientUserId, { calories: 1900, protein: 150, carbs: 170, fat: 60 });

      await coachService.modifyNutritionRecommendation(ptUserId, clientUserId, cycle.id, {
        calories: 1950,
        protein: 145,
        carbs: 208,
        fat: 60,
      });

      await assert.rejects(
        () => svc.acceptNutritionRecommendation(cycle.id, clientUserId),
        (err: any) => err.status === 409,
      );

      const goal = await repo.findGoalByUserId(clientUserId);
      assert.equal(goal!.calories, 1950, "the PT's version must survive a stale client accept attempt");
      assert.equal(goal!.triggeredBy, "PT");
    } finally {
      coachDeps.isActivePtClientRelationship = original;
      await cleanup(db, clientUserId);
    }
  },
);

test(
  "IDEMPOTENCY: a PT double-clicking Approve only applies once — the second call is rejected (409), exactly one ACTIVE goal exists",
  skipOpts,
  async () => {
    const { prisma: db, coachService, coachDeps, nutritionRepository: repo } = await loadModules();
    const clientUserId = `client-${randomUUID()}`;
    const ptUserId = `pt-${randomUUID()}`;
    const original = coachDeps.isActivePtClientRelationship;
    coachDeps.isActivePtClientRelationship = async () => true;
    try {
      const { cycle } = await seedCycleWithNutritionProposal(db, clientUserId, { calories: 1900, protein: 150, carbs: 170, fat: 60 });

      const results = await Promise.allSettled([
        coachService.approveNutritionRecommendation(ptUserId, clientUserId, cycle.id),
        coachService.approveNutritionRecommendation(ptUserId, clientUserId, cycle.id),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal((rejected[0] as PromiseRejectedResult).reason?.status, 409);

      const history = await repo.findGoalHistoryByUserId(clientUserId);
      const active = history.filter((h) => h.status === "ACTIVE");
      assert.equal(active.length, 1, "exactly one ACTIVE goal must survive a double-click");
    } finally {
      coachDeps.isActivePtClientRelationship = original;
      await cleanup(db, clientUserId);
    }
  },
);
