import test from "node:test";
import assert from "node:assert/strict";
import { parseFitNotesCsv } from "../utils/fitnotes-csv-parser.util";

/**
 * Roadmap P2.3 "FitNotes import"
 * (docs/features/FITNOTES_IMPORT_IMPACT_ANALYSIS.md).
 */

const HEADER = "Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment";

test("parseFitNotesCsv: groups rows into ONE workout per calendar Date, positional set numbering (no order column exists)", () => {
  const csv = [
    HEADER,
    "2024-01-08,Bench Press,Chest,60,kg,10,,,,",
    "2024-01-08,Bench Press,Chest,62.5,kg,8,,,,",
    "2024-01-08,Overhead Press,Shoulders,30,kg,10,,,,",
  ].join("\n");

  const { workouts, rowErrors } = parseFitNotesCsv(csv);
  assert.equal(rowErrors.length, 0);
  assert.equal(workouts.length, 1);
  const w = workouts[0];
  assert.equal(w.date, "2024-01-08");
  assert.equal(w.title, "Buổi tập");
  assert.equal(w.notes, null);
  assert.equal(w.exercises.length, 2);

  const bench = w.exercises.find((e) => e.exerciseTitle === "Bench Press")!;
  assert.equal(bench.sets.length, 2);
  assert.equal(bench.sets[0].setNumber, 1);
  assert.equal(bench.sets[0].weight, 60);
  assert.equal(bench.sets[1].setNumber, 2);
  assert.equal(bench.sets[1].weight, 62.5);
});

test("parseFitNotesCsv: two sessions logged on the SAME calendar date necessarily merge into one workout (real, disclosed limitation, not a bug)", () => {
  const csv = [
    HEADER,
    "2024-01-08,Morning Run,Cardio,,,,5,km,1800,",
    "2024-01-08,Bench Press,Chest,60,kg,10,,,,",
  ].join("\n");

  const { workouts } = parseFitNotesCsv(csv);
  assert.equal(workouts.length, 1, "FitNotes' export has no time-of-day — same-date rows cannot be split into separate sessions");
  assert.equal(workouts[0].exercises.length, 2);
});

test("parseFitNotesCsv: converts lb to kg and mi/km/m to meters (reusing the same conversion as Strong import)", () => {
  const csv = [
    HEADER,
    "2024-01-08,Bench Press,Chest,135,lb,10,,,,",
    "2024-01-09,Outdoor Run,Cardio,,,,1,mi,,",
  ].join("\n");
  const { workouts } = parseFitNotesCsv(csv);
  const benchWeight = workouts.find((w) => w.date === "2024-01-08")!.exercises[0].sets[0].weight!;
  assert.ok(Math.abs(benchWeight - 135 * 0.45359237) < 0.01);
  const runDistance = workouts.find((w) => w.date === "2024-01-09")!.exercises[0].sets[0].distanceMeters!;
  assert.ok(Math.abs(runDistance - 1609.344) < 0.01);
});

test("parseFitNotesCsv: Time parses as plain seconds", () => {
  const csv = [HEADER, "2024-01-08,Plank,Core,,,,,,90,"].join("\n");
  const { workouts } = parseFitNotesCsv(csv);
  assert.equal(workouts[0].exercises[0].sets[0].durationSeconds, 90);
});

test("parseFitNotesCsv: Time parses as MM:SS and HH:MM:SS", () => {
  const csv = [
    HEADER,
    "2024-01-08,Plank,Core,,,,,,1:30,",
    "2024-01-09,Long Hold,Core,,,,,,1:02:05,",
  ].join("\n");
  const { workouts } = parseFitNotesCsv(csv);
  assert.equal(workouts.find((w) => w.date === "2024-01-08")!.exercises[0].sets[0].durationSeconds, 90);
  assert.equal(workouts.find((w) => w.date === "2024-01-09")!.exercises[0].sets[0].durationSeconds, 3725);
});

test("parseFitNotesCsv: an unparseable Time is left null, never guessed or blocking the row", () => {
  const csv = [HEADER, "2024-01-08,Plank,Core,,,,,,not-a-time,"].join("\n");
  const { workouts, rowErrors } = parseFitNotesCsv(csv);
  assert.equal(rowErrors.length, 0, "an unparseable Time should not block the whole row — only unparseable Date/missing required fields do");
  assert.equal(workouts[0].exercises[0].sets[0].durationSeconds, null);
});

test("parseFitNotesCsv: a row missing Exercise is reported as a row error, not silently dropped", () => {
  const csv = [HEADER, "2024-01-08,,Chest,60,kg,10,,,,"].join("\n");
  const { workouts, rowErrors } = parseFitNotesCsv(csv);
  assert.equal(workouts.length, 0);
  assert.equal(rowErrors.length, 1);
  assert.match(rowErrors[0].message, /Exercise/);
});

test("parseFitNotesCsv: an unparseable Date is reported as a row error", () => {
  const csv = [HEADER, "not-a-date,Bench Press,Chest,60,kg,10,,,,"].join("\n");
  const { workouts, rowErrors } = parseFitNotesCsv(csv);
  assert.equal(workouts.length, 0);
  assert.equal(rowErrors.length, 1);
  assert.match(rowErrors[0].message, /Date/);
});

test("parseFitNotesCsv: sourceHash is deterministic and distinguishes different dates", () => {
  const csv1 = [HEADER, "2024-01-08,Bench Press,Chest,60,kg,10,,,,"].join("\n");
  const csv2 = [HEADER, "2024-01-09,Barbell Row,Back,80,kg,10,,,,"].join("\n");
  const a1 = parseFitNotesCsv(csv1).workouts[0].sourceHash;
  const a2 = parseFitNotesCsv(csv1).workouts[0].sourceHash;
  const b = parseFitNotesCsv(csv2).workouts[0].sourceHash;
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
});
