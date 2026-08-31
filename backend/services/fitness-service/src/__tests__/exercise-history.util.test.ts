import test from "node:test";
import assert from "node:assert/strict";
import { derivePersonalRecord } from "../utils/exercise-history.util";
import type { SessionProgressPoint } from "../utils/exercise-progress.util";

/**
 * Roadmap P3.6 "Exercise history detail page"
 * (docs/features/EXERCISE_HISTORY_DETAIL_IMPACT_ANALYSIS.md).
 */

function session(partial: Partial<SessionProgressPoint>): SessionProgressPoint {
  return {
    date: "2026-08-01",
    workoutId: "w1",
    maxWeightKg: null,
    repsAtMaxWeight: null,
    maxReps: null,
    bestEstimated1RmKg: null,
    bestSetWeightKg: null,
    bestSetReps: null,
    maxDurationSeconds: null,
    maxDistanceMeters: null,
    bestPaceSecPerKm: null,
    ...partial,
  };
}

test("derivePersonalRecord: REPS_LOAD picks the session with the highest e1RM, with its own weight/reps", () => {
  const result = derivePersonalRecord(
    [
      session({ date: "2026-08-01", bestEstimated1RmKg: 80, bestSetWeightKg: 60, bestSetReps: 10 }),
      session({ date: "2026-08-15", bestEstimated1RmKg: 95, bestSetWeightKg: 80, bestSetReps: 5 }),
    ],
    "REPS_LOAD",
  );
  assert.equal(result?.metric, "e1rm");
  assert.equal(result?.value, 95);
  assert.equal(result?.weightKg, 80);
  assert.equal(result?.reps, 5);
  assert.equal(result?.date, "2026-08-15");
});

test("derivePersonalRecord: BODYWEIGHT_REPS picks the highest single-session rep count", () => {
  const result = derivePersonalRecord(
    [session({ date: "2026-08-01", maxReps: 12 }), session({ date: "2026-08-10", maxReps: 15 })],
    "BODYWEIGHT_REPS",
  );
  assert.equal(result?.metric, "reps");
  assert.equal(result?.value, 15);
  assert.equal(result?.date, "2026-08-10");
});

test("derivePersonalRecord: TIME/TIME_LOAD picks the longest duration", () => {
  const result = derivePersonalRecord(
    [session({ maxDurationSeconds: 45 }), session({ date: "2026-08-20", maxDurationSeconds: 60 })],
    "TIME",
  );
  assert.equal(result?.metric, "duration");
  assert.equal(result?.value, 60);
});

test("derivePersonalRecord: DISTANCE_TIME picks the farthest distance", () => {
  const result = derivePersonalRecord(
    [session({ maxDistanceMeters: 3000 }), session({ date: "2026-08-20", maxDistanceMeters: 5000 })],
    "DISTANCE_TIME",
  );
  assert.equal(result?.metric, "distance");
  assert.equal(result?.value, 5000);
});

test("derivePersonalRecord: an empty session list returns null, never a fabricated record", () => {
  assert.equal(derivePersonalRecord([], "REPS_LOAD"), null);
});

test("derivePersonalRecord: sessions with no data for this mode's metric return null", () => {
  const result = derivePersonalRecord([session({ maxReps: 10 })], "REPS_LOAD");
  assert.equal(result, null, "a REPS_LOAD exercise with only bodyweight-shaped data (no e1RM) has no real PR to report");
});

test("derivePersonalRecord: an unrecognized logging mode returns null rather than guessing a metric", () => {
  const result = derivePersonalRecord([session({ bestEstimated1RmKg: 100 })], "SOME_FUTURE_MODE");
  assert.equal(result, null);
});
