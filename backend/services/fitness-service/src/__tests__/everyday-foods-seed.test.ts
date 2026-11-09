import test from "node:test";
import assert from "node:assert/strict";
import { everydayFoodsCatalog, seedEverydayFoods } from "../services/everyday-foods-seed.service";
import { runFitnessServiceJob } from "../jobs-lambda";

// The catalog ships inside dist/ (src/data) so the jobs Lambda — the only path into Aurora — can load it (2026-11-09).
test("everyday-food catalog: 75 foods, unique fdcIds, every entry has a Vietnamese name and a group", () => {
  const foods = everydayFoodsCatalog();
  assert.equal(foods.length, 75);
  assert.equal(new Set(foods.map((f) => f.fdcId)).size, foods.length);
  for (const f of foods) {
    assert.ok(f.vi.trim().length > 0 && Number.isInteger(f.fdcId) && f.group, JSON.stringify(f));
    if (f.maxG !== undefined) assert.ok(f.maxG > 0 && f.maxG <= 600, JSON.stringify(f));
  }
});

test("seedEverydayFoods reports fdcIds missing from the database and never invents a food row", async () => {
  const calls: string[] = [];
  const fake: any = {
    food: { findMany: async () => [{ id: "f1", fdcId: 1, realisticServingMaxG: null }], update: async () => { calls.push("food.update"); } },
    foodAlias: {
      findUnique: async () => null,
      create: async (a: any) => { calls.push(`alias.create:${a.data.alias}`); },
      findMany: async () => [{ id: "old", foodId: "fX", alias: "Món đã bỏ" }],
      deleteMany: async () => { calls.push("alias.deleteMany"); },
    },
  };
  const r = await seedEverydayFoods(fake, [{ vi: "Cơm trắng", fdcId: 1, group: "carb", maxG: 350 }, { vi: "Không có", fdcId: 2, group: "carb" }]);
  assert.deepEqual(r.missingFdcIds, [2]);
  assert.equal(r.created, 1);
  assert.equal(r.portionCapsSet, 1);
  assert.equal(r.removedStale, 1);
  assert.ok(!calls.some((c) => c.startsWith("food.create")));
});

test("jobs Lambda: an unknown job is a 400-class error, not a silent no-op", async () => {
  await assert.rejects(runFitnessServiceJob({ job: "nope" }), (e: any) => e.statusCode === 400);
});
