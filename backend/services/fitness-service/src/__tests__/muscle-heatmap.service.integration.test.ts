import test from "node:test";
import assert from "node:assert/strict";

/**
 * Roadmap P3.1 "Muscle heatmap"
 * (docs/features/MUSCLE_HEATMAP_IMPACT_ANALYSIS.md).
 *
 * Uses real, existing catalog exercises with real ExerciseMuscle
 * mappings (found by auditing the seed data before writing fixtures —
 * "Air Bike" = abs only; "Car Drivers" = side_delts primary + forearms
 * secondary). This same audit surfaced a real, pre-existing data bug:
 * `gymcoach_fitness_test`'s entire exercise_muscles table (2992 rows)
 * referenced muscle_id values that didn't exist in that database's own
 * `muscles` table — the test DB's `muscles` table had drifted from dev's
 * at some point (each row's `id` is a fresh `@default(uuid())`, so a
 * table reseed anywhere regenerates different ids). This is a TEST-DB-
 * ONLY issue — dev's own data was verified fully valid (2992/2992
 * correctly joined) — but it meant, before the fix, this exact feature's
 * own tests would have found zero real muscle data to work with, and
 * (more importantly) it's the first test in this whole session to
 * exercise that join at all. Fixed by re-running the existing
 * `exerciseMuscleMappingImporter.ts` against the test DB (regenerates
 * correct rows from the source catalog/raw_exercises.json files, keyed
 * by Muscle.code) and deleting the leftover orphaned rows.
 */

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type StatsServiceModule = typeof import("../services/stats.service");

let prisma: PrismaClientLike | undefined;
let statsModule: StatsServiceModule | undefined;
let airBikeId: string | undefined;
let carDriversId: string | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    statsModule = await import("../services/stats.service");
  }
  if (!airBikeId || !carDriversId) {
    // Looked up by name rather than hardcoded — Exercise.exerciseName has
    // no unique constraint and the seed script assigns fresh random ids
    // on every re-run (prisma/seed_exercises_json.ts), so a literal id
    // here goes silently stale the next time the catalog is reseeded.
    const [airBike, carDrivers] = await Promise.all([
      prisma.exercise.findFirstOrThrow({ where: { exerciseName: "Air Bike" } }),
      prisma.exercise.findFirstOrThrow({ where: { exerciseName: "Car Drivers" } }),
    ]);
    airBikeId = airBike.id;
    carDriversId = carDrivers.id;
  }
  return { prisma: prisma!, statsService: statsModule!.statsService, airBikeId, carDriversId };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function seedWorkout(
  db: PrismaClientLike,
  userId: string,
  date: Date,
  exercises: Array<{ exerciseId: string; sets: Array<{ completed: boolean; setType?: string | null }> }>,
) {
  return db.workout.create({
    data: {
      userId,
      name: "Heatmap Test Workout",
      date,
      exercises: {
        create: exercises.map((ex, index) => ({
          exerciseId: ex.exerciseId,
          sets: ex.sets.length,
          order: index,
          workoutSets: {
            create: ex.sets.map((s, i) => ({ setNumber: i + 1, completed: s.completed, setType: s.setType ?? null })),
          },
        })),
      },
    },
  });
}

async function cleanup(db: PrismaClientLike, userId: string) {
  await db.trainingCycle.deleteMany({ where: { userId } });
  await db.workoutSet.deleteMany({ where: { workoutExercise: { workout: { userId } } } });
  await db.workoutExercise.deleteMany({ where: { workout: { userId } } });
  await db.workout.deleteMany({ where: { userId } });
}

