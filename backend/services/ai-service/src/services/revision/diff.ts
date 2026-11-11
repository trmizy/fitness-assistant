/**
 * Phase 3 Batch 4 — deterministic, domain-specific diff types. The diff is computed FIRST and is
 * authoritative; narration text is templated FROM it, never asked of an LLM to infer from two prose
 * answers (brief §22/§23).
 */

export interface RecommendationDiff {
  excludedCandidateIds: string[];
  constraintChanges: Record<string, unknown>;
  previousCandidateIds: string[];
  newCandidateIds: string[];
}

export interface WorkoutDraftDiff {
  changedFields: string[];
  addedEquipment?: string[];
  removedExerciseKeywords?: string[];
  sessionsPerWeek?: { from: number; to: number };
}

export interface NutritionTargetDiff {
  caloriesFrom: number;
  caloriesTo: number;
  macrosRescaled: boolean;
}
