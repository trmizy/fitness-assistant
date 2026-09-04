import test from "node:test";
import assert from "node:assert/strict";
import { matchExerciseName } from "../utils/exercise-name-matcher.util";

/**
 * Roadmap P2 "Canonical import framework"
 * (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md).
 */

const catalog = [
  { id: "1", name: "Barbell Bench Press" },
  { id: "2", name: "Incline Dumbbell Press" },
  { id: "3", name: "Barbell Back Squat" },
  { id: "4", name: "Đẩy Tạ Đòn Nằm Ngang" }, // Vietnamese-named exercise
];

test("matchExerciseName: exact (case/accent-insensitive) match scores 1.0 and sorts first", () => {
  const result = matchExerciseName("barbell bench press", catalog);
  assert.equal(result[0].id, "1");
  assert.equal(result[0].confidence, 1);
});

test("matchExerciseName: exact match ignores Vietnamese accents", () => {
  const result = matchExerciseName("day ta don nam ngang", catalog);
  assert.equal(result[0].id, "4");
  assert.equal(result[0].confidence, 1);
});

test("matchExerciseName: fuzzy candidates are ranked by token overlap", () => {
  const result = matchExerciseName("Barbell Bench", catalog);
  assert.ok(result.length > 0);
  assert.equal(result[0].id, "1"); // "Barbell Bench Press" overlaps more than "Barbell Back Squat"
  assert.ok(result[0].confidence < 1, "a partial name should not score a perfect match");
});

test("matchExerciseName: a genuinely unrelated name returns no candidates, never a forced guess", () => {
  const result = matchExerciseName("Zzz Totally Unrelated Exercise Xyz", catalog);
  assert.deepEqual(result, []);
});

test("matchExerciseName: respects the limit parameter", () => {
  const bigCatalog = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `Barbell Press Variant ${i}` }));
  const result = matchExerciseName("Barbell Press", bigCatalog, 3);
  assert.equal(result.length, 3);
});

test("matchExerciseName: empty catalog returns no candidates", () => {
  assert.deepEqual(matchExerciseName("Bench Press", []), []);
});