test(
  "getMuscleHeatmap: 7d range scores primary=1.0/secondary=0.5 per completed working set, excludes WARMUP, excludes out-of-range workouts, scoped to the requesting user only",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, statsService: svc, airBikeId, carDriversId } = await loadModules();
    const userId = `heatmap-it-${Date.now()}`;
    const otherUserId = `heatmap-other-it-${Date.now()}`;
    try {
      // Within the 7d window: 3 real working sets of Air Bike (abs x3),
      // Car Drivers with 1 WARMUP (excluded) + 1 real working set.
      await seedWorkout(db, userId, daysAgo(2), [
        { exerciseId: airBikeId, sets: [{ completed: true }, { completed: true }, { completed: true }] },
        { exerciseId: carDriversId, sets: [{ completed: true, setType: "WARMUP" }, { completed: true }] },
      ]);
      // Outside the 7d window (but inside 30d) — must not appear in 7d results.
      await seedWorkout(db, userId, daysAgo(20), [{ exerciseId: airBikeId, sets: [{ completed: true }] }]);
      // Another user's own real data — must never leak into this user's heatmap.
      await seedWorkout(db, otherUserId, daysAgo(2), [{ exerciseId: airBikeId, sets: [{ completed: true }, { completed: true }] }]);

      const result = await svc.getMuscleHeatmap(userId, { range: "7d" });
      assert.equal(result.range, "7d");
      assert.equal(result.noActiveCycle, false);

      const byCode = new Map(result.muscles.map((m: any) => [m.code, m]));
      assert.equal(byCode.get("abs")?.score, 3); // 3 working sets * 1.0 primary
      assert.equal(byCode.get("side_delts")?.score, 1); // 1 real working set (WARMUP excluded) * 1.0 primary
      assert.equal(byCode.get("forearms")?.score, 0.5); // 1 real working set * 0.5 secondary
      assert.equal(byCode.get("abs")?.intensity, 9, "the highest-scoring muscle in the window gets intensity 9");

      await cleanup(db, otherUserId);
    } finally {
      await cleanup(db, userId);
    }
  },
);

test(
  "getMuscleHeatmap: 30d range includes a workout the 7d range excludes",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, statsService: svc, airBikeId } = await loadModules();
    const userId = `heatmap-30d-it-${Date.now()}`;
    try {
      await seedWorkout(db, userId, daysAgo(20), [{ exerciseId: airBikeId, sets: [{ completed: true }] }]);

      const result7d = await svc.getMuscleHeatmap(userId, { range: "7d" });
      assert.equal(result7d.muscles.length, 0, "a 20-day-old workout must not appear in the 7d window");

      const result30d = await svc.getMuscleHeatmap(userId, { range: "30d" });
      const abs30d = result30d.muscles.find((m: any) => m.code === "abs");
      assert.equal(abs30d?.score, 1);
    } finally {
      await cleanup(db, userId);
    }
  },
);

test(
  "getMuscleHeatmap: cycle range uses the user's real ACTIVE TrainingCycle window; reports an explicit noActiveCycle state when there isn't one",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, statsService: svc, airBikeId } = await loadModules();
    const userId = `heatmap-cycle-it-${Date.now()}`;
    try {
      const noCycleResult = await svc.getMuscleHeatmap(userId, { range: "cycle" });
      assert.equal(noCycleResult.noActiveCycle, true);
      assert.equal(noCycleResult.muscles.length, 0);

      await db.trainingCycle.create({
        data: { userId, startDate: daysAgo(15), endDate: daysAgo(-15), status: "ACTIVE" },
      });
      // Inside the cycle window but outside 7d/30d-from-now-relative windows is not tested here —
      // this workout is 15 days ago, inside the cycle's [-15d, +15d] window.
      await seedWorkout(db, userId, daysAgo(12), [{ exerciseId: airBikeId, sets: [{ completed: true }] }]);

      const cycleResult = await svc.getMuscleHeatmap(userId, { range: "cycle" });
      assert.equal(cycleResult.noActiveCycle, false);
      const abs = cycleResult.muscles.find((m: any) => m.code === "abs");
      assert.equal(abs?.score, 1);
    } finally {
      await cleanup(db, userId);
    }
  },
);

test(
  "getMuscleHeatmap: custom range respects explicit from/to; rejects an invalid custom range",
  { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database." },
  async () => {
    const { prisma: db, statsService: svc, airBikeId } = await loadModules();
    const userId = `heatmap-custom-it-${Date.now()}`;
    try {
      await seedWorkout(db, userId, daysAgo(50), [{ exerciseId: airBikeId, sets: [{ completed: true }] }]);

      const outsideResult = await svc.getMuscleHeatmap(userId, { range: "custom", from: "2020-01-01", to: "2020-01-31" });
      assert.equal(outsideResult.muscles.length, 0);

      const fromLabel = daysAgo(55).toISOString().slice(0, 10);
      const toLabel = daysAgo(45).toISOString().slice(0, 10);
      const insideResult = await svc.getMuscleHeatmap(userId, { range: "custom", from: fromLabel, to: toLabel });
      const abs = insideResult.muscles.find((m: any) => m.code === "abs");
      assert.equal(abs?.score, 1);

      await assert.rejects(
        () => svc.getMuscleHeatmap(userId, { range: "custom", from: "not-a-date", to: "2026-01-01" }),
        (err: any) => err?.status === 400,
      );
    } finally {
      await cleanup(db, userId);
    }
  },
);
