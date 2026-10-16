import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Phase 4.3 — BACKEND INTEGRATION against the isolated *_test Postgres (skipped otherwise).
// Writes go through the REAL write paths (nutritionService.createLog / upsertMealCompletion / updateLog /
// deleteLog / deleteMealCompletion) so the snapshot-vs-log overlap is the product's real behaviour.

const dbUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(dbUrl) && process.env.NODE_ENV === "test";
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;

type Mods = {
  prisma: (typeof import("../repositories/prisma"))["prisma"];
  svc: (typeof import("../services/nutrition.service"))["nutritionService"];
  getWindow: (typeof import("../services/nutrition-analytics-window.service"))["getNutritionAnalyticsWindow"];
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import("../repositories/prisma")).prisma,
      svc: (await import("../services/nutrition.service")).nutritionService,
      getWindow: (await import("../services/nutrition-analytics-window.service")).getNutritionAnalyticsWindow,
    };
  }
  return mods;
}

const users: string[] = [];
test.after(async () => {
  if (!mods) return;
  for (const userId of users) {
    await mods.prisma.nutritionMealCompletion.deleteMany({ where: { userId } }).catch(() => {});
    await mods.prisma.nutritionProgram.deleteMany({ where: { userId } }).catch(() => {});
    await mods.prisma.nutritionLog.deleteMany({ where: { userId } }).catch(() => {});
    await mods.prisma.nutritionGoal.deleteMany({ where: { userId } }).catch(() => {});
  }
  await mods.prisma.$disconnect();
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const skip = { skip: !canUseIntegrationDb ? "needs isolated *_test Postgres + NODE_ENV=test" : false } as const;

test("real write paths: snapshot/log overlap, later log, edit, delete, window bounds, cross-user (real DB)", skip, async () => {
  const { prisma, svc, getWindow } = await load();
  const userA = `p43-a-${randomUUID()}`;
  const userB = `p43-b-${randomUUID()}`;
  users.push(userA, userB);

  await prisma.nutritionGoal.create({ data: { userId: userA, calories: 2000, protein: 150, carbs: 200, fat: 65, status: "ACTIVE", validFrom: new Date(Date.now() - 60 * 86_400_000) } });
  const program = await prisma.nutritionProgram.create({
    data: {
      userId: userA, name: "p43", status: "ACTIVE", startDate: new Date(Date.now() - 20 * 86_400_000),
      days: { create: [{ dayNumber: 1, meals: { create: [{ mealType: "BREAKFAST" }, { mealType: "LUNCH" }] } }] },
    },
    include: { days: { include: { meals: true } } },
  });
  const meals = program.days[0].meals;
  const lunch = meals.find((m) => m.mealType === "LUNCH")!;
  const breakfast = meals.find((m) => m.mealType === "BREAKFAST")!;

  // D1: log (400) THEN completion override 600 → user's override is the actual; earlier log not added again
  const D1 = daysAgo(3);
  await svc.createLog(userA, { date: D1, mealType: "lunch", foodName: "com", calories: 400, protein: 30, carbs: 40, fats: 10 } as any);
  await sleep(25);
  await svc.upsertMealCompletion(userA, lunch.id, D1, { status: "COMPLETED", overrideCalories: 600, overrideProtein: 40, overrideCarbs: 50, overrideFat: 20 });
  let w = await getWindow(userA, { days: 28 });
  const day1 = () => w.actual.days.find((x) => x.date === D1)!;
  assert.equal(day1().caloriesKcal, 600);
  assert.equal(day1().sources.mealCompletions, 1);
  assert.equal(day1().sources.nutritionLogs, 0, "no double count of the earlier log");

  // later log for the same meal type is an addition (product rule)
  await sleep(25);
  const later = await svc.createLog(userA, { date: D1, mealType: "lunch", foodName: "che", calories: 150, protein: 2, carbs: 30, fats: 1 } as any);
  w = await getWindow(userA, { days: 28 });
  assert.equal(day1().caloriesKcal, 750);
  assert.equal(day1().completeness, "PARTIAL", "breakfast of that plan day has no record");

  // delete → analytics follow authoritative current records
  await svc.deleteLog((later as any).id, userA);
  w = await getWindow(userA, { days: 28 });
  assert.equal(day1().caloriesKcal, 600);

  // D2: percent-mode completion snapshots plan items + existing logs (400) → still 400, not 800
  const D2 = daysAgo(5);
  await svc.createLog(userA, { date: D2, mealType: "breakfast", foodName: "banh mi", calories: 400, protein: 15, carbs: 50, fats: 12 } as any);
  await sleep(25);
  await svc.upsertMealCompletion(userA, breakfast.id, D2, { status: "COMPLETED" });
  w = await getWindow(userA, { days: 28 });
  assert.equal(w.actual.days.find((x) => x.date === D2)!.caloriesKcal, 400);

  // un-complete (delete completion) → falls back to the diary row alone, same value, no stale snapshot
  await svc.deleteMealCompletion(userA, breakfast.id, D2);
  w = await getWindow(userA, { days: 28 });
  assert.equal(w.actual.days.find((x) => x.date === D2)!.caloriesKcal, 400);
  assert.equal(w.actual.days.find((x) => x.date === D2)!.sources.mealCompletions, 0);

  // D3: diary-only day: edit then delete
  const D3 = daysAgo(7);
  const row: any = await svc.createLog(userA, { date: D3, mealType: "dinner", foodName: "pho", calories: 500, protein: 25, carbs: 60, fats: 12 } as any);
  w = await getWindow(userA, { days: 28 });
  assert.equal(w.actual.days.find((x) => x.date === D3)!.caloriesKcal, 500);
  await svc.updateLog(row.id, userA, { calories: 700 });
  w = await getWindow(userA, { days: 28 });
  assert.equal(w.actual.days.find((x) => x.date === D3)!.caloriesKcal, 700);
  await svc.deleteLog(row.id, userA);
  w = await getWindow(userA, { days: 28 });
  assert.equal(w.actual.days.find((x) => x.date === D3)!.state, "NO_DATA");

  // window bounds: 40 days ago and a future date never contribute
  await svc.createLog(userA, { date: daysAgo(40), mealType: "lunch", foodName: "old", calories: 999 } as any);
  await svc.createLog(userA, { date: daysAgo(-2), mealType: "lunch", foodName: "future", calories: 888 } as any);
  w = await getWindow(userA, { days: 28 });
  assert.equal(w.actual.summary.loggedDays, 2); // D1 + D2 only
  assert.ok(!w.actual.days.some((x) => x.caloriesKcal === 999 || x.caloriesKcal === 888));

  // adherence uses the active target, compared only on COMPLETE-coverage days
  assert.equal(w.activeTarget.state, "ACTIVE_TARGET");
  assert.equal(w.adherence.state, "MEASURED");
  assert.equal(w.adherence.calories?.comparedDays, 2);
  assert.equal(w.adherence.calories?.averageActual, 500); // (600 + 400) / 2

  // cross-user: B has nothing and sees none of A's facts
  const b = await getWindow(userB, { days: 28 });
  assert.equal(b.dataQuality, "NO_DATA");
  assert.equal(b.activeTarget.state, "NO_ACTIVE_TARGET");
  assert.equal(b.actual.summary.loggedDays, 0);
  assert.ok(!JSON.stringify(b).includes(program.id));
});

test("only older data → STALE, not 'never logged' (real DB)", skip, async () => {
  const { prisma, svc, getWindow } = await load();
  const userId = `p43-s-${randomUUID()}`;
  users.push(userId);
  await svc.createLog(userId, { date: daysAgo(60), mealType: "lunch", foodName: "x", calories: 500 } as any);
  const w = await getWindow(userId, { days: 28 });
  assert.equal(w.dataQuality, "STALE");
  assert.equal(w.actual.summary.loggedDays, 0);
  assert.equal(w.adherence.state, "NOT_AVAILABLE_NO_ACTUAL");
  void prisma;
});
