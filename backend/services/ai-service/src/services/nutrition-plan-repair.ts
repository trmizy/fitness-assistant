import type { NutritionPlanContent } from "../schemas/nutrition-plan.schemas";
import {
  NUTRITION_CALORIE_TOLERANCE_PCT,
  NUTRITION_MACRO_TOLERANCE_PCT,
} from "./nutrition-plan-invariant.service";

/**
 * Deterministic quantity repair for a generated nutrition plan (no LLM, no randomness).
 *
 * Why it exists: buildNutritionPlanFromTemplate sizes each role (protein / carb / fat food) independently
 * against the full per-meal macro target, so the INCIDENTAL macros a food brings from the other roles
 * (e.g. an LLM-chosen full-fat soy flour adds ~20 g fat per 100 g while the fat role is ALSO sized to the
 * full fat target) stack on top of the target. The authoritative targets are numeric constraints and must not
 * depend on the LLM getting the arithmetic right (see docs/nutrition-generation-invariant-remediation.md).
 *
 * What it does: for each day that violates the (unchanged) invariant tolerances, re-solve ONLY the gram
 * quantities of the items already in that day (same foods, same meal count, same meals) by bounded least
 * squares on relative error of daily kcal / protein / carbs / fat, with soft terms keeping meals balanced and
 * quantities close to the original. Days that already pass are returned untouched (no-op).
 *
 * What it never does: add/replace/remove foods, touch excluded foods (none can appear — no food is added),
 * change the targets, change the meal count, exceed a food's realistic serving cap, or force a plan through:
 * the caller must re-run validateNutritionPlanInvariants on the result; an unrepairable day stays failing.
 */
export type RepairFood = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat?: number;
  fats?: number;
  realisticServingMaxG?: number | null;
};

export type RepairOptions = {
  foodById: Map<string, RepairFood>;
  /** Realistic serving cap in grams for a food (same rule the builder applies). */
  capG: (food: RepairFood) => number;
  /** Minimum grams for any item that stays in the plan. */
  minItemG?: number;
  /** Meal kcal must stay within [minMealShare, maxMealShare] x (daily target / meals) after repair. */
  minMealShare?: number;
  maxMealShare?: number;
};

export type DaySummary = { kcal: number; protein: number; carbs: number; fat: number };
export type RepairReport = {
  invoked: boolean;
  repairedDays: number[];
  failedDays: number[];
  changed: boolean;
  before: DaySummary[];
  after: DaySummary[];
  ms: number;
};

const roundMacro = (v: number) => Math.round(v * 10) / 10;
const fatOf = (f: RepairFood) => f.fat ?? f.fats ?? 0;

function dayTotals(day: NutritionPlanContent["weeklySchedule"][number]): DaySummary {
  return { kcal: day.totalCalories, protein: day.protein, carbs: day.carbs, fat: day.fat };
}

function within(actual: number, expected: number, tol: number): boolean {
  return expected > 0 && Math.abs(actual - expected) / expected <= tol;
}

export function dayWithinTolerance(day: DaySummary, plan: Pick<NutritionPlanContent, "dailyCaloriesTarget" | "proteinTargetGrams" | "carbTargetGrams" | "fatTargetGrams">): boolean {
  return (
    within(day.kcal, plan.dailyCaloriesTarget, NUTRITION_CALORIE_TOLERANCE_PCT) &&
    within(day.protein, plan.proteinTargetGrams, NUTRITION_MACRO_TOLERANCE_PCT) &&
    within(day.carbs, plan.carbTargetGrams, NUTRITION_MACRO_TOLERANCE_PCT) &&
    within(day.fat, plan.fatTargetGrams, NUTRITION_MACRO_TOLERANCE_PCT)
  );
}

type Term = { coef: number[]; target: number; scale: number; weight: number };

/** Cyclic coordinate descent on a bounded convex quadratic; fixed sweep count and order => deterministic. */
function solveBounded(terms: Term[], q0: number[], lo: number[], hi: number[]): number[] {
  const n = q0.length;
  const q = q0.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
  for (let sweep = 0; sweep < 300; sweep += 1) {
    let maxMove = 0;
    for (let j = 0; j < n; j += 1) {
      let s = 0;
      let b = 0;
      for (const t of terms) {
        const cj = t.coef[j];
        if (cj === 0) continue;
        let rest = 0;
        for (let i = 0; i < n; i += 1) if (i !== j) rest += t.coef[i] * q[i];
        const w = t.weight / (t.scale * t.scale);
        s += w * cj * cj;
        b += w * cj * (t.target - rest);
      }
      if (s <= 0) continue;
      const next = Math.min(hi[j], Math.max(lo[j], b / s));
      maxMove = Math.max(maxMove, Math.abs(next - q[j]));
      q[j] = next;
    }
    if (maxMove < 1e-4) break;
  }
  return q;
}

