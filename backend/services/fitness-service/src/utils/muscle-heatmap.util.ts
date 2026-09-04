/**
 * Roadmap P3.1 "Muscle heatmap"
 * (docs/features/MUSCLE_HEATMAP_IMPACT_ANALYSIS.md).
 *
 * Pure score aggregation + intensity normalization — no Prisma, no
 * Express, directly unit-testable. Weighting (primary=1.0,
 * secondary=0.5) and per-completed-WORKING-SET scoring were both
 * confirmed with the user before implementation (§21's own "product
 * heuristic" framing) — see the impact analysis's "Scope confirmed"
 * section.
 */

export const PRIMARY_WEIGHT = 1.0;
export const SECONDARY_WEIGHT = 0.5;

export interface MuscleLink {
  muscleId: string;
  role: "primary" | "secondary" | string;
}

/** Sums weighted contributions per muscle across every exercise's real
 * completed-working-set count in the window. An exercise with no muscle
 * links contributes nothing (never guessed, never errors). */
export function computeMuscleScores(
  workingSetCountByExerciseId: Map<string, number>,
  muscleLinksByExerciseId: Map<string, MuscleLink[]>,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [exerciseId, setCount] of workingSetCountByExerciseId) {
    if (setCount <= 0) continue;
    const links = muscleLinksByExerciseId.get(exerciseId) ?? [];
    for (const link of links) {
      const weight = link.role === "primary" ? PRIMARY_WEIGHT : SECONDARY_WEIGHT;
      scores.set(link.muscleId, (scores.get(link.muscleId) ?? 0) + weight * setCount);
    }
  }
  return scores;
}

/** Normalizes raw scores to a 1-9 intensity scale relative to the
 * result set's OWN maximum (no external absolute reference exists) —
 * matching body-muscles' existing intensity convention (see
 * ExerciseMuscleMap.tsx's own primary=9/secondary=4 hardcoded values).
 * A muscle with zero score is left out entirely — never a fabricated
 * nonzero intensity for something that wasn't actually trained. */
export function normalizeToIntensity(scores: Map<string, number>): Map<string, number> {
  const max = Math.max(0, ...scores.values());
  const result = new Map<string, number>();
  if (max <= 0) return result;
  for (const [muscleId, score] of scores) {
    if (score <= 0) continue;
    result.set(muscleId, Math.max(1, Math.min(9, Math.round((score / max) * 9))));
  }
  return result;
}
