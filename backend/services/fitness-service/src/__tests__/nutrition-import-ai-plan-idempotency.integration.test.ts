import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * V-T012 R222-04 — importAiPlan (POST /nutrition/from-ai-plan) is idempotent per (userId, sourcePlanId), also under a
 * lost check-then-create race: UNIQUE (user_id, source_plan_id) must surface as alreadyExists, never as an error and
 * never as a second program.
 *
 * BACKEND INTEGRATION against the isolated fitness test database (skipped, not failed, when none is configured).
 */
const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(url);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
const skipOpts = { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.", timeout: 60_000 };

const userIds: string[] = [];

const planPayload = (sourcePlanId: string) => ({
  sourcePlanId,
  sourcePlanName: "Idempotency probe",
  goal: "MAINTENANCE",
  durationWeeks: 1,
  mealsPerDay: 3,
  repeatEnabled: true,
  forceArchive: false,
  dailyCaloriesTarget: 2000,
  proteinTargetGrams: 120,
  carbTargetGrams: 220,
  fatTargetGrams: 60,
  weeklySchedule: Array.from({ length: 7 }, (_, i) => ({
    dayNumber: i + 1,
    title: `Day ${i + 1}`,
    meals: [{ mealType: "BREAKFAST", title: "Oats", calories: 400, items: [{ customFoodName: "Oats", quantity: 80, unit: "g", calories: 300 }] }],
  })),
});

test("importAiPlan: 8 concurrent saves of one (user, sourcePlanId) -> exactly one program, every call succeeds, the rest are alreadyExists", skipOpts, async () => {
  const { prisma } = await import("../repositories/prisma");
  const { nutritionService } = await import("../services/nutrition.service");
  const userId = `t-r222-04-${randomUUID().slice(0, 8)}`;
  userIds.push(userId);
  const sourcePlanId = randomUUID();
  const results = await Promise.all(Array.from({ length: 8 }, () => nutritionService.importAiPlan(userId, planPayload(sourcePlanId))));
  assert.equal(results.filter((r: any) => r.alreadyExists === false).length, 1, "exactly one creator");
  assert.equal(results.filter((r: any) => r.alreadyExists === true).length, 7);
  assert.equal(new Set(results.map((r: any) => r.createdProgramId)).size, 1, "all callers see the same program");
  assert.equal(await prisma.nutritionProgram.count({ where: { userId, sourcePlanId } }), 1);
  // a later replay (ai-service recovery) is a pure no-op
  const again: any = await nutritionService.importAiPlan(userId, planPayload(sourcePlanId));
  assert.equal(again.alreadyExists, true);
  assert.equal(await prisma.nutritionProgram.count({ where: { userId } }), 1);
  assert.equal(await prisma.nutritionProgramDay.count({ where: { programId: results[0].createdProgramId } }), 7, "no duplicated day rows");
});

test("importAiPlan: same sourcePlanId for a DIFFERENT user is a different program (key is per user)", skipOpts, async () => {
  const { prisma } = await import("../repositories/prisma");
  const { nutritionService } = await import("../services/nutrition.service");
  const sourcePlanId = randomUUID();
  const u1 = `t-r222-04-${randomUUID().slice(0, 8)}`, u2 = `t-r222-04-${randomUUID().slice(0, 8)}`;
  userIds.push(u1, u2);
  const a: any = await nutritionService.importAiPlan(u1, planPayload(sourcePlanId));
  const b: any = await nutritionService.importAiPlan(u2, planPayload(sourcePlanId));
  assert.equal(a.alreadyExists, false);
  assert.equal(b.alreadyExists, false);
  assert.notEqual(a.createdProgramId, b.createdProgramId);
  assert.equal(await prisma.nutritionProgram.count({ where: { sourcePlanId } }), 2);
});

test.after(async () => {
  if (!canUseIntegrationDb || userIds.length === 0) return;
  const { prisma } = await import("../repositories/prisma");
  await prisma.nutritionProgram.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.$disconnect();
});
