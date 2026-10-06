import { normalizeAgentText } from "../services/fitness-agent-intent";
import { effective, resolveEntityField, type Belief } from "./belief-state";
import type { Conflict } from "./conflict-resolver";
import { recommendMealsPerDay, recommendSessionsPerWeek, recommendTargetWeight } from "./recommenders";
import * as R from "./responses";
import type { Goal, SemanticInterpretation } from "./schema";

/**
 * Conversation policy: (semantic reading + belief state + conflicts + session state) → the NEXT ACTION.
 * The language layer only interprets; this layer decides. It never executes a tool and never writes — every decision that
 * changes state is expressed as a `patch` that the existing workflow pipeline validates and puts behind confirmation.
 */

export type ProposalField = "targetWeight" | "daysPerWeek" | "mealsPerDay" | "sessionMinutes" | "goal";

export interface CiProposal {
  field: ProposalField;
  recommended: number | string;
  checkpoints?: number[];
  /** goal the recommendation assumed (a different goal than the persisted one implies a proposed goal change) */
  goal?: Goal;
  inputs?: Record<string, unknown>;
  note?: string;
}

/** Conversation-scoped memory stored inside the workflow session (`known.__ci`) — never long-term memory. */
export interface CiState {
  proposal?: CiProposal | null;
  lastKey?: string;
  repeat?: number;
  directionHint?: "BELOW" | "ABOVE";
  /** how many times the stored-goal-vs-target-direction question has already been asked (loop detection) */
  directionAsked?: number;
}

export type PolicyAction =
  | "ANSWER_WHY"
  | "ASK_CLARIFICATION"
  | "ASK_MISSING_INFO"
  | "PROPOSE_VALUE"
  | "PROPOSE_PROFILE_CHANGE"
  | "APPLY_AND_CONTINUE"
  | "LEGACY";

export interface PolicyDecision {
  action: PolicyAction;
  /** assistant text for actions that answer directly */
  text?: string;
  /** slot-key → value candidates to merge into the workflow (validated + confirmed by the existing pipeline) */
  patch?: Record<string, unknown>;
  /** text placed in front of the pipeline's own answer (e.g. the confirmation card summary) */
  preface?: string;
  ci: CiState;
  reason: string;
}

export interface PolicyInput {
  text: string;
  interp: SemanticInterpretation;
  belief: Belief;
  conflicts: Conflict[];
  slotKeys: Set<string>;
  expectedSlot?: string | null;
  ci: CiState;
  experience?: string;
}

const ACCEPT = /^\s*(ok|oke|okie|dong y|duoc|duoc roi|vang|uh|u|chot|dung roi|dung vay|ok luon|dc|dc roi)\b/;

const SLOT_BY_ENTITY: Record<string, string> = {
  HEIGHT_CM: "heightCm", WEIGHT_KG: "currentWeightKg", TARGET_WEIGHT_KG: "targetWeight", AGE: "age", GENDER: "gender",
  SESSIONS_PER_WEEK: "daysPerWeek", SESSION_MINUTES: "sessionMinutes", MEALS_PER_DAY: "mealsPerDay", BUDGET_VND: "budgetVnd",
};

export function entitiesToPatch(interp: SemanticInterpretation, slotKeys: Set<string>, expectedSlot?: string | null, currentWeightKnown = true): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const unlabeled = interp.entities.filter((x) => !x.negated && x.type === "WEIGHT_UNLABELED");
  for (const e of interp.entities) {
    if (e.negated) continue;
    let slot = SLOT_BY_ENTITY[e.type];
    if (e.type === "WEIGHT_UNLABELED") {
      const f = resolveEntityField(e, expectedSlot);
      slot = f === "targetWeightKg" ? "targetWeight" : f === "currentWeightKg" ? "currentWeightKg" : "";
      // an introduction ("tôi nữ, 1m58, 52kg") with ONE unit-bearing weight and no current weight on file states the current weight
      if (!slot && unlabeled.length === 1 && !currentWeightKnown && !interp.goalSignals.length && !interp.entities.some((x) => x.type === "TARGET_WEIGHT_KG")) slot = "currentWeightKg";
    }
    if (slot && slotKeys.has(slot) && !(slot in patch)) patch[slot] = e.value;
  }
  // an explicit correction supersedes whatever the plain entity pass assigned (or could not assign)
  for (const c of interp.corrections) {
    if (c.field === "GOAL" || c.newValue === undefined) continue;
    const slot = SLOT_BY_ENTITY[c.field];
    if (slot && slotKeys.has(slot)) patch[slot] = c.newValue;
  }
  return patch;
}

