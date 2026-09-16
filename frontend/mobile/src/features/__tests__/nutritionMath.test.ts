/**
 * CL-03/CL-19 arithmetic. Every case below is pinned to something the real backend does — the
 * fixtures are a real `POST /nutrition` response captured on 2026-09-16, not invented shapes.
 *
 * Runs with: npx tsx --test src/features/__tests__/nutritionMath.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MACRO_CALORIE_TOLERANCE_KCAL,
  buildLogPayload,
  goalProgress,
  groupByMeal,
  isValidQuantity,
  macroCalories,
  macroConsistency,
  normalizeLog,
  normalizeLogs,
  scaleFood,
  sumTotals,
} from "../nutrition/nutritionMath";

/** Verbatim from `GET /nutrition` for john.doe — note the field is `fats`, and there is no `fat`. */
const realLog = {
  id: "f94b669a-15ab-49a7-9381-8c1848f06cc1",
  userId: "68aca044-a454-4434-9206-c8a43702f664",
  date: "2026-09-16T06:16:56.005Z",
  mealType: "breakfast",
  foodName: "KIEM THU Phase 6 - yen mach",
  calories: 350,
  protein: 12,
  carbs: 58,
  fats: 7,
  notes: null,
};

describe("normalizeLog", () => {
  it("reads the API's `fats` — the bug that silently zeroes web's fat total", () => {
    const log = normalizeLog(realLog);
    assert.equal(log.fat, 7);
    assert.equal(log.calories, 350);
    assert.equal(log.protein, 12);
    assert.equal(log.carbs, 58);
    assert.equal(log.mealType, "breakfast");
  });

  it("still accepts a row that spells it `fat`", () => {
    assert.equal(normalizeLog({ ...realLog, fats: undefined, fat: 9 }).fat, 9);
  });

  it("a missing macro is zero, not NaN — the API omits macros that were never logged", () => {
    const log = normalizeLog({ id: "x", mealType: "lunch", foodName: "Cơm", calories: 200 });
    assert.equal(log.protein, 0);
    assert.equal(log.carbs, 0);
    assert.equal(log.fat, 0);
    assert.equal(log.notes, null);
  });

  it("an unknown meal type falls back to snack rather than dropping the row", () => {
    assert.equal(normalizeLog({ mealType: "brunch" }).mealType, "snack");
  });
});

describe("normalizeLogs", () => {
  it("takes the list endpoint's bare array and the wrapped shapes alike", () => {
    assert.equal(normalizeLogs([realLog]).length, 1);
    assert.equal(normalizeLogs({ logs: [realLog] }).length, 1);
    assert.equal(normalizeLogs({ data: [realLog, realLog] }).length, 2);
    assert.deepEqual(normalizeLogs(null), []);
    assert.deepEqual(normalizeLogs({ error: "nope" }), []);
  });
});

