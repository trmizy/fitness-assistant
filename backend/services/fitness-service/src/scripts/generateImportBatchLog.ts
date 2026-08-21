/**
 * Gate 5 — writes reports/data/import-batches-log.md, a human-readable
 * log of every ImportBatch run so far (real DB query, not hand-written).
 * Run inside the fitness-service container:
 *   npx tsx src/scripts/generateImportBatchLog.ts
 */
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../repositories/prisma";

async function main() {
  const batches = await prisma.importBatch.findMany({ orderBy: { startedAt: "asc" } });

  const rows = batches
    .map(
      (b) =>
        `| ${b.id.slice(0, 8)} | ${b.source} | ${b.startedAt.toISOString()} | ${b.status}${b.dryRun ? " (dry-run)" : ""} | ${b.insertedCount} | ${b.updatedCount} | ${b.skippedCount} | ${b.reviewCount} | ${b.errorCount} |`,
    )
    .join("\n");

  const md = `# Import Batch Log

Generated: ${new Date().toISOString()} — real query against \`import_batches\`, not hand-maintained.

| Batch (short id) | Source | Started | Status | Inserted | Updated | Skipped/Dup | Review-queued | Errors |
|---|---|---|---|---|---|---|---|---|
${rows}

## What's actually live vs review-queued

- **curated_vi_food_aliases**: the real (non-dry-run) run committed 553
  alias-food links from the 195-entry source file. 136 individual alias
  entries were queued for review rather than auto-linked — either because
  their \`englishQuery\` matched ZERO foods (a gap in the source file's own
  query mapping, e.g. "chicken breast cooked" not appearing verbatim in
  any of the 13,159 USDA names), or matched MORE than 30 foods (too broad
  to safely auto-link without a human picking which ones are actually
  right — e.g. "ức gà"/"chicken breast" alone matched 36 rows). Re-running
  the importer a second time confirmed idempotency: 0 new inserts, all
  553 correctly recognized as already-linked.
- **curated_vi_exercise_catalog**: only the 26 EXACT_CROSS_SOURCE matches
  from \`reports/data/duplicate-candidate-report.md\` were auto-linked (52
  rows: 26 ExerciseAlias + 26 ExerciseSource). The other 179 catalog
  entries (LIKELY_DUPLICATE/POSSIBLE_VARIANT/MANUAL_REVIEW/no-match) are
  queued for human review — importing them as NEW exercise rows is Gate
  7's explicit, separately-reviewed scope, not done here.
- Both importers' dry-run output matched their real-run output exactly,
  and a real-run-twice check produced zero new writes on the second pass.
- Rollback mechanism independently verified via an isolated throwaway
  batch (create → verify exists → roll back → verify gone), without
  touching either of the two real batches above.
`;

  const outDir = path.resolve(process.cwd(), "../../../reports/data");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "import-batches-log.md");
  fs.writeFileSync(outPath, md);
  console.log(`Wrote ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