const withKey = (ci: CiState, key: string): CiState => ({ ...ci, lastKey: key, repeat: ci.lastKey === key ? (ci.repeat ?? 0) + 1 : 0 });

/** goal the recommender should assume: an explicit direction the user already showed beats the stale persisted goal. */
function goalForRecommendation(input: PolicyInput): Goal | undefined {
  if (input.ci.directionHint === "BELOW") return "WEIGHT_LOSS";
  if (input.ci.directionHint === "ABOVE") return "MUSCLE_GAIN";
  return effective(input.belief.goal);
}

function recommendFor(input: PolicyInput): PolicyDecision {
  const { belief, expectedSlot, ci } = input;
  const persistedGoal = belief.goal?.persisted;
  const slot = expectedSlot ?? "";
  if (slot === "targetWeight" || (!slot && input.slotKeys.has("targetWeight"))) {
    const goal = goalForRecommendation(input);
    const rec = recommendTargetWeight({ heightCm: effective(belief.heightCm), currentWeightKg: effective(belief.currentWeightKg), goal });
    if (rec.kind === "INSUFFICIENT") return { action: "ASK_MISSING_INFO", text: R.insufficientRecommendation(rec.missing), ci: withKey(ci, "REC_INSUFFICIENT"), reason: "recommendation needs more facts" };
    const changes = goal && persistedGoal && goal !== persistedGoal && (rec.kind === "LOSS" || rec.kind === "GAIN");
    const proposal: CiProposal = { field: "targetWeight", recommended: rec.recommendedKg, checkpoints: rec.checkpoints, goal: rec.kind === "LOSS" ? "WEIGHT_LOSS" : rec.kind === "GAIN" ? "MUSCLE_GAIN" : goal, inputs: rec.inputs, note: rec.note };
    return {
      action: "PROPOSE_VALUE", text: R.recommendationText(rec, changes ? { from: persistedGoal!, to: goal! } : undefined),
      ci: { ...withKey(ci, "PROPOSE:targetWeight"), proposal: rec.kind === "LOSS" || rec.kind === "GAIN" ? proposal : null }, reason: "user asked the assistant to choose the target weight",
    };
  }
  if (slot === "daysPerWeek") {
    const r = recommendSessionsPerWeek({ goal: effective(belief.goal), experience: input.experience });
    return { action: "PROPOSE_VALUE", text: R.countRecommendation("số buổi tập mỗi tuần", r.value, r.reason), ci: { ...withKey(input.ci, "PROPOSE:daysPerWeek"), proposal: { field: "daysPerWeek", recommended: r.value } }, reason: "recommend sessions/week" };
  }
  if (slot === "mealsPerDay") {
    const r = recommendMealsPerDay({ goal: effective(belief.goal) });
    return { action: "PROPOSE_VALUE", text: R.countRecommendation("số bữa mỗi ngày", r.value, r.reason), ci: { ...withKey(input.ci, "PROPOSE:mealsPerDay"), proposal: { field: "mealsPerDay", recommended: r.value } }, reason: "recommend meals/day" };
  }
  if (slot === "sessionMinutes") {
    const value = (input.experience ?? "").toUpperCase() === "BEGINNER" || !input.experience ? 45 : 60;
    return { action: "PROPOSE_VALUE", text: R.countRecommendation("thời lượng mỗi buổi", value, "đủ để tập đều mà không quá sức") + " (đơn vị: phút)", ci: { ...withKey(input.ci, "PROPOSE:sessionMinutes"), proposal: { field: "sessionMinutes", recommended: value } }, reason: "recommend session minutes" };
  }
  // No slot is being asked about (e.g. the opening message of a workflow): nothing to recommend here.
  if (!expectedSlot) return { action: "LEGACY", ci: input.ci, reason: "no slot to recommend for" };
  // Budget, availability days, PT choice… are the user's own decision: say so, do not invent a value.
  return { action: "ASK_CLARIFICATION", text: "Phần này phụ thuộc vào điều kiện riêng của bạn (ví dụ ngân sách hoặc lịch rảnh) nên mình không tự đặt giúp được. Bạn cho mình một khoảng gần đúng là mình lọc phương án phù hợp ngay nhé.", ci: withKey(input.ci, `NO_RECOMMENDER:${slot}`), reason: "no safe recommender for this slot" };
}

