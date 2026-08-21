/**
 * Gate 6 — populates ExerciseMuscle (canonical Muscle, real primary/
 * secondary distinction) for the muscle-map SVG UI. Two source paths,
 * each using the MOST PRECISE data actually available rather than a
 * single lossy heuristic for everything:
 *
 *  1. Catalog-sourced exercises (ExerciseSource.sourceName =
 *     curated_vi_exercise_catalog): use gym_exercises.csv's own
 *     primary_muscles/secondary_muscles columns directly — already coded
 *     in the SAME canonical vocabulary as the Muscle table (both derive
 *     from data/catalog/taxonomy/ref_muscles.csv), so no translation
 *     ambiguity at all.
 *  2. free-exercise-db-sourced exercises (ExerciseSource.sourceName =
 *     free_exercise_db, from freeExerciseDbProvenanceImporter.ts): the
 *     live flat muscleGroupsActivated string[] column LOSES the
 *     primary/secondary split, but prisma/raw_exercises.json — the exact
 *     original source file — still has it (primaryMuscles[]/
 *     secondaryMuscles[] as SEPARATE arrays). Looked up by the real
 *     ExerciseSource.externalId (not a fragile re-match-by-name), so this
 *     is exact data, not a guess about which N items were "probably"
 *     primary.
 *
 * Exercises resolving to NEITHER path (the ~4 hand-authored equipment-gap
 * exercises with no ExerciseSource yet) are left unmapped — reported, not
 * guessed. Any muscle-group value with no canonical Muscle.code match
 * (e.g. "neck" — a real gap: absent from ref_muscles.csv's 29-entry
 * taxonomy) is also left unmapped and reported, per the task's explicit
 * "show unmapped state, never guess" rule.
 *
 * Run inside the fitness-service container:
 *   npx tsx src/importers/exerciseMuscleMappingImporter.ts --dry-run --report
 *   npx tsx src/importers/exerciseMuscleMappingImporter.ts --report
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

const SOURCE = "exercise_muscle_mapping";

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') { current += '"'; i++; } else { inQuotes = !inQuotes; }
    } else if (char === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += char; }
  }
  result.push(current);
  return result;
}

// free-exercise-db's own muscle vocabulary -> canonical Muscle.code
// (ref_muscles.csv's 29 entries). Built from the FULL observed vocabulary
// across all 883 live rows (verified directly against the DB, not
// assumed). "neck" has no canonical match at all — deliberately absent,
// left unmapped rather than forced into an ill-fitting category.
const FREE_EXERCISE_DB_MUSCLE_MAP: Record<string, string> = {
  abdominals: "abs",
  abductors: "abductors",
  adductors: "adductors",
  back: "upper_back", // coarse — "back" alone doesn't distinguish upper/mid/lower; upper_back is the most common intended target for an unqualified "back" tag in this dataset
  biceps: "biceps",
  calves: "calves",
  chest: "chest",
  forearms: "forearms",
  glutes: "glutes",
  hamstrings: "hamstrings",
  lats: "lats",
  "lower back": "spinal_erectors",
  "middle back": "mid_back",
  quadriceps: "quads",
  quads: "quads",
  shoulders: "side_delts", // coarse — "shoulders" alone doesn't distinguish front/side/rear delt; side_delts is the most common intended target for an unqualified "shoulders" tag
  traps: "traps",
  triceps: "triceps",
  // "neck" intentionally not mapped — no equivalent in ref_muscles.csv's
  // 29-entry canonical taxonomy.
};

// Real, previously-undiscovered finding from this importer's own dry-run:
// data/catalog/plans/gym_exercises.csv's primary_muscles/secondary_muscles
// columns use SOME values not present in ref_muscles.csv — its own
// sibling taxonomy file in the same catalog, which the Muscle table was
// seeded from. Verified directly (grep against the real CSV, not
// assumed): "shoulders" (24×), "legs" (23×), "hips" (6×), "lower_traps"
// (2×), "upper_traps" (10×), and a bare "none" placeholder (8×, meaning
// "no specific muscle target" — e.g. some conditioning entries — not
// missing data). Translated the same conservative way as the
// free-exercise-db coarse terms above; "legs" is left UNMAPPED rather
// than guessed (too ambiguous between quads/hamstrings/glutes/calves to
// pick one without inventing an assertion the source data doesn't
// actually make); "none" is silently skipped (not an error, not a
// mapping — a real "no target" signal).
const CATALOG_MUSCLE_MAP: Record<string, string | null> = {
  shoulders: "side_delts",
  hips: "hip_flexors",
  lower_traps: "traps",
  upper_traps: "traps",
  legs: null, // too ambiguous to map without guessing — left unmapped, reported
  none: null, // legitimate "no specific muscle target" signal — skipped silently, not reported as an error
};

interface RawExercise {
  id: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
}

async function main() {
  const options = parseImportCliArgs(process.argv.slice(2));
  if (options.rollbackBatch) {
    await rollbackImportBatch(options.rollbackBatch);
    return;
  }

  const catalogCsvPath = path.resolve(process.cwd(), "../../../data/catalog/plans/gym_exercises.csv");
  const catalogRaw = fs.readFileSync(catalogCsvPath, "utf-8");
  const catalogLines = catalogRaw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const catalogHeader = parseCSVLine(catalogLines[0]);
  const catalogIdx = (col: string) => catalogHeader.indexOf(col);
  const catalogByExternalId = new Map<string, { primary: string[]; secondary: string[] }>();
  for (let i = 1; i < catalogLines.length; i++) {
    const fields = parseCSVLine(catalogLines[i]);
    if (fields.length < catalogHeader.length) continue;
    catalogByExternalId.set(fields[catalogIdx("exercise_id")], {
      primary: fields[catalogIdx("primary_muscles")].split("|").filter(Boolean),
      secondary: fields[catalogIdx("secondary_muscles")].split("|").filter(Boolean),
    });
  }

  const rawJsonPath = path.join(__dirname, "../../prisma/raw_exercises.json");
  const rawJson = fs.readFileSync(rawJsonPath, "utf-8");
  const rawItems: RawExercise[] = JSON.parse(rawJson);
  const rawByExternalId = new Map(rawItems.map((item) => [item.id, item]));

  const checksum = crypto.createHash("sha256").update(catalogRaw + rawJson).digest("hex");

  const muscleIdByCode = new Map(
    (await prisma.muscle.findMany({ select: { id: true, code: true } })).map((m) => [m.code, m.id]),
  );

  const allSources = await prisma.exerciseSource.findMany({
    select: { exerciseId: true, sourceName: true, externalId: true },
  });
  const limited = options.limit ? allSources.slice(0, options.limit) : allSources;

  const handle = await startImportBatch(SOURCE, options, checksum);
  console.log(`Batch ${handle.batchId} started — resolving muscle mappings for ${limited.length} exercise-source records${options.dryRun ? " (DRY RUN)" : ""}.`);

  const unmappedMuscleCodesSeen = new Set<string>();

  async function upsertLink(exerciseId: string, muscleCode: string, role: "primary" | "secondary", provenance: string) {
    const muscleId = muscleIdByCode.get(muscleCode);
    if (!muscleId) {
      unmappedMuscleCodesSeen.add(muscleCode);
      await handle.record({ externalRef: `${exerciseId}::${muscleCode}::${role}`, decision: "ERROR", detail: { reason: "no canonical Muscle for this code", muscleCode } });
      return;
    }
    const existing = await prisma.exerciseMuscle.findFirst({ where: { exerciseId, muscleId, role } });
    if (existing) {
      await handle.record({ externalRef: `${exerciseId}::${muscleCode}::${role}`, decision: "SKIPPED_DUPLICATE", targetTable: "exercise_muscles", targetId: existing.id });
      return;
    }
    if (options.dryRun) {
      await handle.record({ externalRef: `${exerciseId}::${muscleCode}::${role}`, decision: "INSERTED", detail: { dryRun: true, provenance } });
      return;
    }
    const link = await prisma.exerciseMuscle.create({
      data: { exerciseId, muscleId, role, source: provenance },
    });
    await handle.record({ externalRef: `${exerciseId}::${muscleCode}::${role}`, decision: "INSERTED", targetTable: "exercise_muscles", targetId: link.id });
  }

  // Catalog values are USUALLY already canonical (chest, front_delts, ...
  // — the Muscle table was seeded straight from ref_muscles.csv, the
  // catalog's own sibling taxonomy file) — try the raw code directly
  // first; only fall through to CATALOG_MUSCLE_MAP for the handful of
  // values that turned out NOT to be, found via this importer's own
  // dry-run rather than assumed.
  function resolveCatalogMuscleCode(rawCode: string): { code: string | null; skipSilently: boolean } {
    if (muscleIdByCode.has(rawCode)) return { code: rawCode, skipSilently: false };
    if (rawCode in CATALOG_MUSCLE_MAP) {
      const mapped = CATALOG_MUSCLE_MAP[rawCode];
      return { code: mapped, skipSilently: mapped === null && rawCode === "none" };
    }
    return { code: null, skipSilently: false };
  }

  try {
    for (const src of limited) {
      if (src.sourceName === "curated_vi_exercise_catalog" && src.externalId) {
        const catalogRow = catalogByExternalId.get(src.externalId);
        if (!catalogRow) continue;
        for (const raw of catalogRow.primary) {
          const { code, skipSilently } = resolveCatalogMuscleCode(raw);
          if (code) await upsertLink(src.exerciseId, code, "primary", "curated_vi_catalog");
          else if (!skipSilently) unmappedMuscleCodesSeen.add(raw);
        }
        for (const raw of catalogRow.secondary) {
          const { code, skipSilently } = resolveCatalogMuscleCode(raw);
          if (code) await upsertLink(src.exerciseId, code, "secondary", "curated_vi_catalog");
          else if (!skipSilently) unmappedMuscleCodesSeen.add(raw);
        }
      } else if (src.sourceName === "free_exercise_db" && src.externalId) {
        const rawItem = rawByExternalId.get(src.externalId);
        if (!rawItem) continue;
        for (const m of rawItem.primaryMuscles) {
          const mapped = FREE_EXERCISE_DB_MUSCLE_MAP[m];
          if (mapped) await upsertLink(src.exerciseId, mapped, "primary", "free_exercise_db");
          else unmappedMuscleCodesSeen.add(m);
        }
        for (const m of rawItem.secondaryMuscles) {
          const mapped = FREE_EXERCISE_DB_MUSCLE_MAP[m];
          if (mapped) await upsertLink(src.exerciseId, mapped, "secondary", "free_exercise_db");
          else unmappedMuscleCodesSeen.add(m);
        }
      }
    }

    await handle.finish("COMPLETED");
  } catch (err) {
    await handle.finish("FAILED");
    throw err;
  }

  console.log("Unmapped free-exercise-db muscle codes encountered (no canonical Muscle.code — reported, not guessed):", [...unmappedMuscleCodesSeen]);

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
