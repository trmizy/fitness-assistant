/**
 * Integration tests for the workout-log completion gaps flagged in
 * docs/workout-log-audit.md's "Known Gaps" and
 * docs/CLOUDCODE_IMPLEMENTATION_AUDIT.md (G1/G2/G3):
 *
 *  - SKIPPED was a valid WorkoutSchedule.status value with no code path
 *    that ever wrote it — skipSchedule() now does.
 *  - PARTIALLY_COMPLETED distinguishes "some exercises actually logged"
 *    from "session started, nothing done yet" (previously both read as
 *    IN_PROGRESS).
 *  - CANCELLED with a mandatory reason, distinct from SKIPPED.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/workout-schedule-lifecycle.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test",
};

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

function dateOnly(offsetDays: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
}

async function seedProgramWithSchedule(
  db: PrismaClientLike,
  options: { userId: string; date: Date; exerciseCount?: number },
) {
  const exerciseCount = options.exerciseCount ?? 2;
  const seedId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const exerciseIds: string[] = [];
  for (let i = 0; i < exerciseCount; i += 1) {
    const exercise = await db.exercise.create({
      data: {
        id: `${options.userId}-exercise-${seedId}-${i + 1}`,
        exerciseName: `Lifecycle Test Exercise ${i + 1}`,
        typeOfActivity: "STRENGTH",
        typeOfEquipment: "BODYWEIGHT",
        bodyPart: "UPPER_BODY",
        type: "PUSH",
        muscleGroupsActivated: ["test"],
        instructions: "Test exercise.",
      },
    });
    exerciseIds.push(exercise.id);
  }

  const program = await db.workoutProgram.create({
    data: {
      userId: options.userId,
      name: "Lifecycle Test Program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Lifecycle Test Day 1",
          exercises: {
            create: exerciseIds.map((exerciseId, index) => ({ exerciseId, order: index + 1, sets: 1, reps: 10 })),
          },
        },
      },
    },
    include: { days: { include: { exercises: { orderBy: { order: "asc" } } } } },
  });

  const programDay = program.days[0];
  const schedule = await db.workoutSchedule.create({
    data: { userId: options.userId, date: options.date, programDayId: programDay.id, sourceType: "LIFECYCLE_TEST" },
  });

  return { program, programDay, plannedExercises: programDay.exercises, schedule };
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({ where: { id: { startsWith: `${userId}-exercise-` } } });
}

test("skipSchedule: writes SKIPPED for today's not-yet-started schedule", skipOpts, async () => {
  const { prisma: db, workoutService: service } = await loadModules();
  const userId = `skip-it-${Date.now()}`;
  await deleteSeed(db, userId);
  try {
    const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(0) });
    const result = await service.skipSchedule(seeded.schedule.id, userId, "Không đủ thời gian hôm nay");
    assert.equal(result.status, "SKIPPED");
    assert.equal(result.notes, "Không đủ thời gian hôm nay");
  } finally {
    await deleteSeed(db, userId);
  }
});

test("skipSchedule: rejected (409) once a real workout log already exists for the schedule", skipOpts, async () => {
  const { prisma: db, workoutService: service } = await loadModules();
  const userId = `skip-started-${Date.now()}`;
  await deleteSeed(db, userId);
  try {
    const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(0) });
    await service.startSchedule(userId, seeded.schedule.id);
    await assert.rejects(
      () => service.skipSchedule(seeded.schedule.id, userId),
      (err: any) => err?.status === 409,
    );
  } finally {
    await deleteSeed(db, userId);
  }
});

test("skipSchedule: locked (409) for a future day, same as every other mutating endpoint", skipOpts, async () => {
  const { prisma: db, workoutService: service } = await loadModules();
  const userId = `skip-future-${Date.now()}`;
  await deleteSeed(db, userId);
  try {
    const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(3) });
    await assert.rejects(
      () => service.skipSchedule(seeded.schedule.id, userId),
      (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
    );
  } finally {
    await deleteSeed(db, userId);
  }
});

test("cancelSchedule: requires a reason and writes CANCELLED + the reason as notes", skipOpts, async () => {
  const { prisma: db, workoutService: service } = await loadModules();
  const userId = `cancel-it-${Date.now()}`;
  await deleteSeed(db, userId);
  try {
    const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(0) });
    const result = await service.cancelSchedule(seeded.schedule.id, userId, "Đổi lịch tập");
    assert.equal(result.status, "CANCELLED");
    assert.equal(result.notes, "Đổi lịch tập");
  } finally {
    await deleteSeed(db, userId);
  }
});

test(
  "recomputeScheduleProgress: 1-of-2 exercises completed reads as PARTIALLY_COMPLETED, distinct from a just-started session",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `partial-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(0), exerciseCount: 2 });
      const started = await service.startSchedule(userId, seeded.schedule.id);
      assert.equal(started.sessionStatus, "in_progress");

      let reloaded = await db.workoutSchedule.findUniqueOrThrow({ where: { id: seeded.schedule.id } });
      assert.equal(reloaded.status, "IN_PROGRESS", "0 of 2 exercises done — not yet PARTIALLY_COMPLETED");

      const afterFirst = await service.completeScheduleExercise(userId, seeded.schedule.id, seeded.plannedExercises[0].id);
      reloaded = await db.workoutSchedule.findUniqueOrThrow({ where: { id: seeded.schedule.id } });
      assert.equal(reloaded.status, "PARTIALLY_COMPLETED", "1 of 2 exercises done — must be distinct from IN_PROGRESS");
      assert.equal(reloaded.completedExercises, 1);
      assert.equal(reloaded.totalExercises, 2);

      // The external API contract stays stable — a PARTIALLY_COMPLETED
      // schedule must still report "in_progress" externally, not regress
      // to "not_started".
      assert.equal(afterFirst.sessionStatus, "in_progress");
      assert.equal(afterFirst.dayStatus, "in_progress");

      await service.completeScheduleExercise(userId, seeded.schedule.id, seeded.plannedExercises[1].id);
      reloaded = await db.workoutSchedule.findUniqueOrThrow({ where: { id: seeded.schedule.id } });
      assert.equal(reloaded.status, "COMPLETED", "2 of 2 exercises done — must be COMPLETED, not PARTIALLY_COMPLETED");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
