/**
 * Gate 10 (Vietnamese nutrition) — first, small, real batch of Vietnamese
 * dishes as Recipe/RecipeIngredient rows, composed ENTIRELY from
 * ingredients already in the existing, already-licensed Food catalog
 * (USDA FoodData Central, sr_legacy/survey_fndds — see
 * docs/research/fitness-data-source-and-license-review.md). No new
 * external data source is introduced by this importer: FAO Vietnamese
 * Food Composition Table and Open Food Facts remain explicitly NOT used
 * (Gate 0's documented license blockers), exactly as before.
 *
 * What "curated" means here: the DISH COMPOSITION (which real ingredients,
 * in what typical proportions) is original, written from general public
 * culinary knowledge of how each dish is conventionally made — not copied
 * from any specific copyrighted recipe/website. The per-ingredient NUTRIENT
 * DATA itself is 100% sourced from the existing Food rows (never invented).
 *
 * Known, deliberate approximations (documented here, not hidden):
 *   - USDA has no dedicated "rice vermicelli" (bún) entry distinct from
 *     flat pho noodles — both dishes reuse the same "Rice noodles, cooked"
 *     row (both are rice-flour-and-water noodles; width doesn't
 *     meaningfully change macros).
 *   - Phở broth is approximated with canned "beef broth, ready-to-serve"
 *     (7 kcal/100g) rather than a home-simmered bone broth — a
 *     conservative (under-, not over-, stated) proxy; a real bone broth
 *     with marrow/fat rendered in would run higher in calories/fat.
 *   - Whole aromatics steeped-then-discarded (star anise, cinnamon,
 *     cloves, charred ginger) are NOT listed as ingredients — real dishes
 *     use them, but at zero meaningfully-consumed mass, matching how
 *     nutrition labels typically treat steep-only aromatics.
 *   - Nước chấm (dipping sauce) is simplified to its two calorically-
 *     relevant components (fish sauce + sugar) at roughly the concentrated
 *     portion actually consumed, not the full diluted sauce volume.
 * Every one of these is a defensible, disclosed approximation — never a
 * silently invented number — and every dish imports as status: "STAGING"
 * (Gate 12 rollout states), same as new exercises: not visible to real
 * users until a human reviews and promotes it.
 *
 * Run inside the fitness-service container:
 *   npx tsx src/importers/vietnameseDishImporter.ts --dry-run --report
 *   npx tsx src/importers/vietnameseDishImporter.ts --report          (real run)
 *   npx tsx src/importers/vietnameseDishImporter.ts --rollback-batch <id>
 */
import * as crypto from "crypto";
import { prisma } from "../repositories/prisma";
import {
  parseImportCliArgs,
  startImportBatch,
  printBatchReport,
  rollbackImportBatch,
} from "./import-cli.util";

const SOURCE = "original_curated_vi";
const SOURCE_VERSION = "2026-08-20";

interface CuratedIngredient {
  /** Exact Food.name — resolved to an id at run time, not hardcoded, so a
   * renamed/removed USDA row fails loudly (REVIEW_QUEUED) instead of
   * silently importing wrong data. */
  foodName: string;
  amountG: number;
  note?: string;
}

interface CuratedDish {
  slug: string;
  nameVi: string;
  nameEn: string;
  yieldServings: number;
  preparationState: "cooked";
  ingredients: CuratedIngredient[];
}

