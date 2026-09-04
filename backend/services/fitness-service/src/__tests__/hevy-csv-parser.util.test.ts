import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseHevyCsv, parseHevyDateToLabel } from "../utils/hevy-csv-parser.util";

/**
 * Roadmap P2.1 "Hevy import"
 * (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md).
 */

const HEADER = "title,start_time,end_time,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe";

test("parseCsv: splits a simple comma-separated row", () => {
  const { headers, rows } = parseCsv("a,b,c\n1,2,3");
  assert.deepEqual(headers, ["a", "b", "c"]);
  assert.deepEqual(rows, [["1", "2", "3"]]);
});

test("parseCsv: handles quoted fields with embedded commas and escaped quotes", () => {
  const { rows } = parseCsv('a,b\n"Bench, Incline","She said ""go"""');
  assert.deepEqual(rows, [["Bench, Incline", 'She said "go"']]);
});

test("parseCsv: handles \\r\\n line endings", () => {
  const { headers, rows } = parseCsv("a,b\r\n1,2\r\n3,4");
  assert.deepEqual(headers, ["a", "b"]);
  assert.deepEqual(rows, [["1", "2"], ["3", "4"]]);
});

test("parseHevyDateToLabel: parses an ISO-ish 'YYYY-MM-DD HH:MM:SS' string", () => {
  assert.equal(parseHevyDateToLabel("2024-01-08 09:15:00"), "2024-01-08");
});

test("parseHevyDateToLabel: parses a '8 Jan 2024, 09:15' style string", () => {
  assert.equal(parseHevyDateToLabel("8 Jan 2024, 09:15"), "2024-01-08");
});

test("parseHevyDateToLabel: returns null for genuinely unparseable input, never guesses", () => {
  assert.equal(parseHevyDateToLabel("not a date"), null);
  assert.equal(parseHevyDateToLabel(""), null);
  assert.equal(parseHevyDateToLabel(undefined), null);
});

test("parseHevyCsv: groups multiple set rows into one workout by (title, start_time)", () => {
  const csv = [
    HEADER,
    'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Bench Press,,,0,normal,100,8,,,8',
    'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Bench Press,,,1,normal,102.5,6,,,9',
    'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Overhead Press,,,0,warmup,40,10,,,',
  ].join("\n");

  const { workouts, rowErrors } = parseHevyCsv(csv);
  assert.equal(rowErrors.length, 0);
  assert.equal(workouts.length, 1);
  const w = workouts[0];
  assert.equal(w.title, "Push Day");
  assert.equal(w.date, "2024-01-08");
  assert.equal(w.exercises.length, 2);

  const bench = w.exercises.find((e) => e.exerciseTitle === "Bench Press")!;
  assert.equal(bench.order, 0);
  assert.equal(bench.sets.length, 2);
  // Hevy's set_index is 0-based; this app's setNumber is 1-based.
  assert.deepEqual(bench.sets[0], { setNumber: 1, weight: 100, reps: 8, durationSeconds: null, distanceMeters: null, rpe: 8, setType: "WORKING" });
  assert.deepEqual(bench.sets[1], { setNumber: 2, weight: 102.5, reps: 6, durationSeconds: null, distanceMeters: null, rpe: 9, setType: "WORKING" });

  const ohp = w.exercises.find((e) => e.exerciseTitle === "Overhead Press")!;
  assert.equal(ohp.order, 1);
  assert.equal(ohp.sets[0].setType, "WARMUP");
});

test("parseHevyCsv: converts distance_km to distanceMeters", () => {
  const csv = [
    HEADER,
    'Run Day,2024-02-01 07:00:00,2024-02-01 07:30:00,Outdoor Run,,,0,normal,,,5.2,1800,',
  ].join("\n");
  const { workouts } = parseHevyCsv(csv);
  assert.equal(workouts[0].exercises[0].sets[0].distanceMeters, 5200);
  assert.equal(workouts[0].exercises[0].sets[0].durationSeconds, 1800);
});

test("parseHevyCsv: two different (title, start_time) pairs on the same day are two workouts", () => {
  const csv = [
    HEADER,
    'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Bench Press,,,0,normal,100,8,,,',
    'Pull Day,2024-01-08 18:00:00,2024-01-08 18:45:00,Barbell Row,,,0,normal,80,10,,,',
  ].join("\n");
  const { workouts } = parseHevyCsv(csv);
  assert.equal(workouts.length, 2);
});

test("parseHevyCsv: a row missing exercise_title is reported as a row error, not silently dropped", () => {
  const csv = [
    HEADER,
    'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,,,,0,normal,100,8,,,',
  ].join("\n");
  const { workouts, rowErrors } = parseHevyCsv(csv);
  assert.equal(workouts.length, 0);
  assert.equal(rowErrors.length, 1);
  assert.match(rowErrors[0].message, /exercise_title/);
});

test("parseHevyCsv: an unparseable start_time is reported as a row error", () => {
  const csv = [
    HEADER,
    'Push Day,not-a-date,2024-01-08 10:00:00,Bench Press,,,0,normal,100,8,,,',
  ].join("\n");
  const { workouts, rowErrors } = parseHevyCsv(csv);
  assert.equal(workouts.length, 0);
  assert.equal(rowErrors.length, 1);
  assert.match(rowErrors[0].message, /start_time/);
});

test("parseHevyCsv: sourceHash is deterministic (same input -> same hash) and distinguishes different workouts", () => {
  const csv1 = [
    HEADER,
    'Push Day,2024-01-08 09:15:00,2024-01-08 10:00:00,Bench Press,,,0,normal,100,8,,,',
  ].join("\n");
  const csv2 = [
    HEADER,
    'Pull Day,2024-01-08 18:00:00,2024-01-08 18:45:00,Barbell Row,,,0,normal,80,10,,,',
  ].join("\n");

  const a1 = parseHevyCsv(csv1).workouts[0].sourceHash;
  const a2 = parseHevyCsv(csv1).workouts[0].sourceHash; // re-parse the identical text
  const b = parseHevyCsv(csv2).workouts[0].sourceHash;

  assert.equal(a1, a2, "identical input must produce an identical hash");
  assert.notEqual(a1, b, "different workouts must produce different hashes");
});
