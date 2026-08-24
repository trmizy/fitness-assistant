/**
 * Phase 8 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — deterministic,
 * rule-based marketplace plan quality score. NO AI involved in computing
 * this — mirrors cycle-feedback-aggregator.ts's "pure function over plain
 * data, no DB access" pattern for the same testability reasons. AI (see
 * plan-improvement-suggestion.service.ts) only ever INTERPRETS the output
 * of this file, never recomputes the numbers themselves.
 */

export interface PlanReviewLike {
  rating: number; // 1-5, always present
  goalFit: number | null;
  enjoyment: number | null;
  clarity: number | null;
  equipmentFit: number | null;
  timeFit: number | null;
  difficultyFit: string | null; // too_easy | just_right | too_hard
  resultsPerception: string | null; // better_than_expected | as_expected | worse_than_expected | too_early_to_tell
  wouldUseAgain: boolean | null;
  complaintTags: string[] | null;
}

export interface PlanQualityScoreResult {
  qualityScore: number; // 0-1
  reviewCount: number;
  averageRating: number | null;
  wouldUseAgainRate: number | null; // 0-1, null if no review answered it
  difficultyFitDistribution: { too_easy: number; just_right: number; too_hard: number };
  commonComplaints: Array<{ tag: string; count: number }>;
}

export function computePlanQualityScore(reviews: PlanReviewLike[]): PlanQualityScoreResult {
  const difficultyFitDistribution = { too_easy: 0, just_right: 0, too_hard: 0 };
  const complaintCounts = new Map<string, number>();

  if (reviews.length === 0) {
    return {
      qualityScore: 0,
      reviewCount: 0,
      averageRating: null,
      wouldUseAgainRate: null,
      difficultyFitDistribution,
      commonComplaints: [],
    };
  }

  // Weighted composite over every dimension that has data — a review
  // missing a dimension simply doesn't contribute that term, rather than
  // being scored as a 0 (matches cycle-feedback-aggregator.ts's philosophy
  // of never treating "not answered" as a negative signal).
  const dims: Array<{ key: keyof PlanReviewLike; weight: number }> = [
    { key: "goalFit", weight: 1.5 },
    { key: "enjoyment", weight: 1 },
    { key: "clarity", weight: 1 },
    { key: "equipmentFit", weight: 0.75 },
    { key: "timeFit", weight: 0.75 },
  ];

  let weightedSum = 0;
  let totalWeight = 0;
  let ratingSum = 0;
  let wouldUseAgainYes = 0;
  let wouldUseAgainAnswered = 0;

  for (const review of reviews) {
    ratingSum += review.rating;
    weightedSum += (review.rating / 5) * 2; // rating itself always counts, weight 2
    totalWeight += 2;

    for (const dim of dims) {
      const value = review[dim.key];
      if (typeof value === "number") {
        weightedSum += (value / 5) * dim.weight;
        totalWeight += dim.weight;
      }
    }

    if (review.wouldUseAgain != null) {
      wouldUseAgainAnswered++;
      if (review.wouldUseAgain) wouldUseAgainYes++;
    }

    if (review.difficultyFit === "too_easy" || review.difficultyFit === "just_right" || review.difficultyFit === "too_hard") {
      difficultyFitDistribution[review.difficultyFit]++;
    }

    if (Array.isArray(review.complaintTags)) {
      for (const tag of review.complaintTags) {
        complaintCounts.set(tag, (complaintCounts.get(tag) ?? 0) + 1);
      }
    }
  }

  let score = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // wouldUseAgain is a strong, direct signal — nudge the composite toward
  // it rather than let it just be one more averaged-in dimension.
  if (wouldUseAgainAnswered > 0) {
    const rate = wouldUseAgainYes / wouldUseAgainAnswered;
    score = score * 0.85 + rate * 0.15;
  }

  // A high concentration of complaints on the same tag is a real quality
  // signal beyond what the numeric ratings alone capture — apply a bounded
  // penalty (never below 0) proportional to how many reviewers hit the
  // single most common complaint.
  const maxComplaintCount = Math.max(0, ...complaintCounts.values());
  if (maxComplaintCount > 0) {
    const complaintRate = maxComplaintCount / reviews.length;
    score = Math.max(0, score - complaintRate * 0.2);
  }

  const commonComplaints = [...complaintCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    qualityScore: Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000,
    reviewCount: reviews.length,
    averageRating: Math.round((ratingSum / reviews.length) * 100) / 100,
    wouldUseAgainRate: wouldUseAgainAnswered > 0 ? Math.round((wouldUseAgainYes / wouldUseAgainAnswered) * 1000) / 1000 : null,
    difficultyFitDistribution,
    commonComplaints,
  };
}