const DISHES: CuratedDish[] = [
  {
    slug: "pho-bo",
    nameVi: "Phở Bò",
    nameEn: "Vietnamese Beef Noodle Soup",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Rice noodles, cooked", amountG: 200 },
      {
        foodName: 'Beef, brisket, whole, separable lean and fat, trimmed to 1/8"" fat, all grades, cooked, braised',
        amountG: 100,
      },
      { foodName: "Soup, beef broth or bouillon canned, ready-to-serve", amountG: 400, note: "broth proxy — see importer header comment" },
      { foodName: "Fish sauce", amountG: 10 },
      { foodName: "Bean sprouts, raw", amountG: 30 },
      { foodName: "Cilantro, raw", amountG: 5 },
      { foodName: "Onions, raw", amountG: 20 },
      { foodName: "Limes, raw", amountG: 10, note: "garnish wedge" },
    ],
  },
  {
    slug: "com-tam-suon-nuong",
    nameVi: "Cơm Tấm Sườn Nướng",
    nameEn: "Broken Rice with Grilled Pork Chop",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Rice, white, long-grain, regular, cooked, unenriched, with salt", amountG: 250 },
      { foodName: "Pork, fresh, loin, whole, separable lean and fat, cooked, roasted", amountG: 150, note: "grilled-pork-chop proxy" },
      { foodName: "Fish sauce", amountG: 15, note: "nước mắm chấm" },
      { foodName: "Sugars, granulated", amountG: 5, note: "in the dipping sauce" },
      { foodName: "Garlic, raw", amountG: 3 },
      { foodName: "Cucumber, with peel, raw", amountG: 30, note: "side" },
    ],
  },
  {
    slug: "bun-cha",
    nameVi: "Bún Chả",
    nameEn: "Grilled Pork with Rice Vermicelli",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Rice noodles, cooked", amountG: 200, note: "rice-vermicelli proxy — see importer header comment" },
      { foodName: "Pork, fresh, loin, whole, separable lean and fat, cooked, roasted", amountG: 120, note: "grilled-pork proxy" },
      { foodName: "Fish sauce", amountG: 10, note: "concentrated portion of the diluted nước chấm actually consumed" },
      { foodName: "Sugars, granulated", amountG: 8, note: "in the dipping sauce" },
      { foodName: "Lettuce, iceberg (includes crisphead types), raw", amountG: 40 },
      { foodName: "Cucumber, with peel, raw", amountG: 30 },
    ],
  },
  {
    slug: "goi-cuon",
    nameVi: "Gỏi Cuốn",
    nameEn: "Fresh Spring Rolls",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Rice paper", amountG: 30, note: "~3 sheets" },
      { foodName: "Shrimp, steamed or boiled", amountG: 60 },
      { foodName: "Rice noodles, cooked", amountG: 60 },
      { foodName: "Lettuce, iceberg (includes crisphead types), raw", amountG: 30 },
      { foodName: "Peppermint, fresh", amountG: 5 },
      { foodName: "Peanuts, all types, dry-roasted, without salt", amountG: 10, note: "simplified peanut dipping sauce" },
    ],
  },
  {
    slug: "canh-chua-ca",
    nameVi: "Canh Chua Cá",
    nameEn: "Vietnamese Sweet and Sour Fish Soup",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Fish, catfish, channel, wild, cooked, dry heat", amountG: 150 },
      { foodName: "Tamarinds, raw", amountG: 15 },
      { foodName: "Pineapple, raw, all varieties", amountG: 50 },
      { foodName: "Tomatoes, red, ripe, raw, year round average", amountG: 50 },
      { foodName: "Bean sprouts, raw", amountG: 30 },
      { foodName: "Fish sauce", amountG: 10 },
      { foodName: "Sugars, granulated", amountG: 5 },
    ],
  },

  // ── Batch 2 (2026-08-20) — 10 more dishes, same rules: every ingredient
  // resolved against the EXISTING Food catalog, nothing invented. Ingredient
  // availability was checked against the real catalog BEFORE writing this
  // list (not assumed) — several otherwise-obvious dishes were deliberately
  // LEFT OUT because a defining ingredient has no honest USDA match:
  //   - Bún Bò Huế: needs mắm ruốc (fermented shrimp paste) — not in USDA.
  //   - Mì Quảng: lemongrass-forward, multi-protein, riskier to approximate
  //     honestly in one pass — deferred, not attempted.
  //   - Bún Thịt Nướng: too close to the already-imported Bún Chả (same
  //     grilled-pork + rice-vermicelli shape) — skipped to avoid an
  //     effectively-duplicate recipe entry.
  //   - Bánh Xèo: coconut-milk crêpe batter — mappable in principle, held
  //     back this pass to keep the batch a size that's actually reviewable.
  //   - Rau Muống Xào Tỏi: water spinach (rau muống / Ipomoea aquatica) has
  //     no USDA entry under any name checked (kangkong, morning glory) —
  //     genuinely absent from the catalog, not just hard to find.
  {
    slug: "banh-mi-thit",
    nameVi: "Bánh Mì Thịt",
    nameEn: "Vietnamese Pork Sandwich",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Bread, french or vienna (includes sourdough)", amountG: 120 },
      { foodName: "Ham, sliced, regular (approximately 11% fat)", amountG: 40 },
      { foodName: "Pork, fresh, loin, whole, separable lean and fat, cooked, roasted", amountG: 30, note: "roast-pork component" },
      { foodName: "Mayonnaise, regular", amountG: 10 },
      { foodName: "Carrots, raw", amountG: 20, note: "đồ chua proxy — USDA has no daikon entry, and pickling's own sugar/vinegar isn't modeled; carrot-only, unpickled macros" },
      { foodName: "Cucumber, with peel, raw", amountG: 15 },
      { foodName: "Cilantro, raw", amountG: 5 },
    ],
  },
  {
    slug: "com-ga",
    nameVi: "Cơm Gà",
    nameEn: "Vietnamese Chicken Rice",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Rice, white, long-grain, regular, cooked, unenriched, with salt", amountG: 250 },
      { foodName: "Chicken, broilers or fryers, breast, meat and skin, cooked, roasted", amountG: 150 },
      { foodName: "Cucumber, with peel, raw", amountG: 30, note: "side" },
      { foodName: "Fish sauce", amountG: 10 },
    ],
  },
  {
    slug: "chao-ga",
    nameVi: "Cháo Gà",
    nameEn: "Vietnamese Chicken Rice Porridge",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Rice, white, long-grain, regular, cooked, unenriched, with salt", amountG: 150, note: "porridge's extra cooking water isn't separately modeled — steamed-rice macros used as the closest available proxy" },
      { foodName: "Chicken, broilers or fryers, breast, meat and skin, cooked, roasted", amountG: 100, note: "shredded" },
      { foodName: "Ginger root, raw", amountG: 5 },
      { foodName: "Fish sauce", amountG: 8 },
    ],
  },
  {
    slug: "ga-kho-gung",
    nameVi: "Gà Kho Gừng",
    nameEn: "Vietnamese Ginger Braised Chicken",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Chicken, broilers or fryers, dark meat, meat only, cooked, stewed", amountG: 200 },
      { foodName: "Ginger root, raw", amountG: 15 },
      { foodName: "Fish sauce", amountG: 15 },
      { foodName: "Sugars, granulated", amountG: 8, note: "for the caramel base" },
    ],
  },
  {
    slug: "ca-kho-to",
    nameVi: "Cá Kho Tộ",
    nameEn: "Vietnamese Caramelized Braised Catfish",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Fish, catfish, channel, wild, cooked, dry heat", amountG: 180 },
      { foodName: "Fish sauce", amountG: 15 },
      { foodName: "Sugars, granulated", amountG: 10, note: "for the caramel base" },
      { foodName: "Garlic, raw", amountG: 3 },
    ],
  },
  {
    slug: "thit-kho-trung",
    nameVi: "Thịt Kho Trứng",
    nameEn: "Vietnamese Braised Pork Belly with Eggs",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Pork, fresh, belly, raw", amountG: 150, note: "no cooked/braised belly row in USDA — raw-state macros used; braising typically renders out some fat, so this likely mildly OVERSTATES calories/fat, not understates" },
      { foodName: "Egg, whole, raw, fresh", amountG: 100, note: "~2 eggs, hard-boiled — boiling doesn't meaningfully change egg macros vs raw" },
      { foodName: "Fish sauce", amountG: 15 },
      { foodName: "Sugars, granulated", amountG: 10, note: "for the caramel base" },
    ],
  },
  {
    slug: "dau-hu-sot-ca-chua",
    nameVi: "Đậu Hũ Sốt Cà Chua",
    nameEn: "Vietnamese Tofu in Tomato Sauce",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Tofu, firm, prepared with calcium sulfate and magnesium chloride (nigari)", amountG: 200 },
      { foodName: "Tomatoes, red, ripe, raw, year round average", amountG: 100 },
      { foodName: "Garlic, raw", amountG: 5 },
      { foodName: "Fish sauce", amountG: 8 },
    ],
  },
  {
    slug: "canh-bi-do-thit-bam",
    nameVi: "Canh Bí Đỏ Thịt Bằm",
    nameEn: "Vietnamese Pumpkin Soup with Ground Pork",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Pumpkin, raw", amountG: 200, note: "cooked into soup — raw pumpkin macros are a close proxy (mostly water/carbs, minimal change on cooking)" },
      { foodName: "Pork, ground, 84% lean / 16% fat, raw", amountG: 50 },
      { foodName: "Fish sauce", amountG: 8 },
    ],
  },
  {
    slug: "hu-tieu",
    nameVi: "Hủ Tiếu",
    nameEn: "Vietnamese Southern-Style Rice Noodle Soup",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Rice noodles, cooked", amountG: 200 },
      { foodName: "Shrimp, steamed or boiled", amountG: 50 },
      { foodName: "Pork, fresh, loin, whole, separable lean and fat, cooked, roasted", amountG: 50 },
      { foodName: "Bean sprouts, raw", amountG: 30 },
      { foodName: "Fish sauce", amountG: 10 },
    ],
  },
  {
    slug: "bun-rieu",
    nameVi: "Bún Riêu",
    nameEn: "Vietnamese Crab and Tomato Noodle Soup",
    yieldServings: 1,
    preparationState: "cooked",
    ingredients: [
      { foodName: "Rice noodles, cooked", amountG: 200 },
      { foodName: "Crustaceans, crab, blue, canned", amountG: 80 },
      { foodName: "Tomatoes, red, ripe, raw, year round average", amountG: 80 },
      { foodName: "Tofu, firm, prepared with calcium sulfate and magnesium chloride (nigari)", amountG: 50 },
      { foodName: "Fish sauce", amountG: 10 },
    ],
  },
];

