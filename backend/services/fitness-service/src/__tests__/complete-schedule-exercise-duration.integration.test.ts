import test from "node:test";
import assert from "node:assert/strict";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

/**
 * Real bug found this pass (docs/OPENGYM_P0_COMPLETION_REPORT.md): the
 * frontend's pre-existing "cardio" logging path relabeled the weight slider
 * as "Thời gian (phút)" but the value it collected was submitted and stored
 * as `weight` — a plank/cardio session's duration silently became a "kg"
 * value in the database. `completeScheduleExerciseSchema` gained
 * `durationSeconds`/`distanceMeters` this pass specifically so TIME/
 * TIME_LOAD/DISTANCE_TIME exercises have a real, separate, correctly-typed
 * field to write to — this test proves the full write path (schema ->
 * service -> WorkoutExercise.duration + WorkoutSet.durationSeconds/
 * distanceMeters), not just that the Zod schema accepts the field.
 */

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
      typeOfActivity: "CARDIO",
      typeOfEquipment: "BODYWEIGHT",
      bodyPart: "CORE",
      type: "HOLD",
      muscleGroupsActivated: ["core"],
      instructions: "Test exercise.",
      loggingMode: "TIME",
    },
  });
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  const workouts = await db.workout.findMany({ where: { userId }, select: { id: true } });
  await db.workout.deleteMany({ where: { userId } });
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
  void workouts;
}

test(
  "completeScheduleExercise with durationSeconds writes it to WorkoutExercise.duration AND WorkoutSet.durationSeconds — never silently into weight",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `duration-schedule-it-${Date.now()}`;
    const exId = `${userId}-ex-a`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Duration Test Plank");

      const program = await db.workoutProgram.create({
        data: {
          userId,
          name: "Duration schedule program",
          status: "ACTIVE",
          days: {
            create: {
              dayNumber: 1,
              title: "Duration test day",
              exercises: { create: { exerciseId: exId, order: 1, sets: 1, reps: null } },
            },
          },
        },
        include: { days: { include: { exercises: true } } },
      });
      const programExerciseId = program.days[0].exercises[0].id;
      const schedule = await db.workoutSchedule.create({
        data: { userId, date: todayAsScheduleDate(), programDayId: program.days[0].id, sourceType: "INTEGRATION_TEST" },
      });

      await service.startSchedule(userId, schedule.id);
      const result = await service.completeScheduleExercise(userId, schedule.id, programExerciseId, {
        durationSeconds: 65,
      });

      const logged = await db.workoutExercise.findFirstOrThrow({
        where: { workoutId: result.workoutId!, programExerciseId },
        include: { workoutSets: true },
      });

      assert.equal(logged.duration, 65, "WorkoutExercise.duration must carry the real duration");
      assert.equal(logged.weight, null, "duration must NEVER be silently written into weight");
      assert.equal(logged.workoutSets.length, 1);
      assert.equal(logged.workoutSets[0].durationSeconds, 65);
      assert.equal(logged.workoutSets[0].weight, null);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "completeScheduleExercise with distanceMeters writes it to WorkoutSet.distanceMeters",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `distance-schedule-it-${Date.now()}`;
    const exId = `${userId}-ex-a`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Distance Test Running");

      const program = await db.workoutProgram.create({
        data: {
          userId,
          name: "Distance schedule program",
          status: "ACTIVE",
          days: {
            create: {
              dayNumber: 1,
              title: "Distance test day",
              exercises: { create: { exerciseId: exId, order: 1, sets: 1, reps: null } },
            },
          },
        },
        include: { days: { include: { exercises: true } } },
      });
      const programExerciseId = program.days[0].exercises[0].id;
      const schedule = await db.workoutSchedule.create({
        data: { userId, date: todayAsScheduleDate(), programDayId: program.days[0].id, sourceType: "INTEGRATION_TEST" },
      });

      await service.startSchedule(userId, schedule.id);
      const result = await service.completeScheduleExercise(userId, schedule.id, programExerciseId, {
        durationSeconds: 1500,
        distanceMeters: 5000,
      });

      const logged = await db.workoutExercise.findFirstOrThrow({
        where: { workoutId: result.workoutId!, programExerciseId },
        include: { workoutSets: true },
      });
      assert.equal(logged.workoutSets[0].distanceMeters, 5000);
      assert.equal(logged.workoutSets[0].durationSeconds, 1500);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "re-completing preserves the previously-logged duration when a later call omits it",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `duration-recomplete-it-${Date.now()}`;
    const exId = `${userId}-ex-a`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Duration Recomplete Plank");
      const program = await db.workoutProgram.create({
        data: {
          userId,
          name: "Duration recomplete program",
          status: "ACTIVE",
          days: {
            create: {
              dayNumber: 1,
              title: "Duration recomplete day",
              exercises: { create: { exerciseId: exId, order: 1, sets: 1, reps: null } },
            },
          },
        },
        include: { days: { include: { exercises: true } } },
      });
      const programExerciseId = program.days[0].exercises[0].id;
      const schedule = await db.workoutSchedule.create({
        data: { userId, date: todayAsScheduleDate(), programDayId: program.days[0].id, sourceType: "INTEGRATION_TEST" },
      });

      await service.startSchedule(userId, schedule.id);
      await service.completeScheduleExercise(userId, schedule.id, programExerciseId, { durationSeconds: 45 });
      // Re-submit with only RPE — no durationSeconds this time.
      const result = await service.completeScheduleExercise(userId, schedule.id, programExerciseId, { rpe: 7 });

      const logged = await db.workoutExercise.findFirstOrThrow({
        where: { workoutId: result.workoutId!, programExerciseId },
        include: { workoutSets: true },
      });
      assert.equal(logged.duration, 45, "duration must persist across a re-completion that omits it");
      assert.equal(logged.workoutSets[0].durationSeconds, 45);
      assert.equal(logged.workoutSets[0].rpe, 7);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
