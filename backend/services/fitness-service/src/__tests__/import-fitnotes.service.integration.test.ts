import test from "node:test";
import assert from "node:assert/strict";

/**
 * Roadmap P2.3 "FitNotes import" (docs/features/FITNOTES_IMPORT_IMPACT_ANALYSIS.md).
 *
 * commitImportBatch itself is already fully covered by Hevy's own
 * integration suite — it's provider-agnostic and unchanged. This file
 * proves the FitNotes-specific wiring: the previewFitNotesImport
 * wrapper, the merged-by-date grouping (FitNotes' real, disclosed
 * session-boundary limitation) flowing through to real committed rows,
 * and the source-aware "Nhập từ FitNotes" notes prefix.
 */

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type ImportServiceLike = (typeof import("../services/import.service"))["importService"];

let prisma: PrismaClientLike | undefined;
let importService: ImportServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/import.service");
    prisma = prismaModule.prisma;
    importService = serviceModule.importService;
  }
  return { prisma: prisma!, importService: importService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

const HEADER = "Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment";

async function cleanupUser(db: PrismaClientLike, userId: string) {
  await db.workoutImportBatch.deleteMany({ where: { userId } });
  await db.workoutSet.deleteMany({ where: { workoutExercise: { workout: { userId } } } });
  await db.workoutExercise.deleteMany({ where: { workout: { userId } } });
  await db.workout.deleteMany({ where: { userId } });
}

test(
  "previewFitNotesImport + commitImportBatch: real end-to-end round trip, two exercises on the same date merge into ONE Workout, source=FITNOTES",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, importService: svc } = await loadModules();
    const userId = `import-fitnotes-it-${Date.now()}`;
    try {
      const curl = await db.exercise.findFirst({ where: { exerciseName: "Barbell Curl" } });
      assert.ok(curl, "seed catalog must contain Barbell Curl for this test to be meaningful");

      const csv = [
        HEADER,
        "2024-01-08,Barbell Curl,Arms,20,kg,10,,,,",
        "2024-01-08,Barbell Curl,Arms,22.5,kg,8,,,,",
      ].join("\n");

      const preview = await svc.previewFitNotesImport(userId, "fitnotes-export.csv", csv) as any;
      assert.equal(preview.blocked, false);
      assert.equal(preview.workoutCount, 1);
      const curlMatch = preview.exerciseMatchSummary.find((s: any) => s.exerciseTitle === "Barbell Curl");
      assert.equal(curlMatch.isExactMatch, true);

      const batch = await db.workoutImportBatch.findUnique({ where: { id: preview.batchId } });
      assert.equal(batch!.source, "FITNOTES");

      const commitResult = await svc.commitImportBatch(userId, preview.batchId, {
        "Barbell Curl": { action: "USE_EXISTING", exerciseId: curl!.id },
      });
      assert.equal(commitResult.committedWorkoutCount, 1);

      const workout = await db.workout.findUnique({
        where: { id: commitResult.createdWorkoutIds[0] },
        include: { exercises: { include: { workoutSets: { orderBy: { setNumber: "asc" } } } } },
      });
      assert.ok(workout!.notes?.includes("Nhập từ FitNotes"));
      assert.equal(workout!.exercises.length, 1);
      const sets = workout!.exercises[0].workoutSets;
      assert.equal(sets.length, 2, "both same-date rows for the same exercise must land as 2 real sets, not merged/lost");
      assert.equal(sets[0].weight, 20);
      assert.equal(sets[1].weight, 22.5);
    } finally {
      await cleanupUser(db, userId);
    }
  },
);
