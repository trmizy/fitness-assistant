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

function dateOnly(offsetDays: number): Date {
  const date = new Date(Date.UTC(2026, 6, 9 + offsetDays));
  return date;
}

async function seedProgramWithSchedule(
  db: PrismaClientLike,
  options: {
    userId: string;
    date: Date;
    exerciseCount: number;
    duplicateGlobalExercise?: boolean;
  },
) {
  const exerciseIds: string[] = [];
  const uniqueExerciseCount = options.duplicateGlobalExercise
    ? 1
    : options.exerciseCount;
  const seedId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  for (let i = 0; i < uniqueExerciseCount; i += 1) {
    const exercise = await db.exercise.create({
      data: {
        id: `${options.userId}-exercise-${seedId}-${i + 1}`,
        exerciseName: `Integration Exercise ${i + 1}`,
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
      name: "Integration Workout Program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Integration Day 1",
          exercises: {
            create: Array.from(
              { length: options.exerciseCount },
              (_unused, index) => ({
                exerciseId: options.duplicateGlobalExercise
                  ? exerciseIds[0]
                  : exerciseIds[index],
                order: index + 1,
                sets: 1,
                reps: 10,
              }),
            ),
          },
        },
      },
    },
    include: {
      days: {
        include: {
          exercises: { orderBy: { order: "asc" } },
        },
      },
    },
  });

  const programDay = program.days[0];
  const schedule = await db.workoutSchedule.create({
    data: {
      userId: options.userId,
      date: options.date,
      programDayId: programDay.id,
      sourceType: "INTEGRATION_TEST",
    },
  });

  return {
    exerciseIds,
    program,
    programDay,
    plannedExercises: programDay.exercises,
    schedule,
  };
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  const workouts = await db.workout.findMany({
    where: { userId },
    select: { id: true },
  });
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({
    where: { id: { startsWith: `${userId}-exercise-` } },
  });
  for (const workout of workouts) {
    await db.workout.deleteMany({ where: { id: workout.id } });
  }
}

test(
  "Workout Log completion persists canonical progress through Prisma",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `workout-it-${Date.now()}`;
    await deleteSeed(db, userId);

    const seeded = await seedProgramWithSchedule(db, {
      userId,
      date: dateOnly(0),
      exerciseCount: 4,
    });

    try {
      const started = await service.startSchedule(userId, seeded.schedule.id);
      assert.equal(started.totalExercises, 4);
      assert.equal(started.completedExercises, 0);
      assert.equal(started.progressPercent, 0);
      assert.equal(started.sessionStatus, "in_progress");

      const startedSchedule = await db.workoutSchedule.findUniqueOrThrow({
        where: { id: seeded.schedule.id },
        include: { workout: { include: { exercises: true } } },
      });
      assert.equal(startedSchedule.status, "IN_PROGRESS");
      assert.ok(startedSchedule.workoutId);
      assert.equal(startedSchedule.workout?.exercises.length, 4);
      assert.equal(
        startedSchedule.workout?.exercises.every((exercise) =>
          Boolean(exercise.programExerciseId),
        ),
        true,
      );

      const expectedProgress = [25, 50, 75, 100];
      for (const [
        index,
        plannedExercise,
      ] of seeded.plannedExercises.entries()) {
        const result = await service.completeScheduleExercise(
          userId,
          seeded.schedule.id,
          plannedExercise.id,
        );
        assert.equal(result.completedExercises, index + 1);
        assert.equal(result.totalExercises, 4);
        assert.equal(result.progressPercent, expectedProgress[index]);
      }

      const completedSchedule = await db.workoutSchedule.findUniqueOrThrow({
        where: { id: seeded.schedule.id },
        include: {
          workout: {
            include: {
              exercises: {
                include: { workoutSets: true },
              },
            },
          },
        },
      });
      assert.equal(completedSchedule.status, "COMPLETED");
      assert.equal(completedSchedule.progressPercent, 100);
      assert.equal(completedSchedule.completedExercises, 4);
      assert.equal(completedSchedule.totalExercises, 4);
      assert.ok(completedSchedule.completedAt);
      assert.equal(
        completedSchedule.workout?.exercises.every(
          (exercise) =>
            exercise.workoutSets.length > 0 &&
            exercise.workoutSets.every((set) => set.completed),
        ),
        true,
      );

      const idempotent = await service.completeScheduleExercise(
        userId,
        seeded.schedule.id,
        seeded.plannedExercises[0].id,
      );
      assert.equal(idempotent.progressPercent, 100);
      assert.equal(idempotent.completedExercises, 4);

      const duplicateLogs = await db.workoutExercise.groupBy({
        by: ["workoutId", "programExerciseId"],
        where: {
          workoutId: completedSchedule.workoutId!,
          programExerciseId: { not: null },
        },
        _count: { id: true },
      });
      assert.equal(
        duplicateLogs.every((row) => row._count.id === 1),
        true,
      );

      await assert.rejects(
        () =>
          service.completeScheduleExercise(
            "other-user",
            seeded.schedule.id,
            seeded.plannedExercises[0].id,
          ),
        (err: any) => err?.status === 404,
      );

      const wrongSeed = await seedProgramWithSchedule(db, {
        userId,
        date: dateOnly(1),
        exerciseCount: 1,
      });
      await assert.rejects(
        () =>
          service.completeScheduleExercise(
            userId,
            seeded.schedule.id,
            wrongSeed.plannedExercises[0].id,
          ),
        (err: any) => err?.status === 404,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "Workout Log completion keys off planned exercise id when global exercise id is duplicated",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `workout-dup-it-${Date.now()}`;
    await deleteSeed(db, userId);

    const seeded = await seedProgramWithSchedule(db, {
      userId,
      date: dateOnly(2),
      exerciseCount: 2,
      duplicateGlobalExercise: true,
    });

    try {
      await service.startSchedule(userId, seeded.schedule.id);
      const first = await service.completeScheduleExercise(
        userId,
        seeded.schedule.id,
        seeded.plannedExercises[0].id,
      );
      assert.equal(first.completedExercises, 1);
      assert.equal(first.totalExercises, 2);
      assert.equal(first.progressPercent, 50);

      const schedule = await db.workoutSchedule.findUniqueOrThrow({
        where: { id: seeded.schedule.id },
        include: {
          workout: {
            include: {
              exercises: {
                orderBy: { order: "asc" },
                include: { workoutSets: true },
              },
            },
          },
        },
      });

      const [firstLogged, secondLogged] = schedule.workout?.exercises ?? [];
      assert.equal(
        firstLogged.programExerciseId,
        seeded.plannedExercises[0].id,
      );
      assert.equal(
        secondLogged.programExerciseId,
        seeded.plannedExercises[1].id,
      );
      assert.equal(
        firstLogged.workoutSets.every((set) => set.completed),
        true,
      );
      assert.equal(
        secondLogged.workoutSets.every((set) => set.completed),
        false,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