describe("sumTotals", () => {
  it("adds a day up, fat included", () => {
    const logs = normalizeLogs([
      realLog,
      { ...realLog, id: "2", mealType: "lunch", calories: 680, protein: 45, carbs: 70, fats: 18 },
    ]);
    assert.deepEqual(sumTotals(logs), { calories: 1030, protein: 57, carbs: 128, fat: 25 });
  });

  it("an empty day is zeroes, not an empty object", () => {
    assert.deepEqual(sumTotals([]), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe("groupByMeal", () => {
  it("always returns all four meals so the screen renders empty ones too", () => {
    const groups = groupByMeal(normalizeLogs([realLog]));
    assert.deepEqual(Object.keys(groups), ["breakfast", "lunch", "dinner", "snack"]);
    assert.equal(groups.breakfast.length, 1);
    assert.equal(groups.dinner.length, 0);
  });
});

describe("scaleFood", () => {
  const oats = { id: "f1", name: "Yến mạch", calories: 389, protein: 16.9, carbs: 66.3, fats: 6.9 };

  it("scales per 100g the way web does — whole kcal, one decimal for macros", () => {
    assert.deepEqual(scaleFood(oats, 100), { calories: 389, protein: 16.9, carbs: 66.3, fats: 6.9 });
    assert.deepEqual(scaleFood(oats, 50), { calories: 195, protein: 8.5, carbs: 33.2, fats: 3.5 });
  });

  it("reads `fats` from the catalog, with `fat` as the fallback", () => {
    assert.equal(scaleFood({ calories: 100, fat: 10 }, 100).fats, 10);
  });
});

describe("isValidQuantity", () => {
  it("accepts 1–5000 g and nothing else, matching web's own check", () => {
    assert.equal(isValidQuantity(1), true);
    assert.equal(isValidQuantity(5000), true);
    assert.equal(isValidQuantity(0), false);
    assert.equal(isValidQuantity(5001), false);
    assert.equal(isValidQuantity(NaN), false);
  });
});

describe("buildLogPayload", () => {
  it("omits a zero macro — the endpoint demands a positive number and 400s on 0", () => {
    const payload = buildLogPayload({
      mealType: "snack",
      foodName: "Nước lọc",
      calories: 1,
      protein: 0,
      carbs: 0,
      fats: 0,
    });
    assert.deepEqual(payload, { mealType: "snack", foodName: "Nước lọc", calories: 1 });
    assert.equal("protein" in payload, false);
  });

  it("sends the macros a food actually has, and trims the name", () => {
    assert.deepEqual(
      buildLogPayload({ mealType: "breakfast", foodName: "  Yến mạch  ", calories: 195, protein: 8.5, carbs: 33.2, fats: 3.5 }),
      { mealType: "breakfast", foodName: "Yến mạch", calories: 195, protein: 8.5, carbs: 33.2, fats: 3.5 },
    );
  });

  it("keeps calories a positive integer, since the schema requires one", () => {
    assert.equal(buildLogPayload({ mealType: "lunch", foodName: "x", calories: 0.4 }).calories, 1);
    assert.equal(buildLogPayload({ mealType: "lunch", foodName: "x", calories: 350.6 }).calories, 351);
  });

  it("carries notes and an explicit date only when they are given", () => {
    const bare = buildLogPayload({ mealType: "lunch", foodName: "x", calories: 10, notes: "   " });
    assert.equal("notes" in bare, false);
    assert.equal("date" in bare, false);
    const full = buildLogPayload({ mealType: "lunch", foodName: "x", calories: 10, notes: " ngon ", date: "2026-09-16T00:00:00.000Z" });
    assert.equal(full.notes, "ngon");
    assert.equal(full.date, "2026-09-16T00:00:00.000Z");
  });
});

describe("macroConsistency", () => {
  it("reproduces the backend's own bug-report case: 3000 kcal vs 1985 from macros", () => {
    const check = macroConsistency(3000, 150, 200, 65);
    assert.equal(check.computedCalories, 1985);
    assert.equal(check.consistent, false);
    assert.equal(check.discrepancyKcal, -1015);
  });

  it("passes a self-consistent goal and the backend's rounding slack", () => {
    assert.equal(macroConsistency(1985, 150, 200, 65).consistent, true);
    // 150*4 + 200*4 + 56*9 = 1904 against 1950 → 46 kcal out, inside the ±50 the server allows.
    assert.equal(macroConsistency(1950, 150, 200, 56).consistent, true);
  });

  it("is exactly as strict as the server at the boundary", () => {
    assert.equal(MACRO_CALORIE_TOLERANCE_KCAL, 50);
    // 150*4 + 200*4 + 56*9 = 1904 kcal from the macros.
    assert.equal(macroConsistency(1854, 150, 200, 56).discrepancyKcal, 50);
    assert.equal(macroConsistency(1854, 150, 200, 56).consistent, true, "exactly 50 out still saves");
    assert.equal(macroConsistency(1853, 150, 200, 56).discrepancyKcal, 51);
    assert.equal(macroConsistency(1853, 150, 200, 56).consistent, false, "51 out is refused");
  });
});

describe("macroCalories and goalProgress", () => {
  it("splits a day's calories across the three macros", () => {
    assert.deepEqual(macroCalories({ calories: 1030, protein: 57, carbs: 128, fat: 25 }), {
      protein: 228,
      carbs: 512,
      fat: 225,
    });
  });

  it("a day over target fills the ring instead of wrapping past it", () => {
    assert.equal(goalProgress(1000, 2000), 0.5);
    assert.equal(goalProgress(3000, 2000), 1);
    assert.equal(goalProgress(-5, 2000), 0);
    assert.equal(goalProgress(500, 0), 0, "no goal set yet must not divide by zero");
  });
});
