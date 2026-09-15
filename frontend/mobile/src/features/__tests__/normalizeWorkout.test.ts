/**
 * CL-17's workout normalization. The first regression below is a real bug found while logging a
 * workout end to end on the emulator: every live session rendered "0/0" sets.
 *
 * Runs with: npx tsx --test src/features/__tests__/normalizeWorkout.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REST_SECONDS,
  formatClock,
  normalizeWorkout,
} from "../workout/normalizeWorkout";

/** Trimmed from a real `GET /workouts/:id` response. */
const realWorkoutResponse = {
  id: "8cf2e1be-70ec-4775-ad59-328571ac2f3c",
  name: "Buổi 1 (đã chỉnh sửa)",
  exercises: [
    {
      id: "ccc38e67-fb7b-4cec-8468-16ca3bc4ce27",
      exerciseId: "94f3832d-582d-4a03-a940-6fae6d7fb81f",
      // The PLANNED set count — a number, not the rows.
      sets: 4,
      reps: 12,
      exerciseNameSnapshot: "Push-Ups",
      exercise: { id: "94f3832d-582d-4a03-a940-6fae6d7fb81f", exerciseName: "Push-Ups" },
      workoutSets: [
        { id: "s1", setNumber: 1, reps: 12, weight: null, completed: true },
        { id: "s2", setNumber: 2, reps: 12, weight: null, completed: false },
        { id: "s3", setNumber: 3, reps: 12, weight: 5, completed: false },
        { id: "s4", setNumber: 4, reps: 12, weight: null, completed: false },
      ],
    },
  ],
};

describe("normalizeWorkout", () => {
  it("reads the logged rows from workoutSets, not the planned `sets` count (the 0/0 bug)", () => {
    const blocks = normalizeWorkout(realWorkoutResponse);
    assert.ok(blocks);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].sets.length, 4);
    assert.deepEqual(
      blocks[0].sets.map((s) => [s.id, s.setNumber, s.reps, s.weight, s.completed]),
      [
        ["s1", 1, 12, 0, true],
        ["s2", 2, 12, 0, false],
        ["s3", 3, 12, 5, false],
        ["s4", 4, 12, 0, false],
      ],
    );
  });

  it("keeps the exercise identity the set endpoints need", () => {
    const [block] = normalizeWorkout(realWorkoutResponse)!;
    assert.equal(block.key, "ccc38e67-fb7b-4cec-8468-16ca3bc4ce27");
    assert.equal(block.exerciseId, "94f3832d-582d-4a03-a940-6fae6d7fb81f");
    assert.equal(block.name, "Push-Ups");
    assert.equal(block.restSeconds, DEFAULT_REST_SECONDS);
  });

  it("falls back to the name snapshot when the catalog exercise is not included", () => {
    const [block] = normalizeWorkout({
      exercises: [{ id: "e1", exerciseId: "x", exerciseNameSnapshot: "Squat", workoutSets: [] }],
    })!;
    assert.equal(block.name, "Squat");

    const [unnamed] = normalizeWorkout({ exercises: [{ id: "e2" }] })!;
    assert.equal(unnamed.name, "Bài tập");
    assert.deepEqual(unnamed.sets, []);
  });

  it("still reads a legacy `sets` array when there is no workoutSets", () => {
    const [block] = normalizeWorkout({
      exercises: [{ id: "e1", sets: [{ targetReps: 8, targetWeight: 40, targetRpe: 7 }] }],
    })!;
    assert.equal(block.sets.length, 1);
    assert.equal(block.sets[0].reps, 8);
    assert.equal(block.sets[0].weight, 40);
    assert.equal(block.sets[0].targetReps, 8);
    assert.equal(block.sets[0].targetRpe, 7);
    assert.equal(block.sets[0].id, "0-0", "a row with no id gets a stable positional one");
  });

  it("unwraps { workout } and { data } envelopes", () => {
    assert.equal(normalizeWorkout({ workout: realWorkoutResponse })?.[0].sets.length, 4);
    assert.equal(normalizeWorkout({ data: realWorkoutResponse })?.[0].sets.length, 4);
  });

  it("returns null when there is no exercise list to render", () => {
    assert.equal(normalizeWorkout(null), null);
    assert.equal(normalizeWorkout({}), null);
    assert.equal(normalizeWorkout({ exercises: "nope" }), null);
  });
});

describe("formatClock", () => {
  it("pads minutes and seconds and does not roll over into hours", () => {
    assert.equal(formatClock(0), "00:00");
    assert.equal(formatClock(65), "01:05");
    assert.equal(formatClock(24 * 60 + 13), "24:13");
    assert.equal(formatClock(75 * 60), "75:00");
  });
});