function rebuildItem(item: any, food: RepairFood, quantity: number) {
  const factor = quantity / 100;
  return {
    ...item,
    quantity,
    calories: Math.max(0, Math.round(food.calories * factor)),
    protein: roundMacro(food.protein * factor),
    carbs: roundMacro(food.carbs * factor),
    fat: roundMacro(fatOf(food) * factor),
  };
}

function sum(items: Array<{ calories: number; protein: number; carbs: number; fat: number }>): DaySummary {
  return items.reduce(
    (t, i) => ({ kcal: t.kcal + i.calories, protein: roundMacro(t.protein + i.protein), carbs: roundMacro(t.carbs + i.carbs), fat: roundMacro(t.fat + i.fat) }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** Repairs quantities day by day. Pure: returns a NEW content object; the input is not mutated. */
export function repairNutritionPlanQuantities(
  content: NutritionPlanContent,
  options: RepairOptions,
): { content: NutritionPlanContent; report: RepairReport } {
  const started = process.hrtime.bigint();
  const minItemG = options.minItemG ?? 10;
  const minShare = options.minMealShare ?? 0.4;
  const maxShare = options.maxMealShare ?? 1.8;
  const before = content.weeklySchedule.map(dayTotals);
  const repairedDays: number[] = [];
  const failedDays: number[] = [];
  const meals = Math.max(1, content.weeklySchedule[0]?.meals.length ?? 1);
  const avgMealKcal = content.dailyCaloriesTarget / meals;

  const weeklySchedule = content.weeklySchedule.map((day, dayIndex) => {
    if (dayWithinTolerance(dayTotals(day), content)) return day;

    const refs: Array<{ mealIndex: number; itemIndex: number; food: RepairFood }> = [];
    let unresolved = false;
    day.meals.forEach((meal, mealIndex) =>
      meal.items.forEach((item, itemIndex) => {
        const food = item.foodId ? options.foodById.get(item.foodId) : undefined;
        if (!food) unresolved = true;
        else refs.push({ mealIndex, itemIndex, food });
      }),
    );
    if (unresolved || refs.length === 0) {
      failedDays.push(dayIndex);
      return day;
    }

    const n = refs.length;
    const q0 = refs.map((r) => Number(day.meals[r.mealIndex].items[r.itemIndex].quantity) || minItemG);
    const hi = refs.map((r) => Math.max(minItemG, options.capG(r.food)));
    const lo = refs.map((_, i) => Math.min(minItemG, hi[i]));

    const per = (f: (x: RepairFood) => number) => refs.map((r) => f(r.food) / 100);
    const terms: Term[] = [
      { coef: per((f) => f.calories), target: content.dailyCaloriesTarget, scale: content.dailyCaloriesTarget, weight: 1 },
      { coef: per((f) => f.protein), target: content.proteinTargetGrams, scale: content.proteinTargetGrams, weight: 1 },
      { coef: per((f) => f.carbs), target: content.carbTargetGrams, scale: content.carbTargetGrams, weight: 1 },
      { coef: per(fatOf), target: content.fatTargetGrams, scale: content.fatTargetGrams, weight: 1 },
    ];
    // Keep every meal a real meal: soft pull of each meal's kcal toward an equal share of the daily target.
    for (let m = 0; m < day.meals.length; m += 1) {
      terms.push({
        coef: refs.map((r) => (r.mealIndex === m ? r.food.calories / 100 : 0)),
        target: avgMealKcal, scale: avgMealKcal, weight: 0.1,
      });
    }
    // Stay close to the composition/portions the plan already had.
    for (let i = 0; i < n; i += 1) {
      terms.push({ coef: refs.map((_, k) => (k === i ? 1 : 0)), target: q0[i], scale: Math.max(q0[i], 10), weight: 0.01 });
    }

    const solved = solveBounded(terms, q0, lo, hi).map((v, i) => Math.min(hi[i], Math.max(lo[i], Math.round(v))));

    const newMeals = day.meals.map((meal, mealIndex) => {
      const items = meal.items.map((item, itemIndex) => {
        const k = refs.findIndex((r) => r.mealIndex === mealIndex && r.itemIndex === itemIndex);
        return rebuildItem(item, refs[k].food, solved[k]);
      });
      const t = sum(items);
      return { ...meal, calories: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, items };
    });
    const t = sum(newMeals.map((m) => ({ calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat })));
    const mealBalanceOk = newMeals.every((m) => m.calories >= minShare * avgMealKcal && m.calories <= maxShare * avgMealKcal);
    const repairedDay = { ...day, meals: newMeals, totalCalories: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat };

    if (!mealBalanceOk || !dayWithinTolerance(dayTotals(repairedDay), content)) {
      failedDays.push(dayIndex);
      return day; // never force an unrepairable day through: leave it failing so the invariant rejects the plan
    }
    repairedDays.push(dayIndex);
    return repairedDay;
  });

  const after = weeklySchedule.map(dayTotals);
  return {
    content: { ...content, weeklySchedule },
    report: {
      invoked: true, repairedDays, failedDays, changed: repairedDays.length > 0, before, after,
      ms: Number(process.hrtime.bigint() - started) / 1e6,
    },
  };
}
