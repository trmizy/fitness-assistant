import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNutritionAnalyticsWindow,
  normalizeNutritionWindowDays,
  resolveNutritionWindow,
  type CompletionInput,
  type GoalInput,
  type LogInput,
} from "../services/nutrition-analytics-window.service";

// Phase 4.3 — DB-free coverage of the target-vs-actual normalization.
// Dates: window = 28 UTC days ending 2026-10-10 (from 2026-09-13T00:00Z).

const ASOF = new Date("2026-10-10T12:00:00.000Z");
const { from, to } = resolveNutritionWindow(ASOF, 28);
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const at = (iso: string) => new Date(iso);

const GOAL: GoalInput = {
  id: "g1", calories: 2000, protein: 150, carbs: 200, fat: 65, status: "ACTIVE",
  validFrom: at("2026-08-01T00:00:00Z"), supersededAt: null, triggeredBy: "ONBOARDING",
};

let n = 0;
function log(date: string, over: Partial<LogInput> = {}): LogInput {
  return { id: `l${++n}`, date: d(date), mealType: "lunch", calories: 500, protein: 30, carbs: 50, fats: 15, createdAt: at(`${date}T08:00:00Z`), ...over };
}
function completion(date: string, over: Partial<CompletionInput> = {}): CompletionInput {
  return {
    logDate: d(date), status: "COMPLETED", consumedCalories: 600, consumedProtein: 40, consumedCarbs: 60, consumedFat: 20,
    updatedAt: at(`${date}T12:00:00Z`), mealId: "m-lunch", mealType: "LUNCH",
    dayMeals: [{ id: "m-lunch", mealType: "LUNCH" }], ...over,
  };
}
const build = (o: Partial<Parameters<typeof buildNutritionAnalyticsWindow>[0]> = {}) =>
  buildNutritionAnalyticsWindow({ from, to, days: 28, completions: [], logs: [], goals: [GOAL], hasActivityBeforeWindow: false, ...o });

test("window convention matches training: 28 UTC days incl. asOf's day; bounds validated", () => {
  assert.equal(from.toISOString(), "2026-09-13T00:00:00.000Z");
  assert.equal(normalizeNutritionWindowDays(undefined), 28);
  assert.throws(() => normalizeNutritionWindowDays(6), RangeError);
  assert.throws(() => normalizeNutritionWindowDays(91), RangeError);
});

test("TARGET ONLY: target present, actual NO_DATA, adherence NOT_AVAILABLE_NO_ACTUAL — never 0 kcal / 0%", () => {
  const w = build();
  assert.equal(w.activeTarget.state, "ACTIVE_TARGET");
  assert.equal(w.dataQuality, "NO_DATA");
  assert.equal(w.actual.summary.loggedDays, 0);
  assert.equal(w.actual.summary.calories.averageKcal, null);
  assert.equal(w.adherence.state, "NOT_AVAILABLE_NO_ACTUAL");
  assert.equal(w.adherence.calories, null);
  assert.ok(w.actual.days.every((x) => x.state === "NO_DATA" && x.caloriesKcal === null));
});

test("ACTUAL WITHOUT TARGET: summaries available, adherence NOT_AVAILABLE_NO_TARGET, no fabricated target", () => {
  const w = build({ goals: [], logs: [log("2026-10-01"), log("2026-10-02", { calories: 700 })] });
  assert.equal(w.activeTarget.state, "NO_ACTIVE_TARGET");
  assert.equal(w.actual.summary.loggedDays, 2);
  assert.equal(w.actual.summary.calories.averageKcal, 600);
  assert.equal(w.adherence.state, "NOT_AVAILABLE_NO_TARGET");
  assert.equal(w.adherence.calories, null);
});

test("COMPLETE CALORIES: exact counts, average, target and delta (diary days, 2 meals/day)", () => {
  const logs: LogInput[] = [];
  const kcal = [1800, 2000, 2200, 1900, 2100]; // days 1..5 → average 2000
  kcal.forEach((k, i) => {
    const day = `2026-10-0${i + 1}`;
    logs.push(log(day, { mealType: "lunch", calories: k - 800, protein: null, carbs: null, fats: null }));
    logs.push(log(day, { mealType: "dinner", calories: 800, protein: null, carbs: null, fats: null }));
  });
  const w = build({ logs });
  assert.equal(w.actual.summary.loggedDays, 5);
  assert.equal(w.actual.summary.calories.averageKcal, 2000);
  assert.equal(w.actual.summary.calories.daysUsed, 5);
  assert.equal(w.adherence.state, "MEASURED");
  assert.deepEqual(w.adherence.calories, { comparedDays: 5, averageTarget: 2000, averageActual: 2000, averageDelta: 0, averageAbsoluteDelta: 120 });
  // no tolerance / good-bad classification anywhere in the contract
  assert.ok(!JSON.stringify(w).match(/within|good|poor|adherent/i));
});

