/**
 * Gate 4/5 — closes a real Gate 2 audit gap: the 883 free-exercise-db-
 * sourced exercises (seeded by prisma/seed_exercises_json.ts, LONG before
 * this pass's ExerciseSource table existed) have NEVER had their
 * provenance recorded at the database level — confirmed by
 * existing-catalog-audit.md's "unknownSourceOrLicense: 883". This
 * importer matches live exercises back to the exact source file
 * (prisma/raw_exercises.json — the same file seed_exercises_json.ts
 * originally read, matched by exact exerciseName === item.name, the
 * field that script wrote verbatim with no transformation) and records a
 * real ExerciseSource row: source=free_exercise_db, externalId=item.id,
 * dataLicense=Unlicense (per docs/research/fitness-data-source-and-
 * license-review.md's verified finding), mediaLicense explicitly marked
 * UNDOCUMENTED (also per that review — never silently implied safe).
 *
 * Purely additive metadata — never touches exerciseName/instructions/any
 * existing column, never changes status.
 *
 * Run inside the fitness-service container:
 *   npx tsx src/importers/freeExerciseDbProvenanceImporter.ts --dry-run --report
 *   npx tsx src/importers/freeExerciseDbProvenanceImporter.ts --report
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { prisma } from "../repositories/prisma";
import {
  parseImportCliArgs,
  startImportBatch,
  printBatchReport,
  rollbackImportBatch,
} from "./import-cli.util";

const SOURCE = "free_exercise_db";

interface RawExercise {
  id: string;
  name: string;
  images?: string[];
}

async function main() {
  const options = parseImportCliArgs(process.argv.slice(2));
  if (options.rollbackBatch) {
    await rollbackImportBatch(options.rollbackBatch);
    return;
  }

  const jsonPath = path.join(__dirname, "../../prisma/raw_exercises.json");
  const raw = fs.readFileSync(jsonPath, "utf-8");
  const items: RawExercise[] = JSON.parse(raw);
  const checksum = crypto.createHash("sha256").update(raw).digest("hex");
  const byName = new Map(items.map((item) => [item.name, item]));

  const liveExercises = await prisma.exercise.findMany({ select: { id: true, exerciseName: true } });
  const limited = options.limit ? liveExercises.slice(0, options.limit) : liveExercises;

  const handle = await startImportBatch(SOURCE + "_provenance_backfill", options, checksum);
  console.log(`Batch ${handle.batchId} started — matching ${limited.length} live exercises against ${items.length} free-exercise-db entries${options.dryRun ? " (DRY RUN)" : ""}.`);

  try {
    for (const exercise of limited) {
      const match = byName.get(exercise.exerciseName);
      if (!match) {
        // Not from this source (e.g. a curated_vi_catalog / equipment-gap
        // exercise, or the name diverged) — nothing to record, not an error.
        continue;
      }

      const existing = await prisma.exerciseSource.findFirst({
        where: { exerciseId: exercise.id, sourceName: SOURCE, externalId: match.id },
      });
      if (existing) {
        await handle.record({ externalRef: match.id, decision: "SKIPPED_DUPLICATE", targetTable: "exercise_sources", targetId: existing.id });
        continue;
      }

      if (options.dryRun) {
        await handle.record({ externalRef: match.id, decision: "INSERTED", detail: { dryRun: true, exerciseId: exercise.id, exerciseName: exercise.exerciseName } });
        continue;
      }

      const source = await prisma.exerciseSource.create({
        data: {
          exerciseId: exercise.id,
          sourceName: SOURCE,
          externalId: match.id,
          sourceUrl: "https://github.com/yuhonas/free-exercise-db",
          dataLicense: "Unlicense",
          // Deliberately NOT implying image safety — Gate 0's research
          // found free-exercise-db's images have NO documented license at
          // all, unlike the text data. Recorded explicitly rather than
          // left null/ambiguous.
          mediaLicense: "UNDOCUMENTED_DO_NOT_RELY_ON",
          sourceVersion: options.sourceVersion ?? "unknown-commit-at-original-seed-time",
        },
      });
      await handle.record({ externalRef: match.id, decision: "INSERTED", targetTable: "exercise_sources", targetId: source.id });
    }

    await handle.finish("COMPLETED");
  } catch (err) {
    await handle.finish("FAILED");
    throw err;
  }

  if (options.report) {
    await printBatchReport(handle.batchId);
  } else {
    console.log(`Batch ${handle.batchId} finished.`);
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
