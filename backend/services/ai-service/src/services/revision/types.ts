/**
 * Phase 3 Batch 4 (docs/ai-product/phase3-batch4-conversational-revision.md) — the typed contract for
 * revising a previous recommendation, draft, or pending proposal. A bounded, allowlisted shape, never
 * {target: string, change: any} — see the accompanying doc for which classes/kinds are genuinely
 * supported today vs deferred.
 */

export type RevisionTargetClass =
  | "WORKOUT_DRAFT" | "NUTRITION_DRAFT" | "PT_RECOMMENDATION" | "PROGRAM_RECOMMENDATION"
  | "PENDING_ACTION" | "UNKNOWN";

export type RevisionTarget =
  | { class: "PT_RECOMMENDATION" | "PROGRAM_RECOMMENDATION"; recommendationId: string; candidateIds: string[] }
  | { class: "WORKOUT_DRAFT" | "NUTRITION_DRAFT" | "PENDING_ACTION"; actionId: string }
  | { class: "UNKNOWN" };

/** Only operations actually backed by a real data field/mechanism today — see the doc's "deferred" list
 * for what was deliberately left out (CHANGE_SPECIALTY, CHANGE_GENDER_PREFERENCE, program CHANGE_EQUIPMENT,
 * CHANGE_MACRO_PREFERENCE — no backing field/tool support exists). */
export type RevisionChangeKind =
  | "EXCLUDE_PT" | "EXCLUDE_PROGRAM" | "LOWER_MAX_BUDGET" | "CHANGE_AVAILABILITY_REQUIREMENT"
  | "CHANGE_DAYS_PER_WEEK" | "CHANGE_GOAL"
  | "CHANGE_SESSIONS_PER_WEEK" | "CHANGE_DURATION" | "CHANGE_TRAINING_DAY" | "REDUCE_SESSION_VOLUME"
  | "REPLACE_EXERCISE_IN_DRAFT" | "ADD_EQUIPMENT" | "REMOVE_EQUIPMENT"
  | "CHANGE_CALORIE_TARGET" | "CHANGE_MEAL_CONSTRAINT" | "CHANGE_DIETARY_PREFERENCE";

export interface RevisionChange {
  kind: RevisionChangeKind;
  sourceText: string;
  ordinal?: number;
  value?: unknown;
}

export interface RevisionRequest {
  target: RevisionTarget;
  changes: RevisionChange[];
  ambiguous: boolean;
  ambiguityReason?: string;
}
