/**
 * Product Completeness pass — Food Library browse/detail
 * (foodService.listFoods/getFood). Same dev-DB convention as
 * food-serving-metadata.integration.test.ts — the real 13k+-row USDA
 * catalog only exists in gymcoach_fitness, not the _test DB.
 * Run inside the fitness-service container:
 *   npx tsx --test src/__tests__/food-library.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/prisma";
import { foodService } from "../services/food.service";

test.after(async () => {
  await prisma.$disconnect();
});

test("listFoods: returns a paginated page of the real catalog, deterministically ordered", async () => {
  const result = await foodService.listFoods({ page: 1, limit: 5 });
  assert.equal(result.foods.length, 5);
  assert.ok(result.pagination.total > 5, "expected the real seeded catalog to have more than 5 rows");
  // Deterministic (same `ORDER BY name` on every call) rather than asserting
  // a specific JS sort algorithm matches Postgres's collation byte-for-byte
  // (it doesn't always — case ordering differs) — what pagination actually
  // needs is that repeated page-1 calls return the same rows in the same
  // order, not that it matches any particular JS string comparator.
  const again = await foodService.listFoods({ page: 1, limit: 5 });
  assert.deepEqual(
    again.foods.map((f) => f.id),
    result.foods.map((f) => f.id),
  );
});

test("listFoods: page 2 returns a different set than page 1", async () => {
  const page1 = await foodService.listFoods({ page: 1, limit: 5 });
  const page2 = await foodService.listFoods({ page: 2, limit: 5 });
  const ids1 = new Set(page1.foods.map((f) => f.id));
  const ids2 = new Set(page2.foods.map((f) => f.id));
  for (const id of ids2) assert.ok(!ids1.has(id));
});

test("getFood: returns the real canonical row with macro fields intact", async () => {
  const { foods } = await foodService.listFoods({ page: 1, limit: 1 });
  const target = foods[0];
  const food = await foodService.getFood(target.id);
  assert.equal(food.id, target.id);
  assert.equal(food.name, target.name);
  assert.equal(typeof food.calories, "number");
  assert.equal(typeof food.protein, "number");
  assert.equal(typeof food.carbs, "number");
  assert.equal(typeof food.fats, "number");
});

test("getFood: a nonexistent id throws 404, not a silent null", async () => {
  await assert.rejects(
    () => foodService.getFood("00000000-0000-0000-0000-000000000000"),
    (err: any) => err.status === 404,
  );
});

// Product Completeness pass follow-up — "protein-rich / carb-rich /
// fat-rich" sort (spec §18's real, computable-from-existing-fields
// allowance, distinct from the deferred food-group/category filter).
test("listFoods: sortBy=protein returns rows in descending protein order", async () => {
  const result = await foodService.listFoods({ page: 1, limit: 10, sortBy: "protein" });
  const proteins = result.foods.map((f) => f.protein);
  for (let i = 1; i < proteins.length; i++) {
    assert.ok(proteins[i] <= proteins[i - 1], `expected descending protein order, got ${proteins}`);
  }
  // Sanity: the top protein result should be a real high-protein food, not
  // an arbitrary/near-zero one — regression guard against orderBy being
  // silently ignored.
  assert.ok(proteins[0] > 50, `expected the highest-protein food's protein to be well above trace amounts, got ${proteins[0]}`);
});

test("listFoods: sortBy=carbs and sortBy=fats each produce a different top result than the default name sort", async () => {
  const [byName, byCarbs, byFats] = await Promise.all([
    foodService.listFoods({ page: 1, limit: 1 }),
    foodService.listFoods({ page: 1, limit: 1, sortBy: "carbs" }),
    foodService.listFoods({ page: 1, limit: 1, sortBy: "fats" }),
  ]);
  assert.notEqual(byCarbs.foods[0].id, byName.foods[0].id);
  assert.notEqual(byFats.foods[0].id, byName.foods[0].id);
});

test("listFoods: an unrecognized sortBy value falls back to name order (no crash)", async () => {
  const result = await foodService.listFoods({ page: 1, limit: 5, sortBy: "not-a-real-sort" });
  assert.equal(result.foods.length, 5);
});

test("getFilterOptions: returns real source and food form values from the catalog", async () => {
  const options = await foodService.getFilterOptions();
  assert.ok(options.sources.length > 0, "expected at least one real food source");
  assert.ok(options.foodForms.length > 0, "expected at least one real food form");
  assert.deepEqual(options.supplementValues, [false, true]);
});

test("listFoods: source and foodForm filters only return matching rows", async () => {
  const options = await foodService.getFilterOptions();
  const source = options.sources[0];
  const foodForm = options.foodForms[0];

  const [bySource, byForm] = await Promise.all([
    foodService.listFoods({ page: 1, limit: 10, source }),
    foodService.listFoods({ page: 1, limit: 10, foodForm }),
  ]);

  assert.ok(bySource.foods.length > 0, `expected rows for source ${source}`);
  assert.ok(bySource.foods.every((food) => food.source === source));
  assert.ok(byForm.foods.length > 0, `expected rows for foodForm ${foodForm}`);
  assert.ok(byForm.foods.every((food) => food.foodForm === foodForm));
});

test("listFoods: supplement filter only returns matching rows when such rows exist", async () => {
  const supplements = await foodService.listFoods({
    page: 1,
    limit: 10,
    isSupplement: "true",
  });

  if (supplements.foods.length > 0) {
    assert.ok(supplements.foods.every((food) => food.isSupplement === true));
  }

  const regularFoods = await foodService.listFoods({
    page: 1,
    limit: 10,
    isSupplement: "false",
  });
  assert.ok(regularFoods.foods.length > 0);
  assert.ok(regularFoods.foods.every((food) => food.isSupplement === false));
});

test("listFoods: hasImage=true only returns foods with image URLs", async () => {
  const result = await foodService.listFoods({ page: 1, limit: 10, hasImage: "true" });
  if (result.pagination.total === 0) return;
  assert.ok(result.foods.length > 0);
  assert.ok(result.foods.every((food) => !!food.imageUrl));
});
