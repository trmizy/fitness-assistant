/**
 * Gate 5/8 — isolated proof that rollbackImportBatch() actually deletes
 * what it inserted, without touching the real 553-alias import already
 * committed. Creates its own tiny throwaway batch (2 records against a
 * real food, using an alias string that will never collide with the real
 * curated_vi_food_aliases content), rolls it back, and verifies the rows
 * are gone while the real 553 aliases are untouched.
 * Run inside the fitness-service container:
 *   npx tsx src/scripts/verifyRollbackMechanism.ts
 */
import { prisma } from "../repositories/prisma";
import { normalizeVietnamese } from "../utils/normalizeVietnamese";
import { startImportBatch, rollbackImportBatch } from "../importers/import-cli.util";

async function main() {
  const realAliasCountBefore = await prisma.foodAlias.count({ where: { source: "curated_vi_food_aliases" } });

  const someFood = await prisma.food.findFirst({ select: { id: true } });
  if (!someFood) throw new Error("no food rows to test against");

  const testAlias = "__rollback_test_alias__";
  const handle = await startImportBatch("rollback_mechanism_test", { dryRun: false, noMedia: false, report: false, reviewOnly: false });
  const created = await prisma.foodAlias.create({
    data: {
      foodId: someFood.id,
      alias: testAlias,
      aliasNormalized: normalizeVietnamese(testAlias),
      language: "vi",
      source: "rollback_mechanism_test",
    },
  });
  await handle.record({ externalRef: testAlias, decision: "INSERTED", targetTable: "food_aliases", targetId: created.id });
  await handle.finish("COMPLETED");

  const existsBeforeRollback = await prisma.foodAlias.findUnique({ where: { id: created.id } });
  console.log("Test alias exists before rollback:", !!existsBeforeRollback);

  await rollbackImportBatch(handle.batchId);

  const existsAfterRollback = await prisma.foodAlias.findUnique({ where: { id: created.id } });
  console.log("Test alias exists after rollback:", !!existsAfterRollback);

  const realAliasCountAfter = await prisma.foodAlias.count({ where: { source: "curated_vi_food_aliases" } });

  const passed = !!existsBeforeRollback && !existsAfterRollback && realAliasCountBefore === realAliasCountAfter;
  console.log(JSON.stringify({ realAliasCountBefore, realAliasCountAfter, passed }, null, 2));
  if (!passed) {
    console.error("ROLLBACK MECHANISM CHECK FAILED");
    process.exit(1);
  }
  console.log("ROLLBACK MECHANISM CHECK PASSED — test row created then removed, real 553-alias import untouched.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
