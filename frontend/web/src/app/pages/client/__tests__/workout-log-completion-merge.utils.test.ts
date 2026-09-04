/**
 * Regression coverage for the "0% then flips to 100% after reload" bug:
 * the completion-percentage / "Xong X/Y" counter is driven entirely by
 * mergeRealWorkoutData's completedIndices output. See the doc comment in
 * workout-log-completion-merge.utils.ts for how this relates to the actual
 * root cause (wrong selectedDate → wrong cachedWorkout lookup, fixed
 * separately in workout-log-url.utils.ts).
 *
 * Run with: npx tsx --test src/app/pages/client/__tests__/workout-log-completion-merge.utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeRealWorkoutData } from "../workout-log-completion-merge.utils";

const template = [
  { dbId: "ex-1", weight: null, rpe: null, rir: null },
  { dbId: "ex-2", weight: null, rpe: null, rir: null },
  { dbId: "ex-3", weight: null, rpe: null, rir: null },
];

describe("mergeRealWorkoutData", () => {
  it("no cached workout at all (never logged / still loading) leaves the template untouched and reports zero completed", () => {
    const { merged, completedIndices } = mergeRealWorkoutData(template, null);
    assert.deepEqual(merged, template);
    assert.equal(completedIndices.size, 0);
  });

  it("an exercise with every set completed is marked complete — the case that should read as real progress, not a stale 0%", () => {
    const cachedWorkout = {
      exercises: [
        {
          exerciseId: "ex-1",
          weight: 60,
          workoutSets: [
            { completed: true, rpe: 8, rir: 2 },
            { completed: true, rpe: 8, rir: 2 },
          ],
        },
      ],
    };
    const { merged, completedIndices } = mergeRealWorkoutData(template, cachedWorkout);
    assert.ok(completedIndices.has(0));
    assert.equal(completedIndices.size, 1);
    assert.equal(merged[0].weight, 60);
    assert.equal(merged[0].rpe, 8);
    assert.equal(merged[0].rir, 2);
  });

  it("an exercise logged but with an INCOMPLETE set must NOT count as done — no inferring 100% just because a WorkoutExercise row exists", () => {
    const cachedWorkout = {
      exercises: [
        {
          exerciseId: "ex-2",
          weight: 40,
          workoutSets: [{ completed: true }, { completed: false }],
        },
      ],
    };
    const { completedIndices } = mergeRealWorkoutData(template, cachedWorkout);
    assert.equal(completedIndices.has(1), false);
  });

  it("an exercise logged with zero sets must NOT count as done (empty array is not 'every set complete')", () => {
    const cachedWorkout = {
      exercises: [{ exerciseId: "ex-1", weight: 20, workoutSets: [] }],
    };
    const { completedIndices } = mergeRealWorkoutData(template, cachedWorkout);
    assert.equal(completedIndices.size, 0);
  });

  it("multiple completed exercises are all reflected, at their correct template indices", () => {
    const cachedWorkout = {
      exercises: [
        { exerciseId: "ex-1", weight: 60, workoutSets: [{ completed: true }] },
        { exerciseId: "ex-3", weight: 80, workoutSets: [{ completed: true }] },
      ],
    };
    const { completedIndices } = mergeRealWorkoutData(template, cachedWorkout);
    assert.deepEqual([...completedIndices].sort(), [0, 2]);
  });

  it("an exercise in the cached workout that no longer exists in today's template (program changed) is ignored, not crashed on", () => {
    const cachedWorkout = {
      exercises: [
        { exerciseId: "no-longer-in-plan", weight: 10, workoutSets: [{ completed: true }] },
      ],
    };
    const { merged, completedIndices } = mergeRealWorkoutData(template, cachedWorkout);
    assert.equal(completedIndices.size, 0);
    assert.deepEqual(merged, template);
  });

  it("a template exercise with no matching logged entry keeps its original (template) weight/rpe/rir untouched", () => {
    const cachedWorkout = {
      exercises: [{ exerciseId: "ex-1", weight: 60, workoutSets: [{ completed: true }] }],
    };
    const { merged } = mergeRealWorkoutData(template, cachedWorkout);
    assert.equal(merged[1].weight, null);
    assert.equal(merged[2].weight, null);
  });
});
