import test from "node:test";
import assert from "node:assert/strict";
import { nutritionBootstrapScreening } from "../services/nutrition-bootstrap-screening";

test("follow-up status requests professional review even without flags", () => {
  assert.equal(nutritionBootstrapScreening({ safetyScreeningStatus: "FOLLOW_UP_SUGGESTED" }).professionalReviewRequired, true);
});

test("reported flags override a contradictory cleared status", () => {
  assert.equal(nutritionBootstrapScreening({ safetyScreeningStatus: "CLEARED", safetyScreeningFlags: ["heart_condition"] }).professionalReviewRequired, true);
});

test("cleared screening without flags does not request review", () => {
  assert.deepEqual(nutritionBootstrapScreening({ safetyScreeningStatus: "CLEARED", safetyScreeningFlags: [] }), {
    safetyScreeningStatus: "CLEARED", professionalReviewRequired: false,
  });
});

test("a minor (profile age < 18) requires professional review even when screening is cleared", () => {
  const r = nutritionBootstrapScreening({ safetyScreeningStatus: "CLEARED", safetyScreeningFlags: [], age: 16 });
  assert.equal(r.professionalReviewRequired, true);
  assert.equal(r.minorAge, true);
  assert.equal(nutritionBootstrapScreening({ safetyScreeningStatus: "CLEARED", safetyScreeningFlags: [], age: 18 }).professionalReviewRequired, false);
});

test("missing screening stays unknown rather than becoming cleared", () => {
  for (const profile of [null, {}]) {
    assert.deepEqual(nutritionBootstrapScreening(profile), {
      safetyScreeningStatus: "UNKNOWN", professionalReviewRequired: false,
    });
  }
});

// Owner's own account (2026-11-08): 22 y, 80.9 kg -> target 72 kg, goal MUSCLE_GAIN -> onboarding gave a +surplus 3543 kcal goal.
test("a goal that contradicts the target weight is flagged (maintenance until the user picks the goal they mean)", () => {
  const base = { age: 22, gender: "MALE", heightCm: 173, currentWeight: 80.9 } as any;
  assert.deepEqual(nutritionBootstrapScreening({ ...base, goal: "MUSCLE_GAIN", targetWeight: 72 }).goalTargetConflict, { goal: "MUSCLE_GAIN", currentWeight: 80.9, targetWeight: 72 });
  assert.ok(nutritionBootstrapScreening({ ...base, goal: "WEIGHT_LOSS", targetWeight: 90 }).goalTargetConflict);
  assert.equal(nutritionBootstrapScreening({ ...base, goal: "WEIGHT_LOSS", targetWeight: 72 }).goalTargetConflict, undefined);
  assert.equal(nutritionBootstrapScreening({ ...base, goal: "MUSCLE_GAIN", targetWeight: 85 }).goalTargetConflict, undefined);
  assert.equal(nutritionBootstrapScreening({ ...base, goal: "MUSCLE_GAIN", targetWeight: 80.5 }).goalTargetConflict, undefined, "within 1 kg is not a conflict");
  assert.equal(nutritionBootstrapScreening({ ...base, goal: "MUSCLE_GAIN", targetWeight: 72 }).professionalReviewRequired, false, "not a health flag");
});
