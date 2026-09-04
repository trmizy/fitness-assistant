import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

/**
 * Roadmap P1.4 "Active-workout offline resilience"
 * (docs/features/ACTIVE_WORKOUT_OFFLINE_RESILIENCE_IMPACT_ANALYSIS.md).
 * Proves a same-eventId retry replays the FIRST result instead of
 * re-executing the mutation — the core guarantee the offline queue's
 * drain-on-reconnect depends on (a queued event may genuinely have
 * already reached the server before the client learned that, and the
 * drain must not know or care).
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

async function seedTwoSetProgram(db: PrismaClientLike, userId: string, exerciseId: string) {
  const program = await db.workoutProgram.create({
    data: {
      userId,
      name: "Idempotency test program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Idempotency test day",
          exercises: { create: [{ exerciseId, order: 1, sets: 2, reps: 8, weight: 50 }] },
        },
      },
    },
    include: { days: { include: { exercises: { orderBy: { order: "asc" } } } } },
  });
  const schedule = await db.workoutSchedule.create({
    data: { userId, date: todayAsScheduleDate(), programDayId: program.days[0].id, sourceType: "INTEGRATION_TEST" },
  });
  return { scheduleId: schedule.id, programExerciseId: program.days[0].exercises[0].id };
}

test(
  "updateSet: the same eventId submitted twice executes the mutation ONCE and replays the identical stored result",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `idempotency-updateset-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Idempotency Test Bench Press");
      const { scheduleId, programExerciseId } = await seedTwoSetProgram(db, userId, exId);
      await service.startSchedule(userId, scheduleId);
      const workoutExercise = await db.workoutExercise.findFirstOrThrow({
        where: { programExerciseId },
        include: { workoutSets: { orderBy: { setNumber: "asc" } } },
      });
      const [set1] = workoutExercise.workoutSets;
      const eventId = randomUUID();

      const first = await service.updateSet(set1.id, userId, { weight: 60, reps: 8, completed: true }, eventId);
      // Retry with a DIFFERENT weight than the first call — if the ledger
      // is doing its job, this second value must NEVER actually apply;
      // the retry must return the FIRST call's result untouched.
      const second = await service.updateSet(set1.id, userId, { weight: 999, reps: 1, completed: true }, eventId);

      // The replayed result round-tripped through the ledger's JSONB
      // column, so Date fields come back as ISO strings rather than Date
      // objects — normalize both sides through the same JSON round-trip
      // before comparing (this is expected serialization behavior, not a
      // bug: the values themselves must still match exactly).
      assert.deepEqual(
        JSON.parse(JSON.stringify(second)),
        JSON.parse(JSON.stringify(first)),
        "a same-eventId retry must return the byte-identical first result",
      );
      assert.equal(Number((second as any).weight), 60, "the retry's own (different) payload must never have applied");

      const eventLedgerRows = await db.workoutMutationEvent.findMany({ where: { id: eventId } });
      assert.equal(eventLedgerRows.length, 1, "exactly one ledger row, not one per call");

      const finalSet = await db.workoutSet.findUniqueOrThrow({ where: { id: set1.id } });
      assert.equal(Number(finalSet.weight), 60, "the actual DB row must reflect only the FIRST call, never the retry's 999");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "updateSet: omitting eventId behaves exactly as before — every call executes for real (no accidental ledger interference)",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `idempotency-noeventid-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Idempotency Test Bench Press");
      const { scheduleId, programExerciseId } = await seedTwoSetProgram(db, userId, exId);
      await service.startSchedule(userId, scheduleId);
      const workoutExercise = await db.workoutExercise.findFirstOrThrow({
        where: { programExerciseId },
        include: { workoutSets: { orderBy: { setNumber: "asc" } } },
      });
      const [set1] = workoutExercise.workoutSets;

      await service.updateSet(set1.id, userId, { weight: 60, reps: 8, completed: true });
      await service.updateSet(set1.id, userId, { weight: 70, reps: 9, completed: true });

      const finalSet = await db.workoutSet.findUniqueOrThrow({ where: { id: set1.id } });
      assert.equal(Number(finalSet.weight), 70, "without an eventId, the SECOND call must genuinely re-apply, unchanged from today's behavior");

      const ledgerCount = await db.workoutMutationEvent.count({ where: { userId } });
      assert.equal(ledgerCount, 0, "no eventId means no ledger row is ever written");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "completeScheduleExercise: a retried first-touch call (the real INSERT branch) with the same eventId never hits a raw DB conflict, replays the same result",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `idempotency-firsttouch-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Idempotency Test Bench Press");
      // A fresh 1-set exercise/schedule — completeScheduleExercise's
      // FIRST-TOUCH (tx.workoutExercise.create) branch, the one behind a
      // real unique constraint, fires here (no startSchedule call first).
      const program = await db.workoutProgram.create({
        data: {
          userId,
          name: "Idempotency first-touch test",
          status: "ACTIVE",
          days: {
            create: {
              dayNumber: 1,
              title: "Idempotency first-touch day",
              exercises: { create: [{ exerciseId: exId, order: 1, sets: 1, reps: 8, weight: 50 }] },
            },
          },
        },
        include: { days: { include: { exercises: true } } },
      });
      const schedule = await db.workoutSchedule.create({
        data: { userId, date: todayAsScheduleDate(), programDayId: program.days[0].id, sourceType: "INTEGRATION_TEST" },
      });
      const programExerciseId = program.days[0].exercises[0].id;
      const eventId = randomUUID();

      const first = await service.completeScheduleExercise(
        userId, schedule.id, programExerciseId, { weight: 55, reps: 8 }, eventId,
      );
      const second = await service.completeScheduleExercise(
        userId, schedule.id, programExerciseId, { weight: 999, reps: 1 }, eventId,
      );

      assert.deepEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)));
      const exerciseCount = await db.workoutExercise.count({ where: { programExerciseId } });
      assert.equal(exerciseCount, 1, "the retry must never create a second WorkoutExercise row");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "undoCompleteScheduleExercise: same eventId retry is a safe no-op replay, not a second undo",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `idempotency-undo-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Idempotency Test Bench Press");
      const { scheduleId, programExerciseId } = await seedTwoSetProgram(db, userId, exId);
      await service.startSchedule(userId, scheduleId);
      await service.completeScheduleExercise(userId, scheduleId, programExerciseId, { weight: 55, reps: 8 });

      const eventId = randomUUID();
      const first = await service.undoCompleteScheduleExercise(userId, scheduleId, programExerciseId, eventId);
      const second = await service.undoCompleteScheduleExercise(userId, scheduleId, programExerciseId, eventId);
      assert.deepEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)));
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
