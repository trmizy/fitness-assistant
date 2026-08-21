/**
 * Corrective pass for a real bug found via the regression suite
 * immediately after newExerciseImporter.ts's real run: the 21 newly
 * imported exercises (status=STAGING) were given movementPattern values
 * straight from the catalog's OWN lowercase snake_case taxonomy
 * (data/catalog/taxonomy/ref_movement_patterns.csv), which is a
 * DIFFERENT vocabulary from the live schema's canonical UPPERCASE
 * taxonomy (src/constants/movement-patterns.ts, populated by
 * prisma/seed_movement_patterns.ts) — exactly the taxonomy-mismatch risk
 * flagged (but not yet acted on) in docs/audit/exercise-nutrition-data-
 * impact-map.md §1. Also: no ExerciseEquipment rows were created for
 * these 21 rows at all (only the coarse typeOfEquipment enum was set),
 * breaking the "every exercise has at least one equipment link"
 * invariant every other live exercise satisfies.
 *
 * This is a one-time correction of content THIS importer created moments
 * ago (still STAGING, unreferenced by anything) — not a retroactive
 * change to any pre-existing exercise's data.
 *
 * Run inside the fitness-service container:
 *   npx tsx src/scripts/fixNewExerciseTaxonomyAndEquipment.ts
 */
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../repositories/prisma";

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

// Catalog (ref_movement_patterns.csv, lowercase snake_case) -> canonical
// live taxonomy (src/constants/movement-patterns.ts, UPPERCASE). Built by
// hand, one row per catalog value that actually exists — not a
// mechanical .toUpperCase() (glute_bridge and core_anti_rotation don't
// have a 1:1 uppercase counterpart, they map to the closest existing
// canonical category instead, documented inline).
const MOVEMENT_PATTERN_MAP: Record<string, string> = {
  horizontal_push: "HORIZONTAL_PUSH",
  vertical_push: "VERTICAL_PUSH",
  horizontal_pull: "HORIZONTAL_PULL",
  vertical_pull: "VERTICAL_PULL",
  squat: "SQUAT",
  hinge: "HINGE",
  lunge: "LUNGE",
  glute_bridge: "HIP_EXTENSION", // closest canonical category — a glute bridge IS a hip-extension pattern
  carry: "CARRY",
  core_anti_extension: "CORE_ANTI_EXTENSION",
  core_anti_rotation: "CORE_ANTI_EXTENSION", // no distinct anti-rotation category exists live; grouped with the other anti-movement/stability pattern rather than with active core_rotation
  core_flexion: "CORE_FLEXION",
  core_rotation: "CORE_ROTATION",
  calves: "CALF_RAISE",
  conditioning: "CARDIO",
  mobility: "MOBILITY",
};

// Catalog equipment code -> live Equipment.slug. Only mapping codes that
// actually appear in data/catalog/taxonomy/ref_equipment.csv; anything
// unmapped falls back to 'bodyweight' (never left null — every exercise
// must have at least one equipment link per the live integrity test).
const EQUIPMENT_SLUG_MAP: Record<string, string> = {
  bodyweight: "bodyweight",
  dumbbell: "dumbbell",
  barbell: "barbell",
  // NOT mapped to 'generic-machine' — that row is a deliberately inactive,
  // documented internal fallback ("0 exercises actually reference it" per
  // its own description, an invariant a naive generic mapping here would
  // have silently broken — caught by equipment-invariants.test.ts).
  // "machine" alone is too vague to resolve correctly for a specific
  // exercise; see EXPLICIT_EQUIPMENT_NAME_OVERRIDES below for the
  // per-exercise-name resolution this actually needs, matching the same
  // precedent seed_equipment.ts already established for exactly this
  // ambiguity.
  foam_roller: "foam-roller",
  cable: "cable-machine",
  kettlebell: "kettlebell",
  resistance_band: "resistance-band",
  smith_machine: "smith-machine",
  pullup_bar: "pull-up-bar",
  bench: "bench",
  trap_bar: "barbell", // no dedicated trap-bar slug live; closest real equivalent
  medicine_ball: "medicine-ball",
  suspension_trainer: "suspension-trainer",
  landmine: "barbell", // landmine attachment is used WITH a barbell; no dedicated slug live
  rower: "rowing-machine",
  bike: "stationary-bike",
  treadmill: "treadmill",
  elliptical: "treadmill", // no dedicated elliptical slug live; closest cardio-machine equivalent
  sled: "sled",
};

