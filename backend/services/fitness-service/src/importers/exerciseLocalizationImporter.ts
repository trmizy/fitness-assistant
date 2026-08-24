/**
 * Gate 5 importer — links the curated Vietnamese exercise catalog
 * (data/catalog/plans/gym_exercises.csv, 205 entries, original-curated,
 * no external-license question per Gate 0) onto EXISTING live exercises,
 * using the Gate 3 duplicate detector (exercise-duplicate-detector.ts).
 *
 * Deliberately scoped narrow for this pass: only acts on
 * EXACT_SAME_SOURCE / EXACT_CROSS_SOURCE decisions (the ~26 confident
 * matches from reports/data/duplicate-candidate-report.md) — creates an
 * ExerciseAlias (Vietnamese name) + ExerciseSource record on the existing
 * live Exercise row. NEVER creates a new Exercise row, NEVER changes an
 * existing exercise's id/exerciseName/instructions. Every other decision
 * tier (LIKELY_DUPLICATE, POSSIBLE_VARIANT, MANUAL_REVIEW, DISTINCT) is
 * recorded as REVIEW_QUEUED — importing genuinely NEW exercise rows from
 * the 21+95+... unmatched/variant catalog entries is Gate 7's job, with
 * its own explicit human-review step, not auto-done here.
 *
 * Run inside the fitness-service container:
 *   npx tsx src/importers/exerciseLocalizationImporter.ts --dry-run --report
 *   npx tsx src/importers/exerciseLocalizationImporter.ts --report          (real run)
 *   npx tsx src/importers/exerciseLocalizationImporter.ts --rollback-batch <id>
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { prisma } from "../repositories/prisma";
import { normalizeVietnamese } from "../utils/normalizeVietnamese";
import {
  detectDuplicate,
  type ExerciseMatchCandidate,
} from "../services/exercise-duplicate-detector";
import {
  parseImportCliArgs,
  startImportBatch,
  printBatchReport,
  rollbackImportBatch,
} from "./import-cli.util";

// Original curated content, first-party to this repo — see
// docs/research/fitness-data-source-and-license-review.md.
const SOURCE = "curated_vi_exercise_catalog";

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

interface CatalogRow {
  externalId: string;
  nameVi: string;
  nameEn: string;
  movementPattern: string;
  primaryMuscles: string[];
  equipment: string[];
  isCompound: boolean;
}

function loadCatalog(): { rows: CatalogRow[]; raw: string } {
  const csvPath = path.resolve(process.cwd(), "../../../data/catalog/plans/gym_exercises.csv");
  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCSVLine(lines[0]);
  const idx = (col: string) => header.indexOf(col);

  const rows: CatalogRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < header.length) continue;
    rows.push({
      externalId: fields[idx("exercise_id")],
      nameVi: fields[idx("exercise_name_vi")],
      nameEn: fields[idx("exercise_name_en")],
      movementPattern: fields[idx("movement_pattern")],
      primaryMuscles: fields[idx("primary_muscles")].split("|").filter(Boolean),
      equipment: fields[idx("equipment")].split("|").filter(Boolean),
      isCompound: fields[idx("is_compound")].trim().toLowerCase() === "true",
    });
  }
  return { rows, raw };
}

async function loadLiveExercises(): Promise<ExerciseMatchCandidate[]> {
  const rows = await prisma.exercise.findMany({
    select: {
      id: true,
      exerciseName: true,
      typeOfEquipment: true,
      muscleGroupsActivated: true,
      movementPattern: true,
      mechanics: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.exerciseName,
    source: "free_exercise_db_live",
    equipment: [r.typeOfEquipment.toLowerCase()],
    primaryMuscles: r.muscleGroupsActivated.map((m) => m.toLowerCase()),
    movementPattern: r.movementPattern,
    mechanics: r.mechanics === "compound" || r.mechanics === "isolation" ? (r.mechanics as "compound" | "isolation") : null,
  }));
}

function rawNameJaccard(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  const setA = tok(a);
  const setB = tok(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

async function main() {
  const options = parseImportCliArgs(process.argv.slice(2));

  if (options.rollbackBatch) {
    await rollbackImportBatch(options.rollbackBatch);
    return;
  }

  const { rows: catalog, raw } = loadCatalog();
  const live = await loadLiveExercises();
  const checksum = crypto.createHash("sha256").update(raw).digest("hex");
  const limited = options.limit ? catalog.slice(0, options.limit) : catalog;

  const handle = await startImportBatch(SOURCE, options, checksum);
  console.log(`Batch ${handle.batchId} started — ${limited.length} catalog entries to process against ${live.length} live exercises${options.dryRun ? " (DRY RUN)" : ""}.`);

  try {
    for (const catalogRow of limited) {
      const catalogCandidate: ExerciseMatchCandidate = {
        id: catalogRow.externalId,
        name: catalogRow.nameEn,
        source: "curated_vi_catalog",
        externalId: catalogRow.externalId,
        equipment: catalogRow.equipment,
        primaryMuscles: catalogRow.primaryMuscles,
        movementPattern: catalogRow.movementPattern,
        mechanics: catalogRow.isCompound ? "compound" : "isolation",
      };

      let best: { candidate: ExerciseMatchCandidate; result: ReturnType<typeof detectDuplicate>; tiebreak: number } | null = null;
      for (const liveCandidate of live) {
        const result = detectDuplicate(catalogCandidate, liveCandidate);
        if (result.decision === "DISTINCT") continue;
        const tiebreak = rawNameJaccard(catalogCandidate.name, liveCandidate.name);
        if (!best || result.confidence > best.result.confidence || (result.confidence === best.result.confidence && tiebreak > best.tiebreak)) {
          best = { candidate: liveCandidate, result, tiebreak };
        }
      }

      if (options.reviewOnly) {
        await handle.record({ externalRef: catalogRow.externalId, decision: "REVIEW_QUEUED", detail: { decision: best?.result.decision ?? "DISTINCT", note: "review-only mode" } });
        continue;
      }

      if (!best || (best.result.decision !== "EXACT_SAME_SOURCE" && best.result.decision !== "EXACT_CROSS_SOURCE")) {
        // Not a confident auto-link case — queue for human review (Gate
        // 7 territory), never act unilaterally here.
        await handle.record({
          externalRef: catalogRow.externalId,
          decision: "REVIEW_QUEUED",
          detail: best ? { decision: best.result.decision, liveExerciseId: best.candidate.id, liveExerciseName: best.candidate.name } : { decision: "DISTINCT" },
        });
        continue;
      }

      const exerciseId = best.candidate.id;
      const aliasNormalized = normalizeVietnamese(catalogRow.nameVi);

      const existingAlias = await prisma.exerciseAlias.findFirst({
        where: { exerciseId, language: "vi", aliasNormalized },
      });
      const existingSource = await prisma.exerciseSource.findFirst({
        where: { exerciseId, sourceName: SOURCE, externalId: catalogRow.externalId },
      });

      if (existingAlias && existingSource) {
        await handle.record({ externalRef: catalogRow.externalId, decision: "SKIPPED_DUPLICATE", targetTable: "exercise_aliases", targetId: existingAlias.id });
        continue;
      }

      if (options.dryRun) {
        await handle.record({
          externalRef: catalogRow.externalId,
          decision: "INSERTED",
          detail: { dryRun: true, liveExerciseId: exerciseId, liveExerciseName: best.candidate.name, nameVi: catalogRow.nameVi, matchDecision: best.result.decision },
        });
        continue;
      }

      try {
        if (!existingAlias) {
          const alias = await prisma.exerciseAlias.create({
            data: {
              exerciseId,
              language: "vi",
              alias: catalogRow.nameVi,
              aliasNormalized,
              aliasType: "localized_name",
              source: SOURCE,
            },
          });
          await handle.record({ externalRef: catalogRow.externalId, decision: "INSERTED", targetTable: "exercise_aliases", targetId: alias.id });
        }
        if (!existingSource) {
          const source = await prisma.exerciseSource.create({
            data: {
              exerciseId,
              sourceName: SOURCE,
              externalId: catalogRow.externalId,
              dataLicense: "original_curated",
              sourceVersion: options.sourceVersion ?? "2026-08-19",
              rawHash: crypto.createHash("sha256").update(JSON.stringify(catalogRow)).digest("hex"),
            },
          });
          await handle.record({ externalRef: `${catalogRow.externalId}::source`, decision: "INSERTED", targetTable: "exercise_sources", targetId: source.id });
        }
      } catch (err: any) {
        if (err.code === "P2002") {
          await handle.record({ externalRef: catalogRow.externalId, decision: "SKIPPED_DUPLICATE" });
          continue;
        }
        await handle.record({ externalRef: catalogRow.externalId, decision: "ERROR", detail: { message: err.message } });
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
// simply IMPORTING this file (e.g. a future caller reusing one of its
// helpers as application code, the way exercise-review.service.ts now
// reuses newExerciseImporter.ts's exports) would otherwise execute a full
// real import batch AND disconnect the shared Prisma client as invisible
// side effects of a require/import statement. Only run main() when this
// file is executed directly as a script.
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
