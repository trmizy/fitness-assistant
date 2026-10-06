/**
 * 14B.3 — today's meal plan rules (web NutritionPage), pinned.
 *
 * Chạy: npx tsx --test src/features/__tests__/mealPlan.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  amountCompletion,
  canDeletePlanMeal,
  dayFeedback,
  logEditPayload,
  mealLocked,
  partialPreview,
  percentCompletion,
  planIsActiveForDate,
  planItemPayload,
  planMealFor,
  scaledItemPatch,
  weeklyCalories,
} from "../nutrition/mealPlan";

// Shape fitness-service really returned on 4/10 for GET /nutrition/daily-task (trimmed).
const dailyTask = {
  hasProgram: true,
  day: { id: "d1", dayNumber: 1 },
  meals: [
    {
      id: "m-breakfast",
      mealType: "BREAKFAST",
      title: "Bữa sáng",
      completion: null,
      items: [
        {
          id: "i1",
          sourceType: "PLAN_ITEM",
          programMealItemId: "i1",
          logItemId: null,
          foodName: "Chuối",
          quantity: 120,
          unit: "g",
          calories: 107,
          proteinGrams: 1.3,
          carbGrams: 27.4,
          fatGrams: 0.4,
          food: { calories: 89, protein: 1.1, carbs: 22.8, fats: 0.3 },
        },
      ],
    },
    { id: "m-lunch", mealType: "LUNCH", completion: { status: "PARTIAL", percentConsumed: 75 }, items: [] },
  ],
};

describe("plan meals", () => {
  it("only when the program covers the date", () => {
    assert.equal(planIsActiveForDate(dailyTask), true);
    assert.equal(planIsActiveForDate({ ...dailyTask, outOfRange: true }), false);
    assert.equal(planIsActiveForDate({ hasProgram: false }), false);
    assert.equal(planMealFor({ ...dailyTask, day: null }, "breakfast"), null);
  });

  it("finds a meal by type and normalizes items", () => {
    const b = planMealFor(dailyTask, "breakfast")!;
    assert.equal(b.id, "m-breakfast");
    assert.equal(b.items[0].protein, 1.3);
    assert.deepEqual(b.items[0].per100g, { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3 });
    assert.equal(planMealFor(dailyTask, "lunch")!.completion?.percentConsumed, 75);
    assert.equal(planMealFor(dailyTask, "dinner"), null);
  });

  it("eaten meals are locked and cannot be deleted; pending / skipped can", () => {
    assert.equal(mealLocked("COMPLETED"), true);
    assert.equal(mealLocked("PARTIAL"), true);
    assert.equal(canDeletePlanMeal("PENDING"), true);
    assert.equal(canDeletePlanMeal("SKIPPED"), true);
    assert.equal(canDeletePlanMeal("PARTIAL"), false);
  });
});

describe("quantity edit rescales macros (web sends the quantity alone)", () => {
  it("from the catalog's per-100 g values — the real banana 120 g → 150 g edit", () => {
    const item = planMealFor(dailyTask, "breakfast")!.items[0];
    assert.deepEqual(scaledItemPatch(item, 150), { quantity: 150, calories: 134, protein: 1.7, carbs: 34.2, fat: 0.5 });
  });
  it("proportionally when no catalog food, quantity alone when nothing to scale from", () => {
    const base = { id: "x", sourceType: "PLAN_ITEM", programMealItemId: "x", logItemId: null, foodName: "Tự nhập", unit: "g", calories: 200, protein: 10, carbs: 20, fat: 5, per100g: null };
    assert.deepEqual(scaledItemPatch({ ...base, quantity: 100 }, 50), { quantity: 50, calories: 100, protein: 5, carbs: 10, fat: 2.5 });
    assert.deepEqual(scaledItemPatch({ ...base, quantity: null }, 50), { quantity: 50 });
  });
});

describe("partial completion (web's two modes)", () => {
  const planned = { calories: 543, protein: 54.3, carbs: 63.6, fat: 6.4 };
  it("percent mode: preview and status (exactly 100 = completed)", () => {
    assert.deepEqual(partialPreview(planned, 50), { calories: 272, protein: 27.2, carbs: 31.8, fat: 3.2 });
    assert.deepEqual(percentCompletion("75"), { status: "PARTIAL", pct: 75 });
    assert.deepEqual(percentCompletion("100"), { status: "COMPLETED", pct: 100 });
    assert.deepEqual(percentCompletion("125"), { status: "PARTIAL", pct: 125 });
    assert.deepEqual(percentCompletion(""), { status: "PARTIAL", pct: 50 });
  });
  it("amount mode: calories required; ≥100% of plan counts as completed", () => {
    assert.equal(amountCompletion(543, { calories: "", protein: "", carbs: "", fat: "" }), null);
    assert.deepEqual(amountCompletion(543, { calories: "300", protein: "20", carbs: "", fat: "" }), {
      status: "PARTIAL",
      pct: 55,
      overrideCalories: 300,
      overrideProtein: 20,
      overrideCarbs: undefined,
      overrideFat: undefined,
    });
    assert.equal(amountCompletion(543, { calories: "600", protein: "", carbs: "", fat: "" })!.status, "COMPLETED");
  });
});

describe("bodies sent to the server", () => {
  it("add item: catalog food scaled from per-100 g", () => {
    assert.deepEqual(planItemPayload({ id: "f1", calories: 120, protein: 0.8, carbs: 13.2, fats: 7.1 }, 100), {
      foodId: "f1",
      quantity: 100,
      unit: "g",
      calories: 120,
      protein: 0.8,
      carbs: 13.2,
      fat: 7.1,
    });
  });
  it("log edit: web's checks, fat → fats", () => {
    const form = { mealType: "snack" as const, foodName: " Chuối ", quantity: "", calories: "95", protein: "1", carbs: "21.3", fat: "0.2", notes: "100g" };
    const ok = logEditPayload(form);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.body.foodName, "Chuối");
      assert.equal(ok.body.fats, 0.2);
      assert.equal(ok.body.quantity, undefined);
    }
    assert.deepEqual(logEditPayload({ ...form, foodName: " " }), { ok: false, error: "Tên thực phẩm không được để trống" });
    assert.deepEqual(logEditPayload({ ...form, calories: "" }), { ok: false, error: "Calories không hợp lệ" });
    assert.deepEqual(logEditPayload({ ...form, protein: "-1" }), { ok: false, error: "Giá trị macro phải >= 0" });
  });
});

describe("day feedback (web's rules, max 2)", () => {
  const goal = { calories: 2000, protein: 150, fat: 65 };
  const t = (calories: number, protein: number, fat: number) => ({ calories, protein, carbs: 0, fat });
  it("nothing without a goal or logs", () => {
    assert.deepEqual(dayFeedback(goal, t(100, 1, 0), false), []);
    assert.deepEqual(dayFeedback(null, t(100, 1, 0), true), []);
  });
  it("low protein (the emulator's real day: 95 kcal, 1 g protein)", () => {
    assert.deepEqual(dayFeedback(goal, t(95, 1, 0.2), true).map((f) => f.text), [
      "Protein hôm nay còn thấp, bạn nên bổ sung thêm thực phẩm giàu protein.",
    ]);
  });
  it("over calories + high fat, capped at two", () => {
    const out = dayFeedback(goal, t(2400, 100, 90), true);
    assert.equal(out.length, 2);
    assert.match(out[0].text, /vượt mục tiêu calories/);
  });
  it("on target is a success line", () => {
    assert.deepEqual(dayFeedback(goal, t(2000, 150, 60), true), [{ tone: "success", text: "Dinh dưỡng hôm nay khá ổn so với mục tiêu của bạn." }]);
  });
});

describe("weeklyCalories", () => {
  it("seven local days ending today, oldest first", () => {
    const logs = [
      { id: "a", date: "2026-10-04T09:58:08.695Z", mealType: "snack" as const, foodName: "x", calories: 95, protein: 0, carbs: 0, fat: 0, notes: null },
      { id: "b", date: "2026-09-29T08:00:00.000Z", mealType: "lunch" as const, foodName: "y", calories: 500, protein: 0, carbs: 0, fat: 0, notes: null },
    ];
    const week = weeklyCalories(logs, new Date(2026, 9, 4, 12));
    assert.deepEqual(week.map((d) => d.day), ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]);
    assert.equal(week[6].calories, 95);
    assert.equal(week[1].calories, 500);
    assert.equal(week[0].key, "2026-09-28");
  });
});
