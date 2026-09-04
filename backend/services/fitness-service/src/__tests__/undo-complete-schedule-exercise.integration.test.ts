import test from "node:test";
import assert from "node:assert/strict";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

/**
 * Roadmap P1.6 "undo last set" (docs/features/UNDO_LAST_SET_IMPACT_ANALYSIS.md).
 * `undoCompleteScheduleExercise` is a thin sibling of `completeScheduleExercise`
 * that flips `WorkoutSet.completed` back to false and re-runs the exact same
 * `recomputeScheduleProgress` derivation completion already uses — these
 * tests prove that derivation correctly reflects the reversal (no parallel
 * counting logic to get wrong), and that undo is properly scoped (rejects a
 * never-completed exercise, rejects a locked/past day, never touches a
 * sibling exercise's own completion).
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

async function seedTwoExerciseProgram(db: PrismaClientLike, userId: string, exAId: string, exBId: string, date: Date) {
  const program = await db.workoutProgram.create({
    data: {
      userId,
      name: "Undo-complete test program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Undo-complete test day",
          exercises: {
            create: [
              { exerciseId: exAId, order: 1, sets: 1, reps: 8, weight: 50 },
              { exerciseId: exBId, order: 2, sets: 1, reps: 8, weight: 40 },
            ],
          },
        },
      },
    },
    include: { days: { include: { exercises: { orderBy: { order: "asc" } } } } },
  });
  const schedule = await db.workoutSchedule.create({
    data: { userId, date, programDayId: program.days[0].id, sourceType: "INTEGRATION_TEST" },
  });
  return {
    scheduleId: schedule.id,
    programExerciseAId: program.days[0].exercises[0].id,
    programExerciseBId: program.days[0].exercises[1].id,
  };
}

test(
  "undoCompleteScheduleExercise flips completed back to false and recomputeScheduleProgress correctly reports one fewer completed exercise",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `undo-complete-it-${Date.now()}`;
    const exAId = `${userId}-ex-a`;
    const exBId = `${userId}-ex-b`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exAId, "Undo Test Bench Press");
      await seedExercise(db, exBId, "Undo Test Row");
      const { scheduleId, programExerciseAId } = await seedTwoExerciseProgram(
        db, userId, exAId, exBId, todayAsScheduleDate(),
      );

      await service.startSchedule(userId, scheduleId);
      const afterComplete = await service.completeScheduleExercise(userId, scheduleId, programExerciseAId, {
        weight: 55, reps: 8,
      });
      assert.equal(afterComplete.completedExercises, 1);
      assert.equal(afterComplete.totalExercises, 2);

      const afterUndo = await service.undoCompleteScheduleExercise(userId, scheduleId, programExerciseAId);
      assert.equal(afterUndo.completedExercises, 0, "undo must decrease the derived completed count");
      assert.equal(afterUndo.totalExercises, 2, "total is unaffected by undo");
      assert.equal(afterUndo.sessionStatus, "in_progress", "session was started (workoutId exists) but nothing is completed now");

      const workoutExercise = await db.workoutExercise.findFirstOrThrow({
        where: { workoutId: afterComplete.workoutId!, programExerciseId: programExerciseAId },
        include: { workoutSets: true },
      });
      assert.equal(workoutExercise.workoutSets.length, 1);
      assert.equal(workoutExercise.workoutSets[0].completed, false);
      // The just-submitted values must survive undo (never blanked) — the
      // frontend is what restores them into the editable draft, but the
      // PERSISTED row itself must still show what was actually logged.
      assert.equal(Number(workoutExercise.workoutSets[0].weight), 55);
      assert.equal(workoutExercise.workoutSets[0].reps, 8);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "undoCompleteScheduleExercise rejects an exercise that is not currently completed",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `undo-not-completed-it-${Date.now()}`;
    const exAId = `${userId}-ex-a`;
    const exBId = `${userId}-ex-b`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exAId, "Undo Test Bench Press");
      await seedExercise(db, exBId, "Undo Test Row");
      const { scheduleId, programExerciseAId } = await seedTwoExerciseProgram(
        db, userId, exAId, exBId, todayAsScheduleDate(),
      );

      await service.startSchedule(userId, scheduleId);
      // Never completed — no session started for this exercise at all yet.
      await assert.rejects(
        () => service.undoCompleteScheduleExercise(userId, scheduleId, programExerciseAId),
        (err: any) => err?.status === 409,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "undoCompleteScheduleExercise never touches a sibling exercise's own completion",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `undo-sibling-isolation-it-${Date.now()}`;
    const exAId = `${userId}-ex-a`;
    const exBId = `${userId}-ex-b`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exAId, "Undo Test Bench Press");
      await seedExercise(db, exBId, "Undo Test Row");
      const { scheduleId, programExerciseAId, programExerciseBId } = await seedTwoExerciseProgram(
        db, userId, exAId, exBId, todayAsScheduleDate(),
      );

      await service.startSchedule(userId, scheduleId);
      await service.completeScheduleExercise(userId, scheduleId, programExerciseAId, { weight: 55, reps: 8 });
      const afterBoth = await service.completeScheduleExercise(userId, scheduleId, programExerciseBId, { weight: 45, reps: 8 });
      assert.equal(afterBoth.completedExercises, 2);
      assert.equal(afterBoth.sessionStatus, "completed");

      const afterUndoA = await service.undoCompleteScheduleExercise(userId, scheduleId, programExerciseAId);
      assert.equal(afterUndoA.completedExercises, 1, "only A's completion should be reversed");
      assert.equal(afterUndoA.sessionStatus, "in_progress", "no longer fully completed once A is undone");

      const exerciseB = await db.workoutExercise.findFirstOrThrow({
        where: { workoutId: afterBoth.workoutId!, programExerciseId: programExerciseBId },
        include: { workoutSets: true },
      });
      assert.equal(exerciseB.workoutSets[0].completed, true, "B must remain completed — undo(A) must not touch B");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "undoCompleteScheduleExercise is rejected for a locked (past, non-today) schedule",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `undo-locked-day-it-${Date.now()}`;
    const exAId = `${userId}-ex-a`;
    const exBId = `${userId}-ex-b`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exAId, "Undo Test Bench Press");
      await seedExercise(db, exBId, "Undo Test Row");
      const today = todayAsScheduleDate();
      const { scheduleId, programExerciseAId } = await seedTwoExerciseProgram(
        db, userId, exAId, exBId, today,
      );

      await service.startSchedule(userId, scheduleId);
      await service.completeScheduleExercise(userId, scheduleId, programExerciseAId, { weight: 55, reps: 8 });

      // Simulate the schedule having become a past (locked) day, exactly the
      // same "yesterday" UTC-midnight-anchored label convention every other
      // schedule-lock test in this suite uses.
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      await db.workoutSchedule.update({ where: { id: scheduleId }, data: { date: yesterday } });

      await assert.rejects(
        () => service.undoCompleteScheduleExercise(userId, scheduleId, programExerciseAId),
        (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
