/**
 * SH-13 / SH-16 pure parts. The food fixtures are shaped like real `/food` rows (USDA names and
 * all); the articles are the real static library copied from web.
 *
 * Runs with: npx tsx --test src/features/__tests__/libraryContent.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FOOD_SORTS,
  caloriesLabel,
  foodSubtitle,
  foodTotalPages,
  gramLabel,
  macroRatio,
  normalizeFood,
  normalizeFoods,
} from "../library/foodLibrary";
import {
  NUTRITION_ARTICLES,
  categoryLabel,
  findArticle,
  searchArticles,
  totalReadMinutes,
} from "../library/nutritionArticles";

const oats = {
  id: "f1",
  name: "Oats, raw",
  calories: 389,
  protein: 16.9,
  carbs: 66.3,
  fats: 6.9,
  imageUrl: null,
  source: "sr_legacy",
  foodForm: "whole",
  isSupplement: false,
};

describe("normalizeFood", () => {
  it("keeps the catalog's own decimals — these are measurements, not estimates", () => {
    const food = normalizeFood(oats);
    assert.equal(food.protein, 16.9);
    assert.equal(food.calories, 389);
    assert.equal(food.isSupplement, false);
  });

  it("reads `fats`, and tolerates a row spelling it `fat`", () => {
    assert.equal(normalizeFood({ fats: 5 }).fats, 5);
    assert.equal(normalizeFood({ fat: 7 }).fats, 7);
    assert.equal(normalizeFood({}).fats, 0, "a missing macro is zero, not NaN");
  });
});

describe("normalizeFoods / foodTotalPages", () => {
  it("takes the bare array from search and the wrapped page from browse", () => {
    assert.equal(normalizeFoods([oats, oats]).length, 2);
    assert.equal(normalizeFoods({ foods: [oats] }).length, 1);
    assert.deepEqual(normalizeFoods(null), []);
  });

  it("works out the page count from the server's own total", () => {
    assert.equal(foodTotalPages({ pagination: { total: 13159 } }, 20), 658);
    assert.equal(foodTotalPages({ pagination: { total: 20 } }, 20), 1);
    assert.equal(foodTotalPages({}, 20), 1, "no total → one page, never zero");
  });
});

describe("macroRatio", () => {
  it("splits by grams, the way the design's bar reads", () => {
    const slices = macroRatio(normalizeFood(oats));
    const total = 16.9 + 66.3 + 6.9;
    assert.equal(slices.length, 3);
    assert.equal(slices[0].key, "protein");
    assert.equal(slices[0].pct, Math.round((16.9 / total) * 1000) / 10);
    assert.equal(Math.round(slices.reduce((s, x) => s + x.pct, 0)), 100);
  });

  it("a food with no macros at all leaves the bar empty instead of dividing by zero", () => {
    const slices = macroRatio(normalizeFood({ id: "water", name: "Nước", calories: 0 }));
    assert.deepEqual(slices.map((s) => s.pct), [0, 0, 0]);
  });
});

describe("labels", () => {
  it("keeps one decimal on grams and rounds calories to a whole number", () => {
    assert.equal(gramLabel(16.94), "16.9g");
    assert.equal(gramLabel(7), "7g");
    assert.equal(caloriesLabel(388.6), "389 kcal");
  });

  it("builds a subtitle from what the row actually has", () => {
    assert.equal(foodSubtitle(normalizeFood(oats)), "389 kcal · whole");
    assert.equal(
      foodSubtitle(normalizeFood({ ...oats, foodForm: "powder", isSupplement: true })),
      "389 kcal · powder · supplement",
    );
    assert.equal(foodSubtitle(normalizeFood({ calories: 100 })), "100 kcal");
  });

  it("offers exactly the four sorts the endpoint supports", () => {
    assert.deepEqual(FOOD_SORTS.map((s) => s.value), ["name", "protein", "carbs", "fats"]);
  });
});

describe("nutrition articles", () => {
  it("ships the whole static library, not a sample", () => {
    assert.equal(NUTRITION_ARTICLES.length, 12, "12 bài: calo, 3 macro, BMR, TDEE, thâm hụt, thặng dư, đạm×2, nước, thời điểm ăn");
    assert.ok(NUTRITION_ARTICLES.every((a) => a.slug && a.title && a.sections.length > 0));
  });

  it("finds an article by slug, and answers null for one that does not exist", () => {
    assert.equal(findArticle("calories")?.title, "Calo");
    assert.equal(findArticle("khong-co-bai-nay"), null);
    assert.equal(findArticle(undefined), null);
  });

  it("searches titles, summaries and section bodies — web's own matcher", () => {
    assert.ok(searchArticles("calo").length > 0);
    assert.equal(searchArticles("").length, NUTRITION_ARTICLES.length, "empty query → everything");
    assert.equal(searchArticles("zzzz không tồn tại").length, 0);
    // A word that only appears inside a section body still finds its article.
    const bodyWord = NUTRITION_ARTICLES[0].sections[0].body.split(" ")[0];
    assert.ok(searchArticles(bodyWord).length > 0);
  });

  it("names the three categories in Vietnamese and passes an unknown one through", () => {
    assert.equal(categoryLabel("basics"), "Cơ bản");
    assert.equal(categoryLabel("performance"), "Hiệu suất");
    assert.equal(categoryLabel("gì đó"), "gì đó");
  });

  it("adds up the reading time for the hub's one-liner", () => {
    assert.equal(
      totalReadMinutes(),
      NUTRITION_ARTICLES.reduce((s, a) => s + a.readMinutes, 0),
    );
    assert.ok(totalReadMinutes() > 0);
  });
});
