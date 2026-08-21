import test from "node:test";
import assert from "node:assert/strict";

// Real, pre-existing gap found while verifying an unrelated change (Gate
// 10's postMigrationIntegrityCheck.ts run): WorkoutExercise
// .exerciseNameSnapshot (schema.prisma's own doc comment: "New writes
// going forward should populate this at creation time... Never read
// INSTEAD of a live join in new code without this snapshot being
// populated") was ONLY EVER backfilled once by its migration for
// pre-existing rows — every NEW WorkoutExercise row created since then
// (via any of the 4 real write paths) silently left it null, so a later
// exercise rename/reclassification WOULD retroactively change what old
// workout history displays, exactly the bug this column exists to
// prevent. Fixed at all 4 write sites; this is the regression guard.

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

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/workout.service");
    prisma = prismaModule.prisma;
    workoutService = serviceModule.workoutService;
    workoutQueue = serviceModule.workoutQueue;
  }
  return {
    prisma,
    workoutService: workoutService!,
    workoutQueue: workoutQueue!,
  };
}

test.after(async () => {
  if (workoutQueue) await workoutQueue.close();
  if (prisma) await prisma.$disconnect();
});

async function seedExercise(db: PrismaClientLike, id: string, name: string) {
  return db.exercise.create({
    data: {
      id,
      exerciseName: name,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
    },
  });
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
}

test(
  "createWorkout (ad-hoc POST /workouts) stamps exerciseNameSnapshot at creation time",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `snapshot-create-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Snapshot Test Squat");
      const workout = await service.createWorkout(userId, {
        name: "Snapshot test workout",
        exercises: [{ exerciseId: exId, sets: 3, reps: 8, weight: 50 }],
      } as any);
      const logged = await db.workoutExercise.findFirstOrThrow({ where: { workoutId: workout.id } });
      assert.equal(logged.exerciseNameSnapshot, "Snapshot Test Squat");
    } finally {
      await deleteSeed(db, userId);
      await db.exercise.deleteMany({ where: { id: exId } });
    }
  },
);

test(
  "updateWorkout (PUT /workouts/:id) re-stamps exerciseNameSnapshot on the recreated rows",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `snapshot-update-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Snapshot Update Squat");
      const workout = await service.createWorkout(userId, {
        name: "Snapshot test workout",
        exercises: [{ exerciseId: exId, sets: 3, reps: 8, weight: 50 }],
      } as any);
      await service.updateWorkout(workout.id, userId, {
        name: "Snapshot test workout (edited)",
        exercises: [{ exerciseId: exId, sets: 4, reps: 6, weight: 55 }],
      } as any);
      const logged = await db.workoutExercise.findFirstOrThrow({ where: { workoutId: workout.id } });
      assert.equal(logged.exerciseNameSnapshot, "Snapshot Update Squat");
    } finally {
      await deleteSeed(db, userId);
      await db.exercise.deleteMany({ where: { id: exId } });
    }
  },
);

test(
  "addSet (POST /workouts/:id/sets, BUG-007) stamps exerciseNameSnapshot when it creates a brand-new WorkoutExercise row",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `snapshot-addset-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Snapshot AddSet Squat");
      const workout = await service.createWorkout(userId, {
        name: "Snapshot test workout",
        exercises: [],
      } as any);
      await service.addSet(workout.id, userId, { exerciseId: exId, weight: 60, reps: 5 });
      const logged = await db.workoutExercise.findFirstOrThrow({ where: { workoutId: workout.id, exerciseId: exId } });
      assert.equal(logged.exerciseNameSnapshot, "Snapshot AddSet Squat");
    } finally {
      await deleteSeed(db, userId);
      await db.exercise.deleteMany({ where: { id: exId } });
    }
  },
);

test(
  "completeScheduleExercise (schedule-based session) stamps exerciseNameSnapshot, and re-stamps it on a same-session swap",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `snapshot-schedule-it-${Date.now()}`;
    const exId = `${userId}-ex-a`;
    const swapExId = `${userId}-ex-b`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Snapshot Schedule Squat");
      await seedExercise(db, swapExId, "Snapshot Schedule Lunge");

      const program = await db.workoutProgram.create({
        data: {
          userId,
          name: "Snapshot schedule program",
          status: "ACTIVE",
          days: {
            create: {
              dayNumber: 1,
              title: "Snapshot day",
              exercises: { create: { exerciseId: exId, order: 1, sets: 3, reps: 8 } },
            },
          },
        },
        include: { days: { include: { exercises: true } } },
      });
      const programExerciseId = program.days[0].exercises[0].id;
      const now = new Date();
      const scheduleDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const schedule = await db.workoutSchedule.create({
        data: { userId, date: scheduleDate, programDayId: program.days[0].id, sourceType: "INTEGRATION_TEST" },
      });

      await service.startSchedule(userId, schedule.id);
      const firstResult = await service.completeScheduleExercise(userId, schedule.id, programExerciseId);
      const loggedFirst = await db.workoutExercise.findFirstOrThrow({
        where: { workoutId: firstResult.workoutId!, programExerciseId },
      });
      assert.equal(loggedFirst.exerciseNameSnapshot, "Snapshot Schedule Squat");

      // A session-only swap re-submit must update the snapshot to match
      // what was ACTUALLY performed, not silently keep the planned name.
      await service.completeScheduleExercise(userId, schedule.id, programExerciseId, {
        exerciseId: swapExId,
        weight: 40,
      });
      const loggedAfterSwap = await db.workoutExercise.findFirstOrThrow({
        where: { workoutId: firstResult.workoutId!, programExerciseId },
      });
      assert.equal(loggedAfterSwap.exerciseId, swapExId);
      assert.equal(loggedAfterSwap.exerciseNameSnapshot, "Snapshot Schedule Lunge");
    } finally {
      await deleteSeed(db, userId);
      await db.exercise.deleteMany({ where: { id: { in: [exId, swapExId] } } });
    }
  },
);
