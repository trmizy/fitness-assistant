import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import {
  collectExerciseCatalogMetrics,
  disconnectExerciseCatalogValidator,
} from "../scripts/validateExerciseCatalog";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test|localhost:55433)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

function runSeed() {
  const serviceRoot = path.resolve(__dirname, "../..");
  const tsxBin = path.join(
    serviceRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.CMD" : "tsx",
  );
  execFileSync(tsxBin, [path.join("src", "scripts", "seedTestExerciseCatalog.ts")], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: fitnessDatabaseUrl,
      FITNESS_DATABASE_URL: fitnessDatabaseUrl,
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

test.after(async () => {
  await disconnectExerciseCatalogValidator();
});

test(
  "test catalog seed is repeatable and preserves core catalog invariants",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at an isolated test database.",
  },
  async () => {
    runSeed();
    const first = await collectExerciseCatalogMetrics();

    runSeed();
    const second = await collectExerciseCatalogMetrics();

    assert.equal(second.sourcedExerciseCount, first.sourcedExerciseCount, "sourced catalog exercise count must not grow on reseed");
    assert.equal(second.equipmentCount, first.equipmentCount, "equipment count must not grow on reseed");
    assert.equal(
      second.exerciseEquipmentLinkCount,
      first.exerciseEquipmentLinkCount,
      "exercise-equipment links must not duplicate on reseed",
    );
    assert.equal(second.exerciseSourceCount, first.exerciseSourceCount, "exercise sources must not duplicate on reseed");
    assert.equal(second.exerciseAliasCount, first.exerciseAliasCount, "exercise aliases must not duplicate on reseed");
    assert.equal(
      second.exerciseMuscleLinkCount,
      first.exerciseMuscleLinkCount,
      "exercise-muscle links must not duplicate on reseed",
    );

    assert.ok(second.sourcedExerciseCount > 0);
    assert.ok(second.equipmentCount > 0);
    assert.ok(second.exerciseEquipmentLinkCount > 0);
    assert.equal(second.timeLoadCount, 3);
    assert.equal(second.missingMovementPatternCount, 0);
    assert.equal(second.missingEquipmentLinkCount, 0);
    assert.equal(second.duplicateEquipmentSlugs.length, 0);
    assert.equal(second.duplicateExerciseSources.length, 0);
    assert.equal(second.duplicateExerciseAliases, 0);
    assert.equal(second.duplicateExerciseMuscleLinks, 0);
    assert.equal(second.duplicateExerciseEquipmentLinks, 0);
    assert.equal(second.orphanExerciseEquipmentLinks, 0);
    assert.equal(second.invalidRequirementTypeCount, 0);
    assert.equal(second.invalidMovementPatternCount, 0);
  },
);