async function resolveFoodId(name: string): Promise<string | null> {
  const food = await prisma.food.findFirst({ where: { name } });
  return food?.id ?? null;
}

async function main() {
  const options = parseImportCliArgs(process.argv.slice(2));

  if (options.rollbackBatch) {
    await rollbackImportBatch(options.rollbackBatch);
    return;
  }

  const checksum = crypto.createHash("sha256").update(JSON.stringify(DISHES)).digest("hex");
  const limited = options.limit ? DISHES.slice(0, options.limit) : DISHES;

  const handle = await startImportBatch(SOURCE, options, checksum);
  console.log(
    `Batch ${handle.batchId} started — ${limited.length} curated Vietnamese dishes to process${options.dryRun ? " (DRY RUN)" : ""}.`,
  );

  try {
    for (const dish of limited) {
      // Idempotency: a dish already imported from this exact source is
      // never re-created — re-running this importer must never duplicate
      // a recipe (rule 11 of the task's own safety rules).
      const existing = await prisma.recipe.findFirst({
        where: { nameVi: dish.nameVi, source: SOURCE },
      });
      if (existing) {
        await handle.record({
          externalRef: dish.slug,
          decision: "SKIPPED_DUPLICATE",
          targetTable: "recipes",
          targetId: existing.id,
        });
        continue;
      }

      // Resolve every ingredient's Food id BEFORE writing anything — a
      // dish with even one unresolvable ingredient (a USDA row renamed or
      // removed since this list was written) is queued for review rather
      // than imported with a missing/wrong ingredient.
      const resolved: Array<{ foodId: string; ingredient: CuratedIngredient }> = [];
      const unresolved: string[] = [];
      for (const ing of dish.ingredients) {
        const foodId = await resolveFoodId(ing.foodName);
        if (!foodId) {
          unresolved.push(ing.foodName);
        } else {
          resolved.push({ foodId, ingredient: ing });
        }
      }

      if (unresolved.length > 0) {
        await handle.record({
          externalRef: dish.slug,
          decision: "REVIEW_QUEUED",
          detail: { reason: "unresolved ingredient food names", unresolved },
        });
        continue;
      }

      if (options.reviewOnly || options.dryRun) {
        await handle.record({
          externalRef: dish.slug,
          decision: "INSERTED",
          detail: {
            dryRun: true,
            nameVi: dish.nameVi,
            nameEn: dish.nameEn,
            ingredientCount: resolved.length,
          },
        });
        continue;
      }

      try {
        const recipe = await prisma.recipe.create({
          data: {
            name: dish.nameEn,
            nameVi: dish.nameVi,
            yieldServings: dish.yieldServings,
            preparationState: dish.preparationState,
            source: SOURCE,
            status: "STAGING", // Gate 12 rollout — never auto-visible to real users.
            ingredients: {
              create: resolved.map(({ foodId, ingredient }) => ({
                foodId,
                amount: ingredient.amountG,
                unit: "g",
                gramsEquivalent: ingredient.amountG,
                note: ingredient.note ?? null,
              })),
            },
          },
        });
        await handle.record({
          externalRef: dish.slug,
          decision: "INSERTED",
          targetTable: "recipes",
          targetId: recipe.id,
          detail: { nameVi: dish.nameVi, ingredientCount: resolved.length, sourceVersion: SOURCE_VERSION },
        });
      } catch (err: any) {
        await handle.record({ externalRef: dish.slug, decision: "ERROR", detail: { message: err.message } });
      }
    }

    await handle.finish("COMPLETED");
  } catch (err) {
    await handle.finish("FAILED");
    throw err;
  }

  if (options.report) {
    await printBatchReport(handle.batchId);
  } else {
    console.log(`Batch ${handle.batchId} finished. Run with --report for a summary, or --rollback-batch ${handle.batchId} to undo.`);
  }
}

// Guard against the same real bug found and fixed in newExerciseImporter.ts:
// simply IMPORTING this file would otherwise execute a full real import
// batch AND disconnect the shared Prisma client as invisible side effects
// of a require/import statement. Only run main() when this file is
// executed directly as a script — and this file's own DISHES/
// resolveFoodId are about to become reusable exports for Gate 10's
// expansion batch below, so this is no longer a hypothetical risk.
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
