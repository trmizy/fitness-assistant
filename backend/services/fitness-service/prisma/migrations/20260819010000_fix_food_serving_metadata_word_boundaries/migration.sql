-- Corrective migration: the previous pass
-- (20260819000000_add_food_serving_metadata) classified food_form/
-- is_supplement/realistic_serving_max_g using naive `name ILIKE '%oil%'`
-- / `'%nut%'` substring matching, which is NOT word-boundary-aware and
-- produced real false positives found via a follow-up integration test:
--   - "Chicken, broilers or fryers, ..." matched '%oil%' (br-OIL-ers) and
--     got wrongly capped at 20g as food_form='oil'. 133 rows affected.
--   - "Coconut", "Beverages ... with added nutrients/nutritional shake",
--     "Butternut squash" etc. matched '%nut%' and got wrongly classified
--     as food_form='nuts_seeds'.
-- Fixed here using PostgreSQL's `~*` regex operator with `\y` word-
-- boundary anchors (verified directly: 'Chicken, broilers or fryers' !~*
-- '\yoil\y', 'Olive oil' ~* '\yoil\y') — the same semantic as the
-- TypeScript SERVING_CAP_RULES regexes in ai-service's
-- nutrition.processor.ts (which already used `\b` word boundaries and
-- never had this bug). Resets every row to defaults first, then
-- reclassifies from scratch, so this is correct regardless of the
-- previous migration's partial/incorrect state.

UPDATE "foods" SET "food_form" = NULL, "is_supplement" = false, "realistic_serving_max_g" = NULL;

-- Hard/aged cheese
UPDATE "foods" SET "food_form" = 'cheese', "realistic_serving_max_g" = 40
WHERE "name" ~* '\yparmesan\y' OR "name" ~* '\yromano\y' OR "name" ~* '\ygrana\y';

-- Other cheese
UPDATE "foods" SET "food_form" = 'cheese', "realistic_serving_max_g" = 60
WHERE "food_form" IS NULL AND "name" ~* '\ycheese\y';

-- Nuts / seeds
UPDATE "foods" SET "food_form" = 'nuts_seeds', "realistic_serving_max_g" = 35
WHERE "food_form" IS NULL AND (
  "name" ~* '\ynuts?\y' OR "name" ~* '\yseeds?\y' OR "name" ~* '\yalmonds?\y'
  OR "name" ~* '\ypeanuts?\y' OR "name" ~* '\ycashews?\y' OR "name" ~* '\ywalnuts?\y'
  OR "name" ~* '\ypistachios?\y'
);

-- Dried / jerky / smoked
UPDATE "foods" SET "food_form" = 'dried', "realistic_serving_max_g" = 40
WHERE "food_form" IS NULL AND (
  "name" ~* '\ydried\y' OR "name" ~* '\yjerky\y' OR "name" ~* '\ysmoked\y'
);

-- Powder / isolate / concentrate — also marked as a supplement (Part 8:
-- never auto-added to a plan by default).
UPDATE "foods" SET "food_form" = 'powder', "realistic_serving_max_g" = 40, "is_supplement" = true
WHERE "food_form" IS NULL AND (
  "name" ~* '\ypowder\y' OR "name" ~* '\yisolate\y' OR "name" ~* '\yconcentrate\y'
);

-- Oils / fats used as a cooking ingredient, not a "serving" of food.
UPDATE "foods" SET "food_form" = 'oil', "realistic_serving_max_g" = 20
WHERE "food_form" IS NULL AND (
  "name" ~* '\yoils?\y' OR "name" ~* '\yghee\y' OR "name" ~* '\ylard\y'
  OR ("name" ~* '\ybutter\y' AND "name" !~* '\ybuttermilk\y')
);

-- Egg white (liquid/fresh) — realistic upper bound (~5-6 large eggs' worth).
UPDATE "foods" SET "realistic_serving_max_g" = 200
WHERE "food_form" IS NULL AND "name" ~* 'egg white';

-- Everything else keeps food_form = NULL (treated as a whole food) and
-- realistic_serving_max_g = NULL (nutrition.processor.ts falls back to its
-- own DEFAULT_SERVING_CAP_G = 250 for these).
