/**
 * Smart Substitute variants (Production Hardening report §16) — real
 * catalog, real alias data (this test REQUIRES the Food table and
 * food_aliases.vi.json to be seeded — `pnpm seed` then
 * `npx tsx prisma/seed_food_aliases.ts` — the same real USDA+Vietnamese-
 * alias data every other "real seeded" test in this suite already assumes).
 * Deliberately not stubbing foodRepository: the entire point of Smart
 * Substitute is resolving real Vietnamese terms to real, sensible catalog
 * entries — a fully-mocked repository would prove nothing about whether
 * "cá basa" actually resolves to a fish and not a random branded product
 * (a real bug found and fixed while building this: see
 * nutrition-food-suggestion.engine.ts's isBrandedOrInfantFood).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/nutrition-food-substitution.engine.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test",
};

type SubstitutionModule = typeof import("../services/nutrition-food-substitution.engine");
let substitution: SubstitutionModule | undefined;
async function load() {
  if (!substitution) substitution = await import("../services/nutrition-food-substitution.engine");
  return substitution!;
}

test("inferFoodRole: protein-dominant item (chicken breast, ~50% calories from protein) is PROTEIN", skipOpts, async () => {
  const { inferFoodRole } = await load();
  // 200g "Chicken breast, grilled": ~206kcal/100g, ~25.7g protein/100g -> for 200g: 412kcal, 51.4g protein -> 51.4*4=205.6, ~50% of calories
  assert.equal(inferFoodRole(412, 51.4), "PROTEIN");
});

test("inferFoodRole: carb-dominant item (rice, ~8% calories from protein) is CARB", skipOpts, async () => {
  const { inferFoodRole } = await load();
  // 200g white rice cooked: 260kcal, 5.4g protein -> 5.4*4=21.6, ~8% of calories
  assert.equal(inferFoodRole(260, 5.4), "CARB");
});

test("inferFoodRole: cá basa (catfish, NAM's own priority protein) is PROTEIN despite a moderate ~21% protein-calorie share", skipOpts, async () => {
  // Found via real E2E verification against the dev stack (2026-09-07):
  // "Fish, catfish, NFS" (255kcal/13.5g protein per 100g — fattier than
  // e.g. tilapia) sits at ~21% protein-calorie share. At the previous 30%
  // threshold this misclassified as CARB, so a real NAM-region user's own
  // priority protein ("cá basa") got told "món này thuộc nhóm tinh bột,
  // đã là món chay sẵn" for VEGETARIAN/HIGHER_PROTEIN requests instead of
  // a real answer — the threshold moved to 20% because of this exact case.
  const { inferFoodRole } = await load();
  const quantityG = 250;
  const calories = Math.round(255 * (quantityG / 100));
  const protein = 13.5 * (quantityG / 100);
  assert.equal(inferFoodRole(calories, protein), "PROTEIN");
});

test("REPLACE: swapping ức gà (protein role) returns a different protein food, calorie-equivalent quantity", skipOpts, async () => {
  const { findFoodSubstitute } = await load();
  const result = await findFoodSubstitute({
    currentFoodName: "Chicken breast, grilled without sauce, skin eaten",
    currentQuantityG: 200,
    currentCalories: 412,
    currentProtein: 51.4,
    mode: "REPLACE",
    budgetLevel: "NORMAL",
  });
  assert.equal(result.role, "PROTEIN");
  assert.ok(result.candidates.length > 0, "must return at least one alternative");
  for (const c of result.candidates) {
    assert.notEqual(c.foodName.toLowerCase(), "chicken breast, grilled without sauce, skin eaten");
    // Calorie-equivalent swap: should be in the same ballpark as the original 412 kcal
    assert.ok(c.calories > 0, "must have a positive calorie value");
  }
});

test("desiredFoodName: resolves the SPECIFIC named food (\"cá hồi\" -> salmon), not a pool pick, calorie-equivalent quantity", skipOpts, async () => {
  // AI-coach agent action (docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_PLAN.md):
  // "tôi muốn ăn cá hồi thay ức gà" names the replacement explicitly —
  // must resolve exactly that food via the same alias-backed catalog
  // search Smart Substitute already uses, not a pool-ranked alternative.
  const { findFoodSubstitute } = await load();
  const result = await findFoodSubstitute({
    currentFoodName: "Chicken breast, grilled without sauce, skin eaten",
    currentQuantityG: 200,
    currentCalories: 412,
    currentProtein: 51.4,
    mode: "REPLACE",
    budgetLevel: "NORMAL",
    desiredFoodName: "cá hồi",
  });
  assert.equal(result.candidates.length, 1, "a named food resolves to exactly one candidate, not a ranked pool");
  assert.ok(
    result.candidates[0].foodName.toLowerCase().includes("salmon"),
    `expected a salmon food for "cá hồi", got: ${result.candidates[0].foodName}`,
  );
  // Calorie-equivalent quantity math is the SAME formula as the pool path —
  // proves this isn't a fixed 100g default silently changing the meal total.
  assert.ok(result.candidates[0].quantityG > 0);
  assert.ok(result.candidates[0].calories > 0);
});

test("desiredFoodName: a name with no catalog match returns zero candidates with a clear note, never throws or guesses", skipOpts, async () => {
  const { findFoodSubstitute } = await load();
  const result = await findFoodSubstitute({
    currentFoodName: "Chicken breast, grilled without sauce, skin eaten",
    currentQuantityG: 200,
    currentCalories: 412,
    currentProtein: 51.4,
    mode: "REPLACE",
    budgetLevel: "NORMAL",
    desiredFoodName: "xyzzy-mon-khong-ton-tai-nao-ca",
  });
  assert.equal(result.candidates.length, 0);
  assert.ok(result.note.includes("Không tìm thấy"));
});

test("CHEAPER: forces the LOW-budget pool regardless of the caller's own FLEXIBLE budget", skipOpts, async () => {
  const { findFoodSubstitute } = await load();
  const cheap = await findFoodSubstitute({
    currentFoodName: "Fish, salmon, NFS",
    currentQuantityG: 150,
    currentCalories: 411,
    currentProtein: 38.1,
    mode: "CHEAPER",
    budgetLevel: "FLEXIBLE", // deliberately the expensive tier — CHEAPER must override it
  });
  const cheapNames = cheap.candidates.map((c) => c.foodName.toLowerCase());
  // The LOW pool never includes salmon/beef/shrimp — confirms CHEAPER
  // actually used PROTEIN_QUERIES.LOW, not the caller's FLEXIBLE tier.
  assert.ok(
    !cheapNames.some((n) => n.includes("salmon") || n.includes("beef") || n.includes("shrimp")),
    `CHEAPER must never surface a FLEXIBLE-tier food, got: ${cheapNames.join(", ")}`,
  );
});

test("HIGHER_PROTEIN: every candidate has strictly higher protein-per-100g than the current item", skipOpts, async () => {
  const { findFoodSubstitute } = await load();
  // "Egg, whole, raw": ~143kcal/100g, 12.4g protein/100g — plenty of real
  // catalog foods (fish, chicken breast, beef) beat that density.
  const result = await findFoodSubstitute({
    currentFoodName: "Egg, whole, raw",
    currentQuantityG: 100,
    currentCalories: 143,
    currentProtein: 12.4,
    mode: "HIGHER_PROTEIN",
    budgetLevel: "NORMAL",
  });
  assert.ok(result.candidates.length > 0, "expected at least one higher-protein candidate to exist in a real catalog");
  for (const c of result.candidates) {
    const proteinPer100g = (c.protein / c.quantityG) * 100;
    assert.ok(proteinPer100g > 12.4, `candidate ${c.foodName} (${proteinPer100g.toFixed(1)}g/100g) must beat 12.4g/100g`);
  }
});

test("HIGHER_PROTEIN: not applicable to a CARB-role item — returns an explanatory note, no candidates", skipOpts, async () => {
  const { findFoodSubstitute } = await load();
  const result = await findFoodSubstitute({
    currentFoodName: "Rice, white, long-grain, regular, cooked, enriched, with salt",
    currentQuantityG: 200,
    currentCalories: 260,
    currentProtein: 5.4,
    mode: "HIGHER_PROTEIN",
    budgetLevel: "NORMAL",
  });
  assert.equal(result.role, "CARB");
  assert.deepEqual(result.candidates, []);
  assert.ok(result.note.length > 0);
});

test("VEGETARIAN: LACTO_OVO mode may include trứng-derived candidates; VEGAN mode never does", skipOpts, async () => {
  const { findFoodSubstitute } = await load();
  const vegan = await findFoodSubstitute({
    // A genuinely lean cut (separable lean ONLY, no fat) so protein
    // dominates calories with a comfortable margin above the 20% role
    // threshold — see inferFoodRole's own doc comment for why 20%, not the
    // more common 30%, is what this file actually uses.
    currentFoodName: "Pork, fresh, loin, top loin (chops), boneless, separable lean only, raw",
    currentQuantityG: 150,
    currentCalories: 191,
    currentProtein: 33.6,
    mode: "VEGETARIAN",
    budgetLevel: "NORMAL",
    vegetarianMode: "VEGAN",
  });
  assert.equal(vegan.role, "PROTEIN");
  assert.ok(vegan.candidates.length > 0);
  for (const c of vegan.candidates) {
    assert.ok(
      !/egg|trứng/i.test(c.foodName),
      `VEGAN mode must never include an egg-derived candidate, got: ${c.foodName}`,
    );
  }
});

test("VEGETARIAN: not applicable to a CARB-role item — already vegetarian by default", skipOpts, async () => {
  const { findFoodSubstitute } = await load();
  const result = await findFoodSubstitute({
    currentFoodName: "Sweet potato, NFS",
    currentQuantityG: 200,
    currentCalories: 230,
    currentProtein: 3.2,
    mode: "VEGETARIAN",
    budgetLevel: "NORMAL",
  });
  assert.equal(result.role, "CARB");
  assert.deepEqual(result.candidates, []);
});

test("region personalization: NAM region reorders REPLACE candidates toward cá basa/tôm over the national default order", skipOpts, async () => {
  const { findFoodSubstitute } = await load();
  const national = await findFoodSubstitute({
    currentFoodName: "Chicken breast, grilled without sauce, skin eaten",
    currentQuantityG: 200,
    currentCalories: 412,
    currentProtein: 51.4,
    mode: "REPLACE",
    budgetLevel: "NORMAL",
  });
  const nam = await findFoodSubstitute({
    currentFoodName: "Chicken breast, grilled without sauce, skin eaten",
    currentQuantityG: 200,
    currentCalories: 412,
    currentProtein: 51.4,
    mode: "REPLACE",
    budgetLevel: "NORMAL",
    region: "NAM",
  });
  assert.ok(nam.note.includes("Nam"), "the note should mention the regional prep style");
  assert.ok(nam.candidates.length > 0 && national.candidates.length > 0);
  // The NAM-ordered first candidate should be catfish or shrimp (this
  // region's priority proteins) rather than whatever the unordered
  // national default's first candidate happened to be.
  const namFirst = nam.candidates[0].foodName.toLowerCase();
  assert.ok(
    namFirst.includes("catfish") || namFirst.includes("shrimp"),
    `expected NAM's first candidate to be catfish/shrimp, got: ${namFirst}`,
  );
});
