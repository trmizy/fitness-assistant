import test from "node:test";
import assert from "node:assert/strict";
import {
  computePlannedVsActual,
  aggregateCyclePlannedVsActual,
  type PlannedExerciseOccurrence,
  type ActualCompletedSet,
} from "../utils/planned-vs-actual.util";

/**
 * Roadmap P3.5 "Planned vs actual training volume"
 * (docs/features/PLANNED_VS_ACTUAL_VOLUME_IMPACT_ANALYSIS.md).
 */

function planned(p: Partial<PlannedExerciseOccurrence> & Pick<PlannedExerciseOccurrence, "exerciseId" | "loggingMode">): PlannedExerciseOccurrence {
  return { exerciseName: "Test Exercise", sets: null, reps: null, weight: null, duration: null, ...p };
}
function actual(s: Partial<ActualCompletedSet> & Pick<ActualCompletedSet, "exerciseId">): ActualCompletedSet {
  return { weight: null, reps: null, durationSeconds: null, distanceMeters: null, ...s };
}

test("computePlannedVsActual: REPS_LOAD compares volume (sets x reps x weight) only, never reps/duration", () => {
  const result = computePlannedVsActual(
    [planned({ exerciseId: "e1", loggingMode: "REPS_LOAD", sets: 3, reps: 10, weight: 60 })],
    [actual({ exerciseId: "e1", weight: 65, reps: 8 }), actual({ exerciseId: "e1", weight: 65, reps: 10 })],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].plannedVolumeKg, 3 * 10 * 60);
  assert.equal(result[0].actualVolumeKg, 65 * 8 + 65 * 10);
  assert.equal(result[0].plannedReps, null);
  assert.equal(result[0].plannedDurationSeconds, null);
});

test("computePlannedVsActual: BODYWEIGHT_REPS compares reps only, weight is never involved", () => {
  const result = computePlannedVsActual(
    [planned({ exerciseId: "e2", loggingMode: "BODYWEIGHT_REPS", sets: 3, reps: 12 })],
    [actual({ exerciseId: "e2", reps: 10 }), actual({ exerciseId: "e2", reps: 8 })],
  );
  assert.equal(result[0].plannedReps, 36);
  assert.equal(result[0].actualReps, 18);
  assert.equal(result[0].plannedVolumeKg, null);
});

test("computePlannedVsActual: TIME compares duration only", () => {
  const result = computePlannedVsActual(
    [planned({ exerciseId: "e3", loggingMode: "TIME", sets: 3, duration: 45 })],
    [actual({ exerciseId: "e3", durationSeconds: 40 }), actual({ exerciseId: "e3", durationSeconds: 50 })],
  );
  assert.equal(result[0].plannedDurationSeconds, 135);
  assert.equal(result[0].actualDurationSeconds, 90);
});

test("computePlannedVsActual: TIME_LOAD compares duration only, weight target is deliberately not folded into a volume number", () => {
  const result = computePlannedVsActual(
    [planned({ exerciseId: "e4", loggingMode: "TIME_LOAD", sets: 2, duration: 30, weight: 20 })],
    [actual({ exerciseId: "e4", weight: 20, durationSeconds: 28 })],
  );
  assert.equal(result[0].plannedDurationSeconds, 60);
  assert.equal(result[0].actualDurationSeconds, 28);
  assert.equal(result[0].plannedVolumeKg, null);
  assert.equal(result[0].actualVolumeKg, null);
});

test("computePlannedVsActual: DISTANCE_TIME has no planned target (real schema gap) — actual distance only", () => {
  const result = computePlannedVsActual(
    [planned({ exerciseId: "e5", loggingMode: "DISTANCE_TIME" })],
    [actual({ exerciseId: "e5", distanceMeters: 3000 }), actual({ exerciseId: "e5", distanceMeters: 2000 })],
  );
  assert.equal(result[0].actualDistanceMeters, 5000);
  assert.equal(result[0].plannedVolumeKg, null);
  assert.equal(result[0].plannedReps, null);
  assert.equal(result[0].plannedDurationSeconds, null);
});

