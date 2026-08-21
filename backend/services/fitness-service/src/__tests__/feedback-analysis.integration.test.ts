/**
 * Phase 4 (docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md) integration coverage
 * for feedbackAnalysisService — real DB, real ai-service HTTP call (may hit
 * the LLM or fall back — both paths must still produce a persisted audit
 * row), matching the established pattern in
 * training-cycle-unification.integration.test.ts.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/feedback-analysis.integration.test.ts
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
  timeout: 90_000,
};

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type ServiceLike = (typeof import("../services/feedback-analysis.service"))["feedbackAnalysisService"];

let prisma: PrismaClientLike | undefined;
let feedbackAnalysisService: ServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    feedbackAnalysisService = (await import("../services/feedback-analysis.service")).feedbackAnalysisService;
  }
  return { prisma: prisma!, feedbackAnalysisService: feedbackAnalysisService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function makeCycleWithFeedback(db: PrismaClientLike, userId: string) {
  const cycle = await db.trainingCycle.create({
    data: {
      userId,
      name: "Test cycle",
      goal: "MUSCLE_GAIN",
      status: "ACTIVE",
      cycleIndex: 1,
      durationDays: 28,
      startDate: new Date(Date.now() - 7 * 86_400_000),
      endDate: new Date(Date.now() + 21 * 86_400_000),
    },
  });
  const schedule = await db.workoutSchedule.create({
    data: {
      userId,
      trainingCycleId: cycle.id,
      date: new Date(Date.now() - 2 * 86_400_000),
      status: "COMPLETED",
      totalExercises: 1,
      completedExercises: 1,
    },
  });
  await db.cycleSessionFeedback.create({
    data: {
      cycleId: cycle.id,
      workoutScheduleId: schedule.id,
      sessionRating: 2,
      difficulty: "too_hard",
      painScore: 6,
    },
  });
  return cycle;
}

test("analyzeCycleFeedback: rejects a cycle that doesn't belong to the caller (404)", skipOpts, async () => {
  const { prisma: db, feedbackAnalysisService: svc } = await loadModules();
  const ownerId = `feedback-analysis-test-${randomUUID()}`;
  const otherId = `feedback-analysis-test-${randomUUID()}`;
  const cycle = await makeCycleWithFeedback(db, ownerId);

  await assert.rejects(() => svc.analyzeCycleFeedback(cycle.id, otherId), (err: any) => {
    assert.equal(err.status, 404);
    return true;
  });
});

test("analyzeCycleFeedback: rejects a nonexistent cycle id (404)", skipOpts, async () => {
  const { feedbackAnalysisService: svc } = await loadModules();
  await assert.rejects(() => svc.analyzeCycleFeedback(randomUUID(), `feedback-analysis-test-${randomUUID()}`), (err: any) => {
    assert.equal(err.status, 404);
    return true;
  });
});

test("getLatestFeedbackAnalysis: returns null when no analysis has ever been run for an owned cycle", skipOpts, async () => {
  const { prisma: db, feedbackAnalysisService: svc } = await loadModules();
  const userId = `feedback-analysis-test-${randomUUID()}`;
  const cycle = await makeCycleWithFeedback(db, userId);

  const result = await svc.getLatestFeedbackAnalysis(cycle.id, userId);
  assert.equal(result, null);
});

test("analyzeCycleFeedback: produces a persisted audit row and a well-shaped result (LLM success or fallback both count)", skipOpts, async () => {
  const { prisma: db, feedbackAnalysisService: svc } = await loadModules();
  const userId = `feedback-analysis-test-${randomUUID()}`;
  const cycle = await makeCycleWithFeedback(db, userId);

  const result = await svc.analyzeCycleFeedback(cycle.id, userId);

  assert.ok(result.auditId);
  assert.ok(
    ["positive", "negative", "neutral", "mixed", "insufficient_feedback"].includes(result.sentiment),
    `unexpected sentiment: ${result.sentiment}`,
  );
  assert.ok(
    ["supported_by_data", "partially_supported", "not_supported", "insufficient_data"].includes(result.complaintValidity),
    `unexpected complaintValidity: ${result.complaintValidity}`,
  );
  assert.ok(
    ["none", "minor_adjust", "adjust", "deload", "rebuild_consideration"].includes(result.recommendedDecisionInfluence),
    `unexpected recommendedDecisionInfluence: ${result.recommendedDecisionInfluence}`,
  );
  assert.equal(typeof result.explanationForUser, "string");
  assert.ok(result.explanationForUser.length > 0);

  const persisted = await db.cycleFeedbackAnalysisAudit.findUnique({ where: { id: result.auditId } });
  assert.ok(persisted);
  assert.equal(persisted?.cycleId, cycle.id);
  assert.equal(persisted?.userId, userId);

  const latest = await svc.getLatestFeedbackAnalysis(cycle.id, userId);
  assert.equal(latest?.id, result.auditId);
});
