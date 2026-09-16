import test from "node:test";
import assert from "node:assert/strict";
import { deriveGoalAchievement } from "../services/client-journey-derivation.service";

/**
 * deriveGoalAchievement() — pure function, no DB. Guards the "never claim
 * causation, never fabricate a verdict" boundary documented in
 * docs/adr-client-journey-attribution.md ("Causal-claim boundary"): this
 * must always return a directional label or UNKNOWN, never a "success"/
 * "failure" claim, and must default to UNKNOWN whenever the signal is
 * genuinely ambiguous rather than guessing.
 */

test("deriveGoalAchievement: WEIGHT_LOSS improves when body fat % drops meaningfully", () => {
  assert.equal(deriveGoalAchievement("WEIGHT_LOSS", 80, 78, 25, 22), "IMPROVED");
});

test("deriveGoalAchievement: WEIGHT_LOSS regresses when body fat % rises meaningfully", () => {
  assert.equal(deriveGoalAchievement("WEIGHT_LOSS", 80, 82, 25, 27), "REGRESSED");
});

test("deriveGoalAchievement: WEIGHT_LOSS with no body-fat data falls back to weight direction", () => {
  assert.equal(deriveGoalAchievement("WEIGHT_LOSS", 80, 74, null, null), "IMPROVED");
  assert.equal(deriveGoalAchievement("WEIGHT_LOSS", 80, 86, null, null), "REGRESSED");
});

test("deriveGoalAchievement: no ending measurement at all is always UNKNOWN, never guessed", () => {
  assert.equal(deriveGoalAchievement("WEIGHT_LOSS", 80, null, 25, null), "UNKNOWN");
  assert.equal(deriveGoalAchievement("MUSCLE_GAIN", 70, null, 18, null), "UNKNOWN");
});

test("deriveGoalAchievement: MUSCLE_GAIN requires weight up AND body fat not worse — weight-only gain (could be fat) is not claimed as improved", () => {
  // Weight up, but body fat also rose meaningfully — likely fat gain, not muscle.
  assert.equal(deriveGoalAchievement("MUSCLE_GAIN", 70, 74, 15, 19), "NO_CHANGE");
  // Weight up, body fat flat/improved — plausible muscle gain.
  assert.equal(deriveGoalAchievement("MUSCLE_GAIN", 70, 74, 15, 14.5), "IMPROVED");
  // No body-fat data at all for a muscle-gain goal — too ambiguous to claim anything.
  assert.equal(deriveGoalAchievement("MUSCLE_GAIN", 70, 74, null, null), "UNKNOWN");
});

test("deriveGoalAchievement: ATHLETIC_PERFORMANCE and unrecognized goals are always UNKNOWN — body composition alone cannot summarize performance", () => {
  assert.equal(deriveGoalAchievement("ATHLETIC_PERFORMANCE", 80, 78, 20, 18), "UNKNOWN");
  assert.equal(deriveGoalAchievement(null, 80, 78, 20, 18), "UNKNOWN");
  assert.equal(deriveGoalAchievement("SOME_UNRECOGNIZED_GOAL", 80, 78, 20, 18), "UNKNOWN");
});

test("deriveGoalAchievement: tiny fluctuations within noise floor are NO_CHANGE, not a directional claim", () => {
  assert.equal(deriveGoalAchievement("WEIGHT_LOSS", 80, 79.9, null, null), "NO_CHANGE");
  assert.equal(deriveGoalAchievement("MAINTENANCE", 80, 80.3, null, null), "NO_CHANGE");
});
