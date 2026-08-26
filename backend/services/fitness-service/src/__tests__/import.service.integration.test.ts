import test from "node:test";
import assert from "node:assert/strict";

/**
 * Roadmap P2 "Canonical import framework" + P2.1 "Hevy import"
 * (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md).
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

const HEADER = "title,start_time,end_time,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe";

function csvFor(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

async function cleanupUser(db: PrismaClientLike, userId: string) {
  await db.workoutImportBatch.deleteMany({ where: { userId } });
  await db.workoutSet.deleteMany({ where: { workoutExercise: { workout: { userId } } } });
  await db.workoutExercise.deleteMany({ where: { workout: { userId } } });
  await db.workout.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({ where: { ownerId: userId } });
}

test(
  "previewHevyImport: parses a real 2-set-varying workout, matches a real seeded exercise exactly, and flags an unknown one with no forced guess",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, importService: svc } = await loadModules();
    const userId = `import-preview-it-${Date.now()}`;
    try {
      const csv = csvFor([
        'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Barbell Curl,,,0,normal,20,10,,,7',
        'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Barbell Curl,,,1,normal,22.5,8,,,8',
        'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Totally Unknown Exercise Xyz123,,,0,normal,50,5,,,',
      ]);
      const result = await svc.previewHevyImport(userId, "export.csv", csv);
      assert.equal(result.blocked, false);
      assert.equal((result as any).workoutCount, 1);
      assert.equal((result as any).rowErrors.length, 0);

      const summary = (result as any).exerciseMatchSummary as Array<{ exerciseTitle: string; isExactMatch: boolean; candidates: any[] }>;
      const curlMatch = summary.find((s) => s.exerciseTitle === "Barbell Curl")!;
      assert.equal(curlMatch.isExactMatch, true);
      assert.equal(curlMatch.candidates[0].name, "Barbell Curl");

      const unknownMatch = summary.find((s) => s.exerciseTitle === "Totally Unknown Exercise Xyz123")!;
      assert.equal(unknownMatch.isExactMatch, false);
      assert.deepEqual(unknownMatch.candidates, []);

      const batch = await db.workoutImportBatch.findUnique({ where: { id: (result as any).batchId } });
      assert.ok(batch);
      assert.equal(batch!.status, "PREVIEW");
    } finally {
      await cleanupUser(db, userId);
    }
  },
);

test(
  "previewHevyImport: a future-dated workout is excluded and reported, never staged for commit",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, importService: svc } = await loadModules();
    const userId = `import-future-it-${Date.now()}`;
    try {
      const nextYear = new Date().getUTCFullYear() + 1;
      const csv = csvFor([
        `Future Day,${nextYear}-01-08 09:15:00,${nextYear}-01-08 10:00:00,Barbell Curl,,,0,normal,20,10,,,`,
      ]);
      const result = await svc.previewHevyImport(userId, "export.csv", csv);
      assert.equal(result.blocked, true);
      assert.equal((result as any).futureWorkoutCount, 1);
    } finally {
      await cleanupUser(db, userId);
    }
  },
);

test(
  "commitImportBatch: USE_EXISTING writes real per-set VARYING values (not the old uniform-value bug), completed=true, no WorkoutSchedule row",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, importService: svc } = await loadModules();
    const userId = `import-commit-it-${Date.now()}`;
    try {
      const curl = await db.exercise.findFirst({ where: { exerciseName: "Barbell Curl" } });
      assert.ok(curl, "seed catalog must contain Barbell Curl for this test to be meaningful");

      const csv = csvFor([
        'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Barbell Curl,,,0,normal,20,10,,,7',
        'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Barbell Curl,,,1,normal,22.5,8,,,8',
        'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Barbell Curl,,,2,normal,25,6,,,9',
      ]);
      const preview = await svc.previewHevyImport(userId, "export.csv", csv) as any;
      const commitResult = await svc.commitImportBatch(userId, preview.batchId, {
        "Barbell Curl": { action: "USE_EXISTING", exerciseId: curl!.id },
      });
      assert.equal(commitResult.committedWorkoutCount, 1);
      assert.equal(commitResult.alreadyImportedSkippedCount, 0);
      assert.equal(commitResult.skippedExerciseSetCount, 0);

      const workout = await db.workout.findUnique({
        where: { id: commitResult.createdWorkoutIds[0] },
        include: { exercises: { include: { workoutSets: { orderBy: { setNumber: "asc" } } } } },
      });
      assert.ok(workout);
      assert.equal(workout!.userId, userId);
      assert.equal(workout!.exercises.length, 1);
      const sets = workout!.exercises[0].workoutSets;
      assert.equal(sets.length, 3);
      // The exact real-per-set-variation claim this milestone exists to
      // prove — workoutRepository.create's OLD uniform-value behavior
      // would have made every set identical to the first.
      assert.deepEqual(
        sets.map((s) => [s.weight, s.reps, s.rpe]),
        [[20, 10, 7], [22.5, 8, 8], [25, 6, 9]],
      );
      assert.ok(sets.every((s) => s.completed === true));

      const schedule = await db.workoutSchedule.findFirst({ where: { workoutId: workout!.id } });
      assert.equal(schedule, null, "an imported workout must never create a WorkoutSchedule row");

      const batchAfter = await db.workoutImportBatch.findUnique({ where: { id: preview.batchId } });
      assert.equal(batchAfter!.status, "COMMITTED");
      assert.deepEqual(batchAfter!.createdWorkoutIds, [workout!.id]);
    } finally {
      await cleanupUser(db, userId);
    }
  },
);

test(
  "commitImportBatch: CREATE_CUSTOM resolution creates a real custom exercise via the unchanged P1.5 path and uses it",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, importService: svc } = await loadModules();
    const userId = `import-custom-it-${Date.now()}`;
    const uniqueName = `Import Custom Move ${Date.now()}`;
    try {
      const csv = csvFor([
        `Garage Day,2024-01-08 09:15:00,2024-01-08 10:00:00,${uniqueName},,,0,normal,,12,,,`,
      ]);
      const preview = await svc.previewHevyImport(userId, "export.csv", csv) as any;
      const commitResult = await svc.commitImportBatch(userId, preview.batchId, {
        [uniqueName]: {
          action: "CREATE_CUSTOM",
          input: {
            typeOfActivity: "STRENGTH",
            typeOfEquipment: "BODYWEIGHT",
            bodyPart: "UPPER_BODY",
            type: "PUSH",
            loggingMode: "BODYWEIGHT_REPS",
          },
        },
      });
      assert.equal(commitResult.committedWorkoutCount, 1);

      const created = await db.exercise.findFirst({ where: { exerciseName: uniqueName } });
      assert.ok(created);
      assert.equal(created!.source, "USER_CUSTOM");
      assert.equal(created!.ownerId, userId);

      const workout = await db.workout.findUnique({
        where: { id: commitResult.createdWorkoutIds[0] },
        include: { exercises: true },
      });
      assert.equal(workout!.exercises[0].exerciseId, created!.id);
    } finally {
      await cleanupUser(db, userId);
    }
  },
);

test(
  "commitImportBatch: SKIP resolution excludes that exercise's sets and reports the real count, without failing the whole workout",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, importService: svc } = await loadModules();
    const userId = `import-skip-it-${Date.now()}`;
    try {
      const curl = await db.exercise.findFirst({ where: { exerciseName: "Barbell Curl" } });
      const csv = csvFor([
        'Mixed Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Barbell Curl,,,0,normal,20,10,,,',
        'Mixed Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Some Weird Machine Xyz,,,0,normal,50,8,,,',
        'Mixed Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Some Weird Machine Xyz,,,1,normal,55,6,,,',
      ]);
      const preview = await svc.previewHevyImport(userId, "export.csv", csv) as any;
      const commitResult = await svc.commitImportBatch(userId, preview.batchId, {
        "Barbell Curl": { action: "USE_EXISTING", exerciseId: curl!.id },
        "Some Weird Machine Xyz": { action: "SKIP" },
      });
      assert.equal(commitResult.committedWorkoutCount, 1);
      assert.equal(commitResult.skippedExerciseSetCount, 2);

      const workout = await db.workout.findUnique({
        where: { id: commitResult.createdWorkoutIds[0] },
        include: { exercises: true },
      });
      assert.equal(workout!.exercises.length, 1, "only the resolved (non-skipped) exercise should be written");
      assert.equal(workout!.exercises[0].exerciseId, curl!.id);
    } finally {
      await cleanupUser(db, userId);
    }
  },
);

test(
  "commitImportBatch: re-importing the same workout twice is idempotent — zero duplicate Workout rows, reported as already-imported",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, importService: svc } = await loadModules();
    const userId = `import-idempotent-it-${Date.now()}`;
    try {
      const curl = await db.exercise.findFirst({ where: { exerciseName: "Barbell Curl" } });
      const csv = csvFor([
        'Repeat Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Barbell Curl,,,0,normal,20,10,,,',
      ]);

      const preview1 = await svc.previewHevyImport(userId, "export.csv", csv) as any;
      const commit1 = await svc.commitImportBatch(userId, preview1.batchId, {
        "Barbell Curl": { action: "USE_EXISTING", exerciseId: curl!.id },
      });
      assert.equal(commit1.committedWorkoutCount, 1);

      // Re-upload the exact same file — a brand-new preview batch, same content.
      const preview2 = await svc.previewHevyImport(userId, "export.csv", csv) as any;
      assert.equal(preview2.alreadyImportedCount, 1, "preview should surface the duplicate up front");
      const commit2 = await svc.commitImportBatch(userId, preview2.batchId, {
        "Barbell Curl": { action: "USE_EXISTING", exerciseId: curl!.id },
      });
      assert.equal(commit2.committedWorkoutCount, 0);
      assert.equal(commit2.alreadyImportedSkippedCount, 1);

      const allWorkouts = await db.workout.findMany({ where: { userId } });
      assert.equal(allWorkouts.length, 1, "re-importing the same export must never create a second Workout row");
    } finally {
      await cleanupUser(db, userId);
    }
  },
);

test(
  "cancelImportBatch: marks CANCELLED and commits nothing; committing an already-decided batch is rejected",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, importService: svc } = await loadModules();
    const userId = `import-cancel-it-${Date.now()}`;
    try {
      const curl = await db.exercise.findFirst({ where: { exerciseName: "Barbell Curl" } });
      const csv = csvFor([
        'Cancel Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Barbell Curl,,,0,normal,20,10,,,',
      ]);
      const preview = await svc.previewHevyImport(userId, "export.csv", csv) as any;
      const cancelled = await svc.cancelImportBatch(userId, preview.batchId);
      assert.equal(cancelled.status, "CANCELLED");

      await assert.rejects(
        () => svc.commitImportBatch(userId, preview.batchId, { "Barbell Curl": { action: "USE_EXISTING", exerciseId: curl!.id } }),
        (err: any) => err?.status === 409,
      );

      const workouts = await db.workout.findMany({ where: { userId } });
      assert.equal(workouts.length, 0);
    } finally {
      await cleanupUser(db, userId);
    }
  },
);

test(
  "commitImportBatch: another user cannot commit or cancel someone else's batch",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, importService: svc } = await loadModules();
    const ownerId = `import-owner-it-${Date.now()}`;
    const otherId = `import-other-it-${Date.now()}`;
    try {
      const csv = csvFor([
        'Owner Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Barbell Curl,,,0,normal,20,10,,,',
      ]);
      const preview = await svc.previewHevyImport(ownerId, "export.csv", csv) as any;

      await assert.rejects(
        () => svc.commitImportBatch(otherId, preview.batchId, {}),
        (err: any) => err?.status === 404,
      );
      await assert.rejects(
        () => svc.cancelImportBatch(otherId, preview.batchId),
        (err: any) => err?.status === 404,
      );
    } finally {
      await cleanupUser(db, ownerId);
      await cleanupUser(db, otherId);
    }
  },
);
