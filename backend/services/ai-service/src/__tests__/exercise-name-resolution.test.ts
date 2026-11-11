import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { CANONICAL_EXERCISE_NAMES, canonicalExerciseName, pickExerciseByName } from "../services/exercise-name-resolution";

/**
 * 2026-10-25 live incident: template names were resolved by text search (which also matches exercise
 * INSTRUCTIONS) + "shortest name wins", so "Bench Press" became "JM Press" and "Deadlift" became "Rack Pulls".
 */
const ex = (id: string, exerciseName: string) => ({ id, exerciseName });

test("name-only: an exercise whose NAME lacks the words is never picked (the 'JM Press' bug)", () => {
  // Search results for "Bench Press" included JM Press only because its instructions mention bench press.
  const results = [ex("1", "JM Press"), ex("2", "Machine Bench Press"), ex("3", "Decline Barbell Bench Press")];
  assert.equal(pickExerciseByName(results, "Bench Press")?.exerciseName, "Machine Bench Press");
  assert.equal(pickExerciseByName([ex("1", "JM Press"), ex("2", "Rack Pulls")], "Bench Press"), null);
});

test("exact name wins over shorter partial names; case and punctuation are ignored", () => {
  const results = [ex("1", "Leg Press"), ex("2", "Calf Press On The Leg Press Machine"), ex("3", "Leg-Over Floor Press")];
  assert.equal(pickExerciseByName(results, "leg press")?.id, "1");
  assert.equal(pickExerciseByName([ex("1", "Straight-Arm Pulldown")], "Straight Arm Pulldown")?.id, "1");
});

test("plural/singular differences still match by name", () => {
  assert.equal(pickExerciseByName([ex("1", "Leg Extensions")], "Leg Extension")?.id, "1");
  assert.equal(pickExerciseByName([ex("1", "Pullups")], "Pullup")?.id, "1");
});

test("canonical table: known template names map to a fixed catalog name, lookup is case-insensitive", () => {
  assert.equal(canonicalExerciseName("Deadlift"), "Barbell Deadlift");
  assert.equal(canonicalExerciseName("  BARBELL ROW "), "Bent Over Barbell Row");
  assert.equal(canonicalExerciseName("Totally Unknown Move"), null);
});

test("every canonical target exists in the real catalog snapshot (skipped when the snapshot file is absent)", (t) => {
  const snapshot = path.resolve(__dirname, "../../../../../.dev/aws/catalog-names.json");
  if (!fs.existsSync(snapshot)) { t.skip("no catalog snapshot at .dev/aws/catalog-names.json"); return; }
  const names = new Set((JSON.parse(fs.readFileSync(snapshot, "utf8").replace(/^﻿/, "")) as { name: string }[]).map((c) => c.name));
  const missing = Object.entries(CANONICAL_EXERCISE_NAMES).filter(([, target]) => !names.has(target));
  assert.deepEqual(missing, []);
});

test("every template name used by recommendation_engine resolves to a plausible exercise against the real catalog (skipped without snapshot)", (t) => {
  const root = path.resolve(__dirname, "../../../../../");
  const snapshot = path.join(root, ".dev/aws/catalog-names.json");
  const engine = path.join(root, "backend/services/ai-service/src/llm/recommendation_engine.ts");
  if (!fs.existsSync(snapshot)) { t.skip("no catalog snapshot"); return; }
  const catalog = (JSON.parse(fs.readFileSync(snapshot, "utf8").replace(/^﻿/, "")) as { id: string; name: string }[])
    .map((c) => ({ id: c.id, exerciseName: c.name }));
  const names = [...new Set([...fs.readFileSync(engine, "utf8").matchAll(/buildExercise\(\d+,\s*"([^"]+)"/g)].map((m) => m[1]))];
  assert.ok(names.length > 30);
  const wrong: string[] = [];
  for (const n of names) {
    const target = canonicalExerciseName(n) ?? n;
    const hit = pickExerciseByName(catalog, target);
    // A resolved exercise must come from the NAME: it has to share a content word with the template name.
    if (hit && !n.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).some((w) => hit.exerciseName.toLowerCase().includes(w.replace(/s$/, "")))
      && !canonicalExerciseName(n)) wrong.push(`${n} -> ${hit.exerciseName}`);
  }
  assert.deepEqual(wrong, []);
});
