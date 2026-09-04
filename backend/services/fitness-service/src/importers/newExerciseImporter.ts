/**
 * Gate 5/7 importer — creates genuinely NEW Exercise rows from
 * curated_vi_catalog entries the Gate 3 duplicate detector classifies as
 * DISTINCT (no live match at all) or POSSIBLE_VARIANT (confidently a
 * REAL, different exercise related to an existing one — never a
 * duplicate by the matcher's own definition). LIKELY_DUPLICATE and
 * MANUAL_REVIEW stay queued for a human. Every created row gets status
 * "STAGING" — invisible to AI-plan-generation and general browse/search
 * (see internal.controller.ts / exercise.service.ts's status gate) until
 * a human explicitly promotes it. This importer NEVER sets status to
 * PUBLISHED itself — that is a deliberate, separate, reviewed action.
 *
 * Idempotency note (verified, not just assumed): a SINGLE re-run is not
 * always a no-op, because "safe to create" is re-derived against the
 * CURRENT live set each time — as this importer's own earlier runs add
 * new rows, a catalog entry that was ambiguous against the ORIGINAL 883
 * can become a confident DISTINCT/POSSIBLE_VARIANT match against the
 * newly-larger live set (or vice versa). What IS guaranteed and was
 * directly verified: (1) it NEVER creates a true duplicate — every
 * candidate is checked against the full live set, including everything
 * this importer itself already created, via the same externalId-based
 * ExerciseSource lookup used everywhere else; (2) repeated runs converge
 * to a stable fixed point (observed directly: 98 -> 31 -> 30 -> 0 newly
 * inserted across successive runs on the real catalog). Always run to
 * convergence (repeat until a run reports 0 inserted) rather than
 * assuming one run is final.
 *
 * Run inside the fitness-service container:
 *   npx tsx src/importers/newExerciseImporter.ts --dry-run --report
 *   npx tsx src/importers/newExerciseImporter.ts --report          (real run)
 *   npx tsx src/importers/newExerciseImporter.ts --rollback-batch <id>
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
import type { ExerciseType, EquipmentType, BodyPart, MovementType } from "../generated/prisma";

export const SOURCE = "curated_vi_exercise_catalog";

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

export interface CatalogRow {
  externalId: string;
  nameVi: string;
  nameEn: string;
  category: string;
  movementPattern: string;
  primaryMuscles: string[];
  equipment: string[];
  difficulty: string;
  isCompound: boolean;
  isUnilateral: boolean;
  forceType: string;
  setup: string;
  executionSteps: string;
  commonErrors: string;
  contraindications: string;
}

export function loadCatalog(): { rows: CatalogRow[]; raw: string } {
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
      category: fields[idx("category")],
      movementPattern: fields[idx("movement_pattern")],
      primaryMuscles: fields[idx("primary_muscles")].split("|").filter(Boolean),
      equipment: fields[idx("equipment")].split("|").filter(Boolean),
      difficulty: fields[idx("difficulty")],
      isCompound: fields[idx("is_compound")].trim().toLowerCase() === "true",
      isUnilateral: fields[idx("is_unilateral")].trim().toLowerCase() === "true",
      forceType: fields[idx("force_type")],
      setup: fields[idx("setup")],
      executionSteps: fields[idx("execution_steps")],
      commonErrors: fields[idx("common_errors")],
      contraindications: fields[idx("contraindications")],
    });
  }
  return { rows, raw };
}

export async function loadLiveExercises(): Promise<ExerciseMatchCandidate[]> {
  const rows = await prisma.exercise.findMany({
    select: { id: true, exerciseName: true, typeOfEquipment: true, muscleGroupsActivated: true, movementPattern: true, mechanics: true },
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

// Coarse mapping from the catalog's richer taxonomy down to the legacy
// hard-enum columns every existing consumer still reads (typeOfActivity/
// typeOfEquipment/bodyPart/type) — same "keep the coarse enum for
// backward compat, richer fields are additive" approach the schema's own
// comments already establish for movementPattern/mechanics.
const EQUIPMENT_MAP: Record<string, EquipmentType> = {
  barbell: "BARBELL", dumbbell: "DUMBBELLS", kettlebell: "KETTLEBELL", machine: "MACHINE",
  cable: "CABLE", bodyweight: "BODYWEIGHT", band: "RESISTANCE_BAND", medicine_ball: "MEDICINE_BALL",
  foam_roller: "FOAM_ROLLER", bench: "BODYWEIGHT", pullup_bar: "BODYWEIGHT", trap_bar: "BARBELL",
  suspension_trainer: "BODYWEIGHT", landmine: "BARBELL", rower: "BODYWEIGHT", bike: "BODYWEIGHT", treadmill: "BODYWEIGHT",
};
function mapEquipment(codes: string[]): EquipmentType {
  for (const c of codes) if (EQUIPMENT_MAP[c]) return EQUIPMENT_MAP[c];
  return "BODYWEIGHT";
}
function mapBodyPart(muscles: string[]): BodyPart {
  const lower = new Set(muscles.map((m) => m.toLowerCase()));
  const core = ["abs", "obliques", "transverse_abs", "spinal_erectors", "core"];
  const lowerBody = ["glutes", "quads", "hamstrings", "adductors", "abductors", "calves", "hip_flexors"];
  const upperBody = ["chest", "upper_chest", "mid_chest", "lower_chest", "front_delts", "side_delts", "rear_delts", "triceps", "biceps", "forearms", "lats", "upper_back", "mid_back", "traps", "rotator_cuff"];
  if ([...lower].some((m) => core.includes(m))) return "CORE";
  if ([...lower].some((m) => lowerBody.includes(m))) return "LOWER_BODY";
  if ([...lower].some((m) => upperBody.includes(m))) return "UPPER_BODY";
  return "FULL_BODY";
}
function mapActivityType(category: string): ExerciseType {
  const c = category.toLowerCase();
  if (c.includes("cardio")) return "CARDIO";
  if (c.includes("mobility") || c.includes("stretch")) return "MOBILITY";
  return "STRENGTH";
}
function mapMovementType(forceType: string): MovementType {
  const f = forceType.toLowerCase();
  if (f === "pull") return "PULL";
  if (f === "static" || f === "hold") return "HOLD";
  if (f === "stretch") return "STRETCH";
  return "PUSH";
}

// Root-cause fix (found via the first 21-exercise run's own regression
// suite, corrected after the fact by fixNewExerciseTaxonomyAndEquipment.ts
// — applied HERE directly now so every subsequent import gets it right at
// creation time, not via a follow-up repair pass): the catalog's own
// lowercase snake_case movementPattern taxonomy
// (data/catalog/taxonomy/ref_movement_patterns.csv) is a DIFFERENT
// vocabulary from the live schema's canonical UPPERCASE taxonomy
// (src/constants/movement-patterns.ts / prisma/seed_movement_patterns.ts)
// — writing the catalog value verbatim silently introduces stray values
// the rest of the app has never seen.
const MOVEMENT_PATTERN_MAP: Record<string, string> = {
  horizontal_push: "HORIZONTAL_PUSH",
  vertical_push: "VERTICAL_PUSH",
  horizontal_pull: "HORIZONTAL_PULL",
  vertical_pull: "VERTICAL_PULL",
  squat: "SQUAT",
  hinge: "HINGE",
  lunge: "LUNGE",
  glute_bridge: "HIP_EXTENSION",
  carry: "CARRY",
  core_anti_extension: "CORE_ANTI_EXTENSION",
  core_anti_rotation: "CORE_ANTI_EXTENSION",
  core_flexion: "CORE_FLEXION",
  core_rotation: "CORE_ROTATION",
  calves: "CALF_RAISE",
  conditioning: "CARDIO",
  mobility: "MOBILITY",
};
function mapMovementPattern(catalogPattern: string): string | null {
  return MOVEMENT_PATTERN_MAP[catalogPattern] ?? null;
}

// Root-cause fix, same origin as above: catalog equipment code -> live
// Equipment.slug, deliberately never resolving to 'generic-machine' (a
// documented, intentionally-inactive internal fallback — see
// fixNewExerciseTaxonomyAndEquipment.ts's comment for the full story of
// how using it the first time broke a real integrity invariant).
const EQUIPMENT_SLUG_MAP: Record<string, string> = {
  bodyweight: "bodyweight",
  dumbbell: "dumbbell",
  barbell: "barbell",
  foam_roller: "foam-roller",
  cable: "cable-machine",
  kettlebell: "kettlebell",
  resistance_band: "resistance-band",
  smith_machine: "smith-machine",
  pullup_bar: "pull-up-bar",
  bench: "bench",
  trap_bar: "barbell",
  medicine_ball: "medicine-ball",
  suspension_trainer: "suspension-trainer",
  landmine: "barbell",
  rower: "rowing-machine",
  bike: "stationary-bike",
  treadmill: "treadmill",
  elliptical: "treadmill",
  sled: "sled",
};
// Per-exercise-name overrides for catalog rows whose "machine" equipment
// code needs a SPECIFIC live machine slug — same precedent
// seed_equipment.ts's EXPLICIT_EQUIPMENT_OVERRIDES already established.
// Extend this map by exercise name as new "machine"-equipped catalog rows
// are found to need it (verified via the equipment-invariants test suite
// after each real run, same as how the first two were found).
const EXPLICIT_EQUIPMENT_NAME_OVERRIDES: Record<string, string[]> = {
  "Pec Deck": ["pec-deck-machine"],
  "45-Degree Hip Extension": ["hyperextension-bench"],
};
function mapEquipmentSlugs(exerciseName: string, codes: string[]): string[] {
  const override = EXPLICIT_EQUIPMENT_NAME_OVERRIDES[exerciseName];
  if (override) return override;
  const slugs = new Set(codes.map((code) => EQUIPMENT_SLUG_MAP[code] ?? "bodyweight"));
  return [...slugs];
}

/**
 * The actual "create one new STAGING exercise from one catalog row" logic
 * — extracted so Gate 7's review service (a human explicitly deciding
 * APPROVE_AS_NEW_STAGING on a LIKELY_DUPLICATE/MANUAL_REVIEW candidate
 * this importer's own auto-import deliberately skipped) creates EXACTLY
 * the same shape of row this importer does, rather than a second,
 * potentially-drifting copy of the same mapping logic. Never called for
 * DISTINCT/POSSIBLE_VARIANT candidates by this importer's own main loop
 * without going through the caller's own duplicate-checked flow first —
 * this function itself does not re-check for an existing ExerciseSource,
 * callers must do that (both this file's main() and the review service
 * already do, right before calling this).
 */
