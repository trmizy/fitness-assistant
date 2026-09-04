import test from "node:test";
import assert from "node:assert/strict";

// Regression coverage for a severe bug caught before it shipped (P1 gap
// analysis item: warm-up-set exclusion from PR detection). The naive fix
// (`setType: { not: "WARMUP" }` in computeNewPRs' Prisma query) silently
// excluded every NULL-setType row too — standard SQL three-valued logic,
// not a Prisma quirk — verified empirically against the real dev DB
// (485,741 of 485,741 existing rows are setType=null; that filter alone
// matched zero of them). Since virtually all real historical data predates
// the advanced-set-logging UI and is null, that naive filter would have
// silently broken PR detection for almost every user. Fixed with an
// explicit `OR: [{ setType: null }, { setType: { not: "WARMUP" } }]`. This
// test proves the fix against a REAL database, not just reasoning about it.

const fitnessDatabaseUrl =
  process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);

if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type MetricsModule = typeof import("../services/training-cycle-metrics.service");

let prisma: PrismaClientLike | undefined;
let computeNewPRs: MetricsModule["computeNewPRs"] | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const metricsModule = await import("../services/training-cycle-metrics.service");
    prisma = prismaModule.prisma;
    computeNewPRs = metricsModule.computeNewPRs;
  }
  return { prisma, computeNewPRs: computeNewPRs! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function seedExercise(db: PrismaClientLike, id: string) {
  return db.exercise.create({
    data: {
      id,
      exerciseName: `PR Warmup Regression Exercise ${id}`,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BARBELL",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
    },
  });
}

async function seedWorkoutWithSets(
  db: PrismaClientLike,
  options: {
    userId: string;
    date: Date;
    exerciseId: string;
    sets: Array<{ weight: number; setType: string | null }>;
  },
) {
  return db.workout.create({
    data: {
      userId: options.userId,
      name: "PR Warmup Regression Workout",
      date: options.date,
      exercises: {
        create: [
          {
            exerciseId: options.exerciseId,
            sets: options.sets.length,
            order: 0,
            workoutSets: {
              create: options.sets.map((s, i) => ({
                setNumber: i + 1,
                weight: s.weight,
                reps: 5,
                completed: true,
                setType: s.setType,
              })),
            },
          },
        ],
      },
    },
  });
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workout.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({ where: { id: { startsWith: `${userId}-ex-` } } });
}

test(
  "computeNewPRs: a prior session with a NULL setType (the real-world common case) still counts as the record to beat — the warm-up-exclusion fix must not blind PR detection to unclassified history",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, computeNewPRs: fn } = await loadModules();
    const userId = `pr-warmup-null-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      const cycleStart = new Date(Date.UTC(2026, 6, 1));

      // Prior session, BEFORE the cycle, setType left null (real-world norm).
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 5, 1)),
        exerciseId: ex.id,
        sets: [{ weight: 80, setType: null }],
      });

      // Cycle session: 90kg, should register as a PR (80 -> 90).
      const cycleSets = [
        {
          weight: 90,
          reps: 5,
          rpe: null,
          rir: null,
          completed: true,
          date: new Date(Date.UTC(2026, 6, 5)),
          exerciseName: ex.exerciseName,
          muscleGroups: [],
          setType: null,
        },
      ];

      const prs = await fn(userId, cycleSets, cycleStart);
      assert.deepEqual(prs, [ex.exerciseName], "the null-setType prior session must still count as the record to beat");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "computeNewPRs: a heavier WARMUP-tagged prior set does not count as the record to beat",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, computeNewPRs: fn } = await loadModules();
    const userId = `pr-warmup-excl-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      const cycleStart = new Date(Date.UTC(2026, 6, 1));

      // Prior session: a genuine working-set best of 80kg, plus a heavier
      // "warm-up" of 120kg that should NEVER count as the real record
      // (e.g. a bar-only/technique warm-up logged with an unrealistic
      // weight by mistake, or a partial-ROM ramp-up rep).
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 5, 1)),
        exerciseId: ex.id,
        sets: [
          { weight: 80, setType: "WORKING" },
          { weight: 120, setType: "WARMUP" },
        ],
      });

      // Cycle session: 100kg — beats the real 80kg working best, but is
      // still below the (incorrectly-would-be-counted) 120kg warm-up.
      const cycleSets = [
        {
          weight: 100,
          reps: 5,
          rpe: null,
          rir: null,
          completed: true,
          date: new Date(Date.UTC(2026, 6, 5)),
          exerciseName: ex.exerciseName,
          muscleGroups: [],
          setType: "WORKING",
        },
      ];

      const prs = await fn(userId, cycleSets, cycleStart);
      assert.deepEqual(
        prs,
        [ex.exerciseName],
        "100kg must register as a PR against the true 80kg working best, not be suppressed by the 120kg warm-up",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