test("computePlannedVsActual: an exercise logged but never planned (ad-hoc substitution) is excluded entirely", () => {
  const result = computePlannedVsActual(
    [planned({ exerciseId: "e1", loggingMode: "REPS_LOAD", sets: 3, reps: 10, weight: 60 })],
    [actual({ exerciseId: "e1", weight: 60, reps: 10 }), actual({ exerciseId: "unplanned-ex", weight: 40, reps: 8 })],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].exerciseId, "e1");
});

test("computePlannedVsActual: a planned exercise never actually logged still appears, with 0 actual", () => {
  const result = computePlannedVsActual(
    [planned({ exerciseId: "e1", loggingMode: "REPS_LOAD", sets: 3, reps: 10, weight: 60 })],
    [],
  );
  assert.equal(result[0].actualVolumeKg, 0);
  assert.equal(result[0].plannedVolumeKg, 1800);
});

test("computePlannedVsActual: sums across multiple sessions this exercise was planned this cycle (sessionsPlanned)", () => {
  const result = computePlannedVsActual(
    [
      planned({ exerciseId: "e1", loggingMode: "REPS_LOAD", sets: 3, reps: 10, weight: 60 }),
      planned({ exerciseId: "e1", loggingMode: "REPS_LOAD", sets: 3, reps: 8, weight: 65 }),
    ],
    [],
  );
  assert.equal(result[0].sessionsPlanned, 2);
  assert.equal(result[0].plannedVolumeKg, 3 * 10 * 60 + 3 * 8 * 65);
});

test("aggregateCyclePlannedVsActual: sums per-mode totals independently, never blended across modes", () => {
  const perExercise = computePlannedVsActual(
    [
      planned({ exerciseId: "e1", loggingMode: "REPS_LOAD", sets: 3, reps: 10, weight: 60 }),
      planned({ exerciseId: "e2", loggingMode: "BODYWEIGHT_REPS", sets: 3, reps: 12 }),
      planned({ exerciseId: "e3", loggingMode: "TIME", sets: 2, duration: 30 }),
    ],
    [
      actual({ exerciseId: "e1", weight: 60, reps: 8 }),
      actual({ exerciseId: "e2", reps: 10 }),
      actual({ exerciseId: "e3", durationSeconds: 25 }),
      actual({ exerciseId: "e5", distanceMeters: 1000 }), // unplanned, contributes nowhere
    ],
  );
  const totals = aggregateCyclePlannedVsActual(perExercise);
  assert.equal(totals.totalPlannedVolumeKg, 1800);
  assert.equal(totals.totalActualVolumeKg, 480);
  assert.equal(totals.totalPlannedReps, 36);
  assert.equal(totals.totalActualReps, 10);
  assert.equal(totals.totalPlannedDurationSeconds, 60);
  assert.equal(totals.totalActualDurationSeconds, 25);
  assert.equal(totals.totalActualDistanceMeters, null, "e5 was never planned, so it's excluded from computePlannedVsActual entirely and never reaches the aggregate");
});

test("aggregateCyclePlannedVsActual: volumeAdherencePct is actual/planned*100, null when nothing was planned", () => {
  const perExercise = computePlannedVsActual(
    [planned({ exerciseId: "e1", loggingMode: "REPS_LOAD", sets: 2, reps: 10, weight: 50 })], // planned 1000kg
    [actual({ exerciseId: "e1", weight: 50, reps: 10 }), actual({ exerciseId: "e1", weight: 50, reps: 10 })], // actual 1000kg
  );
  const totals = aggregateCyclePlannedVsActual(perExercise);
  assert.equal(totals.volumeAdherencePct, 100);
});

test("aggregateCyclePlannedVsActual: an empty cycle returns all nulls, never fabricated zeros", () => {
  const totals = aggregateCyclePlannedVsActual([]);
  assert.deepEqual(totals, {
    totalPlannedVolumeKg: null,
    totalActualVolumeKg: null,
    volumeAdherencePct: null,
    totalPlannedReps: null,
    totalActualReps: null,
    totalPlannedDurationSeconds: null,
    totalActualDurationSeconds: null,
    totalActualDistanceMeters: null,
  });
});
