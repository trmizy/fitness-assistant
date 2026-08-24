/**
 * Deterministic (no AI) near-duplicate detection for marketplace plans —
 * Jaccard similarity over each plan's set of exerciseIds, extended with a
 * day-count/goal proximity bonus. Explainable by design (this project's
 * "no black box" convention) — a similarityScore is just set overlap, not a
 * learned embedding, so "why did this flag as similar" is always answerable
 * by listing the shared exercise ids.
 */

export interface SimilarityCandidate {
  publishedPlanId: string;
  title: string;
  exerciseIds: Set<string>;
  daysPerWeek: number;
  goal: string;
}

export interface SimilarListing {
  publishedPlanId: string;
  title: string;
  similarityScore: number; // 0-1
}

const SIMILARITY_REPORT_THRESHOLD = 0.6;

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function findSimilarPlans(
  target: { exerciseIds: Set<string>; daysPerWeek: number; goal: string },
  candidates: SimilarityCandidate[],
): SimilarListing[] {
  const scored = candidates.map((c) => {
    let score = jaccard(target.exerciseIds, c.exerciseIds);
    // Same goal + same days/week is a real corroborating signal beyond raw
    // exercise overlap (two plans could share exercises but serve very
    // different structures) — small bounded bonus, never enough to flag a
    // near-empty exercise overlap as "similar" by itself.
    if (c.goal === target.goal) score = Math.min(1, score + 0.05);
    if (c.daysPerWeek === target.daysPerWeek) score = Math.min(1, score + 0.05);
    return { publishedPlanId: c.publishedPlanId, title: c.title, similarityScore: Math.round(score * 1000) / 1000 };
  });
  return scored
    .filter((s) => s.similarityScore >= SIMILARITY_REPORT_THRESHOLD)
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, 5);
}
