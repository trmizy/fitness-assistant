/**
 * Roadmap P3.5 "Planned vs actual training volume"
 * (docs/features/PLANNED_VS_ACTUAL_VOLUME_IMPACT_ANALYSIS.md).
 *
 * Proves getCycleReport's new `plannedVsActual` block against a real
 * seeded program day + completed workout, across 2 logging modes
 * (REPS_LOAD and BODYWEIGHT_REPS) — mode-gated, never blended.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/planned-vs-actual.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test",
  timeout: 60_000,
};

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type TrainingCycleServiceLike = (typeof import("../services/training-cycle.service"))["trainingCycleService"];

let prisma: PrismaClientLike | undefined;
let trainingCycleService: TrainingCycleServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    trainingCycleService = (await import("../services/training-cycle.service")).trainingCycleService;
  }
  return { prisma: prisma!, trainingCycleService: trainingCycleService! };
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

const REPS_LOAD_EXERCISE_ID = "f1b609bf-0994-4a70-b2d5-a22465438312"; // real seeded "Barbell Curl" (REPS_LOAD)

test(
  "getCycleReport: plannedVsActual compares real planned targets against real logged sets, mode-gated",
  skipOpts,
  async () => {
    const { prisma: db, trainingCycleService: svc } = await loadModules();
    const userId = randomUUID();

    // A real bodyweight exercise to exercise the BODYWEIGHT_REPS path —
    // reuses a real custom exercise row rather than guessing a second
    // real seeded id, kept isolated to this test via a unique name.
    const bwExercise = await db.exercise.create({
      data: {
        exerciseName: `E2E Pull-up (planned-vs-actual test) ${randomUUID()}`,
        typeOfActivity: "STRENGTH",
        typeOfEquipment: "BODYWEIGHT",
        bodyPart: "UPPER_BODY",
        type: "PULL",
        muscleGroupsActivated: [],
        instructions: "test",
        loggingMode: "BODYWEIGHT_REPS",
        source: "SYSTEM",
      },
    });

    const program = await db.workoutProgram.create({
      data: { userId, name: "E2E Planned vs Actual Program" },
    });
    const programDay = await db.workoutProgramDay.create({
      data: { programId: program.id, dayNumber: 1, title: "Day 1" },
    });
    await db.workoutProgramExercise.create({
      data: { programDayId: programDay.id, exerciseId: REPS_LOAD_EXERCISE_ID, order: 0, sets: 3, reps: 10, weight: 40 },
    });
    await db.workoutProgramExercise.create({
      data: { programDayId: programDay.id, exerciseId: bwExercise.id, order: 1, sets: 3, reps: 12 },
    });

    const workout = await db.workout.create({
      data: {
        userId,
        name: "E2E Planned vs Actual Session",
        date: daysAgo(3),
        exercises: {
          create: [
            {
              exerciseId: REPS_LOAD_EXERCISE_ID,
              sets: 3,
              order: 0,
              workoutSets: {
                create: [
                  { setNumber: 1, weight: 42.5, reps: 8, completed: true },
                  { setNumber: 2, weight: 42.5, reps: 8, completed: true },
                ],
              },
            },
            {
              exerciseId: bwExercise.id,
              sets: 3,
              order: 1,
              workoutSets: { create: [{ setNumber: 1, reps: 10, completed: true }] },
            },
          ],
        },
      },
    });

    const cycle = await db.trainingCycle.create({
      data: {
        userId,
        cycleIndex: 1,
        startDate: daysAgo(10),
        endDate: daysAgo(-10),
        durationDays: 20,
        status: "ACTIVE",
      },
    });
    await db.workoutSchedule.create({
      data: {
        userId,
        date: daysAgo(3),
        status: "COMPLETED",
        trainingCycleId: cycle.id,
        programDayId: programDay.id,
        workoutId: workout.id,
      },
    });

    try {
      const report: any = await svc.getCycleReport(cycle.id, userId);
      const byExercise: any[] = report.plannedVsActual.byExercise;

      const repsLoadRow = byExercise.find((e) => e.exerciseId === REPS_LOAD_EXERCISE_ID);
      assert.ok(repsLoadRow, "the REPS_LOAD exercise must appear in the breakdown");
      assert.equal(repsLoadRow.loggingMode, "REPS_LOAD");
      assert.equal(repsLoadRow.plannedVolumeKg, 3 * 10 * 40); // 1200
      assert.equal(repsLoadRow.actualVolumeKg, 42.5 * 8 + 42.5 * 8); // 680
      assert.equal(repsLoadRow.plannedReps, null, "REPS_LOAD must never populate the reps field");

      const bwRow = byExercise.find((e) => e.exerciseId === bwExercise.id);
      assert.ok(bwRow, "the BODYWEIGHT_REPS exercise must appear in the breakdown");
      assert.equal(bwRow.loggingMode, "BODYWEIGHT_REPS");
      assert.equal(bwRow.plannedReps, 3 * 12); // 36
      assert.equal(bwRow.actualReps, 10);
      assert.equal(bwRow.plannedVolumeKg, null, "BODYWEIGHT_REPS must never populate the volume field");

      // Totals: volume total is REPS_LOAD-only (1200 planned, 680 actual);
      // reps total is BODYWEIGHT_REPS-only (36 planned, 10 actual) — never
      // blended into one number.
      assert.equal(report.plannedVsActual.totals.totalPlannedVolumeKg, 1200);
      assert.equal(report.plannedVsActual.totals.totalActualVolumeKg, 680);
      assert.equal(report.plannedVsActual.totals.totalPlannedReps, 36);
      assert.equal(report.plannedVsActual.totals.totalActualReps, 10);
      assert.equal(report.plannedVsActual.totals.volumeAdherencePct, Math.round((680 / 1200) * 100));
    } finally {
      await db.workoutSchedule.deleteMany({ where: { userId } });
      await db.trainingCycle.deleteMany({ where: { userId } });
      await db.workoutSet.deleteMany({ where: { workoutExercise: { workoutId: workout.id } } });
      await db.workoutExercise.deleteMany({ where: { workoutId: workout.id } });
      await db.workout.deleteMany({ where: { userId } });
      await db.workoutProgramExercise.deleteMany({ where: { programDayId: programDay.id } });
      await db.workoutProgramDay.deleteMany({ where: { programId: program.id } });
      await db.workoutProgram.deleteMany({ where: { userId } });
      await db.exercise.delete({ where: { id: bwExercise.id } });
    }
  },
);
