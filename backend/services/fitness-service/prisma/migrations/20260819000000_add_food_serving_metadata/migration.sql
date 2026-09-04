-- AI-nutrition-overhaul pass (Part 6): additive food-realism metadata.
-- Backfills all 13k+ existing rows using the same name-keyword
-- classification already proven in ai-service's
-- nutrition.processor.ts (SERVING_CAP_RULES) and
-- internal.controller.ts (excludedKeywords) — kept in sync by hand since
-- SQL and TypeScript can't share one regex source directly. If either side
-- changes its keyword list, update the other.

ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "food_form" TEXT;
ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "is_supplement" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "realistic_serving_max_g" DOUBLE PRECISION;

-- Order matters: more specific patterns (parmesan) before their broader
-- parent (cheese) so the tighter cap wins.

-- Hard/aged cheese
UPDATE "foods" SET "food_form" = 'cheese', "realistic_serving_max_g" = 40
WHERE "name" ILIKE '%parmesan%' OR "name" ILIKE '%romano%' OR "name" ILIKE '%grana%';

-- Other cheese
UPDATE "foods" SET "food_form" = 'cheese', "realistic_serving_max_g" = 60
WHERE "food_form" IS NULL AND "name" ILIKE '%cheese%';

-- Nuts / seeds
UPDATE "foods" SET "food_form" = 'nuts_seeds', "realistic_serving_max_g" = 35
WHERE "food_form" IS NULL AND (
  "name" ILIKE '%nut%' OR "name" ILIKE '%seed%' OR "name" ILIKE '%almond%'
  OR "name" ILIKE '%peanut%' OR "name" ILIKE '%cashew%' OR "name" ILIKE '%walnut%'
  OR "name" ILIKE '%pistachio%'
);

-- Dried / jerky / smoked
UPDATE "foods" SET "food_form" = 'dried', "realistic_serving_max_g" = 40
WHERE "food_form" IS NULL AND (
  "name" ILIKE '%dried%' OR "name" ILIKE '%jerky%' OR "name" ILIKE '%smoked%'
);

-- Powder / isolate / concentrate — also marked as a supplement (Part 8:
-- never auto-added to a plan by default).
UPDATE "foods" SET "food_form" = 'powder', "realistic_serving_max_g" = 40, "is_supplement" = true
WHERE "food_form" IS NULL AND (
  "name" ILIKE '%powder%' OR "name" ILIKE '%isolate%' OR "name" ILIKE '%concentrate%'
);

-- Oils / fats used as a cooking ingredient, not a "serving" of food.
UPDATE "foods" SET "food_form" = 'oil', "realistic_serving_max_g" = 20
WHERE "food_form" IS NULL AND (
  "name" ILIKE '%oil%' OR "name" ILIKE '%ghee%' OR "name" ILIKE '%lard%'
  OR ("name" ILIKE '%butter%' AND "name" NOT ILIKE '%buttermilk%')
);

-- Egg white (liquid/fresh) — realistic upper bound (~5-6 large eggs' worth).
UPDATE "foods" SET "realistic_serving_max_g" = 200
WHERE "food_form" IS NULL AND "name" ILIKE '%egg white%';

-- Everything else keeps food_form = NULL (treated as a whole food) and
-- realistic_serving_max_g = NULL (nutrition.processor.ts falls back to its
-- own DEFAULT_SERVING_CAP_G = 250 for these).
