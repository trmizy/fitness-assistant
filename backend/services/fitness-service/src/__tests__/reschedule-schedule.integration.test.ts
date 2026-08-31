import test from "node:test";
import assert from "node:assert/strict";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

/**
 * Roadmap P1.2 "Reschedule workout"
 * (docs/features/RESCHEDULE_WORKOUT_IMPACT_ANALYSIS.md). Covers the 7
 * required cases plus the doc's central architectural claim: a reschedule
 * is a plain UPDATE of the same row's `date` — never a new row — so
 * computeAdherence (an unmodified, pre-existing range query) reflects it
 * correctly with zero changes to any adherence/cycle code.
 */

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type WorkoutServiceLike = (typeof import("../services/workout.service"))["workoutService"];
type WorkoutQueueLike = (typeof import("../services/workout.service"))["workoutQueue"];
type ComputeAdherenceLike = (typeof import("../services/training-cycle-metrics.service"))["computeAdherence"];

let prisma: PrismaClientLike | undefined;
let workoutService: WorkoutServiceLike | undefined;
let workoutQueue: WorkoutQueueLike | undefined;
let computeAdherence: ComputeAdherenceLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/workout.service");
    const metricsModule = await import("../services/training-cycle-metrics.service");
    prisma = prismaModule.prisma;
    workoutService = serviceModule.workoutService;
    workoutQueue = serviceModule.workoutQueue;
    computeAdherence = metricsModule.computeAdherence;
  }
  return { prisma: prisma!, workoutService: workoutService!, workoutQueue: workoutQueue!, computeAdherence: computeAdherence! };
}

test.after(async () => {
  if (workoutQueue) await workoutQueue.close();
  if (prisma) await prisma.$disconnect();
});

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

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

async function seedProgramAndSchedule(
  db: PrismaClientLike,
  userId: string,
  exerciseId: string,
  date: Date,
  title = "Reschedule test day",
) {
  const program = await db.workoutProgram.create({
    data: {
      userId,
      name: "Reschedule test program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title,
          exercises: { create: [{ exerciseId, order: 1, sets: 1, reps: 8, weight: 50 }] },
        },
      },
    },
    include: { days: true },
  });
  const schedule = await db.workoutSchedule.create({
    data: { userId, date, programDayId: program.days[0].id, sourceType: "INTEGRATION_TEST" },
  });
  return { programId: program.id, programDayId: program.days[0].id, scheduleId: schedule.id };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

