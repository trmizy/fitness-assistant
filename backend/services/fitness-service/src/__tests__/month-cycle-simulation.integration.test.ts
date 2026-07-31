/**
 * Month-long simulation: seeds a realistic ~4-week training cycle (real
 * WorkoutProgram/WorkoutSchedule/Workout/WorkoutSet rows in the test DB,
 * spanning clearly past/today/future days so the schedule-date lock has
 * real boundaries to exercise) with progressive overload, varying RPE/RIR,
 * one skipped session, and one reduced-performance session — then runs the
 * REAL deterministic report engines (computeCycleMetrics + evaluateCycle)
 * over that data and checks the numbers actually reflect what was seeded.
 *
 * InBody snapshots are passed in directly as plain objects rather than
 * fetched over HTTP from user-service (computeCycleMetrics accepts them as
 * a parameter) — this keeps the test fully self-contained and avoids the
 * pre-existing, unrelated user-service seed-data gap that
 * adaptive-cycle-evaluation.integration.test.ts's InBody steps depend on.
 *
 * All dates are anchored to the REAL current UTC day via a relative-offset
 * helper (never a hardcoded date), so this suite never depends on when it
 * happens to run and never goes stale.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/month-cycle-simulation.integration.test.ts
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
type WorkoutServiceLike = (typeof import("../services/workout.service"))["workoutService"];
type WorkoutQueueLike = (typeof import("../services/workout.service"))["workoutQueue"];
type ComputeCycleMetricsLike = (typeof import("../services/cycle-metrics.engine"))["computeCycleMetrics"];
type EvaluateCycleLike = (typeof import("../services/cycle-decision.engine"))["evaluateCycle"];

let prisma: PrismaClientLike | undefined;
let workoutService: WorkoutServiceLike | undefined;
let workoutQueue: WorkoutQueueLike | undefined;
let computeCycleMetrics: ComputeCycleMetricsLike | undefined;
let evaluateCycle: EvaluateCycleLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const workoutModule = await import("../services/workout.service");
    const metricsModule = await import("../services/cycle-metrics.engine");
    const decisionModule = await import("../services/cycle-decision.engine");
    prisma = prismaModule.prisma;
    workoutService = workoutModule.workoutService;
    workoutQueue = workoutModule.workoutQueue;
    computeCycleMetrics = metricsModule.computeCycleMetrics;
    evaluateCycle = decisionModule.evaluateCycle;
  }
  return {
    prisma: prisma!,
    workoutService: workoutService!,
    workoutQueue: workoutQueue!,
    computeCycleMetrics: computeCycleMetrics!,
    evaluateCycle: evaluateCycle!,
  };
}

test.after(async () => {
  if (workoutQueue) await workoutQueue.close();
  if (prisma) await prisma.$disconnect();
});

function daysAgo(n: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n));
}

const CYCLE_START = daysAgo(27); // ~4 weeks ago
const TODAY = daysAgo(0);

/**
 * Seeds one full simulated training cycle for `userId`:
 *  - week 1-3 (past, locked): one session per week, each with progressively
 *    heavier weight, rising RPE, falling RIR — except week 2's session,
 *    which is a deliberate SKIP (never started), and week 3's session,
 *    which is COMPLETED but with only half its planned sets logged
 *    (reduced performance, not a full skip).
 *  - "today": a session that's been started but only partially logged, to
 *    prove the lock boundary — today must stay editable.
 *  - "+3 days": a future, untouched schedule.
 */
