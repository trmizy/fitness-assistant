/**
 * Gate 10 — isolated proof that rollbackImportBatch() correctly handles
 * Recipe rows: deletes a STAGING recipe it inserted (cascading its
 * RecipeIngredient rows), but REFUSES to delete one that has since been
 * promoted to PUBLISHED — mirroring the same guard already proven for
 * Exercise rows. Creates its own tiny throwaway recipes against real
 * Food rows, never touching the 5 real curated_vi dishes already
 * imported.
 * Run inside the fitness-service container:
 *   npx tsx src/scripts/verifyRecipeRollback.ts
 */
import { prisma } from "../repositories/prisma";
import { startImportBatch, rollbackImportBatch } from "../importers/import-cli.util";

async function main() {
  const someFood = await prisma.food.findFirst({ select: { id: true } });
  if (!someFood) throw new Error("no food rows to test against");

  // --- Case 1: STAGING recipe — rollback must succeed and cascade. ---
  const handle1 = await startImportBatch("rollback_recipe_test", { dryRun: false, noMedia: false, report: false, reviewOnly: false });
  const stagingRecipe = await prisma.recipe.create({
    data: {
      name: "__rollback_test_dish__",
      nameVi: "__rollback_test_dish_vi__",
      yieldServings: 1,
      preparationState: "cooked",
      source: "rollback_recipe_test",
      status: "STAGING",
      ingredients: { create: [{ foodId: someFood.id, amount: 100, unit: "g", gramsEquivalent: 100 }] },
    },
    include: { ingredients: true },
  });
  await handle1.record({ externalRef: "test-staging", decision: "INSERTED", targetTable: "recipes", targetId: stagingRecipe.id });
  await handle1.finish("COMPLETED");

  const ingredientIdBefore = stagingRecipe.ingredients[0].id;
  console.log("STAGING recipe + 1 ingredient exist before rollback:", !!(await prisma.recipe.findUnique({ where: { id: stagingRecipe.id } })));

  await rollbackImportBatch(handle1.batchId);

  const recipeAfter = await prisma.recipe.findUnique({ where: { id: stagingRecipe.id } });
  const ingredientAfter = await prisma.recipeIngredient.findUnique({ where: { id: ingredientIdBefore } });
  console.log("STAGING recipe deleted after rollback:", recipeAfter === null);
  console.log("Its RecipeIngredient cascade-deleted:", ingredientAfter === null);
  if (recipeAfter !== null || ingredientAfter !== null) {
    throw new Error("FAIL: STAGING recipe rollback did not fully clean up");
  }

  // --- Case 2: PUBLISHED recipe — rollback must REFUSE, not delete. ---
  const handle2 = await startImportBatch("rollback_recipe_test", { dryRun: false, noMedia: false, report: false, reviewOnly: false });
  const publishedRecipe = await prisma.recipe.create({
    data: {
      name: "__rollback_test_dish_published__",
      nameVi: "__rollback_test_dish_published_vi__",
      yieldServings: 1,
      preparationState: "cooked",
      source: "rollback_recipe_test",
      status: "STAGING",
      ingredients: { create: [{ foodId: someFood.id, amount: 100, unit: "g", gramsEquivalent: 100 }] },
    },
  });
  await handle2.record({ externalRef: "test-published", decision: "INSERTED", targetTable: "recipes", targetId: publishedRecipe.id });
  await handle2.finish("COMPLETED");

  // Simulate a human promoting it after import — exactly what the
  // PUBLISHED-guard exists to protect against an unsafe later rollback.
  await prisma.recipe.update({ where: { id: publishedRecipe.id }, data: { status: "PUBLISHED" } });

  let refused = false;
  try {
    await rollbackImportBatch(handle2.batchId);
  } catch (err: any) {
    refused = /Refusing to roll back/.test(err.message);
  }
  console.log("Rollback of a PUBLISHED recipe was refused:", refused);
  const stillThere = await prisma.recipe.findUnique({ where: { id: publishedRecipe.id } });
  console.log("PUBLISHED recipe still exists (not deleted):", !!stillThere);
  if (!refused || !stillThere) {
    throw new Error("FAIL: PUBLISHED recipe was NOT protected from rollback");
  }

  // Cleanup this test's own PUBLISHED throwaway row directly (rollback
  // correctly won't touch it — that's the whole point of the guard).
  await prisma.recipeIngredient.deleteMany({ where: { recipeId: publishedRecipe.id } });
  await prisma.recipe.delete({ where: { id: publishedRecipe.id } });

  // 2026-08-20: grew from 5 to 15 after vietnameseDishImporter.ts's real
  // batch-2 run (10 more dishes) — a legitimate content addition, not
  // corruption. Update this expected count again whenever another real
  // batch is imported, same convention as postMigrationIntegrityCheck.ts's
  // BASELINE object.
  const EXPECTED_REAL_DISH_COUNT = 15;
  const realDishCount = await prisma.recipe.count({ where: { source: "original_curated_vi" } });
  console.log(`Real curated_vi dishes untouched by this test: ${realDishCount} (expected ${EXPECTED_REAL_DISH_COUNT})`);
  if (realDishCount !== EXPECTED_REAL_DISH_COUNT) {
    throw new Error(`FAIL: expected ${EXPECTED_REAL_DISH_COUNT} real curated_vi dishes, found ${realDishCount}`);
  }

  console.log("\nALL CHECKS PASSED.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
