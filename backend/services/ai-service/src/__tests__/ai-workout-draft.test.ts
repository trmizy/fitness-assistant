import test from "node:test";
import assert from "node:assert/strict";
import { convertAiPlanToDraft, exercisesPerDayFor } from "../services/ai-workout-draft";

/**
 * Chat "tạo lịch tập" is backed by the real AI worker: its plan content carries canonical exerciseIds.
 * These pure helpers turn that content into a chat draft that can be saved into the schedule.
 */
test("exercisesPerDayFor: fits the session, bounded to the schema's 3..8", () => {
  assert.equal(exercisesPerDayFor(60), 7);
  assert.equal(exercisesPerDayFor(45), 5);
  assert.equal(exercisesPerDayFor(120), 8); // capped
  assert.equal(exercisesPerDayFor(15), 3); // floored
});

test("convertAiPlanToDraft: keeps real exerciseIds and the AI's prescription, renumbers order", () => {
  const { days, discarded } = convertAiPlanToDraft({
    weeklySchedule: [
      { day: "Day 1", goal: "Push", exercises: [
        { exerciseId: "e1", name: "Barbell Bench Press - Medium Grip", order: 3, sets: 4, reps: "6-8", restSeconds: 90, note: "compound" },
        { exerciseId: "e2", exerciseName: "Seated Dumbbell Press", sets: 3, reps: "8-10", restSeconds: 75 },
      ] },
    ],
  });
  assert.equal(discarded, 0);
  assert.equal(days.length, 1);
  assert.deepEqual(days[0].exercises.map((e: any) => [e.exerciseId, e.order]), [["e1", 1], ["e2", 2]]);
  assert.equal((days[0].exercises[1] as any).name, "Seated Dumbbell Press");
  assert.equal(days[0].goal, "Push");
});

test("convertAiPlanToDraft: an exercise without a real exerciseId is dropped and counted, never resolved by name", () => {
  const { days, discarded } = convertAiPlanToDraft({
    weeklySchedule: [{ day: "Day 1", exercises: [{ name: "Bench Press", sets: 4 }, { exerciseId: "e9", name: "Leg Press" }] }],
  });
  assert.equal(discarded, 1);
  assert.deepEqual(days[0].exercises.map((e: any) => e.exerciseId), ["e9"]);
});

test("convertAiPlanToDraft: days left empty are removed; malformed content yields no days", () => {
  assert.equal(convertAiPlanToDraft({ weeklySchedule: [{ day: "D1", exercises: [{ name: "x" }] }] }).days.length, 0);
  assert.deepEqual(convertAiPlanToDraft(null), { days: [], discarded: 0 });
  assert.deepEqual(convertAiPlanToDraft({ weeklySchedule: "nope" }), { days: [], discarded: 0 });
});
