/**
 * Regression coverage for replacing the two hardcoded, fabricated
 * "Phân bổ nhóm cơ" / "Phân bổ loại bài tập" pie charts (previously static
 * percentages identical for every user) with real distributions computed
 * from actual logged workout history.
 *
 * Run with: npx tsx --test src/app/pages/client/__tests__/workout-analytics.utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeMuscleGroupDistribution,
  computeActivityTypeDistribution,
} from "../workout-analytics.utils";

function w(dateIso: string, muscleGroupsList: string[][], activityTypes: string[] = []) {
  return {
    date: dateIso,
    exercises: muscleGroupsList.map((groups, i) => ({
      exercise: {
        muscleGroupsActivated: groups,
        typeOfActivity: activityTypes[i] ?? "STRENGTH",
      },
    })),
  };
}

describe("computeMuscleGroupDistribution", () => {
  it("no logged workouts at all -> empty array (caller must show an honest empty state, never fake data)", () => {
    assert.deepEqual(computeMuscleGroupDistribution([], "all"), []);
  });

  it("computes real percentages from actual muscle groups activated, not a hardcoded list", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const workouts = [
      w("2026-07-29", [["chest"], ["chest"]]),
      w("2026-07-28", [["back"]]),
    ];
    const result = computeMuscleGroupDistribution(workouts, "all", now);
    const chest = result.find((r) => r.name === "Ngực");
    const back = result.find((r) => r.name === "Lưng");
    assert.ok(chest);
    assert.ok(back);
    // 2 chest + 1 back = 3 total -> chest ~67%, back ~33%
    assert.equal(chest!.value, 67);
    assert.equal(back!.value, 33);
  });

  it("'last' filter only counts the single most recent logged workout", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const workouts = [
      w("2026-07-29", [["chest"]]),
      w("2026-07-01", [["back"]]),
    ];
    const result = computeMuscleGroupDistribution(workouts, "last", now);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Ngực");
    assert.equal(result[0].value, 100);
  });

  it("'week' filter excludes a workout logged more than 7 days ago", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const workouts = [
      w("2026-07-29", [["chest"]]), // within 7 days
      w("2026-06-01", [["back"]]), // outside 7 days
    ];
    const result = computeMuscleGroupDistribution(workouts, "week", now);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Ngực");
  });

  it("'month' filter excludes a workout logged more than 30 days ago", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const workouts = [
      w("2026-07-15", [["chest"]]), // within 30 days
      w("2026-01-01", [["back"]]), // outside 30 days
    ];
    const result = computeMuscleGroupDistribution(workouts, "month", now);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Ngực");
  });

  it("translates a muscle group with no known Vietnamese label by passing the raw value through, rather than crashing", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const workouts = [w("2026-07-29", [["some_new_muscle_group"]])];
    const result = computeMuscleGroupDistribution(workouts, "all", now);
    assert.equal(result[0].name, "some_new_muscle_group");
  });

  it("an exercise with no muscleGroupsActivated at all is safely skipped, not counted as a phantom group", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const workouts = [
      {
        date: "2026-07-29",
        exercises: [{ exercise: { muscleGroupsActivated: undefined, typeOfActivity: "STRENGTH" } }],
      },
    ];
    assert.deepEqual(computeMuscleGroupDistribution(workouts as any, "all", now), []);
  });
});

describe("computeActivityTypeDistribution", () => {
  it("no logged workouts -> empty array, never fabricated categories", () => {
    assert.deepEqual(computeActivityTypeDistribution([], "all"), []);
  });

  it("groups by the real typeOfActivity field, translated to Vietnamese", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const workouts = [w("2026-07-29", [["chest"], ["legs"]], ["STRENGTH", "CARDIO"])];
    const result = computeActivityTypeDistribution(workouts, "all", now);
    const strength = result.find((r) => r.name === "Sức mạnh");
    const cardio = result.find((r) => r.name === "Cardio");
    assert.ok(strength);
    assert.ok(cardio);
    assert.equal(strength!.value, 50);
    assert.equal(cardio!.value, 50);
  });
});
