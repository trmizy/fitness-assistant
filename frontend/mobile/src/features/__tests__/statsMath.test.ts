/**
 * CL-15 arithmetic. The activity fixture is shaped like a real `/stats/activity-heatmap` response
 * (john.doe's, which is mostly rest days), and the metric table is checked against the real logging
 * modes the exercise catalog uses.
 *
 * Runs with: npx tsx --test src/features/__tests__/statsMath.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVITY_STATES,
  NO_DATA_COLOR,
  activityColor,
  activityCounts,
  barHeights,
  buildActivityWeeks,
  metricsFor,
  muscleColor,
  seriesFor,
  sortMuscles,
  summarize,
  type ActivityDay,
} from "../stats/statsMath";

const days: ActivityDay[] = [
  // 2026-08-01 is a Saturday, so the first column needs five blanks before it.
  { date: "2026-08-01", state: "rest" },
  { date: "2026-08-02", state: "rest" },
  { date: "2026-08-03", state: "completed" },
  { date: "2026-08-04", state: "partial" },
  { date: "2026-08-05", state: "missed" },
  { date: "2026-08-06", state: "rescheduled" },
  { date: "2026-08-07", state: null },
];

describe("activity grid", () => {
  it("pads the first week so weekdays line up instead of sliding", () => {
    const weeks = buildActivityWeeks(days);
    assert.equal(weeks.length, 2);
    assert.deepEqual(weeks[0].slice(0, 5), [null, null, null, null, null]);
    assert.equal(weeks[0][5]?.date, "2026-08-01", "Saturday sits in row 6 of a Monday-first week");
    assert.equal(weeks[1].length, 7, "the last week is padded out to a full column");
  });

  it("is empty for an empty range rather than one blank column", () => {
    assert.deepEqual(buildActivityWeeks([]), []);
  });

  it("counts only days the server actually classified", () => {
    const counts = activityCounts(days);
    assert.equal(counts.rest, 2);
    assert.equal(counts.completed, 1);
    assert.equal(counts.missed, 1);
    assert.equal(
      Object.values(counts).reduce((a, b) => a + b, 0),
      6,
      "the null day is not counted as anything",
    );
  });

  it("gives a day with no record its own colour, not the rest colour", () => {
    assert.equal(activityColor(null), NO_DATA_COLOR);
    assert.notEqual(activityColor("rest"), activityColor(null));
    assert.equal(activityColor("completed"), "#22c55e");
    assert.equal(ACTIVITY_STATES.length, 5);
  });
});

describe("progress metrics", () => {
  it("offers only what the logging mode can measure", () => {
    assert.deepEqual(metricsFor("BODYWEIGHT_REPS").map((m) => m.dataKey), ["maxReps"]);
    assert.deepEqual(metricsFor("TIME").map((m) => m.dataKey), ["maxDurationSeconds"]);
    assert.deepEqual(
      metricsFor("REPS_LOAD").map((m) => m.dataKey),
      ["maxWeightKg", "maxReps", "bestEstimated1RmKg"],
    );
  });

  it("knows pace is the series where lower is better", () => {
    const pace = metricsFor("DISTANCE_TIME").find((m) => m.id === "pace");
    assert.equal(pace?.lowerIsBetter, true);
    assert.ok(pace?.note?.includes("nhanh"));
    assert.equal(metricsFor("REPS_LOAD")[0].lowerIsBetter, undefined);
  });

  it("falls back to the weighted table for an unknown mode", () => {
    assert.equal(metricsFor(undefined)[0].dataKey, "maxWeightKg");
    assert.equal(metricsFor("SOMETHING_NEW")[0].dataKey, "maxWeightKg");
  });
});

describe("seriesFor", () => {
  const sessions = [
    { date: "2026-09-10T00:00:00.000Z", maxWeightKg: 60, maxReps: 8, bestEstimated1RmKg: 75 },
    { date: "2026-09-03T00:00:00.000Z", maxWeightKg: 55, maxReps: 10, bestEstimated1RmKg: 73 },
    { date: "2026-09-17T00:00:00.000Z", maxWeightKg: null, maxReps: 12, bestEstimated1RmKg: null },
  ];

  it("sorts by date and drops sessions where the metric was not recorded", () => {
    const weight = seriesFor(sessions, "maxWeightKg");
    assert.deepEqual(weight.map((p) => p.date), ["2026-09-03", "2026-09-10"]);
    assert.deepEqual(weight.map((p) => p.value), [55, 60]);
  });

  it("keeps every session for a metric that was recorded each time", () => {
    assert.equal(seriesFor(sessions, "maxReps").length, 3);
    assert.deepEqual(seriesFor(null, "maxReps"), []);
  });
});

describe("summarize", () => {
  const rising = [
    { date: "2026-09-01", value: 55 },
    { date: "2026-09-08", value: 60 },
    { date: "2026-09-15", value: 62.5 },
  ];

  it("reads a rising weight series as progress", () => {
    const summary = summarize(rising)!;
    assert.equal(summary.first, 55);
    assert.equal(summary.last, 62.5);
    assert.equal(summary.best, 62.5);
    assert.equal(summary.delta, 7.5);
    assert.equal(summary.improved, true);
  });

  it("reads a falling PACE as progress, because lower is faster", () => {
    const pace = [
      { date: "2026-09-01", value: 330 },
      { date: "2026-09-08", value: 315 },
    ];
    assert.equal(summarize(pace, true)!.improved, true);
    assert.equal(summarize(pace, true)!.best, 315);
    assert.equal(summarize(pace)!.improved, false, "the same numbers, read as a normal metric");
  });

  it("has no verdict on one session or a flat series", () => {
    assert.equal(summarize([{ date: "2026-09-01", value: 50 }])!.improved, null);
    assert.equal(
      summarize([
        { date: "2026-09-01", value: 50 },
        { date: "2026-09-08", value: 50 },
      ])!.improved,
      null,
    );
    assert.equal(summarize([]), null);
  });
});

describe("barHeights", () => {
  it("scales between the series' own min and max, with a readable floor", () => {
    const heights = barHeights([
      { date: "a", value: 10 },
      { date: "b", value: 20 },
    ]);
    assert.equal(heights[0], 12);
    assert.equal(heights[1], 100);
  });

  it("draws a flat series flat rather than full height", () => {
    const heights = barHeights([
      { date: "a", value: 40 },
      { date: "b", value: 40 },
    ]);
    assert.deepEqual(heights, [60, 60]);
  });
});

describe("muscle heat", () => {
  it("puts the hottest muscle first", () => {
    const sorted = sortMuscles({
      muscles: [
        { muscleId: "m1", code: "CHEST", nameVi: "Ngực", score: 10, intensity: 0.4 },
        { muscleId: "m2", code: "BACK", nameVi: "Lưng", score: 30, intensity: 0.9 },
      ],
    });
    assert.deepEqual(sorted.map((m) => m.code), ["BACK", "CHEST"]);
  });

  it("survives the empty answer a quiet month gives", () => {
    assert.deepEqual(sortMuscles({ muscles: [], noActiveCycle: false }), []);
    assert.deepEqual(sortMuscles(null), []);
  });

  it("keeps the design's four heat steps", () => {
    assert.equal(muscleColor(0.9), "#22c55e");
    assert.equal(muscleColor(0.6), "#16a34a");
    assert.equal(muscleColor(0.35), "#f59e0b");
    assert.equal(muscleColor(0.1), "#3f3f46");
  });
});
