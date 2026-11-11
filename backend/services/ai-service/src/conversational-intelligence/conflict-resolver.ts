import { effective, type Belief } from "./belief-state";
import type { Goal, SemanticInterpretation } from "./schema";

/**
 * Deterministic conflict detection between what is PERSISTED and what the user is saying NOW.
 * This runs BEFORE business validation: a target weight below the current weight is not "invalid" — it is evidence that
 * the stored goal (muscle gain) may no longer be what the user wants.
 */

export type Conflict =
  | { kind: "GOAL_CHANGE"; from: Goal; to: Goal; explicit: boolean; viaCorrection: boolean }
  | { kind: "GOAL_VS_TARGET_DIRECTION"; goal: Goal; currentKg: number; targetKg: number; direction: "BELOW" | "ABOVE" }
  | { kind: "GOAL_DROPPED"; dropped: Goal };

export function detectConflicts(belief: Belief, interp: SemanticInterpretation): Conflict[] {
  const out: Conflict[] = [];
  const goalB = belief.goal;
  const persistedGoal = goalB?.persisted;
  const candidateGoal = goalB?.currentCandidate;
  const candSource = goalB?.candidateSource;
  const strongGoalSource = candSource === "CURRENT_CORRECTION" || candSource === "CURRENT_USER";
  const goalExplicit = interp.goalSignals.some((g) => !g.negatesGoal && g.strength === "EXPLICIT") || interp.corrections.some((c) => c.field === "GOAL");

  // The user drops a goal without naming the next one ("không tăng cơ nữa").
  const dropped = interp.goalSignals.find((g) => g.negatesGoal);
  if (dropped && !goalExplicit && (persistedGoal === dropped.goal || !persistedGoal)) out.push({ kind: "GOAL_DROPPED", dropped: dropped.goal });

  if (candidateGoal && persistedGoal && candidateGoal !== persistedGoal && (strongGoalSource || candSource === "INFERENCE")) {
    out.push({ kind: "GOAL_CHANGE", from: persistedGoal, to: candidateGoal, explicit: goalExplicit, viaCorrection: interp.corrections.some((c) => c.field === "GOAL") });
  }

  // Direction of the target weight vs the goal that is in effect (candidate goal wins over the persisted one).
  const goal = effective(goalB);
  const current = effective(belief.currentWeightKg);
  const target = belief.targetWeightKg?.currentCandidate;
  if (goal && current !== undefined && target !== undefined) {
    if (goal === "MUSCLE_GAIN" && target <= current) out.push({ kind: "GOAL_VS_TARGET_DIRECTION", goal, currentKg: current, targetKg: target, direction: "BELOW" });
    if (goal === "WEIGHT_LOSS" && target >= current) out.push({ kind: "GOAL_VS_TARGET_DIRECTION", goal, currentKg: current, targetKg: target, direction: "ABOVE" });
  }
  return out;
}
