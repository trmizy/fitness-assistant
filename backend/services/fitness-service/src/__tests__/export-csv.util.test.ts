import test from "node:test";
import assert from "node:assert/strict";
import { workoutsToCsv, type ExportedWorkout } from "../services/export.service";

/**
 * Roadmap P2.5 "Export / data portability"
 * (docs/features/JSON_CSV_EXPORT_IMPACT_ANALYSIS.md).
 */

function sampleWorkout(overrides: Partial<ExportedWorkout> = {}): ExportedWorkout {
  return {
    id: "w1",
    name: "Push Day",
    date: "2026-01-08",
    notes: null,
    exercises: [
      {
        exerciseId: "e1",
        exerciseName: "Barbell Curl",
        order: 0,
        sets: [
          { setNumber: 1, weightKg: 20, reps: 10, rpe: 7, rir: null, durationSeconds: null, distanceMeters: null, completed: true, setType: null },
          { setNumber: 2, weightKg: 22.5, reps: 8, rpe: 8, rir: null, durationSeconds: null, distanceMeters: null, completed: true, setType: null },
        ],
      },
    ],
    ...overrides,
  };
}

test("workoutsToCsv: header row matches the documented column order", () => {
  const csv = workoutsToCsv([]);
  const [header] = csv.split("\n");
  assert.equal(
    header,
    "workout_id,date,workout_name,exercise_id,exercise_name,set_number,weight_kg,reps,rpe,rir,duration_seconds,distance_meters,completed,set_type",
  );
});

test("workoutsToCsv: one row per set, including a multi-set exercise", () => {
  const csv = workoutsToCsv([sampleWorkout()]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 3, "1 header + 2 set rows");
  assert.equal(lines[1], "w1,2026-01-08,Push Day,e1,Barbell Curl,1,20,10,7,,,,true,");
  assert.equal(lines[2], "w1,2026-01-08,Push Day,e1,Barbell Curl,2,22.5,8,8,,,,true,");
});

test("workoutsToCsv: escapes a workout name containing a comma and embedded quotes", () => {
  const csv = workoutsToCsv([sampleWorkout({ name: 'Leg, Day "Hard"' })]);
  const [, row] = csv.split("\n");
  assert.ok(row.includes('"Leg, Day ""Hard"""'));
});

test("workoutsToCsv: an empty workout list produces just the header", () => {
  const csv = workoutsToCsv([]);
  assert.equal(csv.split("\n").length, 1);
});

test("workoutsToCsv: multiple workouts and exercises all flatten correctly", () => {
  const w2 = sampleWorkout({
    id: "w2",
    name: "Pull Day",
    date: "2026-01-09",
    exercises: [
      { exerciseId: "e2", exerciseName: "Barbell Row", order: 0, sets: [
        { setNumber: 1, weightKg: 60, reps: 10, rpe: null, rir: null, durationSeconds: null, distanceMeters: null, completed: true, setType: "WARMUP" },
      ] },
    ],
  });
  const csv = workoutsToCsv([sampleWorkout(), w2]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 4, "1 header + 2 (w1) + 1 (w2) set rows");
  assert.ok(lines[3].includes("Pull Day") && lines[3].includes("WARMUP"));
});
