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

test("missing screening stays unknown rather than becoming cleared", () => {
  for (const profile of [null, {}]) {
    assert.deepEqual(nutritionBootstrapScreening(profile), {
      safetyScreeningStatus: "UNKNOWN", professionalReviewRequired: false,
    });
  }
});
