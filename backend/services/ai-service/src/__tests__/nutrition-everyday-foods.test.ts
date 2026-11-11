/**
 * Everyday-meal screen for AI meal-plan foods. Found by test/ai-quality-eval (2026-11-08): plans built from the real USDA
 * slice served "Apples, dehydrated", "Wagyu seam fat, raw", "Puddings, dry mix", "Margarine-like spread" — every invariant
 * passed, only the cross-family judge (Claude Opus 4.6) scored them 1/5. Names below are real catalog rows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isEverydayMealFood, preferEverydayFoods, MIN_EVERYDAY_FOODS } from "../services/nutrition-everyday-foods";

test("non-meal catalog rows seen in the failing plans are screened out", () => {
  for (const n of [
    "Apples, dehydrated (low moisture), sulfured, uncooked", "Marmalade, orange", "Toppings, pineapple", "Puddings, banana, dry mix, regular",
    "Beef, Australian, imported, Wagyu, seam fat, Aust. marble score 4/5, raw", "Margarine-like spread with yogurt, approximately 40% fat, tub, with salt",
    "Salad dressing, mayonnaise, imitation, soybean without cholesterol", "Spinach dip, regular", "Soy flour, defatted", "Soy meal, defatted, raw",
    "Milk, dry, nonfat, calcium reduced", "Cereals ready-to-eat, MALT-O-MEAL, Crispy Rice", "Potato chips, plain", "Pork, cured, separable fat (from ham and arm picnic), unheated",
    "Chicken, skin (drumsticks and thighs), raw", "Egg, yolk only, raw", "Fish, herring eggs, Pacific, dry (Alaska Native)", "Cheese, cream",
    "Pork sausage, link/patty, fully cooked, microwaved", "Cereal or granola bar with nuts, chocolate coated", "Pork, fresh, belly, raw",
  ]) assert.equal(isEverydayMealFood(n), false, n);
});

test("ordinary meal foods stay", () => {
  for (const n of [
    "Turkey, retail parts, breast, meat only, cooked, roasted", "Fish, tuna, yellowfin, fresh, cooked, dry heat", "Rice, white, long-grain, regular, raw, enriched",
    "Rice paper", "Peanuts, dry roasted, salted", "Peanut butter, smooth style, without salt", "Nuts, almonds", "Tofu, raw, firm, prepared with calcium sulfate",
    "Beef, round, top round roast, boneless, separable lean only, trimmed to 0\" fat, select, cooked, roasted", "Chicken, skin not eaten, roasted",
    "Bananas, raw", "Potatoes, boiled, cooked in skin, flesh, without salt", "Yogurt, Greek, plain, nonfat", "Egg, whole, cooked, hard-boiled", "Oats, regular and quick, not fortified, dry",
  ]) assert.equal(isEverydayMealFood(n), true, n);
});

test("the screen never empties a thin catalog (macro accuracy is the hard invariant)", () => {
  const thin = Array.from({ length: MIN_EVERYDAY_FOODS - 1 }, (_, i) => ({ name: `Rice, white, cooked ${i}` }));
  const withOdd = [...thin, { name: "Puddings, rice, dry mix" }];
  const r = preferEverydayFoods(withOdd);
  assert.equal(r.screened, false);
  assert.equal(r.foods.length, withOdd.length);
  const big = [...Array.from({ length: MIN_EVERYDAY_FOODS }, (_, i) => ({ name: `Rice, white, cooked ${i}` })), { name: "Puddings, rice, dry mix" }];
  const r2 = preferEverydayFoods(big);
  assert.equal(r2.screened, true);
  assert.equal(r2.removed, 1);
});

import { catalogTiers, withVietnameseDisplayNames, MIN_CURATED_FOODS } from "../services/nutrition-everyday-foods";
import { findExclusionViolations } from "../services/nutrition-food-constraints";

test("catalog tiers: curated first, each tier a superset of the previous, full list last", () => {
  const curated = Array.from({ length: MIN_CURATED_FOODS }, (_, i) => ({ id: `c${i}`, name: `Rice, white, cooked ${i}`, curated: true }));
  const odd = [{ id: "x", name: "Puddings, rice, dry mix", curated: false }];
  const everyday = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, name: `Chicken, breast, cooked ${i}`, curated: false }));
  const tiers = catalogTiers([...curated, ...everyday, ...odd]);
  assert.deepEqual(tiers.map((t) => t.label), ["curated", "everyday", "full"]);
  for (let i = 1; i < tiers.length; i++) assert.ok(tiers[i - 1].foods.every((f) => tiers[i].foods.includes(f)), `tier ${i} is a superset`);
  assert.deepEqual(catalogTiers(everyday).map((t) => t.label), ["full"], "no curated rows -> previous behaviour");
});

test("Vietnamese display names keep the USDA name and still fail an exclusion check", () => {
  const content = { weeklySchedule: [{ meals: [{ items: [{ foodId: "tofu", name: "Tofu, raw, firm, prepared with calcium sulfate" }, { foodId: "rice", name: "Rice, white, long-grain, regular, enriched, cooked" }] }] }] };
  const shown = withVietnameseDisplayNames(content, [{ id: "tofu", viName: "Đậu phụ (đậu hũ)" }, { id: "rice", viName: "Cơm trắng" }]);
  const items = shown.weeklySchedule[0].meals[0].items as Array<{ name: string; sourceName?: string }>;
  assert.equal(items[0].name, "Đậu phụ (đậu hũ)");
  assert.equal(items[0].sourceName, "Tofu, raw, firm, prepared with calcium sulfate");
  assert.deepEqual(findExclusionViolations(shown, ["soy"]), ["Đậu phụ (đậu hũ)"], "the soy exclusion is still enforced via sourceName");
  assert.deepEqual(findExclusionViolations(shown, ["fish"]), []);
  assert.equal(content.weeklySchedule[0].meals[0].items[0].name, "Tofu, raw, firm, prepared with calcium sulfate", "input not mutated");
});

test("a display word is not an ingredient: 'Rau chân vịt' (spinach) never fails a meat exclusion", () => {
  const content = { weeklySchedule: [{ meals: [{ items: [{ foodId: "sp", name: "Rau chân vịt luộc", sourceName: "Spinach, cooked, boiled, drained, without salt" }] }] }] };
  assert.deepEqual(findExclusionViolations(content, ["meat", "seafood"]), []);
  const duck = { weeklySchedule: [{ meals: [{ items: [{ foodId: "d", name: "Thịt vịt quay", sourceName: "Duck, domesticated, meat only, cooked, roasted" }] }] }] };
  assert.deepEqual(findExclusionViolations(duck, ["meat"]), ["Thịt vịt quay"]);
});

import { buildNutritionPlanFromTemplate } from "../services/nutrition.processor";

// Real USDA macros of the curated rows (per 100 g) with their curated portion caps.
const CURATED = [
  { id: "shrimp", name: "Crustaceans, shrimp, cooked", calories: 99, protein: 24, carbs: 0.2, fat: 0.3, realisticServingMaxG: 200, curated: true, viName: "Tôm luộc" },
  { id: "chicken", name: "Chicken, broilers or fryers, breast, meat only, cooked, roasted", calories: 165, protein: 31, carbs: 0, fat: 3.6, realisticServingMaxG: 200, curated: true, viName: "Ức gà nướng" },
  { id: "rice", name: "Rice, white, long-grain, regular, enriched, cooked", calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, realisticServingMaxG: 350, curated: true, viName: "Cơm trắng" },
  { id: "banana", name: "Bananas, raw", calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3, realisticServingMaxG: 200, curated: true, viName: "Chuối" },
  { id: "oil", name: "Oil, soybean, salad or cooking", calories: 884, protein: 0, carbs: 0, fat: 100, realisticServingMaxG: 15, curated: true, viName: "Dầu đậu nành" },
  { id: "broccoli", name: "Broccoli, cooked, boiled, drained, without salt", calories: 35, protein: 2.4, carbs: 7.2, fat: 0.4, realisticServingMaxG: 250, curated: true, viName: "Bông cải xanh luộc" },
];
const template = { meals: ["BREAKFAST", "LUNCH", "DINNER"].map((mealType) => ({ mealType, title: mealType, items: [] })) } as any;

test("curated catalog: a staple that can deliver the meal's carbs is preferred, and lunch/dinner get a vegetable side", () => {
  const plan = buildNutritionPlanFromTemplate({ goal: "WEIGHT_LOSS", mealsPerDay: 3, dailyCaloriesTarget: 2370, template, allowedFoods: CURATED as any, proteinTargetG: 145, carbTargetG: 299, fatTargetG: 66 });
  const day = plan.weeklySchedule[0];
  for (const meal of day.meals) assert.ok(meal.items.some((i) => i.foodId === "rice"), `${meal.mealType} uses rice (99 g carbs per 350 g), not banana capped at 200 g`);
  for (const meal of day.meals.filter((m) => m.mealType !== "BREAKFAST")) assert.ok(meal.items.some((i) => i.foodId === "broccoli"), `${meal.mealType} has a vegetable side`);
  assert.ok(!day.meals.find((m) => m.mealType === "BREAKFAST")!.items.some((i) => i.foodId === "broccoli"), "no vegetable side at breakfast");
});

test("without curated foods the builder keeps its previous behaviour (no vegetable side added)", () => {
  const plain = CURATED.map(({ curated, viName, ...f }) => f);
  const plan = buildNutritionPlanFromTemplate({ goal: "WEIGHT_LOSS", mealsPerDay: 3, dailyCaloriesTarget: 2370, template, allowedFoods: plain as any, proteinTargetG: 145, carbTargetG: 299, fatTargetG: 66 });
  assert.ok(plan.weeklySchedule.every((d) => d.meals.every((m) => m.items.length <= 3)));
});
