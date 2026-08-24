/**
 * Gate 5 importer — Vietnamese food aliases
 * (prisma/data/food_aliases.vi.json, 195 original-curated entries, no
 * external-license question per Gate 0). Wraps the same matching logic as
 * the pre-existing prisma/seed_food_aliases.ts (kept as-is, unchanged —
 * this importer supersedes it going forward but the old script is not
 * deleted), now with real ImportBatch tracking, --dry-run, --limit,
 * --report, --rollback-batch.
 *
 * Run inside the fitness-service container:
 *   npx tsx src/importers/foodAliasImporter.ts --dry-run --report
 *   npx tsx src/importers/foodAliasImporter.ts --report          (real run)
 *   npx tsx src/importers/foodAliasImporter.ts --rollback-batch <id>
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { prisma } from "../repositories/prisma";
import { normalizeVietnamese } from "../utils/normalizeVietnamese";
import {
  parseImportCliArgs,
  startImportBatch,
  printBatchReport,
  rollbackImportBatch,
} from "./import-cli.util";

interface AliasSeedItem {
  alias: string;
  englishQuery: string;
}

const SOURCE = "curated_vi_food_aliases";
const MAX_MATCHES_PER_ALIAS = 30; // same sanity bound the original seed script warned on

async function main() {
  const options = parseImportCliArgs(process.argv.slice(2));

  if (options.rollbackBatch) {
    await rollbackImportBatch(options.rollbackBatch);
    return;
  }

  const jsonPath = path.join(__dirname, "../../prisma/data/food_aliases.vi.json");
  const raw = await fs.readFile(jsonPath, "utf-8");
  const items = JSON.parse(raw) as AliasSeedItem[];
  const checksum = crypto.createHash("sha256").update(raw).digest("hex");

  const limited = options.limit ? items.slice(0, options.limit) : items;

  const handle = await startImportBatch(SOURCE, options, checksum);
  console.log(`Batch ${handle.batchId} started — ${limited.length} alias entries to process${options.dryRun ? " (DRY RUN)" : ""}.`);

  try {
    for (const item of limited) {
      const alias = item.alias.trim();
      const englishQuery = item.englishQuery.trim();
      if (!alias || !englishQuery) {
        await handle.record({ externalRef: alias || "(empty)", decision: "ERROR", detail: { reason: "empty alias or englishQuery" } });
        continue;
      }

      const foods = await prisma.food.findMany({
        where: { name: { contains: englishQuery, mode: "insensitive" } },
        select: { id: true, name: true },
        take: 50,
      });

      if (foods.length === 0) {
        await handle.record({ externalRef: alias, decision: "REVIEW_QUEUED", detail: { reason: "no matching food found", englishQuery } });
        continue;
      }
      if (foods.length > MAX_MATCHES_PER_ALIAS) {
        // Too broad to safely auto-link every match — same caution the
        // original seed script only warned about; this importer actually
        // acts on it by sending the whole alias to review instead of
        // silently attaching it to 30+ possibly-unrelated foods.
        await handle.record({
          externalRef: alias,
          decision: "REVIEW_QUEUED",
          detail: { reason: `matched ${foods.length} foods (> ${MAX_MATCHES_PER_ALIAS}) — too broad to auto-link safely`, englishQuery },
        });
        continue;
      }

      for (const food of foods) {
        const aliasNormalized = normalizeVietnamese(alias);
        const existing = await prisma.foodAlias.findFirst({
          where: { foodId: food.id, alias, language: "vi" },
        });
        if (existing) {
          await handle.record({ externalRef: `${alias}::${food.id}`, decision: "SKIPPED_DUPLICATE", targetTable: "food_aliases", targetId: existing.id });
          continue;
        }

        if (options.dryRun) {
          await handle.record({ externalRef: `${alias}::${food.id}`, decision: "INSERTED", detail: { dryRun: true, foodName: food.name } });
          continue;
        }

        try {
          const created = await prisma.foodAlias.create({
            data: {
              foodId: food.id,
              alias,
              aliasNormalized,
              language: "vi",
              source: SOURCE,
            },
          });
          await handle.record({ externalRef: `${alias}::${food.id}`, decision: "INSERTED", targetTable: "food_aliases", targetId: created.id });
        } catch (err: any) {
          if (err.code === "P2002") {
            await handle.record({ externalRef: `${alias}::${food.id}`, decision: "SKIPPED_DUPLICATE" });
            continue;
          }
          await handle.record({ externalRef: `${alias}::${food.id}`, decision: "ERROR", detail: { message: err.message } });
        }
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
// executed directly as a script.
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
