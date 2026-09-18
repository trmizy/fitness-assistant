/**
 * Diet break / maintenance-phase modeling (2026-09-07) — integration
 * coverage for training-cycle.service.ts's computeWeeksSinceDeficitPhase
 * Started, the cross-cycle DB walk the pure engine test suite
 * (nutrition-decision.engine.test.ts) can't exercise (that suite only
 * covers evaluateNutritionAdaptive's own decision logic given an already-
 * computed signal). See cycle-thresholds.config.ts's
 * dietBreakThresholdWeeks doc comment for the research this feature is
 * grounded in.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/diet-break.integration.test.ts
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
type TrainingCycleModule = typeof import("../services/training-cycle.service");

let prisma: PrismaClientLike | undefined;
let mod: TrainingCycleModule | undefined;
async function load() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    mod = await import("../services/training-cycle.service");
  }
  return {
    prisma: prisma!,
    computeWeeksSinceDeficitPhaseStarted: mod!.computeWeeksSinceDeficitPhaseStarted,
    trainingCycleService: mod!.trainingCycleService,
  };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function cleanup(db: PrismaClientLike, userId: string) {
  await db.$executeRaw`DELETE FROM nutrition_goals WHERE user_id = ${userId}`;
  await db.cycleAssessment.deleteMany({ where: { cycle: { userId } } });
  await db.trainingCycle.deleteMany({ where: { userId } });
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

test("returns null immediately for a non-WEIGHT_LOSS current cycle, without touching the DB", skipOpts, async () => {
  const { computeWeeksSinceDeficitPhaseStarted: compute } = await load();
  const weeks = await compute("nonexistent-user-never-queried", {
    cycleIndex: 1,
    startDate: daysAgo(100),
    goal: "MUSCLE_GAIN",
  });
  assert.equal(weeks, null);
});

test("single WEIGHT_LOSS cycle, no diet break -> weeks since that cycle's own start", skipOpts, async () => {
  const { prisma: db, computeWeeksSinceDeficitPhaseStarted: compute } = await load();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: {
        userId,
        cycleIndex: 1,
        goal: "WEIGHT_LOSS",
        startDate: daysAgo(84), // exactly 12 weeks
        endDate: daysAgo(84 - 28),
        durationDays: 28,
        status: "ACTIVE",
      },
    });
    const weeks = await compute(userId, { cycleIndex: cycle.cycleIndex, startDate: cycle.startDate, goal: cycle.goal });
    assert.ok(weeks !== null);
    assert.ok(Math.abs(weeks! - 12) < 0.1, `expected ~12 weeks, got ${weeks}`);
  } finally {
    await cleanup(db, userId);
  }
});

test("two CONSECUTIVE WEIGHT_LOSS cycles, no diet break -> walks back to the FIRST cycle's start, not the current one's", skipOpts, async () => {
  const { prisma: db, computeWeeksSinceDeficitPhaseStarted: compute } = await load();
  const userId = randomUUID();
  try {
    await db.trainingCycle.create({
      data: { userId, cycleIndex: 1, goal: "WEIGHT_LOSS", startDate: daysAgo(140), endDate: daysAgo(112), durationDays: 28, status: "COMPLETED" },
    });
    const cycle2 = await db.trainingCycle.create({
      data: { userId, cycleIndex: 2, goal: "WEIGHT_LOSS", startDate: daysAgo(112), endDate: daysAgo(84), durationDays: 28, status: "ACTIVE" },
    });
    const weeks = await compute(userId, { cycleIndex: cycle2.cycleIndex, startDate: cycle2.startDate, goal: cycle2.goal });
    // 140 days ago, not 112 -> 20 weeks, not 16
    assert.ok(Math.abs(weeks! - 20) < 0.1, `expected ~20 weeks (from cycle 1's start), got ${weeks}`);
  } finally {
    await cleanup(db, userId);
  }
});

test("walk stops at a prior cycle with a DIFFERENT goal — only the consecutive WEIGHT_LOSS run counts", skipOpts, async () => {
  const { prisma: db, computeWeeksSinceDeficitPhaseStarted: compute } = await load();
  const userId = randomUUID();
  try {
    await db.trainingCycle.create({
      data: { userId, cycleIndex: 1, goal: "MUSCLE_GAIN", startDate: daysAgo(200), endDate: daysAgo(172), durationDays: 28, status: "COMPLETED" },
    });
    await db.trainingCycle.create({
      data: { userId, cycleIndex: 2, goal: "WEIGHT_LOSS", startDate: daysAgo(140), endDate: daysAgo(112), durationDays: 28, status: "COMPLETED" },
    });
    const cycle3 = await db.trainingCycle.create({
      data: { userId, cycleIndex: 3, goal: "WEIGHT_LOSS", startDate: daysAgo(112), endDate: daysAgo(84), durationDays: 28, status: "ACTIVE" },
    });
    const weeks = await compute(userId, { cycleIndex: cycle3.cycleIndex, startDate: cycle3.startDate, goal: cycle3.goal });
    // Must stop at cycle 2 (140 days ago = 20 weeks), never reach cycle 1 (200 days ago).
    assert.ok(Math.abs(weeks! - 20) < 0.1, `expected ~20 weeks (stopped at the MUSCLE_GAIN boundary), got ${weeks}`);
  } finally {
    await cleanup(db, userId);
  }
});

test("a PRIOR accepted diet break resets the counter to its own validFrom, not the original cut's start", skipOpts, async () => {
  const { prisma: db, computeWeeksSinceDeficitPhaseStarted: compute } = await load();
  const userId = randomUUID();
  try {
    await db.trainingCycle.create({
      data: { userId, cycleIndex: 1, goal: "WEIGHT_LOSS", startDate: daysAgo(140), endDate: daysAgo(112), durationDays: 28, status: "COMPLETED" },
    });
    const cycle2 = await db.trainingCycle.create({
      data: { userId, cycleIndex: 2, goal: "WEIGHT_LOSS", startDate: daysAgo(112), endDate: daysAgo(84), durationDays: 28, status: "ACTIVE" },
    });
    // A diet-break assessment + its accepted NutritionGoal, 21 days ago (3 weeks).
    const breakAssessment = await db.cycleAssessment.create({
      data: {
        cycleId: cycle2.id,
        assessmentVersion: 1,
        status: "COMPLETED",
        decision: "KEEP",
        nutritionDecision: "PROPOSE_DIET_BREAK",
        nutritionReasonCodes: ["SUSTAINED_DEFICIT_DIET_BREAK_RECOMMENDED"] as any,
        nutritionUserDecision: "ACCEPTED",
      },
    });
    await db.$executeRaw`
      INSERT INTO nutrition_goals (id, user_id, calories, protein, carbs, fat, status, valid_from, source_assessment_id, created_at, updated_at)
      VALUES (${randomUUID()}, ${userId}, 2400, 150, 250, 65, 'ACTIVE', ${daysAgo(21)}, ${breakAssessment.id}, NOW(), NOW())
    `;
    const weeks = await compute(userId, { cycleIndex: cycle2.cycleIndex, startDate: cycle2.startDate, goal: cycle2.goal });
    // Must reset to ~3 weeks (since the break), not ~20 weeks (since cycle 1 started).
    assert.ok(Math.abs(weeks! - 3) < 0.1, `expected ~3 weeks (reset by the diet break), got ${weeks}`);
  } finally {
    await cleanup(db, userId);
  }
});

test("an ACCEPTED goal that is NOT a diet break (a normal PROPOSE_ADJUSTMENT) does NOT reset the counter", skipOpts, async () => {
  const { prisma: db, computeWeeksSinceDeficitPhaseStarted: compute } = await load();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: { userId, cycleIndex: 1, goal: "WEIGHT_LOSS", startDate: daysAgo(84), endDate: daysAgo(56), durationDays: 28, status: "ACTIVE" },
    });
    const normalAssessment = await db.cycleAssessment.create({
      data: {
        cycleId: cycle.id,
        assessmentVersion: 1,
        status: "COMPLETED",
        decision: "KEEP",
        nutritionDecision: "PROPOSE_ADJUSTMENT",
        nutritionReasonCodes: ["WEIGHT_LOSS_PLATEAUED_OR_TOO_SLOW"] as any,
        nutritionUserDecision: "ACCEPTED",
      },
    });
    await db.$executeRaw`
      INSERT INTO nutrition_goals (id, user_id, calories, protein, carbs, fat, status, valid_from, source_assessment_id, created_at, updated_at)
      VALUES (${randomUUID()}, ${userId}, 1850, 150, 170, 60, 'ACTIVE', ${daysAgo(10)}, ${normalAssessment.id}, NOW(), NOW())
    `;
    const weeks = await compute(userId, { cycleIndex: cycle.cycleIndex, startDate: cycle.startDate, goal: cycle.goal });
    // Must still be ~12 weeks (from the cycle's own start) — the recent
    // ACCEPTED goal exists but wasn't a diet break, so it must be ignored.
    assert.ok(Math.abs(weeks! - 12) < 0.1, `expected ~12 weeks (normal adjustment must not reset the counter), got ${weeks}`);
  } finally {
    await cleanup(db, userId);
  }
});

// ── getDietBreakStatus (2026-09-07) — "how close am I" progress ──

test("getDietBreakStatus: non-WEIGHT_LOSS cycle -> applicable=false, no DB walk needed", skipOpts, async () => {
  const { prisma: db, trainingCycleService: svc } = await load();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: { userId, cycleIndex: 1, goal: "MUSCLE_GAIN", startDate: daysAgo(50), endDate: daysAgo(22), durationDays: 28, status: "ACTIVE" },
    });
    const status = await svc.getDietBreakStatus(cycle.id, userId);
    assert.deepEqual(status, {
      applicable: false,
      weeksSinceDeficitPhaseStarted: null,
      thresholdWeeks: status.thresholdWeeks,
      weeksRemaining: null,
      eligible: false,
    });
  } finally {
    await cleanup(db, userId);
  }
});

test("getDietBreakStatus: WEIGHT_LOSS cycle below the threshold -> applicable, not yet eligible, correct weeksRemaining", skipOpts, async () => {
  const { prisma: db, trainingCycleService: svc } = await load();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: { userId, cycleIndex: 1, goal: "WEIGHT_LOSS", startDate: daysAgo(49), endDate: daysAgo(21), durationDays: 28, status: "ACTIVE" }, // 7 weeks in
    });
    const status = await svc.getDietBreakStatus(cycle.id, userId);
    assert.equal(status.applicable, true);
    assert.equal(status.eligible, false);
    assert.ok(Math.abs(status.weeksSinceDeficitPhaseStarted! - 7) < 0.2, `expected ~7 weeks elapsed, got ${status.weeksSinceDeficitPhaseStarted}`);
    assert.ok(Math.abs(status.weeksRemaining! - (status.thresholdWeeks - 7)) < 0.2);
  } finally {
    await cleanup(db, userId);
  }
});

test("getDietBreakStatus: WEIGHT_LOSS cycle past the threshold -> eligible=true, weeksRemaining=0", skipOpts, async () => {
  const { prisma: db, trainingCycleService: svc } = await load();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: { userId, cycleIndex: 1, goal: "WEIGHT_LOSS", startDate: daysAgo(90), endDate: daysAgo(62), durationDays: 28, status: "ACTIVE" },
    });
    const status = await svc.getDietBreakStatus(cycle.id, userId);
    assert.equal(status.eligible, true);
    assert.equal(status.weeksRemaining, 0);
  } finally {
    await cleanup(db, userId);
  }
});

// ── triggerDietBreakRecommendation (2026-09-07) — PT-initiated trigger.
// Only the failure paths are exercised here (they never reach the
// cross-service profile fetch) — the happy path (real profile data) is
// covered by real E2E against the dev stack instead, same as the rest of
// this session's PT/Smart-Substitute work; see docs/nutrition.md.

test("triggerDietBreakRecommendation: rejects (409) for a non-WEIGHT_LOSS cycle", skipOpts, async () => {
  const { prisma: db, trainingCycleService: svc } = await load();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: { userId, cycleIndex: 1, goal: "MUSCLE_GAIN", startDate: daysAgo(90), endDate: daysAgo(62), durationDays: 28, status: "ACTIVE" },
    });
    await assert.rejects(
      () => svc.triggerDietBreakRecommendation("pt-1", userId, cycle.id),
      (err: any) => err.status === 409,
    );
  } finally {
    await cleanup(db, userId);
  }
});

test("triggerDietBreakRecommendation: rejects (409) when a nutrition recommendation is already PENDING for this cycle", skipOpts, async () => {
  const { prisma: db, trainingCycleService: svc } = await load();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: { userId, cycleIndex: 1, goal: "WEIGHT_LOSS", startDate: daysAgo(90), endDate: daysAgo(62), durationDays: 28, status: "ACTIVE" },
    });
    await db.cycleAssessment.create({
      data: { cycleId: cycle.id, assessmentVersion: 1, status: "COMPLETED", nutritionDecision: "PROPOSE_ADJUSTMENT", nutritionUserDecision: "PENDING" },
    });
    await assert.rejects(
      () => svc.triggerDietBreakRecommendation("pt-1", userId, cycle.id),
      (err: any) => err.status === 409,
    );
  } finally {
    await cleanup(db, userId);
  }
});

test("triggerDietBreakRecommendation: rejects (400) when the client has no active NutritionGoal at all", skipOpts, async () => {
  const { prisma: db, trainingCycleService: svc } = await load();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: { userId, cycleIndex: 1, goal: "WEIGHT_LOSS", startDate: daysAgo(90), endDate: daysAgo(62), durationDays: 28, status: "ACTIVE" },
    });
    await assert.rejects(
      () => svc.triggerDietBreakRecommendation("pt-1", userId, cycle.id),
      (err: any) => err.status === 400,
    );
  } finally {
    await cleanup(db, userId);
  }
});