test(
  "case 1+2: a not-started future/today session reschedules to another future day, same row (id unchanged)",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `reschedule-basic-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Reschedule Test Bench Press");
      const today = todayAsScheduleDate();
      const source = addDays(today, 3); // a future session
      const target = addDays(today, 7);
      const { scheduleId } = await seedProgramAndSchedule(db, userId, exId, source);

      const result = await service.rescheduleSchedule(userId, scheduleId, isoDate(target));
      assert.equal(result.id, scheduleId, "same row — never a new one");
      assert.equal(result.date.getTime(), target.getTime());
      assert.ok(result.rescheduledAt, "rescheduledAt must be set");
      assert.equal(result.originalPlannedDate?.getTime(), source.getTime());

      const reloaded = await db.workoutSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
      assert.equal(reloaded.date.getTime(), target.getTime());
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "case 3: a missed (past) not-started session can be rescheduled onto a valid recovery date",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `reschedule-missed-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Reschedule Test Bench Press");
      const today = todayAsScheduleDate();
      const missedDate = addDays(today, -5); // a genuinely missed past session
      const target = addDays(today, 2);
      const { scheduleId } = await seedProgramAndSchedule(db, userId, exId, missedDate);

      // Sanity: every OTHER mutation on this same past row is rejected —
      // proves reschedule deliberately does NOT reuse assertScheduleDateEditable.
      await assert.rejects(() => service.skipSchedule(scheduleId, userId));

      const result = await service.rescheduleSchedule(userId, scheduleId, isoDate(target));
      assert.equal(result.date.getTime(), target.getTime());
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "target date must be today or future — rejects a past target",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `reschedule-past-target-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Reschedule Test Bench Press");
      const today = todayAsScheduleDate();
      const { scheduleId } = await seedProgramAndSchedule(db, userId, exId, addDays(today, 3));

      await assert.rejects(
        () => service.rescheduleSchedule(userId, scheduleId, isoDate(addDays(today, -1))),
        (err: any) => err?.status === 400,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "case 4: rejects rescheduling onto a day that already has another session (409, names what's there)",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `reschedule-conflict-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Reschedule Test Bench Press");
      const today = todayAsScheduleDate();
      const occupiedDate = addDays(today, 5);
      await seedProgramAndSchedule(db, userId, exId, occupiedDate, "Leg Day");
      const { scheduleId } = await seedProgramAndSchedule(db, userId, exId, addDays(today, 2), "Push Day");

      await assert.rejects(
        () => service.rescheduleSchedule(userId, scheduleId, isoDate(occupiedDate)),
        (err: any) => err?.status === 409 && /Leg Day/.test(err.message),
      );
      // The source row must be untouched by the rejected attempt.
      const reloaded = await db.workoutSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
      assert.equal(reloaded.date.getTime(), addDays(today, 2).getTime());
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "case 5: rescheduling the same session repeatedly keeps originalPlannedDate fixed to the true first plan",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `reschedule-repeat-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Reschedule Test Bench Press");
      const today = todayAsScheduleDate();
      const original = addDays(today, 1);
      const { scheduleId } = await seedProgramAndSchedule(db, userId, exId, original);

      const first = await service.rescheduleSchedule(userId, scheduleId, isoDate(addDays(today, 4)));
      assert.equal(first.originalPlannedDate?.getTime(), original.getTime());

      const second = await service.rescheduleSchedule(userId, scheduleId, isoDate(addDays(today, 9)));
      assert.equal(second.date.getTime(), addDays(today, 9).getTime());
      assert.equal(
        second.originalPlannedDate?.getTime(),
        original.getTime(),
        "originalPlannedDate must stay pinned to the FIRST plan, not the intermediate reschedule",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "case 7: a completed/started session (workoutId set) cannot be rescheduled",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `reschedule-started-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Reschedule Test Bench Press");
      const today = todayAsScheduleDate();
      const { scheduleId } = await seedProgramAndSchedule(db, userId, exId, today);
      await service.startSchedule(userId, scheduleId);

      await assert.rejects(
        () => service.rescheduleSchedule(userId, scheduleId, isoDate(addDays(today, 3))),
        (err: any) => err?.status === 409,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "scope boundary: a SKIPPED session cannot be rescheduled either",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `reschedule-skipped-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Reschedule Test Bench Press");
      const today = todayAsScheduleDate();
      const { scheduleId } = await seedProgramAndSchedule(db, userId, exId, today);
      await service.skipSchedule(scheduleId, userId);

      await assert.rejects(
        () => service.rescheduleSchedule(userId, scheduleId, isoDate(addDays(today, 3))),
        (err: any) => err?.status === 409,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "central architectural claim: computeAdherence (unmodified) correctly reflects a reschedule with zero adherence-code changes",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service, computeAdherence: adherence } = await loadModules();
    const userId = `reschedule-adherence-it-${Date.now()}`;
    const exId = `${userId}-ex`;
    await deleteSeed(db, userId);
    try {
      await seedExercise(db, exId, "Reschedule Test Bench Press");
      const today = todayAsScheduleDate();
      const cycleStart = addDays(today, -10);
      const cycleEnd = addDays(today, 10);

      // Two sessions inside the cycle window to start.
      const { scheduleId: s1 } = await seedProgramAndSchedule(db, userId, exId, addDays(today, 1));
      await seedProgramAndSchedule(db, userId, exId, addDays(today, 2));

      const before = await adherence(userId, null, cycleStart, cycleEnd);
      assert.equal(before.total, 2);
      assert.equal(before.completed, 0);

      // Reschedule session 1 OUT of the cycle window entirely (30 days out).
      await service.rescheduleSchedule(userId, s1, isoDate(addDays(today, 30)));
      const afterOutOfWindow = await adherence(userId, null, cycleStart, cycleEnd);
      assert.equal(
        afterOutOfWindow.total,
        1,
        "moving a session OUT of the cycle window must drop it from that cycle's total — never counted as missed",
      );

      // Reschedule it back to WITHIN the window — total must recover, no
      // duplicate/phantom counting from the earlier move.
      await service.rescheduleSchedule(userId, s1, isoDate(addDays(today, 5)));
      const afterBackIn = await adherence(userId, null, cycleStart, cycleEnd);
      assert.equal(afterBackIn.total, 2);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
