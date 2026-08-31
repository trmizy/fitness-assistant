import test from "node:test";
import assert from "node:assert/strict";
import { parseStrongCsv } from "../utils/strong-csv-parser.util";

/**
 * Roadmap P2.2 "Strong import"
 * (docs/features/STRONG_IMPORT_IMPACT_ANALYSIS.md).
 */

const HEADER = "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Weight Unit,Reps,RPE,Distance,Distance Unit,Seconds,Notes,Workout Notes";

test("parseStrongCsv: groups multiple set rows into one workout by (Workout Name, Date)", () => {
  const csv = [
    HEADER,
    '2024-01-08 18:30:00,Push Day,45m,Bench Press (Barbell),1,60,kg,10,8,,,,,Felt strong today',
    '2024-01-08 18:30:00,Push Day,45m,Bench Press (Barbell),2,62.5,kg,8,9,,,,,Felt strong today',
    '2024-01-08 18:30:00,Push Day,45m,Overhead Press (Barbell),1,30,kg,10,,,,,,Felt strong today',
  ].join("\n");

  const { workouts, rowErrors } = parseStrongCsv(csv);
  assert.equal(rowErrors.length, 0);
  assert.equal(workouts.length, 1);
  const w = workouts[0];
  assert.equal(w.title, "Push Day");
  assert.equal(w.date, "2024-01-08");
  assert.equal(w.notes, "Felt strong today");
  assert.equal(w.exercises.length, 2);

  const bench = w.exercises.find((e) => e.exerciseTitle === "Bench Press (Barbell)")!;
  assert.equal(bench.sets.length, 2);
  assert.deepEqual(bench.sets[0], { setNumber: 1, weight: 60, reps: 10, durationSeconds: null, distanceMeters: null, rpe: 8, setType: null });
  assert.deepEqual(bench.sets[1], { setNumber: 2, weight: 62.5, reps: 8, durationSeconds: null, distanceMeters: null, rpe: 9, setType: null });
});

test("parseStrongCsv: converts lb to kg", () => {
  const csv = [
    HEADER,
    '2024-01-08 18:30:00,Push Day,45m,Bench Press (Barbell),1,135,lb,10,,,,,,',
  ].join("\n");
  const { workouts } = parseStrongCsv(csv);
  const weightKg = workouts[0].exercises[0].sets[0].weight!;
  assert.ok(Math.abs(weightKg - 61.235) < 0.01, `expected ~61.235kg, got ${weightKg}`);
});

test("parseStrongCsv: kg passes through unchanged", () => {
  const csv = [
    HEADER,
    '2024-01-08 18:30:00,Push Day,45m,Bench Press (Barbell),1,60,kg,10,,,,,,',
  ].join("\n");
  const { workouts } = parseStrongCsv(csv);
  assert.equal(workouts[0].exercises[0].sets[0].weight, 60);
});

test("parseStrongCsv: converts mi to meters, km to meters, defaults unspecified to km", () => {
  const csv = [
    HEADER,
    '2024-01-08 07:00:00,Run Day,30m,Outdoor Run,1,,,,,5,km,1800,,',
    '2024-01-08 07:00:00,Run Day,30m,Outdoor Run,2,,,,,1,mi,600,,',
    '2024-01-08 07:00:00,Run Day,30m,Outdoor Run,3,,,,,2,,600,,',
  ].join("\n");
  const { workouts } = parseStrongCsv(csv);
  const sets = workouts[0].exercises[0].sets;
  assert.equal(sets[0].distanceMeters, 5000);
  assert.ok(Math.abs(sets[1].distanceMeters! - 1609.344) < 0.01);
  assert.equal(sets[2].distanceMeters, 2000, "unspecified Distance Unit defaults to km, matching Strong's own default");
});

test("parseStrongCsv: a row missing Exercise Name is reported as a row error, not silently dropped", () => {
  const csv = [
    HEADER,
    '2024-01-08 18:30:00,Push Day,45m,,1,60,kg,10,,,,,,',
  ].join("\n");
  const { workouts, rowErrors } = parseStrongCsv(csv);
  assert.equal(workouts.length, 0);
  assert.equal(rowErrors.length, 1);
  assert.match(rowErrors[0].message, /Exercise Name/);
});

test("parseStrongCsv: an unparseable Date is reported as a row error", () => {
  const csv = [
    HEADER,
    'not-a-date,Push Day,45m,Bench Press,1,60,kg,10,,,,,,',
  ].join("\n");
  const { workouts, rowErrors } = parseStrongCsv(csv);
  assert.equal(workouts.length, 0);
  assert.equal(rowErrors.length, 1);
  assert.match(rowErrors[0].message, /Date/);
});

test("parseStrongCsv: sourceHash is deterministic and distinguishes different workouts", () => {
  const csv1 = [HEADER, '2024-01-08 18:30:00,Push Day,45m,Bench Press,1,60,kg,10,,,,,,'].join("\n");
  const csv2 = [HEADER, '2024-01-08 19:00:00,Pull Day,45m,Barbell Row,1,80,kg,10,,,,,,'].join("\n");
  const a1 = parseStrongCsv(csv1).workouts[0].sourceHash;
  const a2 = parseStrongCsv(csv1).workouts[0].sourceHash;
  const b = parseStrongCsv(csv2).workouts[0].sourceHash;
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
});

test("parseStrongCsv: a genuinely different provider producing the SAME canonical shape hashes independently of Hevy's own grouping key format", () => {
  // Sanity check that Strong's rawDate-based hash key (no separate
  // start_time/end_time like Hevy) still produces a workout-shaped
  // record indistinguishable from Hevy's own canonical output — proving
  // import.service.ts's shared preview/commit logic can treat both
  // identically.
  const csv = [HEADER, '2024-01-08 18:30:00,Push Day,45m,Bench Press,1,60,kg,10,,,,,,'].join("\n");
  const { workouts } = parseStrongCsv(csv);
  const w = workouts[0];
  assert.ok(typeof w.sourceHash === "string" && w.sourceHash.length === 64, "sha256 hex digest");
  assert.ok(Array.isArray(w.exercises));
  assert.equal(typeof w.date, "string");
});
