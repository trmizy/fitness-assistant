/**
 * Orchestrator for the full fitness-service seed pipeline. Runs each step
 * as its own subprocess, in dependency order, so this is the single
 * command (`pnpm seed` / `pnpm db:seed` / the Dockerfile.dev CMD's
 * `prisma db seed`) that reaches the actually-intended end state.
 *
 * Found 2026-09-07: seed_equipment.ts (Equipment catalog + Exercise<->
 * Equipment mapping) and seed_equipment_gap_exercises.ts (curated
 * exercises for equipment the source dataset has zero coverage for) were
 * real, working, idempotent scripts that existed in this directory but
 * were never wired into `db:seed` / the Dockerfile CMD — only
 * seed_exercises_json.ts was. A freshly-provisioned database (a new test
 * DB, a fresh `docker compose up`) therefore got exercises but silently
 * NO equipment data at all, with nothing surfacing the gap short of
 * running a full test suite and noticing ~109 unrelated-looking failures
 * (see docs/STATUS.md, confirmed on the test DB: equipment/
 * exercise_equipment were exactly 0 rows). The dev database itself was
 * fine (both had already been run against it by hand at some point —
 * confirmed via direct row counts, 46 equipment / 1113 links present
 * before this file existed) — this fixes the pipeline so that stops being
 * something that has to happen "by hand" at all.
 *
 * Steps run in order because seed_equipment.ts's exercise<->equipment
 * mapping step needs the Exercise table populated first, and
 * seed_equipment_gap_exercises.ts's curated exercises reference Equipment
 * rows that seed_equipment.ts's catalog step creates.
 *
 * Each script keeps its own independent `main()` / PrismaClient /
 * $disconnect() — spawning them as separate subprocesses (rather than
 * importing all three into one process) is what keeps that ordering real
 * instead of racing three concurrent Prisma clients against the same DB.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const PRISMA_STEPS = [
  "seed_exercises_json.ts", // exercises (+ foods, same file) — must run first
  "seed_equipment.ts", // Equipment catalog + Exercise<->Equipment mapping
  "seed_equipment_gap_exercises.ts", // curated exercises for zero-coverage equipment
];

// Also found 2026-09-07, same investigation: ExerciseSource (provenance)
// and ExerciseMuscle (primary/secondary muscle map, used by the muscle-
// heatmap feature) both key off the Exercise rows seed_exercises_json.ts
// creates, but neither script above populates them — a separate importer
// pair does, and it wasn't wired in either. Both are idempotent (each
// checks for an existing row before inserting — see their own
// findFirst-before-upsert calls), so safe to run on every provision the
// same way the steps above are.
const IMPORTER_STEPS = [
  "freeExerciseDbProvenanceImporter.ts", // ExerciseSource rows, keyed by exerciseName === raw_exercises.json's name
  "exerciseMuscleMappingImporter.ts", // ExerciseMuscle rows, keyed off the ExerciseSource rows just above
];

const tsxBin = path.join(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.CMD" : "tsx",
);

for (const step of PRISMA_STEPS) {
  console.log(`\n── prisma/${step} ──`);
  execFileSync(tsxBin, [path.join("prisma", step)], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

for (const step of IMPORTER_STEPS) {
  console.log(`\n── src/importers/${step} ──`);
  execFileSync(tsxBin, [path.join("src", "importers", step), "--report"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

console.log("\n✅  Full seed pipeline complete.");
