import test from "node:test";
import assert from "node:assert/strict";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";
import { updateWorkoutSetSchema } from "../models/fitness.models";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;

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
  return { prisma: prisma!, workoutService: workoutService! };
}

test.after(async () => {
  if (workoutQueue) await workoutQueue.close();
  if (prisma) await prisma.$disconnect();
});

test("set-chain validation requires contiguous segments with one technique", () => {
  assert.equal(
    updateWorkoutSetSchema.safeParse({
      segments: [
        { segmentNumber: 1, technique: "DROP_SET", reps: 8, weight: 80 },
        { segmentNumber: 2, technique: "DROP_SET", reps: 10, weight: 60 },
      ],
    }).success,
    true,
  );
  assert.equal(
    updateWorkoutSetSchema.safeParse({
      segments: [{ segmentNumber: 2, technique: "DROP_SET", reps: 8 }],
    }).success,
    false,
  );
  assert.equal(
    updateWorkoutSetSchema.safeParse({
      segments: [
        { segmentNumber: 1, technique: "DROP_SET", reps: 8 },
        { segmentNumber: 2, technique: "REST_PAUSE", reps: 3 },
      ],
    }).success,
    false,
  );
});

test(
  "updateSet stores, preserves, and atomically replaces ordered drop/rest-pause segments",
  { skip: canUseIntegrationDb ? false : "Requires a test database." },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const suffix = Date.now().toString();
    const userId = `set-chain-it-${suffix}`;
    const exerciseId = `${userId}-exercise`;

    try {
      await db.exercise.create({
        data: {
          id: exerciseId,
          exerciseName: "Set Chain Test Press",
          typeOfActivity: "STRENGTH",
          typeOfEquipment: "BARBELL",
          bodyPart: "UPPER_BODY",
          type: "PUSH",
          muscleGroupsActivated: ["chest"],
          instructions: "Test exercise.",
          loggingMode: "REPS_LOAD",
        },
      });
      const workout = await db.workout.create({
        data: {
          userId,
          name: "Set chain session",
          date: todayAsScheduleDate(),
          exercises: {
            create: {
              exerciseId,
              order: 1,
              sets: 1,
              reps: 6,
              weight: 100,
              workoutSets: { create: { setNumber: 1, reps: 6, weight: 100 } },
            },
          },
        },
        include: { exercises: { include: { workoutSets: true } } },
      });
      const setId = workout.exercises[0].workoutSets[0].id;

      const dropSet = await service.updateSet(setId, userId, {
        completed: true,
        segments: [
          { segmentNumber: 1, technique: "DROP_SET", reps: 8, weight: 80, restBeforeSeconds: 0 },
          { segmentNumber: 2, technique: "DROP_SET", reps: 10, weight: 60, restBeforeSeconds: 5 },
        ],
      });
      assert.deepEqual(
        (dropSet as any).segments.map((segment: any) => ({
          segmentNumber: segment.segmentNumber,
          technique: segment.technique,
          reps: segment.reps,
          weight: segment.weight,
          restBeforeSeconds: segment.restBeforeSeconds,
        })),
        [
          { segmentNumber: 1, technique: "DROP_SET", reps: 8, weight: 80, restBeforeSeconds: 0 },
          { segmentNumber: 2, technique: "DROP_SET", reps: 10, weight: 60, restBeforeSeconds: 5 },
        ],
      );

      await service.updateSet(setId, userId, { rpe: 9 });
      assert.equal(await db.workoutSetSegment.count({ where: { workoutSetId: setId } }), 2);

      const restPause = await service.updateSet(setId, userId, {
        segments: [
          { segmentNumber: 1, technique: "REST_PAUSE", reps: 3, weight: 100, restBeforeSeconds: 20 },
        ],
      });
      assert.equal((restPause as any).segments.length, 1);
      assert.equal((restPause as any).segments[0].technique, "REST_PAUSE");

      const straight = await service.updateSet(setId, userId, { segments: [] });
      assert.deepEqual((straight as any).segments, []);
    } finally {
      await db.workout.deleteMany({ where: { userId } });
      await db.exercise.deleteMany({ where: { id: exerciseId } });
    }
  },
);