// Per-exercise-name overrides for catalog rows whose generic "machine"
// equipment code needs a SPECIFIC live machine slug to resolve correctly
// — the same precedent seed_equipment.ts's EXPLICIT_EQUIPMENT_OVERRIDES
// already established. Checked before the generic per-code map.
const EXPLICIT_EQUIPMENT_NAME_OVERRIDES: Record<string, string[]> = {
  "Pec Deck": ["pec-deck-machine"],
  "45-Degree Hip Extension": ["hyperextension-bench"],
};

async function main() {
  const csvPath = path.resolve(process.cwd(), "../../../data/catalog/plans/gym_exercises.csv");
  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCSVLine(lines[0]);
  const idx = (col: string) => header.indexOf(col);
  const catalogByExternalId = new Map<string, { movementPattern: string; equipment: string[] }>();
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < header.length) continue;
    catalogByExternalId.set(fields[idx("exercise_id")], {
      movementPattern: fields[idx("movement_pattern")],
      equipment: fields[idx("equipment")].split("|").filter(Boolean),
    });
  }

  const sources = await prisma.exerciseSource.findMany({
    where: { sourceName: "curated_vi_exercise_catalog" },
    select: { exerciseId: true, externalId: true },
  });

  const equipmentBySlug = new Map(
    (await prisma.equipment.findMany({ select: { id: true, slug: true } })).map((e) => [e.slug, e.id]),
  );

  let taxonomyFixed = 0;
  let equipmentLinksCreated = 0;
  let staleInactiveLinksRemoved = 0;
  let unmappedMovementPatterns: string[] = [];

  const inactiveEquipmentIds = new Set(
    (await prisma.equipment.findMany({ where: { active: false }, select: { id: true } })).map((e) => e.id),
  );

  for (const src of sources) {
    const catalogRow = src.externalId ? catalogByExternalId.get(src.externalId) : undefined;
    if (!catalogRow) continue;

    const exercise = await prisma.exercise.findUnique({ where: { id: src.exerciseId }, select: { status: true, movementPattern: true, exerciseName: true } });
    if (!exercise || exercise.status !== "STAGING") continue; // only ever touch our own still-unreviewed STAGING rows

    const canonicalPattern = MOVEMENT_PATTERN_MAP[catalogRow.movementPattern];
    if (!canonicalPattern) {
      unmappedMovementPatterns.push(catalogRow.movementPattern);
    } else if (exercise.movementPattern !== canonicalPattern) {
      await prisma.exercise.update({ where: { id: src.exerciseId }, data: { movementPattern: canonicalPattern } });
      taxonomyFixed++;
    }

    // Remove any previously-created link pointing at an INACTIVE
    // equipment row (e.g. the earlier run's accidental use of the
    // deliberately-inactive 'generic-machine' fallback) before
    // (re-)resolving the correct one below.
    const existingLinks = await prisma.exerciseEquipment.findMany({
      where: { exerciseId: src.exerciseId },
      select: { id: true, equipmentId: true },
    });
    const staleLinks = existingLinks.filter((l) => inactiveEquipmentIds.has(l.equipmentId));
    if (staleLinks.length > 0) {
      await prisma.exerciseEquipment.deleteMany({ where: { id: { in: staleLinks.map((l) => l.id) } } });
      staleInactiveLinksRemoved += staleLinks.length;
    }

    const remainingLinkCount = existingLinks.length - staleLinks.length;
    if (remainingLinkCount === 0) {
      const overrideSlugs = EXPLICIT_EQUIPMENT_NAME_OVERRIDES[exercise.exerciseName];
      const slugs = new Set(
        overrideSlugs ?? catalogRow.equipment.map((code) => EQUIPMENT_SLUG_MAP[code] ?? "bodyweight"),
      );
      for (const slug of slugs) {
        const equipmentId = equipmentBySlug.get(slug);
        if (!equipmentId) continue;
        await prisma.exerciseEquipment.create({
          data: { exerciseId: src.exerciseId, equipmentId, requirementType: "REQUIRED" },
        });
        equipmentLinksCreated++;
      }
    }
  }

  console.log(JSON.stringify({ taxonomyFixed, equipmentLinksCreated, staleInactiveLinksRemoved, unmappedMovementPatterns: [...new Set(unmappedMovementPatterns)] }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
