/**
 * CL-17's workout normalization and session clock. The first regression below is a real bug found
 * while logging a workout end to end on the emulator: every live session rendered "0/0" sets. The
 * completed-session clock is another: reopening a finished session showed "Đang tập" with a clock
 * still running from the morning's start.
 *
 * Runs with: npx tsx --test src/features/__tests__/normalizeWorkout.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REST_SECONDS,
  formatClock,
  keepUnsyncedRows,
  normalizeWorkout,
  sessionClockState,
} from "../workout/normalizeWorkout";

/** Trimmed from a real `GET /workouts/:id` response. */
const realWorkoutResponse = {
  id: "8cf2e1be-70ec-4775-ad59-328571ac2f3c",
  name: "Buổi 1 (đã chỉnh sửa)",
  // Whole seconds so the clock assertions below are exact (the real stamp carried .911 ms).
  createdAt: "2026-09-15T02:32:50.000Z",
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

describe("sessionClockState", () => {
  const startedAt = "2026-09-15T02:32:50.000Z";
  const tenMinutesLater = Date.parse("2026-09-15T02:42:50.000Z");
  const twelveHoursLater = Date.parse("2026-09-15T14:34:23.000Z");

  it("an in-progress session counts from its real start and keeps ticking", () => {
    const clock = sessionClockState({ status: "IN_PROGRESS", startedAt }, realWorkoutResponse, tenMinutesLater);
    assert.deepEqual(clock, { elapsedSeconds: 600, running: true, completed: false });
  });

  it("a partially completed session is still in progress", () => {
    const clock = sessionClockState(
      { status: "PARTIALLY_COMPLETED", startedAt },
      realWorkoutResponse,
      tenMinutesLater,
    );
    assert.equal(clock.running, true);
    assert.equal(clock.completed, false);
  });

  it("falls back to the workout row's createdAt when the schedule has no start stamp", () => {
    const clock = sessionClockState({ status: "IN_PROGRESS" }, { workout: realWorkoutResponse }, tenMinutesLater);
    assert.equal(clock.elapsedSeconds, 600);
  });

  it("a COMPLETED session shows its real duration, frozen, however late it is reopened", () => {
    // The emulator session: started 02:32:50, completed 02:59:11 → 26:21, not "721:33 Đang tập".
    const clock = sessionClockState(
      { status: "COMPLETED", startedAt, completedAt: "2026-09-15T02:59:11.000Z" },
      realWorkoutResponse,
      twelveHoursLater,
    );
    assert.deepEqual(clock, { elapsedSeconds: 26 * 60 + 21, running: false, completed: true });
    assert.equal(formatClock(clock.elapsedSeconds), "26:21");
  });

  it("a COMPLETED session without both stamps uses durationSeconds, else zero — never a live count", () => {
    const withDuration = sessionClockState(
      { status: "COMPLETED", startedAt, durationSeconds: 1800 },
      realWorkoutResponse,
      twelveHoursLater,
    );
    assert.deepEqual(withDuration, { elapsedSeconds: 1800, running: false, completed: true });

    const bare = sessionClockState({ status: "COMPLETED" }, {}, twelveHoursLater);
    assert.deepEqual(bare, { elapsedSeconds: 0, running: false, completed: true });
  });

  it("with no start stamp at all an in-progress session starts at zero", () => {
    assert.deepEqual(sessionClockState({ status: "IN_PROGRESS" }, {}, tenMinutesLater), {
      elapsedSeconds: 0,
      running: true,
      completed: false,
    });
  });

  it("never goes negative when the start stamp is slightly ahead of the device clock", () => {
    const clock = sessionClockState(
      { status: "IN_PROGRESS", startedAt: "2026-09-15T02:43:00.000Z" },
      realWorkoutResponse,
      tenMinutesLater,
    );
    assert.equal(clock.elapsedSeconds, 0);
  });
});

describe("keepUnsyncedRows", () => {
  it("takes the server's rows after a refocus — sets finished elsewhere show as done", () => {
    const local = normalizeWorkout(realWorkoutResponse)!;
    const server = normalizeWorkout({
      ...realWorkoutResponse,
      exercises: [
        {
          ...realWorkoutResponse.exercises[0],
          workoutSets: realWorkoutResponse.exercises[0].workoutSets.map((s) => ({ ...s, completed: true })),
        },
      ],
    })!;
    const merged = keepUnsyncedRows(server, local);
    assert.equal(merged, server, "nothing pending → the fresh rows as they are");
    assert.equal(merged[0].sets.filter((s) => s.completed).length, 4);
  });

  it("keeps a row that never reached the server instead of dropping it", () => {
    const local = normalizeWorkout(realWorkoutResponse)!;
    local[0].sets[1] = { ...local[0].sets[1], weight: 40, completed: true, unsynced: true };
    const server = normalizeWorkout(realWorkoutResponse)!;

    const merged = keepUnsyncedRows(server, local);
    assert.deepEqual(merged[0].sets[1], local[0].sets[1]);
    assert.equal(merged[0].sets[2], server[0].sets[2], "synced rows still come from the server");
  });

  it("with no local rows yet, is the fresh rows", () => {
    const server = normalizeWorkout(realWorkoutResponse)!;
    assert.equal(keepUnsyncedRows(server, null), server);
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