export async function createStagingExerciseFromCatalogRow(
  row: CatalogRow,
  sourceVersion?: string,
): Promise<
  | { ok: true; exerciseId: string; equipmentLinkIds: string[]; aliasId: string; sourceId: string }
  | { ok: false; error: string }
> {
  const canonicalMovementPattern = mapMovementPattern(row.movementPattern);
  if (!canonicalMovementPattern) {
    return { ok: false, error: `unmapped movementPattern: ${row.movementPattern}` };
  }

  const exercise = await prisma.exercise.create({
    data: {
      exerciseName: row.nameEn,
      typeOfActivity: mapActivityType(row.category),
      typeOfEquipment: mapEquipment(row.equipment),
      bodyPart: mapBodyPart(row.primaryMuscles),
      type: mapMovementType(row.forceType),
      muscleGroupsActivated: [...row.primaryMuscles],
      instructions: row.executionSteps || row.setup || "",
      movementPattern: canonicalMovementPattern,
      mechanics: row.isCompound ? "compound" : "isolation",
      contraindications: row.contraindications ? row.contraindications.split(";").map((s) => s.trim()).filter(Boolean) : [],
      difficultyLevel: row.difficulty || null,
      status: "STAGING",
    },
  });

  const equipmentLinkIds: string[] = [];
  const equipmentSlugs = mapEquipmentSlugs(row.nameEn, row.equipment);
  for (const slug of equipmentSlugs) {
    const equipmentRow = await prisma.equipment.findUnique({ where: { slug }, select: { id: true } });
    if (!equipmentRow) continue;
    const link = await prisma.exerciseEquipment.create({
      data: { exerciseId: exercise.id, equipmentId: equipmentRow.id, requirementType: "REQUIRED" },
    });
    equipmentLinkIds.push(link.id);
  }

  const alias = await prisma.exerciseAlias.create({
    data: {
      exerciseId: exercise.id,
      language: "vi",
      alias: row.nameVi,
      aliasNormalized: normalizeVietnamese(row.nameVi),
      aliasType: "localized_name",
      source: SOURCE,
    },
  });

  const source = await prisma.exerciseSource.create({
    data: {
      exerciseId: exercise.id,
      sourceName: SOURCE,
      externalId: row.externalId,
      dataLicense: "original_curated",
      sourceVersion: sourceVersion ?? "2026-08-19",
      rawHash: crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex"),
    },
  });

  return { ok: true, exerciseId: exercise.id, equipmentLinkIds, aliasId: alias.id, sourceId: source.id };
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

  // Re-derive the safe-to-create-as-NEW-row set using the SAME detector
  // as Gate 3 — never hardcode a fixed list, always recompute so this
  // importer stays correct if the live catalog or the source CSV
  // changes. Safe = the best live match (if any) is either DISTINCT (no
  // match at all) or POSSIBLE_VARIANT (the matcher's own confident
  // classification that this is a REAL, DIFFERENT exercise related to an
  // existing one — by definition never a duplicate). LIKELY_DUPLICATE and
  // MANUAL_REVIEW are deliberately excluded here — those genuinely might
  // be the same exercise under a different name, and creating a new row
  // for them without a human first resolving the ambiguity is exactly
  // the kind of un-reviewed duplicate creation the whole matcher exists
  // to prevent.
  function rawNameJaccard(a: string, b: string): number {
    const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
    const setA = tok(a);
    const setB = tok(b);
    const intersection = [...setA].filter((x) => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
  }
  const SAFE_TO_CREATE_DECISIONS = new Set(["DISTINCT", "POSSIBLE_VARIANT"]);
  const safeRows = catalog.filter((catalogRow) => {
    const candidate: ExerciseMatchCandidate = {
      id: catalogRow.externalId,
      name: catalogRow.nameEn,
      source: "curated_vi_catalog",
      externalId: catalogRow.externalId,
      equipment: catalogRow.equipment,
      primaryMuscles: catalogRow.primaryMuscles,
      movementPattern: catalogRow.movementPattern,
      mechanics: catalogRow.isCompound ? "compound" : "isolation",
    };
    let best: { decision: string; confidence: number; tiebreak: number } | null = null;
    for (const liveCandidate of live) {
      const result = detectDuplicate(candidate, liveCandidate);
      if (result.decision === "DISTINCT") continue;
      const tiebreak = rawNameJaccard(candidate.name, liveCandidate.name);
      if (!best || result.confidence > best.confidence || (result.confidence === best.confidence && tiebreak > best.tiebreak)) {
        best = { decision: result.decision, confidence: result.confidence, tiebreak };
      }
    }
    return !best || SAFE_TO_CREATE_DECISIONS.has(best.decision);
  });

  const limited = options.limit ? safeRows.slice(0, options.limit) : safeRows;
  const handle = await startImportBatch(SOURCE + "_new_exercises", options, checksum);
  console.log(`Batch ${handle.batchId} started — ${limited.length} safe-to-create catalog entries (of ${safeRows.length} DISTINCT/POSSIBLE_VARIANT found; LIKELY_DUPLICATE and MANUAL_REVIEW stay queued for human review)${options.dryRun ? " (DRY RUN)" : ""}.`);

  try {
    for (const row of limited) {
      const existingSource = await prisma.exerciseSource.findFirst({
        where: { sourceName: SOURCE, externalId: row.externalId },
      });
      if (existingSource) {
        await handle.record({ externalRef: row.externalId, decision: "SKIPPED_DUPLICATE", targetTable: "exercise_sources", targetId: existingSource.id });
        continue;
      }

      if (options.dryRun) {
        await handle.record({ externalRef: row.externalId, decision: "INSERTED", detail: { dryRun: true, nameVi: row.nameVi, nameEn: row.nameEn, status: "STAGING" } });
        continue;
      }

      const created = await createStagingExerciseFromCatalogRow(row, options.sourceVersion);
      if (!created.ok) {
        await handle.record({ externalRef: row.externalId, decision: "ERROR", detail: { reason: created.error } });
        continue;
      }
      await handle.record({ externalRef: row.externalId, decision: "INSERTED", targetTable: "exercises", targetId: created.exerciseId });
      // Every exercise must have at least one ExerciseEquipment link — the
      // granular source of truth every consumer besides the legacy coarse
      // typeOfEquipment enum actually reads (equipment-invariants.test.ts).
      for (const linkId of created.equipmentLinkIds) {
        await handle.record({ externalRef: `${row.externalId}::equipment`, decision: "INSERTED", targetTable: "exercise_equipment", targetId: linkId });
      }
      await handle.record({ externalRef: `${row.externalId}::alias`, decision: "INSERTED", targetTable: "exercise_aliases", targetId: created.aliasId });
      await handle.record({ externalRef: `${row.externalId}::source`, decision: "INSERTED", targetTable: "exercise_sources", targetId: created.sourceId });
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

// CRITICAL: this module's exports (loadCatalog, loadLiveExercises,
// createStagingExerciseFromCatalogRow, SOURCE) are now imported by
// exercise-review.service.ts (Gate 7) as real application code, not just
// run standalone via `npx tsx`. Without this guard, simply IMPORTING this
// file — which happens every time the server boots and loads the Gate 7
// review routes — would execute a full real import batch AND disconnect
// the server's shared Prisma client on "completion", both as invisible
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