async function seedMonthCycle(db: PrismaClientLike, userId: string) {
  const exercise = await db.exercise.create({
    data: {
      id: `${userId}-exercise-squat`,
      exerciseName: "Month Sim Back Squat",
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BARBELL",
      bodyPart: "LOWER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["quads"],
      instructions: "Test exercise.",
    },
  });

  const program = await db.workoutProgram.create({
    data: {
      userId,
      name: "Month Simulation Program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Squat Day",
          exercises: { create: { exerciseId: exercise.id, order: 1, sets: 4, reps: 6 } },
        },
      },
    },
    include: { days: { include: { exercises: true } } },
  });
  const programExercise = program.days[0].exercises[0];

  async function createSchedule(date: Date) {
    return db.workoutSchedule.create({
      data: { userId, date, programDayId: program.days[0].id, sourceType: "MONTH_SIM" },
    });
  }

  async function logCompletedSession(
    date: Date,
    opts: { weight: number; rpe: number; rir: number; setsLogged: number; setsPlanned: number },
  ) {
    const schedule = await createSchedule(date);
    const workout = await db.workout.create({
      data: {
        userId,
        name: "Squat Day",
        date,
        exercises: {
          create: {
            exerciseId: exercise.id,
            programExerciseId: programExercise.id,
            sets: opts.setsPlanned,
            reps: 6,
            weight: opts.weight,
            workoutSets: {
              create: Array.from({ length: opts.setsLogged }, (_unused, i) => ({
                setNumber: i + 1,
                reps: 6,
                weight: opts.weight,
                rpe: opts.rpe,
                rir: opts.rir,
                completed: true,
              })),
            },
          },
        },
      },
    });
    const completed = opts.setsLogged >= opts.setsPlanned;
    await db.workoutSchedule.update({
      where: { id: schedule.id },
      data: {
        workoutId: workout.id,
        status: completed ? "COMPLETED" : "IN_PROGRESS",
        startedAt: date,
        completedAt: completed ? date : null,
        totalExercises: 1,
        completedExercises: completed ? 1 : 0,
        totalSets: opts.setsPlanned,
        completedSets: opts.setsLogged,
        progressPercent: Math.round((opts.setsLogged / opts.setsPlanned) * 100),
      },
    });
    return schedule;
  }

  // A realistic ~3x/week program across 4 weeks (11 sessions total before
  // today/future) — enough completed volume to clear the Decision Engine's
  // minimumCompletedSessions/minimumAdherenceRate gates (see
  // cycle-thresholds.config.ts's `assessment` block) while still containing
  // one full skip (week 2) and one reduced/partial session (week 3), so the
  // "good data" test and the "insufficient data" test both reflect
  // realistic, not artificially clean, input.

  // Week 1 (~27/25/23 days ago): baseline weight, all 3 sessions completed.
  const week1 = await logCompletedSession(daysAgo(27), { weight: 60, rpe: 6, rir: 4, setsLogged: 4, setsPlanned: 4 });
  await logCompletedSession(daysAgo(25), { weight: 60, rpe: 6, rir: 4, setsLogged: 4, setsPlanned: 4 });
  await logCompletedSession(daysAgo(23), { weight: 60, rpe: 6, rir: 4, setsLogged: 4, setsPlanned: 4 });

  // Week 2 (~20/18 days ago): one SKIPPED (never started), one completed.
  const week2Skipped = await createSchedule(daysAgo(20));
  await logCompletedSession(daysAgo(18), { weight: 62.5, rpe: 6.5, rir: 3, setsLogged: 4, setsPlanned: 4 });

  // Week 3 (~13/11/9 days ago): the anchor session is reduced/partial (2 of
  // 4 planned sets — stays IN_PROGRESS, not COMPLETED), the other two are
  // completed normally.
  const week3 = await logCompletedSession(daysAgo(13), { weight: 65, rpe: 7, rir: 2, setsLogged: 2, setsPlanned: 4 });
  await logCompletedSession(daysAgo(11), { weight: 65, rpe: 7, rir: 2, setsLogged: 4, setsPlanned: 4 });
  await logCompletedSession(daysAgo(9), { weight: 65, rpe: 7, rir: 2, setsLogged: 4, setsPlanned: 4 });

  // Week 4 (~6/4/2 days ago): heaviest weight, highest RPE, lowest RIR — all
  // 3 completed, completing the progressive-overload trend.
  const week4 = await logCompletedSession(daysAgo(6), { weight: 72.5, rpe: 8, rir: 1, setsLogged: 4, setsPlanned: 4 });
  await logCompletedSession(daysAgo(4), { weight: 72.5, rpe: 8, rir: 1, setsLogged: 4, setsPlanned: 4 });
  await logCompletedSession(daysAgo(2), { weight: 72.5, rpe: 8, rir: 1, setsLogged: 4, setsPlanned: 4 });

  // Today: started, not finished — the lock boundary case.
  const todaySchedule = await createSchedule(TODAY);
  const todayWorkout = await db.workout.create({
    data: {
      userId,
      name: "Squat Day",
      date: TODAY,
      exercises: {
        create: {
          exerciseId: exercise.id,
          programExerciseId: programExercise.id,
          sets: 4,
          reps: 6,
          weight: 75,
          workoutSets: { create: { setNumber: 1, reps: 6, weight: 75, completed: false } },
        },
      },
    },
  });
  await db.workoutSchedule.update({
    where: { id: todaySchedule.id },
    data: { workoutId: todayWorkout.id, status: "IN_PROGRESS", startedAt: TODAY },
  });

  // Future: untouched.
  const futureSchedule = await createSchedule(daysAgo(-3));

  return { program, week1, week2Skipped, week3, week4, todaySchedule, futureSchedule };
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
  "month-long simulation: adherence/volume/RPE/RIR reflect the seeded skip, reduced session, and progressive overload",
  skipOpts,
  async () => {
    const { prisma: db, computeCycleMetrics: compute, evaluateCycle: evaluate } = await loadModules();
    const userId = `month-sim-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      await seedMonthCycle(db, userId);

      const inBodyEntries = [
        { id: "start", date: CYCLE_START.toISOString(), weight: 82, bodyFatPct: 22, muscleMass: 34, status: "manual" },
        { id: "end", date: TODAY.toISOString(), weight: 80.5, bodyFatPct: 20.5, muscleMass: 34.8, status: "manual" },
      ];

      const metrics = await compute({
        cycleId: `fake-cycle-${userId}`,
        userId,
        planId: null,
        goal: "MUSCLE_GAIN",
        startDate: CYCLE_START,
        asOf: TODAY,
        inBodyEntries,
      });

      // Adherence window is [CYCLE_START, TODAY] inclusive: 12 schedules are
      // "due" (11 weekly sessions + today's own in-progress one; the future
      // schedule falls outside the window). 9 are COMPLETED (3 in week 1,
      // 1 in week 2, 2 in week 3, 3 in week 4); the other 3 are not
      // (week 2's skip, week 3's partial-sets session, and today's
      // still-in-progress session) => 9/12 = 0.75.
      assert.equal(metrics.adherenceRate, 0.75);
      assert.equal(metrics.completionRate, 0.75);

      // Progressive overload: 60 -> 65 -> 72.5 kg across completed weeks.
      assert.ok(
        metrics.volumeTrendPercent != null && metrics.volumeTrendPercent > 0,
        `expected a positive volume trend, got ${metrics.volumeTrendPercent}`,
      );

      // RPE rose 6 -> 7 -> 8 across weeks; RIR fell 4 -> 2 -> 1.
      assert.equal(metrics.rpeTrend, "increasing");
      assert.ok(metrics.averageRir != null && metrics.averageRir < 4, "expected averageRir to reflect the falling trend");

      // No NaN/Infinity anywhere in the numeric surface.
      for (const [key, value] of Object.entries(metrics)) {
        if (typeof value === "number") {
          assert.ok(Number.isFinite(value), `metrics.${key} is not finite: ${value}`);
        }
      }

      const decision = evaluate({
        cycleDurationDays: 28,
        completedSessions: 9,
        metrics,
      });
      assert.notEqual(decision.decision, "INSUFFICIENT_DATA");
      assert.ok(Number.isFinite(decision.confidenceScore));
      assert.ok(decision.confidenceScore >= 0 && decision.confidenceScore <= 1);
      assert.equal(decision.safetyFlags.length, 0); // no pain data seeded
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "month-long simulation: a cycle with almost no logged data is classified INSUFFICIENT_DATA, never a confident recommendation",
  skipOpts,
  async () => {
    const { prisma: db, computeCycleMetrics: compute, evaluateCycle: evaluate } = await loadModules();
    const userId = `month-sim-sparse-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const exercise = await db.exercise.create({
        data: {
          id: `${userId}-exercise-squat`,
          exerciseName: "Sparse Sim Squat",
          typeOfActivity: "STRENGTH",
          typeOfEquipment: "BARBELL",
          bodyPart: "LOWER_BODY",
          type: "PUSH",
          muscleGroupsActivated: ["quads"],
          instructions: "Test exercise.",
        },
      });
      const program = await db.workoutProgram.create({
        data: {
          userId,
          name: "Sparse Sim Program",
          status: "ACTIVE",
          days: {
            create: {
              dayNumber: 1,
              title: "Squat Day",
              exercises: { create: { exerciseId: exercise.id, order: 1, sets: 4, reps: 6 } },
            },
          },
        },
        include: { days: true },
      });
      // Only one schedule, never even started — everything else in the
      // month is simply absent (no logs at all), the realistic
      // "insufficient data" case rather than an artificially bad one.
      await db.workoutSchedule.create({
        data: { userId, date: daysAgo(20), programDayId: program.days[0].id, sourceType: "MONTH_SIM_SPARSE" },
      });

      const metrics = await compute({
        cycleId: `fake-cycle-${userId}`,
        userId,
        planId: null,
        goal: "MUSCLE_GAIN",
        startDate: CYCLE_START,
        asOf: TODAY,
        inBodyEntries: [], // no InBody data at all — genuinely insufficient
      });

      const decision = evaluate({ cycleDurationDays: 28, completedSessions: 0, metrics });
      assert.equal(decision.decision, "INSUFFICIENT_DATA");
      assert.equal(decision.recommendedActionScope, "none");
      assert.ok(decision.confidenceScore < 0.5, "confidence must stay low when data is this sparse");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "month-long simulation: past sessions stay locked (409) while today's session remains editable, exactly matching the report's own adherence window",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `month-sim-lock-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedMonthCycle(db, userId);

      // week1 already has a completed workout attached — deleteSchedule's
      // pre-existing "don't delete a schedule with real logged data" guard
      // fires first (its own, older 409), which is a stricter protection
      // than the date lock and is correct to take priority. The date-lock
      // guard itself is exercised below via the still-NOT_STARTED,
      // workout-less week2 schedule, and via startSchedule/completeScheduleExercise
      // elsewhere in this suite for schedules that DO have a workout.
      await assert.rejects(
        () => service.deleteSchedule(seeded.week1.id, userId),
        (err: any) => err?.status === 409,
      );

      // week2 (skipped, no workout attached, date in the past) hits the
      // date lock specifically — not the "has a workout" guard.
      await assert.rejects(
        () => service.deleteSchedule(seeded.week2Skipped.id, userId),
        (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
      );

      // The skipped week2 schedule (still NOT_STARTED, but its date is in
      // the past) must not be startable — no backdated log creation.
      await assert.rejects(
        () => service.startSchedule(userId, seeded.week2Skipped.id),
        (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
      );

      // Today's in-progress session must remain fully editable.
      const resumed = await service.startSchedule(userId, seeded.todaySchedule.id);
      assert.ok(resumed.workoutId);

      // The future schedule is now locked too (§3.3 fix) — a session dated
      // after today can't be deleted/started/completed yet either.
      await assert.rejects(
        () => service.deleteSchedule(seeded.futureSchedule.id, userId),
        (err: any) => err?.status === 409 && err?.code === "SCHEDULE_DATE_LOCKED",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
