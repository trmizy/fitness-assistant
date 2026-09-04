import test from "node:test";
import assert from "node:assert/strict";
import { workoutController } from "../controllers/workout.controller";
import { workoutQueue, workoutService } from "../services/workout.service";

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

const originalStartSchedule = workoutService.startSchedule;
const originalCompleteScheduleExercise =
  workoutService.completeScheduleExercise;

test.afterEach(() => {
  workoutService.startSchedule = originalStartSchedule;
  workoutService.completeScheduleExercise = originalCompleteScheduleExercise;
});

test.after(async () => {
  await workoutQueue.close();
});

test("startSchedule returns canonical in-progress progress contract", async () => {
  workoutService.startSchedule = async () => ({
    sessionId: "workout-1",
    workoutId: "workout-1",
    planId: "plan-1",
    dayId: "day-1",
    completedExercises: 0,
    totalExercises: 4,
    completedSets: 0,
    totalSets: 12,
    progressPercent: 0,
    sessionStatus: "in_progress",
    dayStatus: "in_progress",
    completedAt: null,
    trainingCycleId: null,
  });

  const res = createResponse();
  await workoutController.startSchedule(
    {
      user: { id: "user-1" },
      params: { id: "schedule-1" },
    } as any,
    res as any,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    data: {
      sessionId: "workout-1",
      workoutId: "workout-1",
      planId: "plan-1",
      dayId: "day-1",
      completedExercises: 0,
      totalExercises: 4,
      completedSets: 0,
      totalSets: 12,
      progressPercent: 0,
      sessionStatus: "in_progress",
      dayStatus: "in_progress",
      completedAt: null,
      trainingCycleId: null,
    },
  });
});

test("completeScheduleExercise returns 100 percent when all planned exercises are complete", async () => {
  const completedAt = new Date("2026-07-09T00:00:00.000Z");
  workoutService.completeScheduleExercise = async () => ({
    sessionId: "workout-1",
    workoutId: "workout-1",
    planId: "plan-1",
    dayId: "day-1",
    exerciseId: "exercise-4",
    programExerciseId: "program-exercise-4",
    exerciseCompleted: true,
    completedExercises: 4,
    totalExercises: 4,
    completedSets: 12,
    totalSets: 12,
    progressPercent: 100,
    sessionStatus: "completed",
    dayStatus: "completed",
    completedAt,
    trainingCycleId: null,
  });

  const res = createResponse();
  await workoutController.completeScheduleExercise(
    {
      user: { id: "user-1" },
      params: { id: "schedule-1", programExerciseId: "program-exercise-4" },
    } as any,
    res as any,
  );

  assert.equal(res.statusCode, 200);
  assert.equal((res.body as any).success, true);
  assert.equal((res.body as any).data.exerciseCompleted, true);
  assert.equal((res.body as any).data.completedExercises, 4);
  assert.equal((res.body as any).data.totalExercises, 4);
  assert.equal((res.body as any).data.progressPercent, 100);
  assert.equal((res.body as any).data.sessionStatus, "completed");
  assert.equal((res.body as any).data.dayStatus, "completed");
  assert.equal((res.body as any).data.completedAt, completedAt);
});
