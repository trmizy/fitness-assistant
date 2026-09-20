/**
 * WB-14 — the sentences and picks behind the beginner nutrition card. Fixtures are the real
 * `dailySummary` and `/nutrition/food-suggestions` answers for john.doe captured 2026-09-18.
 *
 * Runs with: npx tsx --test src/features/__tests__/foodSuggestions.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SUBSTITUTE_MODES,
  SUBSTITUTE_MODE_LABEL,
  canSuggest,
  effectiveItems,
  itemKey,
  itemLine,
  normalizeBudgetLevel,
  normalizeRegion,
  regionToSend,
  remainingSentence,
  summaryProgress,
} from "../nutrition/foodSuggestions";

const fresh = {
  targetCalories: 2000,
  targetProtein: 150,
  targetCarbs: 200,
  targetFat: 65,
  consumedCalories: 0,
  consumedProtein: 0,
  consumedCarbs: 0,
  consumedFat: 0,
  remainingCalories: 2000,
  remainingProtein: 150,
  remainingCarbs: 200,
  remainingFat: 65,
};

const optionA = {
  label: "Phương án A",
  items: [
    { foodId: "1d69f529", foodName: "Fish, catfish, NFS", quantityG: 250, calories: 638, protein: 33.8, carbs: 29.3, fat: 41.8 },
    { foodId: "e3fd51ec", foodName: "Rice, white, long-grain, regular, cooked, enriched, with salt", quantityG: 300, calories: 390, protein: 8.1, carbs: 84.6, fat: 0.9 },
  ],
  sideNote: "rau xanh tùy thích",
  totalCalories: 1028,
  totalProtein: 41.9,
  totalCarbs: 113.9,
  totalFat: 42.7,
};

describe("summaryProgress", () => {
  it("is a 0..1 share of the target, clamped", () => {
    const p = summaryProgress({ ...fresh, consumedCalories: 500, consumedProtein: 300, remainingProtein: -150 });
    assert.equal(p.calories, 0.25);
    assert.equal(p.protein, 1);
    assert.equal(p.overCalories, false);
    assert.equal(p.overProtein, true);
  });

  it("does not divide by a zero target", () => {
    const p = summaryProgress({ ...fresh, targetCalories: 0, targetProtein: 0 });
    assert.equal(p.calories, 0);
    assert.equal(p.protein, 0);
  });
});

describe("remainingSentence", () => {
  it("states calories and missing protein when both are left", () => {
    assert.equal(remainingSentence(fresh), "Bạn còn khoảng 2.000 kcal và thiếu khoảng 150g protein.");
  });

  it("drops the protein clause at 5 g or less", () => {
    assert.equal(
      remainingSentence({ ...fresh, remainingCalories: 420.4, remainingProtein: 5 }),
      "Bạn còn khoảng 420 kcal.",
    );
  });

  it("congratulates once calories are passed — and, like web, still appends missing protein", () => {
    assert.equal(
      remainingSentence({ ...fresh, remainingCalories: -80, remainingProtein: 30 }),
      "Bạn đã đạt mục tiêu calories hôm nay 🎉 và thiếu khoảng 30g protein.",
    );
    assert.equal(
      remainingSentence({ ...fresh, remainingCalories: -80, remainingProtein: -3 }),
      "Bạn đã đạt mục tiêu calories hôm nay 🎉.",
    );
  });
});

describe("canSuggest", () => {
  it("offers suggestions until calories are passed, exactly at zero included", () => {
    assert.equal(canSuggest(fresh), true);
    assert.equal(canSuggest({ ...fresh, remainingCalories: 0 }), true);
    assert.equal(canSuggest({ ...fresh, remainingCalories: -1 }), false);
  });
});

describe("effectiveItems", () => {
  it("returns the server's items when nothing was swapped", () => {
    assert.deepEqual(effectiveItems(optionA, {}), optionA.items);
  });

  it("puts a pick in its own slot only, and ignores picks made on another option", () => {
    const tofu = { foodId: "3eea8ee5", foodName: "Tofu, raw, firm", quantityG: 250, calories: 360, protein: 43.3, carbs: 7, fat: 20 };
    const out = effectiveItems(optionA, {
      [itemKey("Phương án A", 0)]: tofu,
      [itemKey("Phương án B", 1)]: tofu,
    });
    assert.equal(out[0], tofu);
    assert.equal(out[1], optionA.items[1]);
  });
});

describe("itemLine", () => {
  it("rounds grams and protein the way web prints them", () => {
    assert.deepEqual(itemLine(optionA.items[0]), {
      name: "250g Fish, catfish, NFS",
      meta: "638 kcal · 34g đạm",
    });
  });
});

describe("substitute modes", () => {
  it("offers the four modes the backend accepts, in web's order and wording", () => {
    assert.deepEqual([...SUBSTITUTE_MODES], ["REPLACE", "CHEAPER", "HIGHER_PROTEIN", "VEGETARIAN"]);
    assert.deepEqual(SUBSTITUTE_MODES.map((m) => SUBSTITUTE_MODE_LABEL[m]), [
      "Món khác",
      "Rẻ hơn",
      "Nhiều đạm hơn",
      "Món chay",
    ]);
  });
});

describe("profile preferences", () => {
  it("defaults an unset or unknown budget to NORMAL, as the backend does", () => {
    assert.equal(normalizeBudgetLevel(null), "NORMAL");
    assert.equal(normalizeBudgetLevel("cheap"), "NORMAL");
    assert.equal(normalizeBudgetLevel("LOW"), "LOW");
    assert.equal(normalizeBudgetLevel("FLEXIBLE"), "FLEXIBLE");
  });

  it("reads only the three regions", () => {
    assert.equal(normalizeRegion("NAM"), "NAM");
    assert.equal(normalizeRegion(undefined), null);
    assert.equal(normalizeRegion("SOUTH"), null);
  });

  it("never sends a region clear — PUT /profile/me answers 400 to region: null", () => {
    assert.equal(regionToSend(null, "BAC"), "BAC");
    assert.equal(regionToSend("BAC", "NAM"), "NAM");
    assert.equal(regionToSend("NAM", "NAM"), null);
  });
});