export function decide(input: PolicyInput): PolicyDecision {
  const { interp, belief, conflicts, ci, slotKeys, expectedSlot } = input;
  const s = normalizeAgentText(input.text);
  const patch = entitiesToPatch(interp, slotKeys, expectedSlot, effective(belief.currentWeightKg) !== undefined);
  const asserted = interp.entities.filter((e) => !e.negated);
  const current = effective(belief.currentWeightKg);
  const persistedGoal = belief.goal?.persisted;

  // 1. "why?" about something the assistant proposed — answer from the stored reasoning, never from a model.
  if (interp.asksWhy && ci.proposal && interp.requestedAction !== "PROPOSE_CHANGE") {
    const p = ci.proposal;
    return { action: "ANSWER_WHY", text: R.explainRecommendation({ inputs: p.inputs ?? {}, recommended: Number(p.recommended), note: p.note, checkpoints: p.checkpoints }), ci, reason: "explain stored recommendation" };
  }

  // 2. references to what the assistant proposed ("mức đó", "lấy mức thấp hơn", "ok")
  const ref = interp.references.find((r) => ["ACCEPT_PROPOSAL", "LOWER_OPTION", "HIGHER_OPTION", "MIDDLE_OPTION"].includes(r.kind));
  const bareAccept = ACCEPT.test(s) && asserted.length === 0 && !interp.corrections.length && interp.primaryIntent !== "ASK_RECOMMENDATION";
  if ((ref || bareAccept) && asserted.length === 0) {
    const p = ci.proposal;
    if (!p) return { action: "ASK_CLARIFICATION", text: R.nothingProposedYet(), ci, reason: "reference without a proposal" };
    let value: number | string = p.recommended;
    if (ref?.kind === "LOWER_OPTION" && p.checkpoints?.length) value = Math.min(...p.checkpoints);
    if (ref?.kind === "HIGHER_OPTION" && p.checkpoints?.length) value = Math.max(...p.checkpoints);
    if (ref?.kind === "MIDDLE_OPTION") {
      const cps = [...(p.checkpoints ?? [])].sort((a, b) => a - b);
      if (cps.length >= 3) value = cps[Math.floor(cps.length / 2)];
      else return { action: "ASK_CLARIFICATION", text: R.middleAmbiguous(cps), ci: withKey(ci, "MIDDLE_AMBIGUOUS"), reason: "ambiguous reference" };
    }
    const slot = p.field;
    const out: Record<string, unknown> = { [slot]: value };
    const changesGoal = p.goal && p.goal !== persistedGoal;
    if (changesGoal && slotKeys.has("goal")) out.goal = p.goal;
    return {
      action: changesGoal ? "PROPOSE_PROFILE_CHANGE" : "APPLY_AND_CONTINUE", patch: out,
      preface: changesGoal ? R.goalChangePreface({ from: persistedGoal ?? p.goal!, to: p.goal!, currentKg: current, targetKg: typeof value === "number" ? value : undefined }) : undefined,
      ci: { ...ci, proposal: null, lastKey: undefined, repeat: 0, directionHint: undefined }, reason: "user accepted / referenced the proposal",
    };
  }

  // 3. the user asks the assistant to choose for them
  // "explain + act" (requestedAction PROPOSE_CHANGE) is handled by the goal-change branch below, not as a plain recommendation request
  if ((interp.primaryIntent === "ASK_RECOMMENDATION" && interp.requestedAction !== "PROPOSE_CHANGE") || interp.requestedAction === "SUGGEST") return recommendFor(input);

  // 4. a rejected value with nothing new ("không phải 72")
  if (interp.negations.some((n) => n.value !== undefined) && asserted.length === 0 && !interp.goalSignals.length) {
    const n = interp.negations.find((x) => x.value !== undefined)!;
    return { action: "ASK_CLARIFICATION", text: R.negatedValueQuestion(`${n.value}`, "Bạn muốn đặt mức nào thay thế, hoặc nhờ mình đề xuất?"), ci: withKey(ci, "NEGATED_VALUE"), reason: "value rejected, no replacement" };
  }

  // 5. conflicts — resolved BEFORE business validation
  const goalChange = conflicts.find((c): c is Extract<Conflict, { kind: "GOAL_CHANGE" }> => c.kind === "GOAL_CHANGE");
  const direction = conflicts.find((c): c is Extract<Conflict, { kind: "GOAL_VS_TARGET_DIRECTION" }> => c.kind === "GOAL_VS_TARGET_DIRECTION");
  const dropped = conflicts.find((c): c is Extract<Conflict, { kind: "GOAL_DROPPED" }> => c.kind === "GOAL_DROPPED");
  const target = belief.targetWeightKg?.currentCandidate;

  if (goalChange) {
    // implicit goal language is only trusted when the numbers point the same way ("khá mập… muốn xuống 72kg")
    const directionAgrees = target !== undefined && current !== undefined && ((goalChange.to === "WEIGHT_LOSS" && target < current) || (goalChange.to === "MUSCLE_GAIN" && target > current));
    if (goalChange.explicit || directionAgrees) {
      return {
        action: "PROPOSE_PROFILE_CHANGE", patch: { ...patch, ...(slotKeys.has("goal") ? { goal: goalChange.to } : {}) },
        preface: [interp.asksWhy ? R.whyGoalExplanation({ to: goalChange.to, heightCm: effective(belief.heightCm), weightKg: current }) : "", R.goalChangePreface({ from: goalChange.from, to: goalChange.to, currentKg: current, targetKg: target })].filter(Boolean).join(" "),
        ci: { ...ci, lastKey: undefined, repeat: 0, proposal: null, directionHint: undefined }, reason: interp.asksWhy ? "explanation + proposed goal change (HITL preserved)" : "goal contradiction resolved as a proposed profile change",
      };
    }
  }
  if (dropped && !goalChange) return { action: "ASK_CLARIFICATION", text: R.goalDroppedQuestion(dropped.dropped), ci: withKey(ci, "GOAL_DROPPED"), reason: "goal dropped without a replacement" };

  if (direction) {
    const dirHint = direction.direction;
    // A goal the assistant already proposed ("hãy đề xuất") that points the same way as the user's number settles the direction.
    const proposedGoal = ci.proposal?.goal;
    const proposalAgrees = proposedGoal && proposedGoal !== direction.goal && ((proposedGoal === "WEIGHT_LOSS" && dirHint === "BELOW") || (proposedGoal === "MUSCLE_GAIN" && dirHint === "ABOVE"));
    if (proposalAgrees || (ci.directionAsked ?? 0) >= 1) {
      // the same conflict twice in a row: stop repeating the question, propose the direction the user keeps showing.
      const to: Goal = proposalAgrees ? proposedGoal! : dirHint === "BELOW" ? "WEIGHT_LOSS" : "MUSCLE_GAIN";
      return {
        action: "PROPOSE_PROFILE_CHANGE", patch: { ...patch, ...(slotKeys.has("goal") ? { goal: to } : {}) },
        preface: R.goalChangePreface({ from: direction.goal, to, currentKg: direction.currentKg, targetKg: direction.targetKg }),
        ci: { ...ci, lastKey: undefined, repeat: 0, proposal: null, directionHint: undefined, directionAsked: 0 }, reason: proposalAgrees ? "value follows the direction of the assistant's own proposal" : "loop detected: escalated to a proposed goal change",
      };
    }
    return { action: "ASK_CLARIFICATION", text: R.directionClarification(direction), ci: { ...withKey(ci, `DIRECTION:${direction.goal}`), directionHint: dirHint, directionAsked: (ci.directionAsked ?? 0) + 1 }, reason: "target direction contradicts stored goal" };
  }

  // 6. nothing special: let the existing deterministic pipeline handle it (canonical answers keep working unchanged)
  return { action: "LEGACY", patch, ci, reason: "no conversational signal needing the semantic layer" };
}
