import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Phase 4.1 — BACKEND INTEGRATION coverage of getTrainingAnalyticsWindow
// against the isolated *_test Postgres only (same gate as the other
// integration suites; skipped otherwise — never touches the dev DB).

const fitnessDatabaseUrl =
  process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
let prisma: PrismaClientLike | undefined;
let getWindow: (typeof import("../services/training-analytics-window.service"))["getTrainingAnalyticsWindow"];

async function load() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    getWindow = (await import("../services/training-analytics-window.service")).getTrainingAnalyticsWindow;
  }
  return prisma;
}

const createdUsers: string[] = [];
const createdExercises: string[] = [];

test.after(async () => {
  if (!prisma) return;
  for (const userId of createdUsers) {
    await prisma.workoutSchedule.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.workout.deleteMany({ where: { userId } }).catch(() => {});
  }
  if (createdExercises.length) await prisma.exercise.deleteMany({ where: { id: { in: createdExercises } } }).catch(() => {});
  await prisma.$disconnect();
});

const ASOF = new Date("2026-10-10T12:00:00.000Z");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function seedExercise(db: PrismaClientLike) {
  const id = randomUUID();
  createdExercises.push(id);
  return db.exercise.create({
    data: {
      id,
      exerciseName: `P41 Bench ${id.slice(0, 8)}`,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BARBELL",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["chest"],
      instructions: "test",
    },
  });
}

async function logWorkout(db: PrismaClientLike, userId: string, exerciseId: string, date: Date, weight: number, reps: number) {
  return db.workout.create({
    data: {
      userId,
      name: "P41",
      date,
      exercises: {
        create: [{ exerciseId, sets: 1, order: 0, workoutSets: { create: [{ setNumber: 1, weight, reps, completed: true }] } }],
      },
    },
  });
}

test("window boundary + schedules + cross-user isolation (real DB)", { skip: !canUseIntegrationDb }, async () => {
  const db = await load();
  const userA = `p41-a-${randomUUID()}`;
  const userB = `p41-b-${randomUUID()}`;
  createdUsers.push(userA, userB);
  const ex = await seedExercise(db);

  // window for ASOF, 28 days = 2026-09-13T00:00Z .. 2026-10-10T12:00Z
  await logWorkout(db, userA, ex.id, new Date("2026-09-12T23:59:59.000Z"), 100, 5); // before window
  await logWorkout(db, userA, ex.id, new Date("2026-09-13T00:00:00.000Z"), 80, 8); // exactly at start (inclusive)
  await logWorkout(db, userA, ex.id, new Date("2026-10-01T10:00:00.000Z"), 85, 8); // inside
  await logWorkout(db, userA, ex.id, new Date("2026-10-11T10:00:00.000Z"), 200, 5); // after asOf (future)

  // schedules: 3 completed, 1 skipped, 1 future (excluded)
  const mk = (date: string, status: string) =>
    db.workoutSchedule.create({ data: { userId: userA, date: day(date), status } });
  await mk("2026-09-15", "COMPLETED");
  await mk("2026-09-20", "COMPLETED");
  await mk("2026-09-25", "COMPLETED");
  await mk("2026-09-30", "SKIPPED");
  await mk("2026-10-12", "NOT_STARTED"); // future
  await mk("2026-09-10", "COMPLETED"); // before window

  const a = await getWindow(userA, { days: 28, asOf: ASOF });
  assert.equal(a.adherence.scheduledSessions, 4);
  assert.equal(a.adherence.completedSessions, 3);
  assert.equal(a.adherence.missedSessions, 1);
  assert.equal(a.adherence.completionRate, 0.75);
  assert.equal(a.frequency.trainingDaysLogged, 2); // only the two in-window workouts
  assert.equal(a.volume.totalVolumeLoadKg, 80 * 8 + 85 * 8);
  assert.equal(a.progression.exercises.length, 1);
  assert.equal(a.progression.exercises[0].exerciseId, ex.id);

  // user B has nothing: no A metrics, no A ids
  const b = await getWindow(userB, { days: 28, asOf: ASOF });
  assert.equal(b.dataQuality, "NO_DATA");
  assert.equal(b.adherence.state, "NO_SCHEDULE");
  assert.equal(b.volume.totalVolumeLoadKg, 0);
  assert.deepEqual(b.progression.exercises, []);
  assert.ok(!JSON.stringify(b).includes(ex.id));
});

test("user with only older activity → STALE (real DB)", { skip: !canUseIntegrationDb }, async () => {
  const db = await load();
  const userId = `p41-stale-${randomUUID()}`;
  createdUsers.push(userId);
  const ex = await seedExercise(db);
  await logWorkout(db, userId, ex.id, new Date("2026-06-01T10:00:00.000Z"), 60, 8);
  const w = await getWindow(userId, { days: 28, asOf: ASOF });
  assert.equal(w.dataQuality, "STALE");
  assert.equal(w.adherence.state, "NO_SCHEDULE");
});
