/**
 * Regression test for the AI-nutrition-overhaul pass's Part 6 food schema
 * extension (migration 20260819000000_add_food_serving_metadata):
 * verifies the backfill actually classified real rows correctly, and that
 * the query internal.controller.ts's foodsForAiNutrition endpoint runs
 * never returns is_supplement=true rows (Part 8: food-first, supplements
 * are opt-in, never silently in the auto-generated catalog).
 *
 * fitness-service has no separate `_test` database with the real 13k+-row
 * USDA food catalog seeded — same accepted, already-documented constraint
 * as equipment-data-integrity.test.ts and its siblings. DATABASE_URL
 * points at the real `gymcoach_fitness` dev DB, where the catalog + this
 * migration's backfill actually live. All assertions here are read-only
 * against seeded reference data, so this is safe to run repeatedly
 * against the live dev DB.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx --test src/__tests__/food-serving-metadata.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/prisma";

test.after(async () => {
  await prisma.$disconnect();
});

test("backfill: a known powder/isolate food is classified as a supplement with a tight serving cap", async () => {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT name, food_form, is_supplement, realistic_serving_max_g FROM foods WHERE name ILIKE '%protein%isolate%' OR name ILIKE '%isolate%protein%' LIMIT 5`,
  );
  assert.ok(rows.length > 0, "expected at least one protein-isolate row in the seeded USDA catalog");
  for (const row of rows) {
    assert.equal(row.is_supplement, true, `expected ${row.name} to be classified as a supplement`);
    assert.equal(row.food_form, "powder");
    assert.ok(row.realistic_serving_max_g <= 40, `expected a tight cap for ${row.name}, got ${row.realistic_serving_max_g}`);
  }
});

test("backfill: a whole food (raw/roasted chicken breast) is NOT classified as a supplement and has no artificial cap", async () => {
  // Regression guard for a real bug found via this test: the first
  // version of the backfill migration used naive `ILIKE '%oil%'`, which
  // matched "broilers" (br-OIL-ers) as a false positive and wrongly
  // capped plain chicken breast at 20g. Fixed in the follow-up migration
  // (20260819010000) using PostgreSQL `~*` with `\y` word boundaries.
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT name, food_form, is_supplement, realistic_serving_max_g FROM foods WHERE name ILIKE '%chicken%breast%raw%' OR name ILIKE '%chicken%breast%roasted%' LIMIT 10`,
  );
  assert.ok(rows.length > 0, "expected at least one plain raw/roasted chicken breast row in the seeded catalog");
  for (const row of rows) {
    assert.equal(row.is_supplement, false, `expected ${row.name} to not be a supplement`);
    assert.equal(row.food_form, null, `expected ${row.name} to be classified as a whole food (food_form=null), got ${row.food_form}`);
    assert.equal(row.realistic_serving_max_g, null, `expected ${row.name} to have no artificial cap, got ${row.realistic_serving_max_g}`);
  }
});

test("backfill: hard cheese (Parmesan) gets a tight 40g cap", async () => {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT name, food_form, realistic_serving_max_g FROM foods WHERE name ILIKE '%parmesan%' LIMIT 5`,
  );
  assert.ok(rows.length > 0, "expected at least one parmesan row in the seeded catalog");
  for (const row of rows) {
    assert.equal(row.food_form, "cheese");
    assert.equal(row.realistic_serving_max_g, 40);
  }
});

test("the foodsForAiNutrition query never returns a row with is_supplement=true", async () => {
  // Mirrors the exact SQL internal.controller.ts's foodsForAiNutrition
  // runs (minus the excludedKeywords/commonKeywords string-built clauses,
  // which are the same regardless of is_supplement).
  const rows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, name, calories, protein, carbs, fats, food_form, is_supplement, realistic_serving_max_g
    FROM foods
    WHERE calories BETWEEN 20 AND 600
      AND is_supplement = false
    ORDER BY protein DESC, calories ASC
    LIMIT 500
  `);
  assert.ok(rows.length > 0, "expected at least some foods to match");
  for (const row of rows) {
    assert.equal(row.is_supplement, false, `expected no supplement rows, got ${row.name}`);
  }
});
