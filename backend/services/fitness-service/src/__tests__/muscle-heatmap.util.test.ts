import test from "node:test";
import assert from "node:assert/strict";
import { computeMuscleScores, normalizeToIntensity } from "../utils/muscle-heatmap.util";

/**
 * Roadmap P3.1 "Muscle heatmap"
 * (docs/features/MUSCLE_HEATMAP_IMPACT_ANALYSIS.md).
 */

test("computeMuscleScores: primary=1.0, secondary=0.5, scored per completed working set", () => {
  const setCounts = new Map([["bench-press", 4]]);
  const links = new Map([
    ["bench-press", [
      { muscleId: "chest", role: "primary" as const },
      { muscleId: "triceps", role: "secondary" as const },
    ]],
  ]);
  const scores = computeMuscleScores(setCounts, links);
  assert.equal(scores.get("chest"), 4 * 1.0);
  assert.equal(scores.get("triceps"), 4 * 0.5);
});

test("computeMuscleScores: multiple exercises accumulate onto the same muscle", () => {
  const setCounts = new Map([
    ["bench-press", 3],
    ["overhead-press", 3],
  ]);
  const links = new Map([
    ["bench-press", [{ muscleId: "front-delts", role: "secondary" as const }]],
    ["overhead-press", [{ muscleId: "front-delts", role: "primary" as const }]],
  ]);
  const scores = computeMuscleScores(setCounts, links);
  assert.equal(scores.get("front-delts"), 3 * 0.5 + 3 * 1.0);
});

test("computeMuscleScores: an exercise with no muscle links contributes nothing, never crashes", () => {
  const setCounts = new Map([["mystery-exercise", 5]]);
  const links = new Map<string, any[]>(); // no entry for mystery-exercise
  const scores = computeMuscleScores(setCounts, links);
  assert.equal(scores.size, 0);
});

test("computeMuscleScores: zero set count contributes nothing", () => {
  const setCounts = new Map([["bench-press", 0]]);
  const links = new Map([["bench-press", [{ muscleId: "chest", role: "primary" as const }]]]);
  const scores = computeMuscleScores(setCounts, links);
  assert.equal(scores.size, 0);
});

test("normalizeToIntensity: the max-score muscle gets intensity 9, others scaled relative to it", () => {
  const scores = new Map([
    ["chest", 10],
    ["triceps", 5],
    ["front-delts", 1],
  ]);
  const intensities = normalizeToIntensity(scores);
  assert.equal(intensities.get("chest"), 9);
  assert.equal(intensities.get("triceps"), 5); // round(5/10 * 9) = round(4.5) = 5 (JS rounds half up)
  assert.ok(intensities.get("front-delts")! >= 1, "even a small nonzero score gets a visible minimum intensity of 1, never 0/invisible");
});

test("normalizeToIntensity: a zero-score muscle is left out entirely, never a fabricated intensity", () => {
  const scores = new Map([
    ["chest", 10],
    ["hamstrings", 0],
  ]);
  const intensities = normalizeToIntensity(scores);
  assert.equal(intensities.has("hamstrings"), false);
  assert.equal(intensities.get("chest"), 9);
});

test("normalizeToIntensity: an empty score map returns an empty intensity map", () => {
  assert.equal(normalizeToIntensity(new Map()).size, 0);
});
