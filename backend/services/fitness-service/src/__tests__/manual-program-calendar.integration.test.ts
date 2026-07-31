/**
 * Regression test for the "calendar days silently vanish" bug: creating (or
 * editing/regenerating) a manual weekly program archives the previous
 * program and deletes its incomplete schedules before creating new ones.
 * That delete step used to be scoped to `date >= startDate` — any schedule
 * dated *before* the new plan's start date survived, then became invisible
 * once its program was archived (listSchedules only returns ACTIVE-program
 * schedules), while permanently blocking that date via the
 * @@unique([userId, date]) + createMany({ skipDuplicates: true }) combo.
 *
 * Reproduced live against real July 2026 data during investigation: days
 * 14/16/17 (Tue/Thu/Fri) disappeared from the calendar after regenerating a
 * schedule with a later start date, exactly matching the reported bug.
 *
 * Same gated-real-DB pattern as workout.completion.integration.test.ts.
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/manual-program-calendar.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

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

async function seedExercise(db: PrismaClientLike, id: string) {
  return db.exercise.upsert({
    where: { id },
    create: {
      id,
      exerciseName: `Integration Exercise ${id}`,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
    },
    update: {},
  });
}

function threeDayPlan(exerciseId: string, suffix: string) {
  return [
    { dayNumber: 1, title: `Day A ${suffix}`, exercises: [{ exerciseId, sets: 3, reps: 10 }] },
    { dayNumber: 2, title: `Day B ${suffix}`, exercises: [{ exerciseId, sets: 3, reps: 10 }] },
    { dayNumber: 3, title: `Day C ${suffix}`, exercises: [{ exerciseId, sets: 3, reps: 10 }] },
  ];
}

/** Every day-of-month in `year`/`monthIndex` whose getDay() is in `weekdays`. */
function expectedDaysOfMonth(year: number, monthIndex: number, weekdays: number[]): number[] {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const days: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    if (weekdays.includes(new Date(year, monthIndex, d).getDay())) days.push(d);
  }
  return days;
}

async function visibleDaysOfMonth(
  service: WorkoutServiceLike,
  userId: string,
  year: number,
  monthIndex: number,
): Promise<number[]> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const startDate = `${year}-${pad(monthIndex + 1)}-01`;
  const endDate = `${year}-${pad(monthIndex + 1)}-${pad(new Date(year, monthIndex + 1, 0).getDate())}`;
  const schedules = await service.listSchedules(userId, { startDate, endDate, limit: 200 });
  // Calling the service directly (not through HTTP/JSON) returns raw Date
  // objects, not ISO strings — read the day via the same local-calendar
  // convention parseDateOnly/nextDateForWeekday use when writing them.
  return (schedules as any[])
    .map((s) => new Date(s.date).getDate())
    .sort((a, b) => a - b);
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
}

const skip = canUseIntegrationDb
  ? false
  : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.";