test("PROTEIN: exact average/delta; days missing protein are PARTIAL coverage and excluded, not zeroed", () => {
  const logs = [
    log("2026-10-01", { protein: 120 }),
    log("2026-10-02", { protein: 150 }),
    log("2026-10-03", { protein: 180 }),
    log("2026-10-04", { protein: null }),                         // calories only
    log("2026-10-05", { protein: 90 }), log("2026-10-05", { mealType: "dinner", protein: null }), // one of two records lacks protein
  ];
  const w = build({ logs });
  assert.equal(w.actual.summary.protein.averageG, 150);
  assert.equal(w.actual.summary.protein.daysUsed, 3);
  assert.equal(w.actual.summary.protein.partialDays, 1);
  assert.equal(w.adherence.protein?.comparedDays, 3);
  assert.equal(w.adherence.protein?.averageTarget, 150);
  assert.equal(w.adherence.protein?.averageDelta, 0);
  const day4 = w.actual.days.find((x) => x.date === "2026-10-04")!;
  assert.equal(day4.proteinG, null);
  assert.equal(day4.coverage.protein, "NONE");
  assert.equal(day4.caloriesKcal, 500, "calories remain usable");
  const day5 = w.actual.days.find((x) => x.date === "2026-10-05")!;
  assert.equal(day5.coverage.protein, "PARTIAL");
  assert.equal(day5.proteinG, 90, "lower bound reported, flagged PARTIAL");
});

test("PARTIAL MACROS: fat missing → carbs/protein/calories still usable; fat stays missing, never 0", () => {
  const w = build({ logs: [log("2026-10-01", { fats: null }), log("2026-10-02", { fats: null })] });
  assert.equal(w.actual.summary.calories.daysUsed, 2);
  assert.equal(w.actual.summary.protein.daysUsed, 2);
  assert.equal(w.actual.summary.fat.daysUsed, 0);
  assert.equal(w.actual.summary.fat.averageG, null);
  assert.equal(w.adherence.fat, null);
  assert.ok(w.actual.days.filter((x) => x.state === "LOGGED").every((x) => x.fatG === null));
});

test("OVERLAP: completion snapshot already contains earlier same-meal logs; only logs created AFTER it are added", () => {
  // percent-mode snapshot at 12:00 included the 08:00 log (600 kcal total); a 13:00 log is an addition
  const comp = completion("2026-10-03", { consumedCalories: 600, updatedAt: at("2026-10-03T12:00:00Z") });
  const before = log("2026-10-03", { mealType: "lunch", calories: 300, createdAt: at("2026-10-03T08:00:00Z") });
  const after = log("2026-10-03", { mealType: "lunch", calories: 150, createdAt: at("2026-10-03T13:00:00Z") });
  const other = log("2026-10-03", { mealType: "dinner", calories: 400, createdAt: at("2026-10-03T19:00:00Z") });
  const w = build({ completions: [comp], logs: [before, after, other] });
  const day = w.actual.days.find((x) => x.date === "2026-10-03")!;
  assert.equal(day.caloriesKcal, 600 + 150 + 400, "snapshot + later log + other meal type; earlier log not double counted");
  assert.deepEqual(day.sources, { mealCompletions: 1, nutritionLogs: 2, skippedMeals: 0 });
});

test("SKIPPED completion is an explicit zero for that meal (product rule) and ignores that meal's logs", () => {
  const comp = completion("2026-10-04", { status: "SKIPPED", consumedCalories: 0, consumedProtein: 0, consumedCarbs: 0, consumedFat: 0 });
  const l = log("2026-10-04", { mealType: "lunch", calories: 500, createdAt: at("2026-10-04T18:00:00Z") });
  const dinner = log("2026-10-04", { mealType: "dinner", calories: 700 });
  const day = build({ completions: [comp], logs: [l, dinner] }).actual.days.find((x) => x.date === "2026-10-04")!;
  assert.equal(day.caloriesKcal, 700);
  assert.equal(day.hasExplicitSkip, true);
  assert.equal(day.sources.skippedMeals, 1);
});

