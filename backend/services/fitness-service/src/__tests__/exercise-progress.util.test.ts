import test from "node:test";
import assert from "node:assert/strict";
import { computeSessionProgressPoint, type CompletedSetInput } from "../utils/exercise-progress.util";

/**
 * Roadmap P3.3 "Exercise progress charts"
 * (docs/features/EXERCISE_PROGRESS_CHARTS_IMPACT_ANALYSIS.md).
 */

function set(partial: Partial<CompletedSetInput>): CompletedSetInput {
  return { weight: null, reps: null, durationSeconds: null, distanceMeters: null, ...partial };
}

test("computeSessionProgressPoint: weight trend picks the heaviest set, with its own reps", () => {
  const point = computeSessionProgressPoint("2026-08-01", "w1", [
    set({ weight: 60, reps: 10 }),
    set({ weight: 80, reps: 5 }),
    set({ weight: 70, reps: 8 }),
  ]);
  assert.equal(point.maxWeightKg, 80);
  assert.equal(point.repsAtMaxWeight, 5);
});

test("computeSessionProgressPoint: rep trend is the highest single-set rep count, independent of weight", () => {
  const point = computeSessionProgressPoint("2026-08-01", "w1", [
    set({ weight: 80, reps: 5 }),
    set({ weight: 60, reps: 12 }),
  ]);
  assert.equal(point.maxReps, 12);
});

test("computeSessionProgressPoint: e1RM / best-set trend picks the highest-e1RM set, not the heaviest weight", () => {
  // 60kg x 12 reps -> e1RM = 60 * (1 + 12/30) = 84
  // 80kg x 5 reps  -> e1RM = 80 * (1 + 5/30)  ≈ 93.33
  const point = computeSessionProgressPoint("2026-08-01", "w1", [
    set({ weight: 60, reps: 12 }),
    set({ weight: 80, reps: 5 }),
  ]);
  assert.equal(point.bestSetWeightKg, 80);
  assert.equal(point.bestSetReps, 5);
  assert.ok(point.bestEstimated1RmKg! > 93 && point.bestEstimated1RmKg! < 94);
});

test("computeSessionProgressPoint: bodyweight-only session (no weight) still gets a rep trend, no weight lines", () => {
  const point = computeSessionProgressPoint("2026-08-01", "w1", [
    set({ reps: 8 }),
    set({ reps: 10 }),
  ]);
  assert.equal(point.maxWeightKg, null);
  assert.equal(point.bestEstimated1RmKg, null);
  assert.equal(point.bestSetWeightKg, null);
  assert.equal(point.maxReps, 10);
});

test("computeSessionProgressPoint: duration-only session (TIME mode) has no weight/rep/e1RM lines", () => {
  const point = computeSessionProgressPoint("2026-08-01", "w1", [
    set({ durationSeconds: 45 }),
    set({ durationSeconds: 60 }),
  ]);
  assert.equal(point.maxDurationSeconds, 60);
  assert.equal(point.maxWeightKg, null);
  assert.equal(point.maxReps, null);
  assert.equal(point.bestEstimated1RmKg, null);
});

test("computeSessionProgressPoint: TIME_LOAD session gets both weight and duration lines", () => {
  const point = computeSessionProgressPoint("2026-08-01", "w1", [
    set({ weight: 20, durationSeconds: 30 }),
    set({ weight: 24, durationSeconds: 40 }),
  ]);
  assert.equal(point.maxWeightKg, 24);
  assert.equal(point.maxDurationSeconds, 40);
});

test("computeSessionProgressPoint: distance/pace trend — farthest distance and fastest pace, from sets that have both together", () => {
  const point = computeSessionProgressPoint("2026-08-01", "w1", [
    set({ durationSeconds: 1800, distanceMeters: 5000 }), // 5km in 30min -> 360 sec/km
    set({ durationSeconds: 900, distanceMeters: 3000 }), // 3km in 15min -> 300 sec/km (faster)
  ]);
  assert.equal(point.maxDistanceMeters, 5000);
  assert.equal(point.bestPaceSecPerKm, 300);
});

test("computeSessionProgressPoint: pace is never computed by mixing duration from one set and distance from another", () => {
  const point = computeSessionProgressPoint("2026-08-01", "w1", [
    set({ durationSeconds: 60 }), // no distance on this set
    set({ distanceMeters: 200 }), // no duration on this set
  ]);
  assert.equal(point.bestPaceSecPerKm, null);
  assert.equal(point.maxDurationSeconds, 60);
  assert.equal(point.maxDistanceMeters, 200);
});

test("computeSessionProgressPoint: an empty set list returns an all-null session point (never guessed/defaulted)", () => {
  const point = computeSessionProgressPoint("2026-08-01", "w1", []);
  assert.equal(point.maxWeightKg, null);
  assert.equal(point.maxReps, null);
  assert.equal(point.bestEstimated1RmKg, null);
  assert.equal(point.maxDurationSeconds, null);
  assert.equal(point.maxDistanceMeters, null);
  assert.equal(point.bestPaceSecPerKm, null);
});

test("computeSessionProgressPoint: date and workoutId pass through unchanged", () => {
  const point = computeSessionProgressPoint("2026-08-15", "workout-abc", [set({ weight: 50, reps: 5 })]);
  assert.equal(point.date, "2026-08-15");
  assert.equal(point.workoutId, "workout-abc");
});
