import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildInterleavedWorkoutSteps,
  computeNextExerciseRestSeconds,
  computeNextInterleavedWorkoutStep,
  findCurrentInterleavedWorkoutStep,
} from "../exercise-group.utils";

describe("computeNextExerciseRestSeconds", () => {
  it("ungrouped exercise always uses the default rest, regardless of what's next", () => {
    const current = { groupId: null };
    assert.equal(computeNextExerciseRestSeconds(current, { groupId: "g1" }), 90);
    assert.equal(computeNextExerciseRestSeconds(current, undefined), 90);
    assert.equal(computeNextExerciseRestSeconds(current, undefined, 60), 60);
  });

  it("grouped exercise advancing to a FELLOW group member uses restBetweenExercisesSeconds", () => {
    const current = { groupId: "g1", restBetweenExercisesSeconds: 15, restAfterRoundSeconds: 120 };
    const next = { groupId: "g1" };
    assert.equal(computeNextExerciseRestSeconds(current, next), 15);
  });

  it("grouped exercise that was the LAST member (next is ungrouped) uses restAfterRoundSeconds", () => {
    const current = { groupId: "g1", restBetweenExercisesSeconds: 15, restAfterRoundSeconds: 120 };
    const next = { groupId: null };
    assert.equal(computeNextExerciseRestSeconds(current, next), 120);
  });

  it("grouped exercise that was the last member of its group, next exercise belongs to a DIFFERENT group, still uses restAfterRoundSeconds", () => {
    const current = { groupId: "g1", restBetweenExercisesSeconds: 15, restAfterRoundSeconds: 120 };
    const next = { groupId: "g2" };
    assert.equal(computeNextExerciseRestSeconds(current, next), 120);
  });

  it("grouped exercise with no next exercise at all (last of the whole day) uses restAfterRoundSeconds", () => {
    const current = { groupId: "g1", restBetweenExercisesSeconds: 15, restAfterRoundSeconds: 120 };
    assert.equal(computeNextExerciseRestSeconds(current, undefined), 120);
  });

  it("falls back to the default when the group's own rest fields are unset (null)", () => {
    const current = { groupId: "g1", restBetweenExercisesSeconds: null, restAfterRoundSeconds: null };
    assert.equal(computeNextExerciseRestSeconds(current, { groupId: "g1" }), 90);
    assert.equal(computeNextExerciseRestSeconds(current, { groupId: null }), 90);
  });

  it("current exercise null/undefined is treated as ungrouped (safe default)", () => {
    assert.equal(computeNextExerciseRestSeconds(null, { groupId: "g1" }), 90);
    assert.equal(computeNextExerciseRestSeconds(undefined, undefined), 90);
  });
});

