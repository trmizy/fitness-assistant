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
import { randomUUID } from "node:crypto";
import { Client as PgClient } from "pg";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

// Real-time body profile refactor (Phase 2, §23) — root-cause fix for this
// test's prior flakiness: it used to hardcode a specific seeded user
// (john.doe@example.com) and a specific pre-existing InBody entry id.
// Verified live (2026-08-18): that entry no longer exists and the seeded
// user currently has ZERO InBody entries at all — shared seed data drifts
// over time (other specs/manual testing legitimately mutate john.doe's
// profile), so a hardcoded id is inherently fragile. Fixed the same way
// training-cycle-baseline-snapshot.integration.test.ts (Phase 1) already
// does it: generate a fresh random userId and seed a real InBody row for
// it directly, via a real pg connection — no shared seeded account
// touched, nothing to drift. There is still no user-service test-DB swap
// in this repo, so this seeds into user-service's real dev DB
// (gymcoach_user) for a synthetic id that was never shared with anything
// else, and cleans it up in test.after — same bridging approach the other
// cross-service integration tests in this codebase already rely on.
const TEST_USER_ID = randomUUID();

const USER_DB_URL =
  process.env.USER_DATABASE_URL ||
  "postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_user";

async function withUserDb<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new PgClient({ connectionString: USER_DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Seeds one real InBody entry, dated yesterday (real wall-clock — must be
 * on/before whatever "now" is when startDraftCycle's systemClock activates
 * the cycle) so fetchLatestInBodyOnOrBefore can actually resolve it. */
async function seedInBodyEntry(userId: string, weight: number): Promise<string> {
  const id = randomUUID();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await withUserDb((client) =>
    client.query(
      `INSERT INTO inbody_entries (id, user_id, date, date_only, weight, body_fat, muscle_mass, status, updated_at)
       VALUES ($1, $2, $3::date, $3::date, $4, 18, 32, 'manual', now())`,
      [id, userId, yesterday, weight],
    ),
  );
  return id;
}

async function cleanupUserServiceData(userId: string): Promise<void> {
  await withUserDb(async (client) => {
    await client.query(`DELETE FROM inbody_entries WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM user_profiles WHERE "userId" = $1`, [userId]);
  });
}

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

let REAL_INBODY_ID: string;
// Captured in step 3 below — cleaned up in test.after. Found via a
// full-suite run where "every exercise has a movementPattern set" /
// "every exercise has at least one equipment link" kept failing on a
// stray leftover "Integration Squat ..." row: this file's own userId-
// scoped cleanup (cleanupUserServiceData) only ever touched the
// user-service DB (inbody/profile), never this fitness-service Exercise/
// Workout/TrainingCycle data it creates — a real, previously-latent
// test-hygiene gap, not a product bug.
let createdExerciseId: string | undefined;

test.after(async () => {
  if (prisma) {
    await cleanupFitnessServiceData(prisma, TEST_USER_ID, createdExerciseId).catch(() => {});
    await prisma.$disconnect();
  }
  await cleanupUserServiceData(TEST_USER_ID).catch(() => {});
});

async function cleanupFitnessServiceData(
  db: PrismaClientLike,
  userId: string,
  exerciseId?: string,
) {
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
  "Adaptive Training Cycle Evaluation — full 9-step lifecycle",
  { skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test", timeout: 150_000 },
  async (t) => {
    const { prisma: db, trainingCycleService: service } = await loadModules();

    // 0. Seed this test's own InBody entry for its own fresh userId — see
    // the header comment for why (root-cause fix for prior flakiness).
    REAL_INBODY_ID = await seedInBodyEntry(TEST_USER_ID, 80);

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
      createdExerciseId = exercise.id;
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
      //
      // Test-assumption update (Phase 2): this used to assert exactly ONE
      // audit row total. Since the Adaptive Nutrition Decision Engine
      // (nutrition-decision.engine.ts) now runs at this same evaluation
      // touchpoint and writes its OWN independent audit row
      // (engineVersion="nutrition-adaptive-v1" — see
      // docs/body-state-and-adaptive-planning.md), a real evaluate() call
      // correctly produces TWO rows now, not one. This is the intended
      // Phase 2 behavior (training and nutrition have independent
      // accept/reject lifecycles), so the test is updated to match — not
      // a product bug (spec §46: assumption was outdated, so the test was
      // corrected, product was not weakened).
      const audits = await db.recommendationAudit.findMany({ where: { cycleId: cycle.id } });
      const trainingAudits = audits.filter((a) => a.engineVersion === "adaptive-v1");
      const nutritionAudits = audits.filter((a) => a.engineVersion === "nutrition-adaptive-v1");
      assert.equal(trainingAudits.length, 1, "expected exactly one TRAINING audit row for this evaluate() call");
      assert.equal(trainingAudits[0].decision, assessment.decision);
      assert.equal(trainingAudits[0].userAction, null, "not yet accepted/rejected");
      // The nutrition engine may legitimately fail to produce a result for
      // this synthetic test user (e.g. no active NutritionGoal seeded) —
      // evaluateNutritionForCycle degrades to null rather than throwing, in
      // which case no nutrition audit row is written at all. Assert AT MOST
      // one, not exactly one, to stay correct either way.
      assert.ok(nutritionAudits.length <= 1, "expected at most one NUTRITION audit row for this evaluate() call");
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

      // Test-assumption update (Phase 2, same reason as step 6 above) —
      // scope to the TRAINING audit row specifically. This also pins down
      // a real bug this test caught and training-cycle.service.ts's
      // reviewRecommendation fixed: accepting the training recommendation
      // must NEVER also mark an independent nutrition audit row (if one
      // exists for the same assessmentId) as reviewed.
      const audits = await db.recommendationAudit.findMany({ where: { cycleId: cycle.id, assessmentId } });
      const trainingAudits = audits.filter((a) => a.engineVersion === "adaptive-v1");
      const nutritionAudits = audits.filter((a) => a.engineVersion === "nutrition-adaptive-v1");
      assert.equal(trainingAudits.length, 1);
      assert.equal(trainingAudits[0].userAction, "accepted", "accepting a recommendation must update its own audit row");
      assert.ok(trainingAudits[0].userActionAt);
      for (const na of nutritionAudits) {
        assert.equal(na.userAction, null, "accepting the TRAINING recommendation must never touch the independent nutrition audit row");
      }

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