test(
  "July 2026 — a single plan spanning the whole month shows every selected weekday, including 14/16/17",
  { skip },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `calendar-it-${Date.now()}-a`;
    const exerciseId = `${userId}-exercise-1`;
    await seedExercise(db, exerciseId);
    await deleteSeed(db, userId);

    try {
      await service.createManualProgram(userId, {
        name: "Thang 7 That Su",
        durationWeeks: 5,
        daysPerWeek: 3,
        startDate: "2026-07-01",
        repeatWeeks: 5,
        selectedWeekdays: [2, 4, 5], // Tue/Thu/Fri — matches the reported 14/16/17
        days: threeDayPlan(exerciseId, "v1"),
      } as any);

      const visible = await visibleDaysOfMonth(service, userId, 2026, 6);
      const expected = expectedDaysOfMonth(2026, 6, [2, 4, 5]);

      assert.deepEqual(visible, expected, "every Tue/Thu/Fri in July 2026 must be visible");
      assert.ok(visible.includes(14), "day 14 must be visible");
      assert.ok(visible.includes(16), "day 16 must be visible");
      assert.ok(visible.includes(17), "day 17 must be visible");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "Regenerating a schedule with a later start date must not leave earlier days as invisible zombies",
  { skip },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `calendar-it-${Date.now()}-b`;
    const exerciseId = `${userId}-exercise-1`;
    await seedExercise(db, exerciseId);
    await deleteSeed(db, userId);

    try {
      // Plan A: covers the first half of the month (includes 14/16/17).
      await service.createManualProgram(userId, {
        name: "Plan A",
        durationWeeks: 2,
        daysPerWeek: 3,
        startDate: "2026-07-01",
        repeatWeeks: 2,
        selectedWeekdays: [2, 4, 5],
        days: threeDayPlan(exerciseId, "A"),
      } as any);

      // User edits/regenerates the schedule starting later in the month —
      // this is the exact trigger that used to orphan 14/16/17.
      await service.createManualProgram(userId, {
        name: "Plan B - edited",
        durationWeeks: 2,
        daysPerWeek: 3,
        startDate: "2026-07-20",
        repeatWeeks: 2,
        selectedWeekdays: [2, 4, 5],
        days: threeDayPlan(exerciseId, "B"),
      } as any);

      const visible = await visibleDaysOfMonth(service, userId, 2026, 6);
      const expected = expectedDaysOfMonth(2026, 6, [2, 4, 5]).filter((d) => d >= 20);
      assert.deepEqual(visible, expected, "only Plan B's own dates should be visible");

      // The critical regression guard: every row the API can see must be
      // ALL the rows that actually exist for this user this month — no
      // orphaned-but-present-in-DB rows hiding behind an archived program.
      const allDbRows = await db.workoutSchedule.findMany({
        where: { userId, date: { gte: new Date(2026, 6, 1), lte: new Date(2026, 6, 31) } },
      });
      assert.equal(
        allDbRows.length,
        visible.length,
        "no schedule rows should exist in the DB that the calendar API can't see",
      );

      // And the old dates must be genuinely gone (not zombied), so they can
      // be scheduled again in the future without silently colliding.
      const oldDates = await db.workoutSchedule.findMany({
        where: { userId, date: { gte: new Date(2026, 6, 1), lte: new Date(2026, 6, 17) } },
      });
      assert.equal(oldDates.length, 0, "Plan A's superseded rows must be fully deleted, not orphaned");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "Editing a saved schedule with the SAME start date replaces it cleanly (no duplicates, no gaps)",
  { skip },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `calendar-it-${Date.now()}-c`;
    const exerciseId = `${userId}-exercise-1`;
    await seedExercise(db, exerciseId);
    await deleteSeed(db, userId);

    try {
      await service.createManualProgram(userId, {
        name: "Original",
        durationWeeks: 3,
        daysPerWeek: 3,
        startDate: "2026-07-01",
        repeatWeeks: 3,
        selectedWeekdays: [2, 4, 5],
        days: threeDayPlan(exerciseId, "orig"),
      } as any);

      // Re-save with the exact same window (typical "edit and save again").
      await service.createManualProgram(userId, {
        name: "Edited",
        durationWeeks: 3,
        daysPerWeek: 3,
        startDate: "2026-07-01",
        repeatWeeks: 3,
        selectedWeekdays: [2, 4, 5],
        days: threeDayPlan(exerciseId, "edited"),
      } as any);

      const visible = await visibleDaysOfMonth(service, userId, 2026, 6);
      const expected = expectedDaysOfMonth(2026, 6, [2, 4, 5]).filter((d) => d <= 21);
      assert.deepEqual(visible, expected);
      assert.ok(visible.includes(14) && visible.includes(16) && visible.includes(17));
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "A schedule spanning a month boundary includes the last day of the range",
  { skip },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `calendar-it-${Date.now()}-d`;
    const exerciseId = `${userId}-exercise-1`;
    await seedExercise(db, exerciseId);
    await deleteSeed(db, userId);

    try {
      // July 2026 has 31 days; selecting every weekday guarantees July 31
      // (a Friday) is the last scheduled day, directly covering the
      // "end-of-range gets dropped" failure mode.
      await service.createManualProgram(userId, {
        name: "Full week",
        durationWeeks: 1,
        daysPerWeek: 7,
        startDate: "2026-07-27",
        repeatWeeks: 1,
        selectedWeekdays: [0, 1, 2, 3, 4, 5, 6],
        days: [0, 1, 2, 3, 4, 5, 6].map((n) => ({
          dayNumber: n + 1,
          title: `Day ${n + 1}`,
          exercises: [{ exerciseId, sets: 3, reps: 10 }],
        })),
      } as any);

      const visible = await visibleDaysOfMonth(service, userId, 2026, 6);
      assert.ok(visible.includes(31), "July 31 (end of range) must not be dropped");
      assert.deepEqual(visible, [27, 28, 29, 30, 31]);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "A schedule with a real completed workout must stay visible even after its program is later archived",
  { skip },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `calendar-it-${Date.now()}-e`;
    const exerciseId = `${userId}-exercise-1`;
    await seedExercise(db, exerciseId);
    await deleteSeed(db, userId);

    try {
      await service.createManualProgram(userId, {
        name: "Plan A",
        durationWeeks: 2,
        daysPerWeek: 3,
        startDate: "2026-07-01",
        repeatWeeks: 2,
        selectedWeekdays: [2, 4, 5],
        days: threeDayPlan(exerciseId, "A"),
      } as any);

      // Simulate the user actually completing the July 14 (Tue) session —
      // a real Workout log gets attached to that schedule row.
      const july14Schedule = await db.workoutSchedule.findFirstOrThrow({
        where: { userId, date: new Date(2026, 6, 14) },
      });
      const loggedWorkout = await db.workout.create({
        data: { userId, name: "Completed session", date: new Date(2026, 6, 14) },
      });
      await db.workoutSchedule.update({
        where: { id: july14Schedule.id },
        data: { workoutId: loggedWorkout.id, status: "COMPLETED" },
      });

      // User later regenerates their schedule (archives Plan A) — the
      // completed July 14 session must remain visible even though its
      // program is now archived and its own placeholder date is superseded.
      await service.createManualProgram(userId, {
        name: "Plan B",
        durationWeeks: 2,
        daysPerWeek: 3,
        startDate: "2026-07-20",
        repeatWeeks: 2,
        selectedWeekdays: [2, 4, 5],
        days: threeDayPlan(exerciseId, "B"),
      } as any);

      const visible = await visibleDaysOfMonth(service, userId, 2026, 6);
      assert.ok(
        visible.includes(14),
        "a completed workout must stay on the calendar even after its program is archived",
      );
    } finally {
      await db.workout.deleteMany({ where: { userId } });
      await deleteSeed(db, userId);
    }
  },
);
