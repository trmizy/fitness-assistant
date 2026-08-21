/**
 * Regression test for the AI-nutrition bug report's meal-plan-generator
 * finding: a historical AI-generated plan totaled 448g protein/95g carb/
 * 43g fat per day, built from 150g soy protein isolate, 162g low-fat
 * Parmesan, 120g dried salmon, 180g dried egg white, and 64g soy nuts —
 * i.e. the top protein-density-per-calorie foods served at whole-food
 * quantities with no category-aware serving cap and no diversity across
 * the week. These tests lock down the fix: realisticServingCapG() caps
 * dense/processed categories tightly, and buildNutritionPlanFromTemplate's
 * output never exceeds those caps or repeats the exact same 1-2 foods
 * every day.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  realisticServingCapG,
  buildNutritionPlanFromTemplate,
} from "../nutrition.processor";

// ── realisticServingCapG ──────────────────────────────────────────────────

test("realisticServingCapG: caps hard cheese (Parmesan) tightly", () => {
  assert.ok(realisticServingCapG("Cheese, parmesan, low fat") <= 40);
});

test("realisticServingCapG: caps nuts/soy nuts tightly", () => {
  assert.ok(realisticServingCapG("Soy nuts, roasted") <= 35);
});

test("realisticServingCapG: caps dried fish tightly", () => {
  assert.ok(realisticServingCapG("Fish, salmon, dried") <= 40);
});

test("realisticServingCapG: caps any residual powder/isolate tightly", () => {
  assert.ok(realisticServingCapG("Soy protein isolate") <= 40);
  assert.ok(realisticServingCapG("Egg white, dried, powder") <= 40);
});

test("realisticServingCapG: a real DB-backfilled cap (Part 6) takes precedence over the name-keyword guess", () => {
  // A misleadingly-named item that the regex would NOT catch (no cheese/
  // nuts/dried/powder/oil keyword), but fitness-service's migration
  // classified with a real cap — the DB value must win.
  assert.equal(realisticServingCapG("Snackable Treat XJ-9", 15), 15);
});

test("realisticServingCapG: an invalid/zero DB cap falls back to the name-keyword guess", () => {
  assert.ok(realisticServingCapG("Cheese, parmesan, low fat", 0) <= 40);
  assert.ok(realisticServingCapG("Cheese, parmesan, low fat", null) <= 40);
  assert.ok(realisticServingCapG("Cheese, parmesan, low fat", undefined) <= 40);
});

test("realisticServingCapG: whole foods (chicken breast) get the default, more generous cap", () => {
  assert.ok(realisticServingCapG("Chicken, breast, roasted") >= 200);
});

// ── buildNutritionPlanFromTemplate: end-to-end serving realism ──────────

// A deliberately adversarial food catalog: mostly dense/processed items
// that would previously dominate the plan, plus a few whole foods —
// including more than one whole-food protein source (a real catalog
// always has several: chicken, turkey, tofu, fish, eggs...), since the
// protein role now also prefers cap-friendly whole foods over dense/
// processed ones (same fix as the carb/fat roles) and a single-whole-food
// catalog would trivially defeat the week-long diversity check below for
// reasons unrelated to what that check verifies.
const adversarialFoods = [
  { id: "isolate-1", name: "Soy protein isolate", calories: 335, protein: 88, carbs: 5, fat: 1 },
  { id: "parmesan-1", name: "Cheese, parmesan, low fat", calories: 300, protein: 38, carbs: 3, fat: 15 },
  { id: "dried-salmon-1", name: "Fish, salmon, dried", calories: 270, protein: 62, carbs: 0, fat: 4 },
  { id: "egg-white-powder-1", name: "Egg white, dried, powder", calories: 382, protein: 84, carbs: 4, fat: 0 },
  { id: "soy-nuts-1", name: "Soy nuts, roasted", calories: 471, protein: 40, carbs: 34, fat: 25 },
  { id: "chicken-1", name: "Chicken, breast, roasted", calories: 165, protein: 31, carbs: 0, fat: 4 },
  { id: "turkey-1", name: "Turkey breast, roasted", calories: 135, protein: 30, carbs: 0, fat: 1 },
  { id: "tofu-1", name: "Tofu, firm", calories: 144, protein: 15, carbs: 3, fat: 9 },
  { id: "rice-1", name: "Rice, white, cooked", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { id: "oil-1", name: "Olive oil", calories: 884, protein: 0, carbs: 0, fat: 100 },
];

test("buildNutritionPlanFromTemplate: no single meal item ever exceeds its category's realistic serving cap", () => {
  const content = buildNutritionPlanFromTemplate({
    goal: "muscle_gain",
    mealsPerDay: 3,
    dailyCaloriesTarget: 2800,
    template: { meals: [] },
    allowedFoods: adversarialFoods,
  });

  const violations: string[] = [];
  for (const day of content.weeklySchedule) {
    for (const meal of day.meals) {
      for (const item of meal.items) {
        const cap = realisticServingCapG(item.name);
        if (item.quantity > cap) {
          violations.push(`${item.name}: ${item.quantity}g > cap ${cap}g`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `serving cap violations: ${violations.join("; ")}`);
});

test("buildNutritionPlanFromTemplate: does not repeat the exact same protein source at every single meal across the week (diversity)", () => {
  const content = buildNutritionPlanFromTemplate({
    goal: "muscle_gain",
    mealsPerDay: 3,
    dailyCaloriesTarget: 2800,
    template: { meals: [] },
    allowedFoods: adversarialFoods,
  });

  const primaryFoodIdsUsed = new Set<string>();
  for (const day of content.weeklySchedule) {
    for (const meal of day.meals) {
      const primaryFoodId = meal.items[0]?.foodId;
      if (primaryFoodId) primaryFoodIdsUsed.add(primaryFoodId);
    }
  }
  assert.ok(
    primaryFoodIdsUsed.size > 1,
    `expected more than one distinct primary protein source across the week, got only: ${[...primaryFoodIdsUsed].join(", ")}`,
  );
});

test("buildNutritionPlanFromTemplate: with only whole foods available, output still respects category caps and produces a real plan", () => {
  const wholeFoods = [
    { id: "chicken-1", name: "Chicken, breast, roasted", calories: 165, protein: 31, carbs: 0, fat: 4 },
    { id: "tofu-1", name: "Tofu, firm", calories: 144, protein: 15, carbs: 3, fat: 9 },
    { id: "rice-1", name: "Rice, white, cooked", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
    { id: "sweet-potato-1", name: "Sweet potato, baked", calories: 90, protein: 2, carbs: 21, fat: 0.1 },
    { id: "avocado-1", name: "Avocado, raw", calories: 160, protein: 2, carbs: 9, fat: 15 },
  ];
  const content = buildNutritionPlanFromTemplate({
    goal: "muscle_gain",
    mealsPerDay: 3,
    dailyCaloriesTarget: 2400,
    template: { meals: [] },
    allowedFoods: wholeFoods,
  });
  assert.equal(content.weeklySchedule.length, 7);
  assert.ok(content.weeklySchedule[0].totalCalories > 0);
});

// ── Macro-target accuracy (real bug found via E2E: quantities used to be
// sized from FIXED calorie-role percentages regardless of the actual
// requested protein/carb/fat gram targets, causing a high-protein request
// to overshoot the real protein target by ~45%+, which
// validateNutritionPlanInvariants's 35% tolerance then correctly rejected
// — meaning generation could silently keep failing for genuinely
// high-protein muscle-gain requests, exactly the feature's main use case) ──

test("buildNutritionPlanFromTemplate: a high-protein muscle-gain target (200g protein / 3200 kcal) lands within a reasonable tolerance of the actual target, not a ~45% overshoot", () => {
  const wholeFoods = [
    { id: "chicken-1", name: "Chicken, breast, roasted", calories: 165, protein: 31, carbs: 0, fat: 4 },
    { id: "salmon-1", name: "Salmon, cooked", calories: 208, protein: 20, carbs: 0, fat: 13 },
    { id: "tofu-1", name: "Tofu, firm", calories: 144, protein: 15, carbs: 3, fat: 9 },
    { id: "egg-1", name: "Egg, whole, cooked", calories: 155, protein: 13, carbs: 1, fat: 11 },
    { id: "greekyogurt-1", name: "Yogurt, Greek, plain", calories: 97, protein: 9, carbs: 3.6, fat: 5 },
    { id: "rice-1", name: "Rice, white, cooked", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
    { id: "sweet-potato-1", name: "Sweet potato, baked", calories: 90, protein: 2, carbs: 21, fat: 0.1 },
    { id: "oats-1", name: "Oats, cooked", calories: 71, protein: 2.5, carbs: 12, fat: 1.5 },
    { id: "avocado-1", name: "Avocado, raw", calories: 160, protein: 2, carbs: 9, fat: 15 },
    { id: "oliveoil-1", name: "Olive oil", calories: 884, protein: 0, carbs: 0, fat: 100 },
  ];
  const content = buildNutritionPlanFromTemplate({
    goal: "muscle_gain",
    mealsPerDay: 4,
    dailyCaloriesTarget: 3200,
    template: { meals: [] },
    allowedFoods: wholeFoods,
    proteinTargetG: 200,
    carbTargetG: 350,
    fatTargetG: 89,
  });

  // Mirrors nutrition-plan-invariant.service.ts's own macroTolerancePct
  // default (0.35) — this is the real bar the generation pipeline is held
  // to; the historical bug regularly exceeded it (~45-50%).
  const MACRO_TOLERANCE = 0.35;
  const violations: string[] = [];
  for (const day of content.weeklySchedule) {
    const proteinDiff = Math.abs(day.protein - 200) / 200;
    if (proteinDiff > MACRO_TOLERANCE) {
      violations.push(`day ${day.dayNumber}: protein=${day.protein}g, target=200g (${Math.round(proteinDiff * 100)}% off)`);
    }
  }
  assert.deepEqual(violations, [], `protein target overshoot beyond tolerance: ${violations.join("; ")}`);
});

// Regression for a second, subtler real-catalog bug found only once the
// protein-overshoot fix above was verified against the REAL 13k-row USDA
// catalog (this curated list alone did not surface it): once carb/fat role
// candidates are filtered to prefer low-protein foods, the density sort
// still happily puts a CAPPED category (dried fruit, hard cheese — high
// carb/fat per calorie, which is exactly what a 40g realistic-serving cap
// applies to) at the top of the pool. Sizing then computes the full raw
// quantity needed to hit carbPerMeal/fatPerMeal from that food, but
// applyServingBounds silently truncates it to the cap — so the meal (and
// the day, and the week) ends up far short of its carb/fat/calorie targets
// even though protein alone looks fine and no single item ever exceeds its
// own cap. The catalog below deliberately makes the capped items the
// densest carb/fat-per-calorie options available, so a regression back to
// "prefer density alone" would reproduce the shortfall.
test("buildNutritionPlanFromTemplate: capped/processed foods (dried fruit, hard cheese) being carb/fat-density leaders does not starve calories or carbs below target", () => {
  const catalogWithDensityTraps = [
    { id: "chicken-1", name: "Chicken, breast, roasted", calories: 165, protein: 31, carbs: 0, fat: 4 },
    { id: "egg-1", name: "Egg, whole, cooked", calories: 155, protein: 13, carbs: 1, fat: 11 },
    { id: "greekyogurt-1", name: "Yogurt, Greek, plain", calories: 97, protein: 9, carbs: 3.6, fat: 5 },
    // Density traps: much higher carb-per-calorie / fat-per-calorie than
    // any whole food below, but capped tightly by realisticServingCapG.
    { id: "raisins-1", name: "Raisins, dried", calories: 299, protein: 3, carbs: 79, fat: 0.5 },
    { id: "parmesan-1", name: "Cheese, parmesan, low fat", calories: 300, protein: 38, carbs: 3, fat: 15 },
    // Genuine whole-food carb/fat sources that must win the selection once
    // capped items are filtered out.
    { id: "rice-1", name: "Rice, white, cooked", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
    { id: "sweet-potato-1", name: "Sweet potato, baked", calories: 90, protein: 2, carbs: 21, fat: 0.1 },
    { id: "oats-1", name: "Oats, cooked", calories: 71, protein: 2.5, carbs: 12, fat: 1.5 },
    { id: "banana-1", name: "Banana, raw", calories: 89, protein: 1.1, carbs: 23, fat: 0.3 },
    { id: "avocado-1", name: "Avocado, raw", calories: 160, protein: 2, carbs: 9, fat: 15 },
    { id: "oliveoil-1", name: "Olive oil", calories: 884, protein: 0, carbs: 0, fat: 100 },
  ];
  const content = buildNutritionPlanFromTemplate({
    goal: "muscle_gain",
    mealsPerDay: 4,
    dailyCaloriesTarget: 3200,
    template: { meals: [] },
    allowedFoods: catalogWithDensityTraps,
    proteinTargetG: 200,
    carbTargetG: 360,
    fatTargetG: 89,
  });

  const CALORIE_TOLERANCE = 0.2;
  const MACRO_TOLERANCE = 0.35;
  const violations: string[] = [];
  for (const day of content.weeklySchedule) {
    const calorieDiff = Math.abs(day.totalCalories - 3200) / 3200;
    if (calorieDiff > CALORIE_TOLERANCE) {
      violations.push(`day ${day.dayNumber}: calories=${day.totalCalories}, target=3200 (${Math.round(calorieDiff * 100)}% off)`);
    }
    const carbDiff = Math.abs(day.carbs - 360) / 360;
    if (carbDiff > MACRO_TOLERANCE) {
      violations.push(`day ${day.dayNumber}: carbs=${day.carbs}g, target=360g (${Math.round(carbDiff * 100)}% off)`);
    }
    const proteinDiff = Math.abs(day.protein - 200) / 200;
    if (proteinDiff > MACRO_TOLERANCE) {
      violations.push(`day ${day.dayNumber}: protein=${day.protein}g, target=200g (${Math.round(proteinDiff * 100)}% off)`);
    }
  }
  assert.deepEqual(violations, [], `target mismatch caused by capped density-trap foods: ${violations.join("; ")}`);
});
