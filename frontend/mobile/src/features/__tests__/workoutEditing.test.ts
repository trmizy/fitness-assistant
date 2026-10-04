import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { canDeleteSchedule, canReschedule, programDayOptions, rescheduleTargets, scheduleErrorMessage } from "../workout/scheduleActions";
import {
  blockDone,
  canCompleteWhole,
  canSwap,
  canUndoWhole,
  closesCycleSession,
  plannedNotLogged,
  setTypeLabel,
  wholeCompletionPayload,
} from "../workout/exerciseActions";
import {
  computeNextInterleavedWorkoutStep,
  findCurrentInterleavedWorkoutStep,
  groupAwareBlocks,
  groupMetaFromDay,
  setRowsByProgramExerciseId,
} from "../workout/exerciseGroups";
import { customExercisePayload, daySaveOps, editExercisesFromDay, filterOptions, groupIndex, groupTypeFor } from "../workout/programEdit";
import { computeActivityTypeDistribution, computeMuscleGroupDistribution, weightJourney } from "../workout/workoutAnalytics";
import type { ExerciseBlock, SetRow } from "../workout/normalizeWorkout";

/**
 * 14B.4 — schedule / exercise / program-editing rules of web WorkoutLogPage, pinned so the phone
 * cannot drift from them (or from the server guards they mirror).
 *
 * Chạy: npx tsx --test src/features/__tests__/workoutEditing.test.ts
 */

const row = (setNumber: number, completed = false, extra: Partial<SetRow> = {}): SetRow => ({
  id: `s${setNumber}`,
  setNumber,
  weight: 0,
  reps: 10,
  targetReps: null,
  targetRpe: null,
  completed,
  ...extra,
});
const block = (key: string, sets: SetRow[], extra: Partial<ExerciseBlock> = {}): ExerciseBlock => ({
  key,
  exerciseId: `ex-${key}`,
  name: key,
  restSeconds: 90,
  mediaUrl: null,
  sets,
  programExerciseId: `pe-${key}`,
  ...extra,
});

describe("schedule actions (server guards)", () => {
  it("reschedule only a NOT_STARTED session with no workout", () => {
    assert.equal(canReschedule({ id: "a", status: "NOT_STARTED" }), true);
    assert.equal(canReschedule({ id: "a", status: "NOT_STARTED", workoutId: "w" }), false);
    assert.equal(canReschedule({ id: "a", status: "SKIPPED" }), false);
    assert.equal(canReschedule(null), false);
  });

  it("hide only today's row without a workout (server refuses other days)", () => {
    assert.equal(canDeleteSchedule({ id: "a", date: "2026-10-04T00:00:00.000Z" }, "2026-10-04"), true);
    assert.equal(canDeleteSchedule({ id: "a", date: "2026-10-05T00:00:00.000Z" }, "2026-10-04"), false);
    assert.equal(canDeleteSchedule({ id: "a", date: "2026-10-04T00:00:00.000Z", workoutId: "w" }, "2026-10-04"), false);
  });

  it("reschedule targets start today, skip the current day and never include the past", () => {
    const today = new Date(2026, 9, 4);
    const t = rescheduleTargets("2026-10-05", today, 4);
    assert.deepEqual(
      t.map((x) => x.key),
      ["2026-10-04", "2026-10-06", "2026-10-07"],
    );
    assert.equal(t[0].weekday, "Hôm nay");
  });

  it("program day options are ordered by day number and read title", () => {
    const opts = programDayOptions({
      days: [
        { id: "b", dayNumber: 2, title: "Toàn thân B", exercises: [{}] },
        { id: "a", dayNumber: 1, title: "Toàn thân A", exercises: [{}, {}] },
      ],
    });
    assert.deepEqual(opts, [
      { id: "a", label: "Toàn thân A", exerciseCount: 2 },
      { id: "b", label: "Toàn thân B", exerciseCount: 1 },
    ]);
  });

  it("maps the server's refusals to web's wording", () => {
    assert.equal(scheduleErrorMessage({ response: { status: 409, data: { error: "Schedule already exists" } } }, "x"), "Ngày này đã có lịch tập.");
    assert.equal(scheduleErrorMessage({ response: { status: 400, data: { error: "Cannot reschedule into the past" } } }, "x"), "Không thể dời sang một ngày đã qua.");
    assert.equal(scheduleErrorMessage({}, "fallback"), "fallback");
  });
});