test("PLANNED is not ACTUAL: a PENDING completion contributes nothing; only the diary does", () => {
  const pending = completion("2026-10-05", { status: "PENDING", consumedCalories: 600 });
  const w = build({ completions: [pending] });
  assert.equal(w.actual.days.find((x) => x.date === "2026-10-05")!.state, "NO_DATA");
  assert.equal(w.actual.summary.loggedDays, 0);
});

test("completion calories-only override: macros 0 with calories>0 are 'not provided' (missing), not zero grams", () => {
  const comp = completion("2026-10-06", { consumedCalories: 640, consumedProtein: 0, consumedCarbs: 0, consumedFat: 0 });
  const day = build({ completions: [comp] }).actual.days.find((x) => x.date === "2026-10-06")!;
  assert.equal(day.caloriesKcal, 640);
  assert.equal(day.proteinG, null);
  assert.equal(day.coverage.protein, "NONE");
});

test("completeness vs plan day: all planned meals recorded ⇒ COMPLETE; some ⇒ PARTIAL; diary-only ⇒ COVERAGE_UNKNOWN", () => {
  const meals = [{ id: "a", mealType: "BREAKFAST" }, { id: "b", mealType: "LUNCH" }];
  const full = build({
    completions: [completion("2026-10-01", { mealId: "a", mealType: "BREAKFAST", dayMeals: meals }), completion("2026-10-01", { mealId: "b", mealType: "LUNCH", dayMeals: meals })],
  });
  assert.equal(full.actual.days.find((x) => x.date === "2026-10-01")!.completeness, "COMPLETE");
  const part = build({ completions: [completion("2026-10-02", { mealId: "b", mealType: "LUNCH", dayMeals: meals })] });
  assert.equal(part.actual.days.find((x) => x.date === "2026-10-02")!.completeness, "PARTIAL");
  const diary = build({ logs: [log("2026-10-03")] });
  assert.equal(diary.actual.days.find((x) => x.date === "2026-10-03")!.completeness, "COVERAGE_UNKNOWN");
});

test("STALE vs NO_DATA vs INSUFFICIENT_HISTORY vs PARTIAL vs SUFFICIENT", () => {
  assert.equal(build({ hasActivityBeforeWindow: true }).dataQuality, "STALE");
  assert.equal(build().dataQuality, "NO_DATA");
  assert.equal(build({ logs: [log("2026-10-01")] }).dataQuality, "INSUFFICIENT_HISTORY");
  assert.equal(build({ logs: [log("2026-10-01"), log("2026-10-02")] }).dataQuality, "PARTIAL");
  const days20 = Array.from({ length: 20 }, (_, i) => new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10)).map((x) => log(x));
  assert.equal(build({ logs: days20 }).dataQuality, "SUFFICIENT"); // 20/28 ≥ 0.7 (existing nutritionAdaptive gate)
});

test("WINDOW: rows before the window or after asOf never contribute", () => {
  const w = build({
    logs: [log("2026-09-12"), log("2026-09-20"), log("2026-10-11", { date: at("2026-10-11T00:00:00Z") })],
    completions: [completion("2026-09-12"), completion("2026-10-12")],
  });
  assert.equal(w.actual.summary.loggedDays, 1);
  assert.equal(w.actual.days.length, 28);
  assert.equal(w.actual.days[0].date, "2026-09-13");
  assert.equal(w.actual.days[27].date, "2026-10-10");
});

test("target versions: per-day applicable target; change inside the window is flagged", () => {
  const old: GoalInput = { ...GOAL, id: "old", calories: 2400, status: "SUPERSEDED", validFrom: at("2026-08-01T00:00:00Z"), supersededAt: at("2026-09-25T10:00:00Z") };
  const cur: GoalInput = { ...GOAL, id: "new", calories: 2000, validFrom: at("2026-09-25T10:00:00Z"), supersededAt: null };
  const w = build({ goals: [old, cur], logs: [log("2026-09-20", { calories: 2400 }), log("2026-10-02", { calories: 2000 })] });
  assert.equal(w.targetChangedInWindow, true);
  assert.equal(w.adherence.calories?.averageTarget, 2200); // (2400 + 2000) / 2 — each day vs its own target
  assert.equal(w.adherence.calories?.averageDelta, 0);
  assert.equal((w.activeTarget as any).goalId, "new");
});
