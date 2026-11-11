/**
 * Diet types (vegetarian / lacto-ovo / vegan) become ENFORCED exclusion keys — found by test/ai-quality-eval PL-B1
 * (2026-11-08): "Tạo thực đơn 4 bữa cho mình, mình ăn chay trứng sữa" produced excludedFoods = [] and a plan with
 * salmon, Wagyu beef and pork cracklings. Pure unit tests (no DB, no LLM).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractNutritionConstraints, foodViolatesExclusions, isKnownExclusionKey } from "../services/nutrition-food-constraints";

const keys = (msg: string) => extractNutritionConstraints(msg).exclusions.map((e) => e.key).sort();

test("'ăn chay trứng sữa' excludes meat and seafood, keeps egg and dairy", () => {
  assert.deepEqual(keys("Tạo thực đơn 4 bữa cho mình, mình ăn chay trứng sữa."), ["meat", "seafood"]);
  assert.deepEqual(keys("Tôi ăn chay"), ["meat", "seafood"]);
  assert.deepEqual(keys("I am vegetarian"), ["meat", "seafood"]);
});

test("'thuần chay' / vegan also excludes egg and dairy", () => {
  assert.deepEqual(keys("Mình ăn thuần chay"), ["dairy", "egg", "meat", "seafood"]);
  assert.deepEqual(keys("vegan meal plan"), ["dairy", "egg", "meat", "seafood"]);
});

test("a negated 'không ăn chay' is not a diet statement; food cues still work alongside a diet", () => {
  assert.deepEqual(keys("Tôi không ăn chay, chỉ không ăn cá"), ["fish"]);
  assert.deepEqual(keys("Mình ăn chay, dị ứng đậu phộng"), ["meat", "peanut", "seafood"]);
});

test("the meat key matches the USDA names seen in the failing plan, and nothing vegetarian", () => {
  assert.equal(isKnownExclusionKey("meat"), true);
  for (const n of ["Beef, Australian, imported, Wagyu, seam fat, Aust. marble score 4/5, raw", "Pork, cracklings", "Chicken, broilers or fryers, breast, meat only, cooked",
    "Turkey, drumstick, from whole bird, meat only, roasted", "Lamb, leg, roasted", "Bologna, beef and pork"]) assert.equal(foodViolatesExclusions(n, ["meat"]), true, n);
  for (const n of ["Tofu, firm", "Eggplant, raw", "Milk, whole", "Egg, whole, cooked", "Lentils, cooked", "Puddings, banana, dry mix", "Spinach dip, regular"]) assert.equal(foodViolatesExclusions(n, ["meat"]), false, n);
  assert.equal(foodViolatesExclusions("Fish, salmon, king, chinook, smoked", ["seafood"]), true);
});

// User test 2026-11-08 ("Điều chỉnh" with "tôi dị ứng với bò" -> the new plan still had beef): filler after the cue and
// clause enders used to drop the allergy silently.
test("natural phrasings of an allergy / exclusion are all recognized", () => {
  const cases: Array<[string, string[]]> = [
    ["tôi dị ứng với bò", ["beef"]], ["Tôi dị ứng với thịt bò", ["beef"]], ["Tôi không ăn được bò", ["beef"]],
    ["mình bị dị ứng thịt bò nên bỏ bò ra", ["beef"]], ["tôi dị ứng với hải sản", ["seafood"]], ["kiêng ăn đậu phộng vì dị ứng", ["peanut"]],
  ];
  for (const [q, want] of cases) assert.deepEqual(keys(q), want, q);
});
