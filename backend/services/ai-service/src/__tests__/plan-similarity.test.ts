import test from "node:test";
import assert from "node:assert/strict";
import { findSimilarPlans, type SimilarityCandidate } from "../services/plan-similarity";

function candidate(id: string, title: string, exerciseIds: string[], daysPerWeek = 3, goal = "MUSCLE_GAIN"): SimilarityCandidate {
  return { publishedPlanId: id, title, exerciseIds: new Set(exerciseIds), daysPerWeek, goal };
}

test("identical exercise sets -> similarityScore of 1 (plus goal/day bonus, capped at 1)", () => {
  const target = { exerciseIds: new Set(["a", "b", "c"]), daysPerWeek: 3, goal: "MUSCLE_GAIN" };
  const result = findSimilarPlans(target, [candidate("x", "Plan X", ["a", "b", "c"])]);
  assert.equal(result.length, 1);
  assert.equal(result[0].similarityScore, 1);
});

test("completely disjoint exercise sets -> not reported (below threshold)", () => {
  const target = { exerciseIds: new Set(["a", "b", "c"]), daysPerWeek: 3, goal: "MUSCLE_GAIN" };
  const result = findSimilarPlans(target, [candidate("x", "Plan X", ["d", "e", "f"])]);
  assert.deepEqual(result, []);
});

test("partial overlap below the report threshold is excluded", () => {
  const target = { exerciseIds: new Set(["a", "b", "c", "d", "e"]), daysPerWeek: 3, goal: "MUSCLE_GAIN" };
  // 1 shared out of 6 unique -> jaccard ~0.17, well under 0.6
  const result = findSimilarPlans(target, [candidate("x", "Plan X", ["a", "f"])]);
  assert.deepEqual(result, []);
});

test("results are sorted by similarityScore descending and capped at 5", () => {
  const target = { exerciseIds: new Set(["a", "b", "c"]), daysPerWeek: 3, goal: "MUSCLE_GAIN" };
  const candidates = Array.from({ length: 8 }, (_, i) => candidate(`p${i}`, `Plan ${i}`, ["a", "b", "c"]));
  const result = findSimilarPlans(target, candidates);
  assert.equal(result.length, 5);
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i - 1].similarityScore >= result[i].similarityScore);
  }
});

test("empty exercise sets never falsely report as similar", () => {
  const target = { exerciseIds: new Set<string>(), daysPerWeek: 3, goal: "MUSCLE_GAIN" };
  const result = findSimilarPlans(target, [candidate("x", "Plan X", [])]);
  assert.deepEqual(result, []);
});