describe("interleaved superset planner", () => {
  const exercises = [
    {
      programExerciseId: "bench",
      groupId: "g1",
      groupOrder: 0,
      sets: 3,
      restBetweenExercisesSeconds: 15,
      restAfterRoundSeconds: 45,
    },
    {
      programExerciseId: "row",
      groupId: "g1",
      groupOrder: 1,
      sets: 3,
      restBetweenExercisesSeconds: 15,
      restAfterRoundSeconds: 45,
    },
    { programExerciseId: "curl", groupId: null, sets: 2 },
  ];

  it("builds true round-major order for a two-exercise superset", () => {
    const steps = buildInterleavedWorkoutSteps(
      exercises,
      {
        bench: [
          { setNumber: 1, completed: false },
          { setNumber: 2, completed: false },
          { setNumber: 3, completed: false },
        ],
        row: [
          { setNumber: 1, completed: false },
          { setNumber: 2, completed: false },
          { setNumber: 3, completed: false },
        ],
      },
      "g1",
    );

    assert.deepEqual(
      steps.map((step) => `${step.programExerciseId}:${step.setNumber}`),
      ["bench:1", "row:1", "bench:2", "row:2", "bench:3", "row:3"],
    );
  });

  it("advances A1 to B1 with between-exercise rest, then B1 to A2 with after-round rest", () => {
    const rows = {
      bench: [
        { setNumber: 1, completed: false },
        { setNumber: 2, completed: false },
      ],
      row: [
        { setNumber: 1, completed: false },
        { setNumber: 2, completed: false },
      ],
    };

    const afterBench = computeNextInterleavedWorkoutStep(exercises, rows, 0, 1);
    assert.equal(afterBench?.programExerciseId, "row");
    assert.equal(afterBench?.setNumber, 1);
    assert.equal(afterBench?.restKind, "between_exercises");
    assert.equal(afterBench?.restSeconds, 15);

    const afterRow = computeNextInterleavedWorkoutStep(exercises, rows, 1, 1);
    assert.equal(afterRow?.programExerciseId, "bench");
    assert.equal(afterRow?.setNumber, 2);
    assert.equal(afterRow?.restKind, "after_round");
    assert.equal(afterRow?.restSeconds, 45);
  });

  it("supports uneven set counts without inventing missing rows", () => {
    const unevenExercises = [
      { ...exercises[0], sets: 3 },
      { ...exercises[1], sets: 4 },
    ];
    const steps = buildInterleavedWorkoutSteps(
      unevenExercises,
      {
        bench: [
          { setNumber: 1, completed: false },
          { setNumber: 2, completed: false },
          { setNumber: 3, completed: false },
        ],
        row: [
          { setNumber: 1, completed: false },
          { setNumber: 2, completed: false },
          { setNumber: 3, completed: false },
          { setNumber: 4, completed: false },
        ],
      },
      "g1",
    );

    assert.deepEqual(
      steps.map((step) => `${step.programExerciseId}:${step.setNumber}`),
      ["bench:1", "row:1", "bench:2", "row:2", "bench:3", "row:3", "row:4"],
    );
  });

  it("skips already completed future steps and finds the current step label", () => {
    const rows = {
      bench: [
        { setNumber: 1, completed: true },
        { setNumber: 2, completed: false },
      ],
      row: [
        { setNumber: 1, completed: true },
        { setNumber: 2, completed: false },
      ],
    };

    const current = findCurrentInterleavedWorkoutStep(exercises, rows, 0, 2);
    assert.equal(current?.roundNumber, 2);
    assert.equal(current?.memberPosition, 1);

    const next = computeNextInterleavedWorkoutStep(exercises, rows, 0, 2);
    assert.equal(next?.programExerciseId, "row");
    assert.equal(next?.setNumber, 2);
  });

  it("supports three-member triset round order and after-round rest", () => {
    const trisetExercises = [
      { ...exercises[0], groupOrder: 0 },
      { ...exercises[1], groupOrder: 1 },
      {
        programExerciseId: "press",
        groupId: "g1",
        groupOrder: 2,
        sets: 2,
        restBetweenExercisesSeconds: 15,
        restAfterRoundSeconds: 60,
      },
    ];
    const rows = {
      bench: [
        { setNumber: 1, completed: false },
        { setNumber: 2, completed: false },
      ],
      row: [
        { setNumber: 1, completed: false },
        { setNumber: 2, completed: false },
      ],
      press: [
        { setNumber: 1, completed: false },
        { setNumber: 2, completed: false },
      ],
    };

    assert.deepEqual(
      buildInterleavedWorkoutSteps(trisetExercises, rows, "g1").map(
        (step) => `${step.programExerciseId}:${step.setNumber}`,
      ),
      ["bench:1", "row:1", "press:1", "bench:2", "row:2", "press:2"],
    );

    const afterMiddle = computeNextInterleavedWorkoutStep(trisetExercises, rows, 1, 1);
    assert.equal(afterMiddle?.programExerciseId, "press");
    assert.equal(afterMiddle?.restKind, "between_exercises");
    assert.equal(afterMiddle?.restSeconds, 15);

    const afterLast = computeNextInterleavedWorkoutStep(trisetExercises, rows, 2, 1);
    assert.equal(afterLast?.programExerciseId, "bench");
    assert.equal(afterLast?.setNumber, 2);
    assert.equal(afterLast?.restKind, "after_round");
    assert.equal(afterLast?.restSeconds, 60);
  });

  it("supports four-member circuit round order", () => {
    const circuitExercises = [
      { programExerciseId: "a", groupId: "g-circuit", groupOrder: 0, sets: 2, restBetweenExercisesSeconds: 10, restAfterRoundSeconds: 75 },
      { programExerciseId: "b", groupId: "g-circuit", groupOrder: 1, sets: 2, restBetweenExercisesSeconds: 10, restAfterRoundSeconds: 75 },
      { programExerciseId: "c", groupId: "g-circuit", groupOrder: 2, sets: 2, restBetweenExercisesSeconds: 10, restAfterRoundSeconds: 75 },
      { programExerciseId: "d", groupId: "g-circuit", groupOrder: 3, sets: 2, restBetweenExercisesSeconds: 10, restAfterRoundSeconds: 75 },
    ];
    const rows = {
      a: [{ setNumber: 1, completed: false }, { setNumber: 2, completed: false }],
      b: [{ setNumber: 1, completed: false }, { setNumber: 2, completed: false }],
      c: [{ setNumber: 1, completed: false }, { setNumber: 2, completed: false }],
      d: [{ setNumber: 1, completed: false }, { setNumber: 2, completed: false }],
    };

    assert.deepEqual(
      buildInterleavedWorkoutSteps(circuitExercises, rows, "g-circuit").map(
        (step) => `${step.programExerciseId}:${step.setNumber}`,
      ),
      ["a:1", "b:1", "c:1", "d:1", "a:2", "b:2", "c:2", "d:2"],
    );

    const afterThird = computeNextInterleavedWorkoutStep(circuitExercises, rows, 2, 1);
    assert.equal(afterThird?.programExerciseId, "d");
    assert.equal(afterThird?.restKind, "between_exercises");
    assert.equal(afterThird?.restSeconds, 10);

    const afterFourth = computeNextInterleavedWorkoutStep(circuitExercises, rows, 3, 1);
    assert.equal(afterFourth?.programExerciseId, "a");
    assert.equal(afterFourth?.setNumber, 2);
    assert.equal(afterFourth?.restKind, "after_round");
    assert.equal(afterFourth?.restSeconds, 75);
  });
});
