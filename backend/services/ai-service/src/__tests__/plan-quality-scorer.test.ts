import test from "node:test";
import assert from "node:assert/strict";
import { computePlanQualityScore, type PlanReviewLike } from "../services/plan-quality-scorer";

function review(overrides: Partial<PlanReviewLike> & { rating: number }): PlanReviewLike {
  return {
    goalFit: null,
    enjoyment: null,
    clarity: null,
    equipmentFit: null,
    timeFit: null,
    difficultyFit: null,
    resultsPerception: null,
    wouldUseAgain: null,
    complaintTags: null,
    ...overrides,
  };
}

test("no reviews -> qualityScore 0, reviewCount 0, no crash", () => {
  const result = computePlanQualityScore([]);
  assert.equal(result.qualityScore, 0);
  assert.equal(result.reviewCount, 0);
  assert.equal(result.averageRating, null);
});

test("all 5-star reviews with every dimension maxed -> qualityScore close to 1", () => {
  const reviews = [
    review({ rating: 5, goalFit: 5, enjoyment: 5, clarity: 5, equipmentFit: 5, timeFit: 5, wouldUseAgain: true }),
    review({ rating: 5, goalFit: 5, enjoyment: 5, clarity: 5, equipmentFit: 5, timeFit: 5, wouldUseAgain: true }),
  ];
  const result = computePlanQualityScore(reviews);
  assert.ok(result.qualityScore > 0.95, `expected near-1, got ${result.qualityScore}`);
});

test("all 1-star reviews -> low qualityScore", () => {
  const reviews = [review({ rating: 1, wouldUseAgain: false }), review({ rating: 1, wouldUseAgain: false })];
  const result = computePlanQualityScore(reviews);
  assert.ok(result.qualityScore < 0.3, `expected low score, got ${result.qualityScore}`);
});

test("a rating-only review (no dimensions answered) still contributes via rating alone", () => {
  const result = computePlanQualityScore([review({ rating: 4 })]);
  assert.ok(result.qualityScore > 0.5);
  assert.equal(result.averageRating, 4);
});

test("missing dimensions are never treated as a zero — a partial review scores based only on what it answered", () => {
  const fullyAnswered = computePlanQualityScore([review({ rating: 5, goalFit: 5, enjoyment: 5, clarity: 5, equipmentFit: 5, timeFit: 5 })]);
  const ratingOnly = computePlanQualityScore([review({ rating: 5 })]);
  // Both should score high since every answered dimension is maxed — the
  // partial review must not be dragged down by unanswered fields.
  assert.ok(Math.abs(fullyAnswered.qualityScore - ratingOnly.qualityScore) < 0.05);
});

test("wouldUseAgain=false nudges the score down even with a decent rating", () => {
  const withNo = computePlanQualityScore([review({ rating: 4, wouldUseAgain: false })]);
  const withYes = computePlanQualityScore([review({ rating: 4, wouldUseAgain: true })]);
  assert.ok(withNo.qualityScore < withYes.qualityScore);
});

test("a common complaint tag shared by most reviewers lowers the score", () => {
  const withComplaints = computePlanQualityScore([
    review({ rating: 4, complaintTags: ["equipment_mismatch"] }),
    review({ rating: 4, complaintTags: ["equipment_mismatch"] }),
    review({ rating: 4, complaintTags: ["equipment_mismatch"] }),
  ]);
  const withoutComplaints = computePlanQualityScore([review({ rating: 4 }), review({ rating: 4 }), review({ rating: 4 })]);
  assert.ok(withComplaints.qualityScore < withoutComplaints.qualityScore);
  assert.deepEqual(withComplaints.commonComplaints, [{ tag: "equipment_mismatch", count: 3 }]);
});

test("difficultyFitDistribution counts each category correctly", () => {
  const result = computePlanQualityScore([
    review({ rating: 4, difficultyFit: "too_hard" }),
    review({ rating: 4, difficultyFit: "too_hard" }),
    review({ rating: 4, difficultyFit: "just_right" }),
  ]);
  assert.deepEqual(result.difficultyFitDistribution, { too_easy: 0, just_right: 1, too_hard: 2 });
});

test("qualityScore is always within [0, 1] regardless of extreme inputs", () => {
  const result = computePlanQualityScore([
    review({ rating: 1, wouldUseAgain: false, complaintTags: ["too_hard", "boring", "equipment_mismatch"] }),
  ]);
  assert.ok(result.qualityScore >= 0 && result.qualityScore <= 1);
});