describe("exercise actions", () => {
  it("swap only before any set is done, never on a finished session", () => {
    assert.equal(canSwap(block("a", [row(1), row(2)]), false), true);
    assert.equal(canSwap(block("a", [row(1, true), row(2)]), false), false);
    assert.equal(canSwap(block("a", [row(1)]), true), false);
    assert.equal(canSwap(block("a", [row(1)], { programExerciseId: null }), false), false);
  });

  it("complete whole while not done; undo whole once done", () => {
    const open = block("a", [row(1, true), row(2)]);
    const done = block("a", [row(1, true), row(2, true)]);
    assert.equal(blockDone(done), true);
    assert.equal(canCompleteWhole(open, false), true);
    assert.equal(canCompleteWhole(done, false), false);
    assert.equal(canUndoWhole(done), true);
    assert.equal(canUndoWhole(open), false);
  });

  it("whole completion carries the swap and its note", () => {
    const b = block("a", [row(1, false, { weight: 10, reps: 8 })]);
    assert.deepEqual(wholeCompletionPayload(b, { exerciseId: "db", name: "Dumbbell Bench Press", fromName: "Bench Press" }), {
      exerciseId: "db",
      weight: 10,
      reps: 8,
      notes: `Đã đổi từ "Bench Press" sang "Dumbbell Bench Press"`,
    });
    assert.equal(wholeCompletionPayload(block("a", [row(1)]), undefined).weight, undefined);
  });

  it("set type labels default to working", () => {
    assert.equal(setTypeLabel(null), "Working");
    assert.equal(setTypeLabel("TOP"), "Top set");
  });

  it("feedback opens only when a cycle session closes", () => {
    assert.equal(closesCycleSession({ trainingCycleId: "c", completedExercises: 2, totalExercises: 2 }), true);
    assert.equal(closesCycleSession({ trainingCycleId: null, completedExercises: 2, totalExercises: 2 }), false);
    assert.equal(closesCycleSession({ trainingCycleId: "c", completedExercises: 1, totalExercises: 2, progressPercent: 50 }), false);
  });

  it("lists plan exercises the started session has no row for", () => {
    const day = { exercises: [{ id: "pe-a" }, { id: "pe-b" }, { id: "pe-c" }] };
    const pending = plannedNotLogged(day, [block("a", [row(1)]), block("b", [row(1)])]);
    assert.deepEqual(
      pending.map((p) => p.id),
      ["pe-c"],
    );
    assert.deepEqual(plannedNotLogged(null, []), []);
  });
});

describe("superset execution (web exercise-group.utils)", () => {
  const day = {
    exerciseGroups: [
      {
        id: "g1",
        type: "SUPERSET",
        restBetweenExercisesSeconds: 30,
        restAfterRoundSeconds: 90,
        members: [
          { programExerciseId: "pe-a", order: 0 },
          { programExerciseId: "pe-b", order: 1 },
        ],
      },
    ],
  };
  const meta = groupMetaFromDay(day);

  it("after A set 1 comes B set 1 with the between-exercises rest", () => {
    const blocks = [block("a", [row(1, true), row(2)]), block("b", [row(1), row(2)])];
    const step = computeNextInterleavedWorkoutStep(groupAwareBlocks(blocks, meta), setRowsByProgramExerciseId(blocks), 0, 1);
    assert.equal(step?.exerciseIndex, 1);
    assert.equal(step?.setNumber, 1);
    assert.equal(step?.restKind, "between_exercises");
    assert.equal(step?.restSeconds, 30);
  });

  it("after B set 1 comes A set 2 with the after-round rest", () => {
    const blocks = [block("a", [row(1, true), row(2)]), block("b", [row(1, true), row(2)])];
    const step = computeNextInterleavedWorkoutStep(groupAwareBlocks(blocks, meta), setRowsByProgramExerciseId(blocks), 1, 1);
    assert.equal(step?.exerciseIndex, 0);
    assert.equal(step?.setNumber, 2);
    assert.equal(step?.restKind, "after_round");
    assert.equal(step?.restSeconds, 90);
  });

  it("the last set of the group has no next step (plain rest)", () => {
    const blocks = [block("a", [row(1, true), row(2, true)]), block("b", [row(1, true), row(2, true)])];
    assert.equal(computeNextInterleavedWorkoutStep(groupAwareBlocks(blocks, meta), setRowsByProgramExerciseId(blocks), 1, 2), null);
  });

  it("ungrouped exercises have no step; the round shown is the active set's", () => {
    const blocks = [block("a", [row(1, true), row(2)]), block("b", [row(1), row(2)]), block("c", [row(1)])];
    const ex = groupAwareBlocks(blocks, meta);
    assert.equal(computeNextInterleavedWorkoutStep(ex, setRowsByProgramExerciseId(blocks), 2, 1), null);
    assert.equal(findCurrentInterleavedWorkoutStep(ex, setRowsByProgramExerciseId(blocks), 0, 2)?.roundNumber, 2);
  });
});

