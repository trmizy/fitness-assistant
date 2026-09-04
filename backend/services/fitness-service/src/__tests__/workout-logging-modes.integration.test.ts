import test from "node:test";
import assert from "node:assert/strict";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

const fitnessDatabaseUrl =
  process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);

if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type WorkoutServiceLike =
  (typeof import("../services/workout.service"))["workoutService"];
type WorkoutQueueLike =
  (typeof import("../services/workout.service"))["workoutQueue"];

let prisma: PrismaClientLike | undefined;
let workoutService: WorkoutServiceLike | undefined;
let workoutQueue: WorkoutQueueLike | undefined;

function todayAsDateOnly() {
  return todayAsScheduleDate().toISOString().slice(0, 10);
}

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/workout.service");
    prisma = prismaModule.prisma;
    workoutService = serviceModule.workoutService;
    workoutQueue = serviceModule.workoutQueue;
  }
  return { prisma, workoutService: workoutService!, workoutQueue: workoutQueue! };
}

test.after(async () => {
  if (workoutQueue) await workoutQueue.close();
  if (prisma) await prisma.$disconnect();
});

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workout.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({ where: { id: { startsWith: `${userId}-ex-` } } });
}

async function seedExercise(db: PrismaClientLike, id: string) {
  return db.exercise.create({
    data: {
      id,
      exerciseName: `Logging Mode Exercise ${id}`,
      typeOfActivity: "CARDIO",
      typeOfEquipment: "BODYWEIGHT",
      bodyPart: "FULL_BODY",
      type: "PULL",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
      loggingMode: "DISTANCE_TIME",
    },
  });
}

test(
  "createWorkout persists bodyweight, duration, and distance on WorkoutSet without remapping them into weight/reps",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `workout-logging-modes-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      const workout = await service.createWorkout(userId, {
        name: "Logging modes integration workout",
        date: todayAsScheduleDate().toISOString(),
        exercises: [
          {
            exerciseId: ex.id,
            sets: 1,
            weight: 10,
            reps: 8,
            bodyWeightAtSetKg: 76.5,
            durationSeconds: 1500,
            distanceMeters: 5000,
            completed: true,
          },
        ],
      });

      const set = await db.workoutSet.findFirstOrThrow({
        where: {
          workoutExercise: {
            workoutId: workout.id,
            exerciseId: ex.id,
          },
        },
      });

      assert.equal(set.weight, 10);
      assert.equal(set.reps, 8);
      assert.equal(set.bodyWeightAtSetKg, 76.5);
      assert.equal(set.durationSeconds, 1500);
      assert.equal(set.distanceMeters, 5000);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "completeScheduleExercise persists bodyweight, duration, and distance on the schedule-linked active workout path",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `workout-logging-schedule-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      const programResult = await service.createManualProgram(userId, {
        name: "Logging mode schedule test program",
        durationWeeks: 1,
        daysPerWeek: 1,
        startDate: todayAsDateOnly(),
        selectedWeekdays: [todayAsScheduleDate().getUTCDay()],
        days: [
          {
            dayNumber: 1,
            title: "Logging mode day",
            exercises: [
              {
                exerciseId: ex.id,
                sets: 1,
                reps: 8,
                restSeconds: 90,
              },
            ],
          },
        ],
      });
      const program = programResult.program;
      const dayId = program.days[0].id;
      const { schedule } = await service.createSchedule(userId, {
        date: todayAsDateOnly(),
        programDayId: dayId,
      });
      const programExerciseId = program.days[0].exercises[0].id;

      const result = await service.completeScheduleExercise(
        userId,
        schedule.id,
        programExerciseId,
        {
          exerciseId: ex.id,
          weight: 10,
          reps: 8,
          bodyWeightAtSetKg: 76.5,
          durationSeconds: 1500,
          distanceMeters: 5000,
        },
      );

      assert.equal(result.sessionStatus, "completed");
      const set = await db.workoutSet.findFirstOrThrow({
        where: {
          workoutExercise: {
            workoutId: result.workoutId!,
            exerciseId: ex.id,
          },
        },
      });

      assert.equal(set.weight, 10);
      assert.equal(set.reps, 8);
      assert.equal(set.bodyWeightAtSetKg, 76.5);
      assert.equal(set.durationSeconds, 1500);
      assert.equal(set.distanceMeters, 5000);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
