import test from "node:test";
import assert from "node:assert/strict";

// Real bug found while building Gate 7 (exercise-review.service.ts reuses
// newExerciseImporter.ts's helper functions as real application code):
// every importer in src/importers/ used to call main() unconditionally at
// module load time — simply `import`-ing one of these files (e.g. because
// a service now reuses one of its exported helpers, exactly like Gate 7
// does) would silently execute a REAL import batch AND disconnect the
// shared Prisma client, both as invisible side effects of an import
// statement. Every importer now guards its main() call with
// `if (require.main === module)`. This test proves the guard actually
// works for ALL SIX importers, not just the one Gate 7 happened to touch
// first — importing each one here must be a complete no-op against the
// database.

const fitnessDatabaseUrl =
  process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test",
};

const IMPORTER_MODULES = [
  "../newExerciseImporter",
  "../exerciseLocalizationImporter",
  "../exerciseMuscleMappingImporter",
  "../foodAliasImporter",
  "../freeExerciseDbProvenanceImporter",
  "../vietnameseDishImporter",
];

test(
  "importing every src/importers/*.ts module creates ZERO ImportBatch rows and never disconnects the shared Prisma client",
  skipOpts,
  async () => {
    const { prisma } = await import("../../repositories/prisma");

    const batchCountBefore = await prisma.importBatch.count();

    for (const modulePath of IMPORTER_MODULES) {
      // Dynamic import — the same mechanism a real service file (like
      // exercise-review.service.ts) uses to reuse an importer's helpers.
      // If main() ever fires as a side effect, this is exactly where it
      // would happen.
      const mod = await import(modulePath);
      assert.ok(mod, `expected ${modulePath} to import successfully`);
    }

    const batchCountAfter = await prisma.importBatch.count();
    assert.equal(
      batchCountAfter,
      batchCountBefore,
      "importing an importer module must never create a real ImportBatch row — main() should only run when the file is executed directly",
    );

    // If any importer's main() had run and hit its own
    // `.finally(() => prisma.$disconnect())`, this query would throw
    // ("Engine is not yet connected" / similar) — reaching this line at
    // all is itself part of the proof, not just the assertion below.
    const stillConnected = await prisma.exercise.count();
    assert.ok(
      typeof stillConnected === "number",
      "the shared Prisma client must still be connected and usable after importing every importer module",
    );
  },
);
