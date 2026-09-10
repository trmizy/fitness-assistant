/**
 * Orchestrator for the full fitness-service catalog seed pipeline.
 *
 * Runs each seed/import step as its own subprocess, in dependency order. This
 * is intentionally reused by dev and by the isolated test catalog setup, so
 * test data stays aligned with the product catalog instead of depending on a
 * developer-seeded database.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const tsxBin = path.join(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.CMD" : "tsx",
);

function runTsx(label: string, args: string[]): string {
  console.log(`\n-- ${label} --`);
  const output = execFileSync(tsxBin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  process.stdout.write(output);
  return output;
}

function runImporterToConvergence(fileName: string, maxRuns: number) {
  for (let run = 1; run <= maxRuns; run++) {
    const output = runTsx(
      `src/importers/${fileName} run ${run}/${maxRuns}`,
      [path.join("src", "importers", fileName), "--report"],
    );
    if (/Inserted:\s+0\b/.test(output)) return;
  }
  throw new Error(`${fileName} did not converge after ${maxRuns} runs`);
}

const PRISMA_STEPS = [
  "seed_exercises_json.ts",
  "seed_equipment.ts",
  "seed_movement_patterns.ts",
  "seed_equipment_gap_exercises.ts",
];

for (const step of PRISMA_STEPS) {
  runTsx(`prisma/${step}`, [path.join("prisma", step)]);
}

runTsx("src/importers/freeExerciseDbProvenanceImporter.ts", [
  path.join("src", "importers", "freeExerciseDbProvenanceImporter.ts"),
  "--report",
]);

runTsx("src/importers/exerciseLocalizationImporter.ts", [
  path.join("src", "importers", "exerciseLocalizationImporter.ts"),
  "--report",
]);

// newExerciseImporter.ts is intentionally convergent: newly-created curated
// rows can change later duplicate-detection decisions, so run until zero new
// inserts are reported. The observed catalog converges well under this cap.
runImporterToConvergence("newExerciseImporter.ts", 6);

runTsx("src/importers/exerciseMuscleMappingImporter.ts", [
  path.join("src", "importers", "exerciseMuscleMappingImporter.ts"),
  "--report",
]);

// Migrations backfill only rows that existed at migration time. Seed/imported
// rows need the same deterministic post-seed logging-mode correction.
runTsx("prisma/seed_logging_modes.ts", [path.join("prisma", "seed_logging_modes.ts")]);

console.log("\nFull seed pipeline complete.");
