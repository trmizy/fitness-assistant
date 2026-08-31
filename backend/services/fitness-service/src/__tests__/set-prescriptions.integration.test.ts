import test from "node:test";
import assert from "node:assert/strict";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type WorkoutServiceLike = (typeof import("../services/workout.service"))["workoutService"];
type WorkoutQueueLike = (typeof import("../services/workout.service"))["workoutQueue"];

let prisma: PrismaClientLike | undefined;
let workoutService: WorkoutServiceLike | undefined;
let workoutQueue: WorkoutQueueLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/workout.service");
    prisma = prismaModule.prisma;
    workoutService = serviceModule.workoutService;
    workoutQueue = serviceModule.workoutQueue;
  }
  return { prisma: prisma!, workoutService: workoutService!, workoutQueue: workoutQueue! };
}

test.after(async () => {
  if (workoutQueue) await workoutQueue.close();
  if (prisma) await prisma.$disconnect();
});

async function seedExercise(db: PrismaClientLike, id: string, name: string) {
  return db.exercise.upsert({
    where: { id },
    update: {},
    create: {
      id,
      exerciseName: name,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BARBELL",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["chest"],
      instructions: "Test exercise.",
      loggingMode: "REPS_LOAD",
    },
  });
}

async function cleanup(db: PrismaClientLike, userId: string, exerciseId: string) {
  await db.workout.deleteMany({ where: { userId } });
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({ where: { id: exerciseId } });
}

test(
  "manual program setPrescriptions create planned rows and startSchedule materializes them into the set skeleton",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `set-prescription-it-${Date.now()}`;
    const exerciseId = `${userId}-ex`;
    await cleanup(db, userId, exerciseId);

    try {
      await seedExercise(db, exerciseId, "Set Prescription Bench Press");
      const result = await service.createManualProgram(userId, {
        name: "Set Prescription Program",
        durationWeeks: 1,
        daysPerWeek: 1,
        startDate: todayAsScheduleDate().toISOString().slice(0, 10),
        repeatWeeks: 1,
        selectedWeekdays: [todayAsScheduleDate().getUTCDay()],
        replaceExisting: true,
        days: [
          {
            dayNumber: 1,
            title: "Set Prescription Day",
            exercises: [
              {
                exerciseId,
                sets: 3,
                reps: 8,
                restSeconds: 90,
                setPrescriptions: [
                  { setNumber: 1, targetReps: 5, targetWeight: 40, targetSetType: "WARMUP", targetTempo: "3-1-1-0", targetRpe: 6, restSeconds: 45 },
                  { setNumber: 2, targetReps: 3, targetWeight: 80, targetSetType: "TOP", targetRpe: 8.5, targetRir: 1, restSeconds: 180 },
                  { setNumber: 3, targetReps: 10, targetWeight: 65, targetSetType: "BACKOFF", isAmrap: true, minReps: 8, restSeconds: 120 },
                ],
              },
            ],
          },
        ],
      });

      const createdProgram = (result as any).program;
      const programExerciseId = createdProgram.days[0].exercises[0].id;
      const planned = await db.workoutProgramExerciseSetPrescription.findMany({
        where: { programExerciseId },
        orderBy: { setNumber: "asc" },
      });
      assert.equal(planned.length, 3);
      assert.equal(planned[0].targetSetType, "WARMUP");
      assert.equal(planned[0].targetTempo, "3-1-1-0");
      assert.equal(planned[1].targetSetType, "TOP");
      assert.equal(planned[2].isAmrap, true);
      assert.equal(planned[2].minReps, 8);

      const schedule = await db.workoutSchedule.findFirstOrThrow({
        where: { userId, programDayId: createdProgram.days[0].id },
      });
      await service.startSchedule(userId, schedule.id);
      const loggedExercise = await db.workoutExercise.findFirstOrThrow({
        where: { programExerciseId },
        include: { workoutSets: { orderBy: { setNumber: "asc" } } },
      });

      assert.deepEqual(
        loggedExercise.workoutSets.map((set) => ({
          setNumber: set.setNumber,
          reps: set.reps,
          weight: set.weight,
          rpe: set.rpe,
          rir: set.rir,
          setType: set.setType,
          tempo: set.tempo,
          completed: set.completed,
        })),
        [
          { setNumber: 1, reps: 5, weight: 40, rpe: 6, rir: null, setType: "WARMUP", tempo: "3-1-1-0", completed: false },
          { setNumber: 2, reps: 3, weight: 80, rpe: 8.5, rir: 1, setType: "TOP", tempo: null, completed: false },
          { setNumber: 3, reps: 10, weight: 65, rpe: null, rir: null, setType: "BACKOFF", tempo: null, completed: false },
        ],
      );
      assert.equal(loggedExercise.workoutSets[2].isAmrap, true);
      assert.equal(loggedExercise.workoutSets[2].amrapMinReps, 8);

      await service.updateSet(loggedExercise.workoutSets[0].id, userId, {
        reps: 6,
        weight: 42.5,
        completed: true,
      });

      const plannedAfterActual = await db.workoutProgramExerciseSetPrescription.findFirstOrThrow({
        where: { programExerciseId, setNumber: 1 },
      });
      assert.equal(plannedAfterActual.targetReps, 5);
      assert.equal(Number(plannedAfterActual.targetWeight), 40);
      assert.equal(plannedAfterActual.targetSetType, "WARMUP");

      const updatedProgramExercise = await service.updateProgramExercise(programExerciseId, userId, {
        weight: 77.5,
      });
      assert.equal(Number((updatedProgramExercise as any).weight), 77.5);
    } finally {
      await cleanup(db, userId, exerciseId);
    }
  },
);
