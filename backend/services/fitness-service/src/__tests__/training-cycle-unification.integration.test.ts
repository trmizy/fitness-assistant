/**
 * Phase 7 (training-cycle flow unification) integration coverage: verifies
 * that closing a cycle with genuinely SUFFICIENT data via the legacy
 * POST /:id/complete endpoint now produces a real, versioned CycleAssessment
 * from the same Adaptive Decision Engine as POST /:id/evaluate — instead of
 * the old standalone classifyProgress()+analyzeCycleSafe() 3-way pipeline.
 *
 * Existing integration coverage (adaptive-cycle-evaluation.integration.test.ts,
 * training-cycle-data-sufficiency.integration.test.ts) only ever exercises
 * completeCycle() through its INSUFFICIENT_DATA branch (too little seeded
 * data to clear the gates) — this file is the first to seed enough real,
 * same-service data (workout history, no cross-service InBody dependency —
 * uses goal=ATHLETIC_PERFORMANCE so goalProgressScore comes from
 * strengthProgressScore instead) to clear every gate and reach a real
 * 6-state decision through the unified engine.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/training-cycle-unification.integration.test.ts
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
  timeout: 150_000,
};

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type TrainingCycleServiceLike = (typeof import("../services/training-cycle.service"))["trainingCycleService"];

let prisma: PrismaClientLike | undefined;
let trainingCycleService: TrainingCycleServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/training-cycle.service");
    prisma = prismaModule.prisma;
    trainingCycleService = serviceModule.trainingCycleService;
  }
  return { prisma: prisma!, trainingCycleService: trainingCycleService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

// This test's own Exercise row (and everything scoped to its userId) was
// never cleaned up — found via a full-suite run where "every exercise has
// a movementPattern set" / "every exercise has at least one equipment
// link" (movement-pattern.test.ts, equipment-data-integrity.test.ts) kept
// failing on a stray leftover "Unification Test Squat ..." row every time
// this file had run before them in the same test DB. Real, previously-
// latent test-hygiene gap, not a product bug.
async function deleteSeed(db: PrismaClientLike, userId: string, exerciseId?: string) {
  const workouts = await db.workout.findMany({ where: { userId }, select: { id: true } });
  await db.workoutSet.deleteMany({ where: { workoutExercise: { workout: { userId } } } });
  await db.workoutExercise.deleteMany({ where: { workoutId: { in: workouts.map((w) => w.id) } } });
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
  await db.recommendationAudit.deleteMany({ where: { userId } }).catch(() => {});
  await db.cycleAssessment.deleteMany({ where: { cycle: { userId } } }).catch(() => {});
  await db.trainingCycle.deleteMany({ where: { userId } });
  if (exerciseId) await db.exercise.deleteMany({ where: { id: exerciseId } }).catch(() => {});
}

test(
  "completeCycle() with sufficient data runs the SAME Adaptive Decision Engine as evaluateCycle() and produces a real, versioned CycleAssessment",
  skipOpts,
  async () => {
    const { prisma: db, trainingCycleService: service } = await loadModules();
    const userId = `unification-test-${randomUUID()}`;
    let exerciseId: string | undefined;

    try {
      await runTest(db, service, userId, (id) => (exerciseId = id));
    } finally {
      await deleteSeed(db, userId, exerciseId);
    }
  },
);

async function runTest(
  db: PrismaClientLike,
  service: TrainingCycleServiceLike,
  userId: string,
  captureExerciseId: (id: string) => void,
) {
    const now = new Date();
    const pastStart = new Date(now.getTime() - 35 * 86_400_000); // clears minimumCycleDays=28

    const cycle = await service.startCycle(userId, null, pastStart.toISOString(), 30, {
      name: "Unification sufficient-data cycle",
      status: "ACTIVE",
    });

    // ATHLETIC_PERFORMANCE routes goalProgressScore through
    // strengthProgressScore (same-service e1RM trend), not body
    // composition — avoids needing cross-service InBody data at all,
    // matching this repo's documented cross-service-InBody test limitation.
    await db.trainingCycle.update({ where: { id: cycle.id }, data: { goal: "ATHLETIC_PERFORMANCE" } });

    const exercise = await db.exercise.create({
      data: {
        exerciseName: `Unification Test Squat ${Date.now()}`,
        typeOfActivity: "STRENGTH",
        typeOfEquipment: "BARBELL",
        bodyPart: "LOWER_BODY",
        type: "PUSH",
        muscleGroupsActivated: ["quads"],
        instructions: "Test exercise.",
      },
    });
    captureExerciseId(exercise.id);

    // 10 COMPLETED sessions across ~5 weeks (100% adherence, well above the
    // 8-session / 0.7-adherence gates), with a clear progressive-overload
    // weight increase week over week so strengthProgressScore is real and
    // positive (not null, not neutral).
    for (let week = 0; week < 5; week++) {
      for (let session = 0; session < 2; session++) {
        const dayOffset = week * 7 + session * 3;
        const scheduleDate = new Date(pastStart.getTime() + dayOffset * 86_400_000);
        const schedule = await db.workoutSchedule.create({
          data: {
            userId,
            date: scheduleDate,
            status: "COMPLETED",
            trainingCycleId: cycle.id,
            totalExercises: 1,
            completedExercises: 1,
          },
        });
        const workout = await db.workout.create({
          data: { userId, name: `Unification test session ${week}-${session}`, date: scheduleDate },
        });
        const workoutExercise = await db.workoutExercise.create({
          data: { workoutId: workout.id, exerciseId: exercise.id, sets: 3, reps: 8 },
        });
        const weightThisWeek = 80 + week * 5; // clear progressive overload
        await db.workoutSet.createMany({
          data: [1, 2, 3].map((n) => ({
            workoutExerciseId: workoutExercise.id,
            setNumber: n,
            reps: 8,
            weight: weightThisWeek,
            rpe: 7,
            completed: true,
          })),
        });
        await db.workoutSchedule.update({ where: { id: schedule.id }, data: { workoutId: workout.id } });
      }
    }

    const completed = await service.completeCycle(cycle.id, userId);

    assert.equal(completed.status, "ANALYZED");
    assert.ok(completed.decision, "expected a real decision, not null");
    assert.notEqual(
      completed.decision,
      "INSUFFICIENT_DATA",
      "10 completed sessions across 35 days with real e1RM progression should clear every INSUFFICIENT_DATA gate",
    );
    assert.ok(
      ["KEEP", "PROGRESS", "ADJUST", "DELOAD", "REBUILD"].includes(completed.decision!),
      `expected a real 6-state (minus INSUFFICIENT_DATA) decision, got ${completed.decision}`,
    );

    // The unified engine must have created exactly one real, versioned
    // CycleAssessment — this is the concrete proof completeCycle() now
    // shares the same engine/persistence as evaluateCycle(), not a
    // parallel classifier.
    const assessments = await db.cycleAssessment.findMany({ where: { cycleId: cycle.id } });
    assert.equal(assessments.length, 1, "completeCycle() should create exactly one versioned CycleAssessment");
    assert.equal(assessments[0].assessmentVersion, 1);
    assert.equal(assessments[0].status, "COMPLETED");
    assert.equal(assessments[0].decision, completed.decision, "TrainingCycle.decision must match the CycleAssessment it came from");

    assert.equal((completed.summary as any)?.unifiedAssessmentId, assessments[0].id);

    // Single, unified TRAINING audit trail: one RecommendationAudit row,
    // same as evaluateCycle(). Test-assumption update (Phase 2): the
    // Adaptive Nutrition Decision Engine now writes its OWN independent
    // audit row (engineVersion="nutrition-adaptive-v1") at this same
    // touchpoint — real, intentional Phase 2 behavior, not a regression —
    // so this scopes to the training row specifically rather than asserting
    // a flat total of 1 (see docs/body-state-and-adaptive-planning.md).
    const audits = await db.recommendationAudit.findMany({ where: { cycleId: cycle.id } });
    const trainingAudits = audits.filter((a) => a.engineVersion === "adaptive-v1");
    assert.equal(trainingAudits.length, 1, "completeCycle() should write exactly one TRAINING RecommendationAudit row, same as evaluateCycle()");
    assert.equal(trainingAudits[0].decision, completed.decision);

    // Calling evaluateCycle() afterward must NOT create a duplicate version 1
    // — it should create version 2, proving both endpoints share one
    // version sequence per cycle rather than two independent counters.
    const secondAssessment = await service.evaluateCycle(cycle.id, userId);
    assert.equal(secondAssessment.assessmentVersion, 2);
}
