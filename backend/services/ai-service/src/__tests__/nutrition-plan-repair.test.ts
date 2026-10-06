/**
 * Deterministic quantity repair (nutrition-plan-repair.ts) — pure unit tests, no DB, no LLM.
 * Foods use representative real nutrient values (per 100 g). The invariant used to judge results is the REAL,
 * unchanged validateNutritionPlanInvariants.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { repairNutritionPlanQuantities, dayWithinTolerance, type RepairFood } from "../services/nutrition-plan-repair";
import { validateNutritionPlanInvariants } from "../services/nutrition-plan-invariant.service";
import { realisticServingCapG } from "../services/nutrition.processor";

const F: Record<string, RepairFood> = {
  chicken: { id: "chicken", name: "Chicken, breast, skinless, roasted", calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  rice: { id: "rice", name: "Rice, white, cooked", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  banana: { id: "banana", name: "Bananas, raw", calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  oats: { id: "oats", name: "Oats, dry", calories: 389, protein: 16.9, carbs: 66.3, fat: 6.9 },
  egg: { id: "egg", name: "Egg, whole, cooked", calories: 143, protein: 12.6, carbs: 0.7, fat: 9.5 },
  soy: { id: "soy", name: "Soy flour, full-fat, raw", calories: 436, protein: 37.8, carbs: 31.9, fat: 20.6 },
  oil: { id: "oil", name: "Olive oil", calories: 884, protein: 0, carbs: 0, fat: 100 },
  almond: { id: "almond", name: "Almonds", calories: 579, protein: 21, carbs: 22, fat: 50 },
  // present in the catalog to prove the repair can never introduce them
  salmon: { id: "salmon", name: "Fish, salmon, Atlantic, farmed", calories: 208, protein: 20, carbs: 0, fat: 13 },
  beef: { id: "beef", name: "Beef, ground, 80% lean", calories: 254, protein: 17, carbs: 0, fat: 20 },
};
const foodById = new Map(Object.values(F).map((f) => [f.id, f]));
const capG = (f: RepairFood) => realisticServingCapG(f.name, f.realisticServingMaxG);
const round1 = (v: number) => Math.round(v * 10) / 10;

type MealSpec = Array<[keyof typeof F, number]>;
function item(key: keyof typeof F, q: number) {
  const f = F[key]; const k = q / 100;
  return { foodId: f.id, name: f.name, quantity: q, unit: "g", calories: Math.round(f.calories * k), protein: round1(f.protein * k), carbs: round1(f.carbs * k), fat: round1((f.fat ?? 0) * k) };
}
function planOf(meals: MealSpec[], target = { kcal: 1992, p: 128, c: 246, f: 55 }) {
  const day = (n: number) => {
    const ms = meals.map((spec, i) => {
      const items = spec.map(([k, q]) => item(k, q));
      const t = items.reduce((a, x) => ({ c: a.c + x.calories, p: a.p + x.protein, cb: a.cb + x.carbs, f: a.f + x.fat }), { c: 0, p: 0, cb: 0, f: 0 });
      return { mealType: (["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const)[i % 4], title: `Bữa ${i + 1}`, calories: t.c, protein: round1(t.p), carbs: round1(t.cb), fat: round1(t.f), items };
    });
    const t = ms.reduce((a, m) => ({ c: a.c + m.calories, p: a.p + m.protein, cb: a.cb + m.carbs, f: a.f + m.fat }), { c: 0, p: 0, cb: 0, f: 0 });
    return { dayNumber: n, title: `Ngày ${n}`, totalCalories: t.c, protein: round1(t.p), carbs: round1(t.cb), fat: round1(t.f), meals: ms };
  };
  return {
    goal: "WEIGHT_LOSS", durationWeeks: 1, mealsPerDay: meals.length, dailyCaloriesTarget: target.kcal, proteinTargetGrams: target.p,
    carbTargetGrams: target.c, fatTargetGrams: target.f, weeklySchedule: Array.from({ length: 7 }, (_, i) => day(i + 1)), generalNotes: [],
  } as any;
}
const valid = (content: any, meals: number) => validateNutritionPlanInvariants({ content, mealsPerDay: meals, allowedFoodIds: new Set(foodById.keys()) });
const foodIdsOf = (content: any) => content.weeklySchedule.flatMap((d: any) => d.meals.flatMap((m: any) => m.items.map((i: any) => i.foodId))).sort().join("|");
const run = (content: any) => repairNutritionPlanQuantities(content, { foodById, capG });

test("fat too high (fat-heavy foods, 3 meals): invariant FAILS before, repair makes it PASS, foods and meal count unchanged", () => {
  const plan = planOf([[["soy", 120], ["banana", 200], ["oil", 20]], [["chicken", 150], ["rice", 200], ["almond", 35]], [["soy", 110], ["banana", 220], ["oil", 20]]]);
  assert.equal(valid(plan, 3).ok, false);
  assert.ok(plan.weeklySchedule[0].fat > 55 * 1.35);
  const { content, report } = run(plan);
  assert.equal(valid(content, 3).ok, true, JSON.stringify(valid(content, 3).violations.slice(0, 3)));
  assert.ok(report.changed && report.repairedDays.length === 7 && report.failedDays.length === 0);
  assert.equal(foodIdsOf(content), foodIdsOf(plan), "same foods, only quantities change");
  assert.ok(content.weeklySchedule.every((d: any) => d.meals.length === 3));
  assert.equal(content.fatTargetGrams, 55); assert.equal(content.dailyCaloriesTarget, 1992);
});

test("fat too low: repair raises fat from the plan's own fat sources (oil/almond), invariant passes", () => {
  const plan = planOf([[["chicken", 150], ["rice", 250], ["oil", 5]], [["chicken", 150], ["rice", 250], ["almond", 10]], [["egg", 60], ["rice", 250], ["oil", 5]]]);
  assert.ok(plan.weeklySchedule[0].fat < 55 * 0.65, `fixture should start below the fat tolerance, got ${plan.weeklySchedule[0].fat}`);
  assert.equal(valid(plan, 3).ok, false);
  const { content } = run(plan);
  assert.equal(valid(content, 3).ok, true, JSON.stringify(valid(content, 3).violations.slice(0, 3)));
  assert.ok(content.weeklySchedule[0].fat > plan.weeklySchedule[0].fat);
});

test("calories too high (fat and carbs balanced but plan overshoots): repaired within 20% of the calorie target", () => {
  const plan = planOf([[["chicken", 250], ["rice", 350], ["oil", 15]], [["chicken", 250], ["rice", 350], ["oil", 15]], [["chicken", 250], ["rice", 350], ["oil", 15]]]);
  assert.ok(plan.weeklySchedule[0].totalCalories > 1992 * 1.2);
  const { content } = run(plan);
  assert.equal(valid(content, 3).ok, true);
  assert.ok(Math.abs(content.weeklySchedule[0].totalCalories - 1992) / 1992 <= 0.2);
});

test("calories too low: repaired upward within bounds", () => {
  const plan = planOf([[["chicken", 80], ["rice", 80], ["oil", 10]], [["chicken", 80], ["rice", 80], ["oil", 10]], [["chicken", 80], ["rice", 80], ["oil", 10]], [["egg", 60], ["banana", 100]]]);
  assert.ok(plan.weeklySchedule[0].totalCalories < 1992 * 0.8);
  const { content } = run(plan);
  assert.equal(valid(content, 4).ok, true, JSON.stringify(valid(content, 4).violations.slice(0, 3)));
});

test("combined calorie + fat mismatch, 4 meals", () => {
  const plan = planOf([[["soy", 150], ["oats", 100], ["oil", 20]], [["soy", 150], ["rice", 300], ["almond", 35]], [["chicken", 150], ["rice", 250], ["oil", 20]], [["soy", 100], ["banana", 200], ["almond", 35]]]);
  const bad = valid(plan, 4);
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.some((v) => v.code === "fat_target_mismatch"));
  const { content, report } = run(plan);
  assert.equal(valid(content, 4).ok, true, JSON.stringify(valid(content, 4).violations.slice(0, 3)));
  assert.ok(report.repairedDays.length > 0);
});

test("exclusions: repair never adds a food — fish/beef in the catalog cannot appear, output foods are a subset of the input plan's foods", () => {
  const plan = planOf([[["soy", 120], ["banana", 200], ["oil", 20]], [["chicken", 150], ["rice", 200], ["almond", 35]], [["soy", 110], ["banana", 220], ["oil", 20]]]);
  const { content } = run(plan);
  const ids: string[] = content.weeklySchedule.flatMap((d: any) => d.meals.flatMap((m: any) => m.items.map((i: any) => i.foodId)));
  assert.ok(!ids.includes("salmon") && !ids.includes("beef"));
  const before = new Set(plan.weeklySchedule.flatMap((d: any) => d.meals.flatMap((m: any) => m.items.map((i: any) => i.foodId))));
  assert.ok(ids.every((id) => before.has(id)));
});

test("bounds: every quantity is an integer within [10 g, realistic serving cap]; no zero-size item or meal; meal kcal balanced", () => {
  const plan = planOf([[["soy", 120], ["banana", 200], ["oil", 20]], [["chicken", 150], ["rice", 200], ["almond", 35]], [["soy", 110], ["banana", 220], ["oil", 20]]]);
  const { content } = run(plan);
  for (const d of content.weeklySchedule) for (const m of d.meals) {
    assert.ok(m.calories >= 0.4 * (1992 / 3) && m.calories <= 1.8 * (1992 / 3), `meal kcal ${m.calories}`);
    for (const i of m.items) {
      const cap = capG(foodById.get(i.foodId as string)!);
      assert.ok(Number.isInteger(i.quantity) && i.quantity >= Math.min(10, cap) && i.quantity <= cap, `${i.name} ${i.quantity}g (cap ${cap})`);
    }
  }
});

test("rounding/consistency: item, meal and day totals stay consistent after repair and macros are rounded to 0.1 g", () => {
  const plan = planOf([[["soy", 120], ["banana", 200], ["oil", 20]], [["chicken", 150], ["rice", 200], ["almond", 35]], [["soy", 110], ["banana", 220], ["oil", 20]]]);
  const { content } = run(plan);
  for (const d of content.weeklySchedule) {
    const mealKcal = d.meals.reduce((a: number, m: any) => a + m.calories, 0);
    const itemKcal = d.meals.reduce((a: number, m: any) => a + m.items.reduce((b: number, i: any) => b + i.calories, 0), 0);
    assert.equal(d.totalCalories, mealKcal); assert.equal(mealKcal, itemKcal);
    for (const m of d.meals) for (const i of m.items) { const f = foodById.get(i.foodId as string)!; assert.equal(i.calories, Math.round((f.calories * i.quantity) / 100)); assert.equal(i.fat, round1(((f.fat ?? 0) * i.quantity) / 100)); }
  }
});

test("no-op: an already-valid plan is returned untouched (same object per day), report.changed=false", () => {
  const plan = planOf([[["chicken", 130], ["rice", 200], ["oil", 8]], [["chicken", 130], ["rice", 200], ["oil", 8]], [["egg", 100], ["oats", 90], ["banana", 100]]]);
  assert.equal(valid(plan, 3).ok, true, JSON.stringify(valid(plan, 3).violations.slice(0, 3)));
  const { content, report } = run(plan);
  assert.equal(report.changed, false);
  assert.deepEqual(content, plan);
  content.weeklySchedule.forEach((d: any, i: number) => assert.equal(d, plan.weeklySchedule[i]));
});

test("deterministic and pure: same input -> identical output; the input plan is not mutated", () => {
  const plan = planOf([[["soy", 120], ["banana", 200], ["oil", 20]], [["chicken", 150], ["rice", 200], ["almond", 35]], [["soy", 110], ["banana", 220], ["oil", 20]]]);
  const snapshot = JSON.stringify(plan);
  const a = run(plan); const b = run(plan);
  assert.equal(JSON.stringify(a.content), JSON.stringify(b.content));
  assert.equal(JSON.stringify(plan), snapshot);
});

test("repair impossible: capped high-fat foods cannot reach the target -> failedDays reported, day left as-is so the invariant still rejects it", () => {
  const plan = planOf([[["almond", 35]], [["oil", 20]], [["almond", 35]]]);
  assert.equal(valid(plan, 3).ok, false);
  const { content, report } = run(plan);
  assert.equal(report.changed, false);
  assert.ok(report.failedDays.length > 0);
  assert.equal(valid(content, 3).ok, false, "never forced through");
  assert.deepEqual(content.weeklySchedule[0], plan.weeklySchedule[0]);
});

test("unknown food id in a failing day -> that day is not repaired (fail closed), not guessed", () => {
  const plan = planOf([[["soy", 120], ["banana", 200], ["oil", 20]], [["chicken", 150], ["rice", 200], ["almond", 35]], [["soy", 110], ["banana", 220], ["oil", 20]]]);
  plan.weeklySchedule[0].meals[0].items[0].foodId = "not-in-catalog";
  const { report } = run(plan);
  assert.ok(report.failedDays.includes(0));
});

test("dayWithinTolerance uses the invariant's own tolerances (20% kcal, 35% macros)", () => {
  const p = { dailyCaloriesTarget: 2000, proteinTargetGrams: 100, carbTargetGrams: 200, fatTargetGrams: 50 };
  assert.equal(dayWithinTolerance({ kcal: 2400, protein: 135, carbs: 200, fat: 50 }, p), true);
  assert.equal(dayWithinTolerance({ kcal: 2401, protein: 100, carbs: 200, fat: 50 }, p), false);
  assert.equal(dayWithinTolerance({ kcal: 2000, protein: 100, carbs: 200, fat: 67.6 }, p), false);
});
