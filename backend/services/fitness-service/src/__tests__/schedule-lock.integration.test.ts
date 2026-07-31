/**
 * Integration tests for the past-date lock enforced by
 * backend/services/fitness-service/src/utils/schedule-lock.util.ts, wired
 * into workout.service.ts's mutating endpoints (startSchedule,
 * completeScheduleExercise, addSet, updateSet, deleteSchedule,
 * createWorkout, updateWorkout, deleteWorkout).
 *
 * This exercises the REAL service + Prisma layer against a real (test-only)
 * database — same gated-real-DB convention as workout.completion.
 * integration.test.ts — so the lock is verified where it actually matters:
 * server-side, independent of whatever the frontend UI shows or disables.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/schedule-lock.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

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

// Anchored to the real current UTC day so "yesterday"/"today"/"tomorrow"
// stay correct no matter when this suite runs — never a hardcoded date.
function dateOnly(offsetDays: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays),
  );
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
        exerciseName: `Lock Test Exercise ${i + 1}`,
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
      name: "Lock Test Program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Lock Test Day 1",
          exercises: {
            create: exerciseIds.map((exerciseId, index) => ({
              exerciseId,
              order: index + 1,
              sets: 1,
              reps: 10,
            })),
          },
        },
      },
    },
    include: { days: { include: { exercises: { orderBy: { order: "asc" } } } } },
  });

  const programDay = program.days[0];
  const schedule = await db.workoutSchedule.create({
    data: {
      userId: options.userId,
      date: options.date,
      programDayId: programDay.id,
      sourceType: "LOCK_INTEGRATION_TEST",
    },
  });

  return { program, programDay, plannedExercises: programDay.exercises, schedule };
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({ where: { id: { startsWith: `${userId}-exercise-` } } });
}

const skipOpts = {
  skip: canUseIntegrationDb
    ? false
    : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
};

test(
  "startSchedule: rejects creating a brand-new session on a locked (yesterday) day",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `lock-it-start-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(-1) });
      await assert.rejects(
        () => service.startSchedule(userId, seeded.schedule.id),
        (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "startSchedule: succeeds normally for today's schedule",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `lock-it-today-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(0) });
      const started = await service.startSchedule(userId, seeded.schedule.id);
      assert.equal(started.sessionStatus, "in_progress");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "startSchedule: resuming an ALREADY-started session on a now-locked day still succeeds (read-only viewing must stay possible)",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `lock-it-resume-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      // Start it "today" (simulated as today via date(0)) then move the
      // schedule's date itself into the past to simulate the clock
      // advancing past midnight on an already-started session.
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(0) });
      await service.startSchedule(userId, seeded.schedule.id);
      await db.workoutSchedule.update({
        where: { id: seeded.schedule.id },
        data: { date: dateOnly(-1) },
      });
      const resumed = await service.startSchedule(userId, seeded.schedule.id);
      assert.ok(resumed.workoutId);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "completeScheduleExercise: rejected on a locked (yesterday) day even if the session was already started",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `lock-it-complete-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      // Regression guard for the exact midnight-rollover edge case: a
      // session started while the day was still "today" must NOT be
      // completable anymore once the schedule's date is in the past — the
      // lock rule is prioritized over an in-progress session, per explicit
      // product decision (see schedule-lock.util.ts's doc comment).
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(0) });
      await service.startSchedule(userId, seeded.schedule.id);
      await db.workoutSchedule.update({
        where: { id: seeded.schedule.id },
        data: { date: dateOnly(-1) },
      });
      await assert.rejects(
        () =>
          service.completeScheduleExercise(
            userId,
            seeded.schedule.id,
            seeded.plannedExercises[0].id,
          ),
        (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "completeScheduleExercise: allowed normally for today's schedule",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `lock-it-complete-today-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(0) });
      await service.startSchedule(userId, seeded.schedule.id);
      const result = await service.completeScheduleExercise(
        userId,
        seeded.schedule.id,
        seeded.plannedExercises[0].id,
      );
      assert.equal(result.completedExercises, 1);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "deleteSchedule: rejected for a locked (yesterday) day",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `lock-it-delete-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(-2) });
      await assert.rejects(
        () => service.deleteSchedule(seeded.schedule.id, userId),
        (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  // Future days are now locked too (§3.3 fix) — a session dated after today
  // cannot be started/completed/deleted yet, since it hasn't occurred. See
  // schedule-lock.util.ts's isScheduleDateLocked doc comment for the exact
  // contradiction (future day simultaneously "100%/Hoàn thành" + an enabled
  // start/edit button) this closes.
  "deleteSchedule: locked (409) for a future day, same as a past day",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `lock-it-delete-future-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(3) });
      await assert.rejects(
        () => service.deleteSchedule(seeded.schedule.id, userId),
        (err: any) => {
          assert.equal(err.status, 409);
          assert.equal(err.code, "SCHEDULE_DATE_LOCKED");
          return true;
        },
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "addSet: rejected for a workout attached to a locked (yesterday) schedule",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `lock-it-addset-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(0) });
      const started = await service.startSchedule(userId, seeded.schedule.id);
      await db.workoutSchedule.update({
        where: { id: seeded.schedule.id },
        data: { date: dateOnly(-1) },
      });
      await assert.rejects(
        () =>
          service.addSet(started.workoutId!, userId, {
            exerciseId: seeded.plannedExercises[0].exerciseId,
          }),
        (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "updateSet: rejected for a set belonging to a locked (yesterday) schedule",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `lock-it-updateset-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(-1) });
      // Backdate directly at creation so the initial workout itself is
      // created via a raw insert (bypassing startSchedule's own lock) to
      // isolate updateSet's guard specifically.
      const workout = await db.workout.create({
        data: {
          userId,
          name: "Backdated",
          date: dateOnly(-1),
          exercises: {
            create: {
              exerciseId: seeded.plannedExercises[0].exerciseId,
              programExerciseId: seeded.plannedExercises[0].id,
              sets: 1,
              workoutSets: { create: { setNumber: 1, completed: false } },
            },
          },
        },
        include: { exercises: { include: { workoutSets: true } } },
      });
      await db.workoutSchedule.update({
        where: { id: seeded.schedule.id },
        data: { workoutId: workout.id },
      });
      const setId = workout.exercises[0].workoutSets[0].id;
      await assert.rejects(
        () => service.updateSet(setId, userId, { completed: true }),
        (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "createWorkout: rejected when scheduleId points at a locked (yesterday) day",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `lock-it-createworkout-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedProgramWithSchedule(db, { userId, date: dateOnly(-1) });
      await assert.rejects(
        () =>
          service.createWorkout(userId, {
            scheduleId: seeded.schedule.id,
            name: "Backdated log attempt",
            exercises: [
              { exerciseId: seeded.plannedExercises[0].exerciseId, sets: [{ setNumber: 1 }] },
            ],
          } as any),
        (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
