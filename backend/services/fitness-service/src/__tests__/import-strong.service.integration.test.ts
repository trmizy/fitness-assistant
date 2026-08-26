import test from "node:test";
import assert from "node:assert/strict";

/**
 * Roadmap P2.2 "Strong import" (docs/features/STRONG_IMPORT_IMPACT_ANALYSIS.md).
 *
 * commitImportBatch itself is already fully covered by
 * import.service.integration.test.ts (Hevy) — it's provider-agnostic and
 * unchanged. This file only proves the Strong-specific wiring: the
 * previewStrongImport wrapper, unit conversion flowing all the way
 * through to a real committed WorkoutSet, and the source-aware "Nhập từ
 * Strong" notes prefix.
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

const HEADER = "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Weight Unit,Reps,RPE,Distance,Distance Unit,Seconds,Notes,Workout Notes";

async function cleanupUser(db: PrismaClientLike, userId: string) {
  await db.workoutImportBatch.deleteMany({ where: { userId } });
  await db.workoutSet.deleteMany({ where: { workoutExercise: { workout: { userId } } } });
  await db.workoutExercise.deleteMany({ where: { workout: { userId } } });
  await db.workout.deleteMany({ where: { userId } });
}

test(
  "previewStrongImport + commitImportBatch: real end-to-end round trip, lb converted to kg, batch tagged source=STRONG, notes say 'Nhập từ Strong'",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, importService: svc } = await loadModules();
    const userId = `import-strong-it-${Date.now()}`;
    try {
      const curl = await db.exercise.findFirst({ where: { exerciseName: "Barbell Curl" } });
      assert.ok(curl, "seed catalog must contain Barbell Curl for this test to be meaningful");

      const csv = [
        HEADER,
        `2024-01-08 18:30:00,Push Day,45m,Barbell Curl,1,44,lb,10,7,,,,,`,
      ].join("\n");

      const preview = await svc.previewStrongImport(userId, "strong-export.csv", csv) as any;
      assert.equal(preview.blocked, false);
      assert.equal(preview.workoutCount, 1);
      const curlMatch = preview.exerciseMatchSummary.find((s: any) => s.exerciseTitle === "Barbell Curl");
      assert.equal(curlMatch.isExactMatch, true);

      const batch = await db.workoutImportBatch.findUnique({ where: { id: preview.batchId } });
      assert.equal(batch!.source, "STRONG");

      const commitResult = await svc.commitImportBatch(userId, preview.batchId, {
        "Barbell Curl": { action: "USE_EXISTING", exerciseId: curl!.id },
      });
      assert.equal(commitResult.committedWorkoutCount, 1);

      const workout = await db.workout.findUnique({
        where: { id: commitResult.createdWorkoutIds[0] },
        include: { exercises: { include: { workoutSets: true } } },
      });
      assert.ok(workout!.notes?.includes("Nhập từ Strong"));
      const weightKg = workout!.exercises[0].workoutSets[0].weight!;
      assert.ok(Math.abs(weightKg - 44 * 0.45359237) < 0.01, `expected lb->kg conversion, got ${weightKg}`);
    } finally {
      await cleanupUser(db, userId);
    }
  },
);
