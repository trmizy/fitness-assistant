import test from "node:test";
import assert from "node:assert/strict";

/**
 * Roadmap P1.3 "Superset / exercise grouping"
 * (docs/features/SUPERSET_GROUPING_IMPACT_ANALYSIS.md).
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

// Seeds a day with 4 exercises in order: A, B, C, D — lets each test pick
// which pair/subset to group and verify the resulting order independently.
async function seedFourExerciseDay(db: PrismaClientLike, userId: string, exIds: string[]) {
  const program = await db.workoutProgram.create({
    data: {
      userId,
      name: "Exercise group test program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Exercise group test day",
          exercises: {
            create: exIds.map((exerciseId, index) => ({
              exerciseId,
              order: index,
              sets: 3,
              reps: 8,
            })),
          },
        },
      },
    },
    include: { days: { include: { exercises: { orderBy: { order: "asc" } } } } },
  });
  return {
    programDayId: program.days[0].id,
    programExerciseIds: program.days[0].exercises.map((e) => e.id),
  };
}

test(
  "createExerciseGroup groups A and C (non-adjacent) into a contiguous block at A's original position",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `exgroup-contiguity-it-${Date.now()}`;
    const exIds = [0, 1, 2, 3].map((i) => `${userId}-ex-${i}`);
    await deleteSeed(db, userId);
    try {
      for (const [i, id] of exIds.entries()) await seedExercise(db, id, `Group Test Exercise ${i}`);
      const { programDayId, programExerciseIds: [A, B, C, D] } = await seedFourExerciseDay(db, userId, exIds);

      const group = await service.createExerciseGroup(userId, programDayId, [A, C], "SUPERSET", 15, 120);
      assert.equal(group.type, "SUPERSET");
      assert.equal(group.restBetweenExercisesSeconds, 15);
      assert.equal(group.restAfterRoundSeconds, 120);
      assert.equal(group.members.length, 2);
      // Member order matches the CALLER's selection order (A before C).
      const memberIds = group.members.sort((m1: any, m2: any) => m1.order - m2.order).map((m: any) => m.programExerciseId);
      assert.deepEqual(memberIds, [A, C]);

      const reordered = await db.workoutProgramExercise.findMany({
        where: { programDayId },
        orderBy: { order: "asc" },
      });
      // A and C now sit contiguously (A's original position), B and D
      // shifted after — never interleaved with an unrelated exercise.
      assert.deepEqual(
        reordered.map((e) => e.id),
        [A, C, B, D],
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "rejects a group with fewer than 2 members, cross-day members, and an already-grouped exercise",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `exgroup-validation-it-${Date.now()}`;
    const exIds = [0, 1, 2, 3].map((i) => `${userId}-ex-${i}`);
    await deleteSeed(db, userId);
    try {
      for (const [i, id] of exIds.entries()) await seedExercise(db, id, `Group Test Exercise ${i}`);
      const { programDayId, programExerciseIds: [A, B] } = await seedFourExerciseDay(db, userId, exIds);

      await assert.rejects(
        () => service.createExerciseGroup(userId, programDayId, [A], "SUPERSET"),
        (err: any) => err?.status === 400,
      );
      await assert.rejects(
        () => service.createExerciseGroup(userId, programDayId, [A, "not-a-real-id"], "SUPERSET"),
        (err: any) => err?.status === 400,
      );
      await assert.rejects(
        () => service.createExerciseGroup(userId, programDayId, [A, B], "NOT_A_TYPE"),
        (err: any) => err?.status === 400,
      );

      await service.createExerciseGroup(userId, programDayId, [A, B], "SUPERSET");
      const { programExerciseIds: [, , C] } = { programExerciseIds: [A, B, (await db.workoutProgramExercise.findMany({ where: { programDayId }, orderBy: { order: "asc" } }))[2].id] };
      await assert.rejects(
        () => service.createExerciseGroup(userId, programDayId, [A, C], "SUPERSET"),
        (err: any) => err?.status === 409,
        "A is already in a group — must reject, not silently move it into a second one",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "ungroupExercises removes the group without touching the exercises or their current order",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `exgroup-ungroup-it-${Date.now()}`;
    const exIds = [0, 1, 2].map((i) => `${userId}-ex-${i}`);
    await deleteSeed(db, userId);
    try {
      for (const [i, id] of exIds.entries()) await seedExercise(db, id, `Group Test Exercise ${i}`);
      const { programDayId, programExerciseIds: [A, B] } = await seedFourExerciseDay(db, userId, exIds);

      const group = await service.createExerciseGroup(userId, programDayId, [A, B], "SUPERSET");
      const orderBefore = await db.workoutProgramExercise.findMany({
        where: { programDayId },
        orderBy: { order: "asc" },
        select: { id: true, order: true },
      });

      await service.ungroupExercises(group.id, userId);

      const groupGone = await db.workoutProgramExerciseGroup.findUnique({ where: { id: group.id } });
      assert.equal(groupGone, null);
      const exercisesStillExist = await db.workoutProgramExercise.findMany({
        where: { programDayId },
        orderBy: { order: "asc" },
        select: { id: true, order: true },
      });
      assert.deepEqual(exercisesStillExist, orderBefore, "ungrouping must never touch the exercises or their order");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "GET-shaped fetch (getCurrentProgram) includes exerciseGroups with members",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `exgroup-fetch-it-${Date.now()}`;
    const exIds = [0, 1].map((i) => `${userId}-ex-${i}`);
    await deleteSeed(db, userId);
    try {
      for (const [i, id] of exIds.entries()) await seedExercise(db, id, `Group Test Exercise ${i}`);
      const { programDayId, programExerciseIds: [A, B] } = await seedFourExerciseDay(db, userId, exIds);
      await service.createExerciseGroup(userId, programDayId, [A, B], "SUPERSET", 20, 90);

      const program = await service.getCurrentProgram(userId);
      const day = program?.days.find((d: any) => d.id === programDayId);
      assert.ok(day, "program day must be present in getCurrentProgram's response");
      assert.equal(day.exerciseGroups.length, 1);
      assert.equal(day.exerciseGroups[0].type, "SUPERSET");
      assert.equal(day.exerciseGroups[0].members.length, 2);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
