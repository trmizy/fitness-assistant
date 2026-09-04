/**
 * Real end-to-end coverage for the moderation-analysis wiring added to
 * marketplace.service.ts's publishPlan/republishVersion — real DB, real
 * ai-service call (LLM success or fallback both count, same tolerance as
 * every other real-LLM integration test in this codebase).
 *
 * Run with (from backend/services/ai-service):
 *   npx tsx --test src/__tests__/marketplace-moderation-analysis.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { marketplaceService, marketplaceDeps } from "../services/marketplace.service";
import { PlanStatus } from "../generated/prisma";

// publishPlan now gates on hasCompletedCycleForPlan (publisher-qualification
// rule, separate concern from this file's moderation-analysis coverage) —
// stub it so these tests don't depend on a real fitness-service cycle.
const originalHasCompletedCycleForPlan = marketplaceDeps.hasCompletedCycleForPlan;
test.before(() => {
  marketplaceDeps.hasCompletedCycleForPlan = async () => true;
});
test.after(async () => {
  marketplaceDeps.hasCompletedCycleForPlan = originalHasCompletedCycleForPlan;
  await prisma.$disconnect();
});

function sevenDayNoRestPlan() {
  return {
    goal: "MUSCLE_GAIN",
    durationWeeks: 4,
    daysPerWeek: 7,
    weeklySchedule: Array.from({ length: 7 }, (_, i) => ({
      day: `Day ${i + 1}`,
      goal: "Full body",
      exercises: [{ exerciseId: `ex-${i}`, order: 1, name: `Exercise ${i}`, sets: 3, reps: "10", restSeconds: 60 }],
    })),
    progressionNotes: [],
    recoveryNotes: [],
  };
}

test("publishPlan: creates a PlanModerationAnalysis row automatically, and a 7-day plan with no rest is flagged (never reported likely_safe)", { timeout: 60_000 }, async () => {
  const userId = `pub-${randomUUID()}`;
  const plan = await prisma.workoutPlan.create({
    data: {
      userId,
      name: "7-day plan",
      goal: "MUSCLE_GAIN",
      duration: 4,
      daysPerWeek: 7,
      plan: sevenDayNoRestPlan(),
      status: PlanStatus.COMPLETED,
    },
  });

  const listing = await marketplaceService.publishPlan(userId, plan.id, "No-rest plan", "test");

  const analysis = await prisma.planModerationAnalysis.findFirst({ where: { publishedPlanId: listing.id } });
  assert.ok(analysis, "expected a PlanModerationAnalysis row to have been created");
  assert.ok((analysis!.ruleFlags as any).includes("NO_REST_DAY"));
  assert.notEqual(analysis!.aiRecommendation, "likely_safe");
  assert.ok(analysis!.aiConfidenceScore >= 0 && analysis!.aiConfidenceScore <= 1);
});

test("publishPlan: a well-formed, safe plan produces an analysis with no severe rule flags", { timeout: 60_000 }, async () => {
  const userId = `pub-${randomUUID()}`;
  const plan = await prisma.workoutPlan.create({
    data: {
      userId,
      name: "3-day plan",
      goal: "MUSCLE_GAIN",
      duration: 4,
      daysPerWeek: 3,
      plan: {
        goal: "MUSCLE_GAIN",
        durationWeeks: 4,
        daysPerWeek: 3,
        weeklySchedule: [
          { day: "Day 1", goal: "Upper", exercises: [{ exerciseId: "a", order: 1, name: "Bench Press", sets: 3, reps: "8-10", restSeconds: 90 }] },
          { day: "Day 2", goal: "Lower", exercises: [{ exerciseId: "b", order: 1, name: "Squat", sets: 3, reps: "8-10", restSeconds: 90 }] },
          { day: "Day 3", goal: "Full body", exercises: [{ exerciseId: "c", order: 1, name: "Deadlift", sets: 3, reps: "6-8", restSeconds: 120 }] },
        ],
        progressionNotes: ["Tăng dần khối lượng mỗi tuần"],
        recoveryNotes: ["Nghỉ ít nhất 1 ngày giữa các buổi nặng"],
      },
      status: PlanStatus.COMPLETED,
    },
  });

  const listing = await marketplaceService.publishPlan(userId, plan.id, "Balanced 3-day plan", "test");
  const analysis = await prisma.planModerationAnalysis.findFirst({ where: { publishedPlanId: listing.id } });
  assert.ok(analysis);
  assert.deepEqual(analysis!.ruleFlags, []);
});

test("republishVersion: also runs moderation analysis for the new version (independent from the old version's analysis)", { timeout: 60_000 }, async () => {
  const userId = `pub-${randomUUID()}`;
  const plan = await prisma.workoutPlan.create({
    data: {
      userId,
      name: "Versioned plan",
      goal: "MUSCLE_GAIN",
      duration: 4,
      daysPerWeek: 3,
      plan: {
        goal: "MUSCLE_GAIN",
        durationWeeks: 4,
        daysPerWeek: 3,
        weeklySchedule: [{ day: "Day 1", exercises: [{ exerciseId: "a", order: 1, name: "Row", sets: 3, reps: "10", restSeconds: 60 }] }],
        progressionNotes: ["note"],
        recoveryNotes: ["note"],
      },
      status: PlanStatus.COMPLETED,
    },
  });
  const v1 = await marketplaceService.publishPlan(userId, plan.id, "V1", "test");
  const v2 = await marketplaceService.republishVersion(userId, v1.id, { changelog: "Fixed something" });

  const v1Analysis = await prisma.planModerationAnalysis.findFirst({ where: { publishedPlanId: v1.id } });
  const v2Analysis = await prisma.planModerationAnalysis.findFirst({ where: { publishedPlanId: v2.id } });
  assert.ok(v1Analysis);
  assert.ok(v2Analysis);
  assert.notEqual(v1Analysis!.id, v2Analysis!.id);
});
