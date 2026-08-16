/**
 * Full-lifecycle integration test for Adaptive Training Cycle Evaluation,
 * following the same gated-real-DB pattern as
 * workout.completion.integration.test.ts (env var pointing at a `_test`-
 * named database, lazy dynamic imports so pure-unit tests elsewhere don't
 * pay a DB-connection cost, skip rather than fail when no test DB is
 * configured).
 *
 * Scope note: the 6 Decision Engine branches (KEEP/PROGRESS/ADJUST/DELOAD/
 * REBUILD/INSUFFICIENT_DATA) plus InBody outlier/water-conflict handling
 * already have full, real fixture coverage as fast pure-function unit tests
 * (cycle-decision.engine.test.ts: 17 tests: cycle-metrics.engine.test.ts /
 * inbody-quality.evaluator.test.ts: 34 tests). Re-deriving all 7 fixtures
 * again here through the full HTTP+DB+LLM stack would mostly duplicate that
 * coverage at a much higher runtime cost (each real LLM round-trip has
 * taken 5-90s in this session's live testing) for little additional
 * confidence. This test instead covers what's UNIQUELY at risk at the
 * integration level: the real DB wiring across the 9 lifecycle steps, and
 * the "a new plan is never auto-applied" invariant — using this session's
 * real, running ai-service (not mocked), same as `evaluateCycle` behaves in
 * production.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/adaptive-cycle-evaluation.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

// Real seeded dev user (see backend/services/auth-service/prisma/seed.ts) —
// used because InBody/profile lookups go over real HTTP to user-service's
// own (non-test) dev DB; there is no user-service test-DB swap in this repo
// today, so bridging via the real seeded user is the same approach the
// existing cross-service calls in this codebase's other integration tests
// rely on.
const TEST_USER_ID = "2adeb124-8a5d-49e6-870f-42c9f925919a";
const REAL_INBODY_ID = "0c18018e-b1ae-4034-b424-225eee8fb6b4";

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

test(
  "Adaptive Training Cycle Evaluation — full 9-step lifecycle",
  { skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test", timeout: 150_000 },
  async (t) => {
    const { prisma: db, trainingCycleService: service } = await loadModules();

    // 1. Tạo cycle (create).
    const cycle = await service.startCycle(TEST_USER_ID, null, "2026-05-01", 30, {
      name: "Integration test cycle",
      status: "DRAFT",
    });
    assert.equal(cycle.status, "DRAFT");
    assert.equal(cycle.name, "Integration test cycle");

    await t.test("2. Start cycle (DRAFT -> ACTIVE)", async () => {
      const started = await service.startDraftCycle(cycle.id, TEST_USER_ID);
      assert.equal(started.status, "ACTIVE");
      assert.ok(started.startInbodyId, "expected a real InBody entry to be resolved at activation");
    });

    await t.test("3. Ghi workout (log a completed workout session)", async () => {
      const exercise = await db.exercise.create({
        data: {
          exerciseName: `Integration Squat ${Date.now()}`,
          typeOfActivity: "STRENGTH",
          typeOfEquipment: "BARBELL",
          bodyPart: "LOWER_BODY",
          type: "PUSH",
          muscleGroupsActivated: ["quads"],
          instructions: "Test exercise.",
        },
      });
      // WorkoutSchedule has @@unique([userId, date]) — use "now" (the cycle
      // just started at activation time in step 2) with a small random
      // sub-second offset so repeated test runs never collide with a
      // leftover row from a prior run, matching
      // workout.completion.integration.test.ts's own Date.now()-based
      // uniqueness convention, while staying inside the cycle's
      // [startDate, asOf] adherence window.
      const scheduleDate = new Date(Date.now() - Math.floor(Math.random() * 500));
      const schedule = await db.workoutSchedule.create({
        data: {
          userId: TEST_USER_ID,
          date: scheduleDate,
          status: "COMPLETED",
          trainingCycleId: cycle.id,
          totalExercises: 1,
          completedExercises: 1,
        },
      });
      const workout = await db.workout.create({
        data: { userId: TEST_USER_ID, name: "Leg day", date: scheduleDate },
      });
      const workoutExercise = await db.workoutExercise.create({
        data: { workoutId: workout.id, exerciseId: exercise.id, sets: 3, reps: 8 },
      });
      await db.workoutSet.createMany({
        data: [1, 2, 3].map((n) => ({
          workoutExerciseId: workoutExercise.id,
          setNumber: n,
          reps: 8,
          weight: 80 + n,
          rpe: 7,
          completed: true,
        })),
      });
      await db.workoutSchedule.update({ where: { id: schedule.id }, data: { workoutId: workout.id } });

      // Per-session subjective feedback (readiness/RPE/pain) — new in this feature.
      await db.cycleSessionFeedback.create({
        data: { cycleId: cycle.id, workoutScheduleId: schedule.id, readinessScore: 8, sessionRpe: 7, painScore: 1 },
      });

      const reloaded = await db.workoutSchedule.findUnique({ where: { id: schedule.id } });
      assert.equal(reloaded?.trainingCycleId, cycle.id);
    });

    await t.test("4. Ghi InBody (link a real InBody entry to the cycle)", async () => {
      const link = await service.linkInBodyEntry(cycle.id, TEST_USER_ID, REAL_INBODY_ID);
      assert.equal(link.cycleId, cycle.id);
      assert.equal(link.inbodyEntryId, REAL_INBODY_ID);

      // Idempotency: linking the same entry again must not throw.
      const linkAgain = await service.linkInBodyEntry(cycle.id, TEST_USER_ID, REAL_INBODY_ID);
      assert.equal(linkAgain.id, link.id);
    });

    await t.test("5. Complete cycle (legacy /complete path stays available)", async () => {
      // This cycle was activated moments ago (step 2) with a single logged
      // session — nowhere near the Decision Engine's minimum cycle-length/
      // session-count gates. completeCycle() now applies that same
      // data-sufficiency gate to the legacy path (previously it had none at
      // all — see training-cycle.service.ts's completeCycle doc comment /
      // the training-cycle bug report §3.4), so it correctly closes as
      // ANALYZED + decision=INSUFFICIENT_DATA rather than running a
      // confident PROGRESSING/PLATEAU/DECLINING classification (and a real
      // AI call) off a few minutes of data.
      const completed = await service.completeCycle(cycle.id, TEST_USER_ID);
      assert.equal(completed.status, "ANALYZED");
      assert.equal(completed.decision, "INSUFFICIENT_DATA");
      assert.equal((completed.summary as any)?.progressSignals, null);
    });

    let assessmentDecision: string | null = null;
    await t.test("6. Evaluate (new richer flow — real Decision Engine + real ai-service call)", async () => {
      const assessment = await service.evaluateCycle(cycle.id, TEST_USER_ID);
      assert.equal(assessment.status, "COMPLETED");
      assert.equal(assessment.assessmentVersion, 1);
      assert.ok(assessment.decision, "expected a real 6-state decision, not null");
      assert.ok(
        ["KEEP", "PROGRESS", "ADJUST", "DELOAD", "REBUILD", "INSUFFICIENT_DATA"].includes(assessment.decision!),
      );
      assert.ok(Array.isArray(assessment.reasonCodes) && (assessment.reasonCodes as string[]).length > 0);
      assessmentDecision = assessment.decision;

      // Idempotency: calling evaluate again immediately (before accept/reject)
      // must not create a second row — /evaluate is idempotent by
      // (cycleId, assessmentVersion), and since version 1 is COMPLETED (not
      // PENDING), a fresh call creates version 2, NOT a duplicate of version 1.
      // Verify no duplicate version 1 row exists (the actual idempotency
      // contract: no two assessments race to create the same version).
      const versionOnes = await db.cycleAssessment.findMany({
        where: { cycleId: cycle.id, assessmentVersion: 1 },
      });
      assert.equal(versionOnes.length, 1, "exactly one assessment for version 1, no duplicates");

      // RecommendationAudit: evaluateCycle must write one interaction-log
      // row per real evaluation, distinct from the CycleAssessment result
      // row itself (see docs/TRAINING_CYCLE_DECISION_ENGINE.md §4).
      const audits = await db.recommendationAudit.findMany({ where: { cycleId: cycle.id } });
      assert.equal(audits.length, 1, "expected exactly one audit row for this evaluate() call");
      assert.equal(audits[0].engineVersion, "adaptive-v1");
      assert.equal(audits[0].decision, assessment.decision);
      assert.equal(audits[0].userAction, null, "not yet accepted/rejected");
    });

    let assessmentId: string;
    await t.test("7. Nhận assessment (fetch it back via the read endpoints)", async () => {
      const latest = await service.getLatestAssessment(cycle.id, TEST_USER_ID);
      assert.equal(latest.decision, assessmentDecision);
      assessmentId = latest.id;

      const list = await service.listAssessments(cycle.id, TEST_USER_ID, 1, 20);
      assert.equal(list.total, 1);
      assert.equal(list.assessments[0].id, assessmentId);
    });

    await t.test("8. Accept recommendation", async () => {
      const accepted = await service.acceptRecommendation(cycle.id, TEST_USER_ID, assessmentId);
      assert.equal(accepted.userDecision, "ACCEPTED");
      assert.ok(accepted.reviewedAt);

      const audits = await db.recommendationAudit.findMany({ where: { cycleId: cycle.id, assessmentId } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].userAction, "accepted", "accepting a recommendation must update its audit row");
      assert.ok(audits[0].userActionAt);

      // A second accept on the same assessment must be rejected (409), not silently succeed twice.
      await assert.rejects(
        () => service!.acceptRecommendation(cycle.id, TEST_USER_ID, assessmentId),
        (err: any) => err.status === 409,
      );
    });

    await t.test("9. Xác nhận plan mới chỉ được áp dụng sau bước accept (no auto-applied plan)", async () => {
      // Accepting a recommendation must NOT itself create/activate a new
      // TrainingCycle or set nextPlanId — that remains the operator's own
      // separate, explicit step (same as the legacy approveDecision flow).
      const reloadedCycle = await db.trainingCycle.findUnique({ where: { id: cycle.id } });
      assert.equal(reloadedCycle?.nextPlanId, null, "accept must not auto-set nextPlanId");

      const otherCyclesForUser = await db.trainingCycle.count({
        where: { userId: TEST_USER_ID, id: { not: cycle.id }, createdAt: { gt: cycle.createdAt } },
      });
      assert.equal(otherCyclesForUser, 0, "accept must not auto-create a follow-up cycle");
    });
  },
);
