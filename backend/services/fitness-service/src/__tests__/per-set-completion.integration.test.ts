import test from "node:test";
import assert from "node:assert/strict";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

/**
 * Roadmap P1.1 "true set-by-set table UI"
 * (docs/features/SET_BY_SET_TABLE_UI_IMPACT_ANALYSIS.md). Proves the two
 * load-bearing facts the frontend's per-set table design depends on:
 *
 * 1. `updateSet` (PATCH /workouts/sets/:setId) never touches a SIBLING
 *    WorkoutSet when completing one set — unlike `completeScheduleExercise`
 *    (a real bug this pass found and deliberately routed around: its
 *    "re-completion" branch unconditionally overwrites every sibling set's
 *    weight/reps/etc with the one value it was given).
 * 2. `updateSet`'s response now carries the same `progress`
 *    (WorkoutProgressSummary) shape `completeScheduleExercise` already
 *    returns, correctly reflecting set-by-set granularity
 *    (completedSets/totalSets) and only flipping the exercise itself to
 *    "completed" once every one of its sets is done.
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

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workout.deleteMany({ where: { userId } });
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
}

async function seedThreeSetProgram(db: PrismaClientLike, userId: string, exerciseId: string) {
  const program = await db.workoutProgram.create({
    data: {
      userId,
      name: "Per-set completion test program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Per-set completion test day",
          exercises: {
            create: [{ exerciseId, order: 1, sets: 3, reps: 8, weight: 50 }],
          },
        },
      },
    },
    include: { days: { include: { exercises: { orderBy: { order: "asc" } } } } },
  });
  const schedule = await db.workoutSchedule.create({
    data: {
      userId,
      date: todayAsScheduleDate(),
      programDayId: program.days[0].id,
      sourceType: "INTEGRATION_TEST",
    },
  });
  return { scheduleId: schedule.id, programExerciseId: program.days[0].exercises[0].id };
}

test(
  "updateSet never overwrites a SIBLING WorkoutSet's already-logged distinct values",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `per-set-isolation-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Per-Set Isolation Bench Press");
      const { scheduleId, programExerciseId } = await seedThreeSetProgram(db, userId, exId);

      await service.startSchedule(userId, scheduleId);
      const workoutExercise = await db.workoutExercise.findFirstOrThrow({
        where: { programExerciseId },
        include: { workoutSets: { orderBy: { setNumber: "asc" } } },
      });
      assert.equal(workoutExercise.workoutSets.length, 3, "startSchedule must pre-create all 3 planned sets");
      const [set1, set2] = workoutExercise.workoutSets;

      // Complete set 1 at 60kg, then set 2 at 70kg — two genuinely DIFFERENT
      // values, exactly the scenario completeScheduleExercise's bulk
      // updateMany would have silently collapsed into one.
      await service.updateSet(set1.id, userId, { weight: 60, reps: 8, completed: true });
      await service.updateSet(set2.id, userId, { weight: 70, reps: 8, completed: true });

      const afterBoth = await db.workoutSet.findMany({
        where: { workoutExerciseId: workoutExercise.id },
        orderBy: { setNumber: "asc" },
      });
      assert.equal(Number(afterBoth[0].weight), 60, "set 1 must keep its OWN 60kg, not be overwritten by set 2's 70kg");
      assert.equal(afterBoth[0].completed, true);
      assert.equal(Number(afterBoth[1].weight), 70);
      assert.equal(afterBoth[1].completed, true);
      assert.equal(afterBoth[2].completed, false, "set 3 must remain untouched/incomplete");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "updateSet's response carries set-granular progress and only flips the exercise completed once every set is done",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `per-set-progress-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Per-Set Progress Bench Press");
      const { scheduleId, programExerciseId } = await seedThreeSetProgram(db, userId, exId);

      await service.startSchedule(userId, scheduleId);
      const workoutExercise = await db.workoutExercise.findFirstOrThrow({
        where: { programExerciseId },
        include: { workoutSets: { orderBy: { setNumber: "asc" } } },
      });
      const [set1, set2, set3] = workoutExercise.workoutSets;

      const afterSet1: any = await service.updateSet(set1.id, userId, { weight: 60, reps: 8, completed: true });
      assert.ok(afterSet1.progress, "updateSet's response must include a progress field");
      assert.equal(afterSet1.progress.completedSets, 1);
      assert.equal(afterSet1.progress.totalSets, 3);
      assert.equal(afterSet1.progress.completedExercises, 0, "exercise is NOT done yet — 2 sets still remain");

      const afterSet2: any = await service.updateSet(set2.id, userId, { weight: 70, reps: 8, completed: true });
      assert.equal(afterSet2.progress.completedSets, 2);
      assert.equal(afterSet2.progress.completedExercises, 0, "still not done — 1 set remains");

      const afterSet3: any = await service.updateSet(set3.id, userId, { weight: 80, reps: 8, completed: true });
      assert.equal(afterSet3.progress.completedSets, 3);
      assert.equal(afterSet3.progress.completedExercises, 1, "the LAST set completing must flip the exercise to done");
      assert.equal(afterSet3.progress.totalExercises, 1);
      assert.equal(afterSet3.progress.sessionStatus, "completed");

      // All 3 sets' own distinct values must have survived to the end.
      const finalSets = await db.workoutSet.findMany({
        where: { workoutExerciseId: workoutExercise.id },
        orderBy: { setNumber: "asc" },
      });
      assert.deepEqual(
        finalSets.map((s) => Number(s.weight)),
        [60, 70, 80],
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