describe("program editing", () => {
  const original = {
    exercises: [
      { id: "p1", exerciseId: "e1", order: 1, sets: 2, reps: 8, restSeconds: 90, exercise: { exerciseName: "Bench Press" } },
      { id: "p2", exerciseId: "e2", order: 2, sets: 2, reps: 12, restSeconds: 90, exercise: { exerciseName: "Squats" } },
    ],
  };

  it("reads a day into editable rows in order", () => {
    const rows = editExercisesFromDay(original);
    assert.deepEqual(
      rows.map((r) => [r.programExerciseId, r.name, r.sets]),
      [
        ["p1", "Bench Press", 2],
        ["p2", "Squats", 2],
      ],
    );
  });

  it("updates kept rows, adds new ones, deletes removed ones", () => {
    const rows = editExercisesFromDay(original);
    const edited = [{ ...rows[1], sets: 3 }, { programExerciseId: null, exerciseId: "e3", name: "Custom", sets: 3, reps: 10, restSeconds: 90, notes: null }];
    const res = daySaveOps(original, edited);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(
      res.ops.map((o) => o.kind),
      ["update", "add", "delete"],
    );
    assert.deepEqual(res.ops[0], { kind: "update", programExerciseId: "p2", payload: { exerciseId: "e2", order: 1, sets: 3, reps: 12, restSeconds: 90, notes: null } });
    assert.deepEqual(res.ops[2], { kind: "delete", programExerciseId: "p1" });
  });

  it("refuses an empty day", () => {
    assert.equal(daySaveOps(original, []).ok, false);
  });

  it("group type follows the selection size", () => {
    assert.equal(groupTypeFor(1), null);
    assert.equal(groupTypeFor(2), "SUPERSET");
    assert.equal(groupTypeFor(3), "TRISET");
    assert.equal(groupTypeFor(5), "CIRCUIT");
  });

  it("group badge position is the member order, 1-based", () => {
    const idx = groupIndex({
      exerciseGroups: [
        {
          id: "g",
          type: "SUPERSET",
          members: [
            { programExerciseId: "p2", order: 1 },
            { programExerciseId: "p1", order: 0 },
          ],
        },
      ],
    });
    assert.equal(idx.get("p1")?.position, 1);
    assert.equal(idx.get("p2")?.position, 2);
  });

  it("unwraps filter-options (web read the wrapper and fell back to BODYWEIGHT only)", () => {
    const f = filterOptions({ success: true, data: { equipments: ["BODYWEIGHT", "DUMBBELLS"], bodyParts: [], activityTypes: ["STRENGTH"], types: ["PUSH"] } });
    assert.deepEqual(f.equipments, ["BODYWEIGHT", "DUMBBELLS"]);
    assert.deepEqual(f.bodyParts, ["UPPER_BODY", "LOWER_BODY", "CORE", "FULL_BODY"]);
  });

  it("custom exercise payload trims and lowercases muscle groups", () => {
    const p = customExercisePayload(
      {
        exerciseName: "  Kéo cáp  ",
        typeOfActivity: "STRENGTH",
        typeOfEquipment: "CABLE",
        bodyPart: "UPPER_BODY",
        type: "PULL",
        loggingMode: "REPS_LOAD",
        muscleGroupsText: "Lưng, , Tay trước",
        instructions: " ",
      },
      true,
    );
    assert.equal(p.exerciseName, "Kéo cáp");
    assert.deepEqual(p.muscleGroupsActivated, ["lưng", "tay trước"]);
    assert.equal(p.instructions, undefined);
    assert.equal(p.confirmCreateAnyway, true);
  });
});

describe("training analytics", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const workouts = [
    {
      date: "2026-10-03T10:00:00Z",
      exercises: [
        { exercise: { muscleGroupsActivated: ["Pectorals, Triceps"], typeOfActivity: "STRENGTH" } },
        { exercise: { muscleGroupsActivated: ["quadriceps"], typeOfActivity: "STRENGTH" } },
      ],
    },
    { date: "2026-08-01T10:00:00Z", exercises: [{ exercise: { muscleGroupsActivated: ["calves"], typeOfActivity: "CARDIO" } }] },
  ];

  it("splits comma-joined muscle entries and keeps only the window", () => {
    const week = computeMuscleGroupDistribution(workouts, "week", now);
    assert.deepEqual(week.map((s) => s.name).sort(), ["Ngực", "Tay sau", "Đùi trước"].sort());
    assert.equal(
      week.reduce((a, s) => a + s.value, 0),
      99,
    );
    assert.equal(computeMuscleGroupDistribution(workouts, "all", now).length, 4);
  });

  it("activity type distribution, empty when no workout is in range", () => {
    assert.deepEqual(computeActivityTypeDistribution(workouts, "week", now), [{ name: "Sức mạnh", value: 100 }]);
    assert.deepEqual(computeActivityTypeDistribution([], "all", now), []);
  });

  it("weight journey: start from profile, current from latest InBody", () => {
    const j = weightJourney({ startingWeight: 80, currentWeight: 100, targetWeight: 72 }, 110.2);
    assert.equal(j?.current, 110.2);
    assert.equal(j?.changedText, "+30.2 kg");
    assert.equal(j?.remainingText, "38.2 kg");
    assert.equal(weightJourney({ startingWeight: 80, currentWeight: 78 }, null)?.remainingText, "Chưa đặt mục tiêu");
    assert.equal(weightJourney({ currentWeight: 78 }, null), null);
  });
});
