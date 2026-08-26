import test from "node:test";
import assert from "node:assert/strict";

/**
 * Roadmap P2.5 "Export / data portability"
 * (docs/features/JSON_CSV_EXPORT_IMPACT_ANALYSIS.md).
 */

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type BuildExportDataLike = (typeof import("../services/export.service"))["buildExportData"];
type WorkoutsToCsvLike = (typeof import("../services/export.service"))["workoutsToCsv"];

let prisma: PrismaClientLike | undefined;
let buildExportData: BuildExportDataLike | undefined;
let workoutsToCsv: WorkoutsToCsvLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/export.service");
    prisma = prismaModule.prisma;
    buildExportData = serviceModule.buildExportData;
    workoutsToCsv = serviceModule.workoutsToCsv;
  }
  return { prisma: prisma!, buildExportData: buildExportData!, workoutsToCsv: workoutsToCsv! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function seedWorkout(db: PrismaClientLike, userId: string, exerciseId: string) {
  return db.workout.create({
    data: {
      userId,
      name: "Push Day",
      date: new Date("2026-01-08T00:00:00.000Z"),
      notes: "felt good",
      exercises: {
        create: [
          {
            exerciseId,
            exerciseNameSnapshot: "Barbell Curl (snapshot)",
            sets: 2,
            order: 0,
            workoutSets: {
              create: [
                { setNumber: 1, weight: 20, reps: 10, completed: true },
                { setNumber: 2, weight: 22.5, reps: 8, completed: true },
              ],
            },
          },
        ],
      },
    },
  });
}

async function cleanupUser(db: PrismaClientLike, userId: string) {
  await db.workoutSet.deleteMany({ where: { workoutExercise: { workout: { userId } } } });
  await db.workoutExercise.deleteMany({ where: { workout: { userId } } });
  await db.workout.deleteMany({ where: { userId } });
  await db.bodyMetrics.deleteMany({ where: { userId } });
}

test(
  "buildExportData: returns real workouts+body metrics scoped ONLY to the requesting user, never leaks another user's data",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, buildExportData: build } = await loadModules();
    const userId = `export-it-${Date.now()}`;
    const otherUserId = `export-other-it-${Date.now()}`;
    try {
      const curl = await db.exercise.findFirst({ where: { exerciseName: "Barbell Curl" } });
      assert.ok(curl, "seed catalog must contain Barbell Curl for this test to be meaningful");

      await seedWorkout(db, userId, curl!.id);
      await seedWorkout(db, otherUserId, curl!.id); // a different user's own data — must never appear in userId's export
      await db.bodyMetrics.create({ data: { userId, date: new Date("2026-01-01T00:00:00.000Z"), weight: 70.5, bodyFat: 15.2 } });

      const data = await build(userId);
      assert.equal(data.workouts.length, 1);
      assert.equal(data.bodyMetrics.length, 1);

      const w = data.workouts[0];
      assert.equal(w.name, "Push Day");
      assert.equal(w.date, "2026-01-08");
      assert.equal(w.exercises[0].exerciseName, "Barbell Curl", "must use the LIVE exercise name, not the internal exerciseNameSnapshot");
      assert.equal(w.exercises[0].sets.length, 2);
      assert.equal(w.exercises[0].sets[1].weightKg, 22.5);

      const m = data.bodyMetrics[0];
      assert.equal(m.weightKg, 70.5);
      assert.equal(m.bodyFatPercent, 15.2);

      // Never leaks internal/operational fields.
      const raw = JSON.stringify(data);
      assert.ok(!raw.includes('"userId"'), "userId must never appear as a field in the export");
      assert.ok(!raw.includes("snapshot"), "the internal exerciseNameSnapshot value must never appear in the export");
      assert.ok(!raw.includes(otherUserId), "another user's id must never appear in this user's export");
    } finally {
      await cleanupUser(db, userId);
      await cleanupUser(db, otherUserId);
    }
  },
);

test(
  "workoutsToCsv on real exported data produces parseable CSV text with the correct row count",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, buildExportData: build, workoutsToCsv: toCsv } = await loadModules();
    const userId = `export-csv-it-${Date.now()}`;
    try {
      const curl = await db.exercise.findFirst({ where: { exerciseName: "Barbell Curl" } });
      await seedWorkout(db, userId, curl!.id);

      const data = await build(userId);
      const csv = toCsv(data.workouts);
      const lines = csv.trim().split("\n");
      assert.equal(lines.length, 3, "1 header + 2 real set rows");
      assert.ok(lines[0].startsWith("workout_id,date,workout_name"));
      assert.ok(lines[1].includes("Push Day") && lines[1].includes("Barbell Curl"));
    } finally {
      await cleanupUser(db, userId);
    }
  },
);
