import test from "node:test";
import assert from "node:assert/strict";
import { computeRirTrend } from "../services/training-cycle-metrics.service";

type SetRowInput = Parameters<typeof computeRirTrend>[0][number];

function set(dayOffset: number, rir: number | null): SetRowInput {
  return {
    weight: 50,
    reps: 8,
    rpe: null,
    rir,
    completed: true,
    date: new Date(Date.UTC(2026, 0, 1 + dayOffset)),
    exerciseName: "Squat",
    muscleGroups: ["legs"],
  };
}

const cycleStart = new Date(Date.UTC(2026, 0, 1));

test("computeRirTrend: no RIR data at all returns an empty weeklyAvg and 'stable'", () => {
  const result = computeRirTrend([set(0, null), set(1, null)], cycleStart);
  assert.deepEqual(result.weeklyAvg, []);
  assert.equal(result.trend, "stable");
});

test("computeRirTrend: averages RIR values within the same week", () => {
  const result = computeRirTrend([set(0, 4), set(1, 2)], cycleStart);
  assert.deepEqual(result.weeklyAvg, [3]);
});

test("computeRirTrend: a falling RIR across 3+ weeks is flagged 'decreasing' (working closer to failure over time)", () => {
  const result = computeRirTrend(
    [set(0, 5), set(7, 3), set(14, 1)],
    cycleStart,
  );
  assert.deepEqual(result.weeklyAvg, [5, 3, 1]);
  assert.equal(result.trend, "decreasing");
});

test("computeRirTrend: a rising RIR across 3+ weeks is flagged 'increasing' (more reps held in reserve — easier)", () => {
  const result = computeRirTrend(
    [set(0, 1), set(7, 3), set(14, 5)],
    cycleStart,
  );
  assert.equal(result.trend, "increasing");
});

test("computeRirTrend: ignores sets with a null rir alongside sets that do have one", () => {
  const result = computeRirTrend([set(0, 4), set(0, null)], cycleStart);
  assert.deepEqual(result.weeklyAvg, [4]);
});
