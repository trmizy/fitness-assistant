/**
 * Phase 4.7R6 — ConservativeSafetyEnvelope (INERT PROTOTYPE: not imported by any production module).
 *
 * Its ONLY job is to decide whether ordinary personalised fitness guidance is allowed. It is NOT a diagnosis,
 * triage score, disease detector, treatment recommender or urgency predictor, and it never produces a medical claim.
 *
 * It consumes bounded, already-computed structured signals (SafetySignalResolution / SafetyNarrativeResolution and an
 * optional future classifier escalation flag). It does not read raw text, DB state or call any model.
 *
 * Authority boundary: the envelope is the final word. A classifier may only ESCALATE; a "normal" classifier output can
 * never turn a RELEVANT/UNCERTAIN state into ALLOW_NORMAL_FITNESS.
 */
import type { SafetySignalResolution } from "./safety-signals";

export type SafetyEnvelopeAction = "ALLOW_NORMAL_FITNESS" | "GENERAL_INFORMATION_ONLY" | "SAFE_ABSTAIN";
export type SafetyEnvelopeState = "SAFE_CLEAR" | "SAFETY_RELEVANT" | "SAFETY_UNCERTAIN";

export type SafetyEnvelopeReason =
  | "HIGH_RISK_PERSONAL"
  | "HIGH_RISK_GENERAL_KNOWLEDGE"
  | "CAUTION_PERSONAL"
  | "CAUTION_GENERAL_KNOWLEDGE"
  | "PERSONAL_BODY_STATE_UNCLASSIFIED"
  | "CLASSIFIER_ESCALATION"
  | "EXPECTED_TRAINING_RESPONSE"
  | "NO_SAFETY_SIGNAL"
  | "CLASSIFIER_DOWNGRADE_IGNORED"
  | "PROCEDURE_HISTORY_ONLY"
  | "NAMED_CONDITION_EDUCATIONAL"
  | "NAMED_CONDITION_PERSONAL_READINESS"
  | "CAUTION_NOT_CLEARLY_EXPECTED_RESPONSE";

export interface SafetyEnvelopeInput {
  resolution: SafetySignalResolution;
  /** a future classifier's positive "safety handling required" decision. Absent / false must never relax the outcome. */
  classifierEscalates?: boolean;
  /** a future classifier's NORMAL decision; recorded and ignored (cannot downgrade). */
  classifierSaysNormal?: boolean;
  /** product policy 3.3: the only procedure signal is a remote, resolved history item (supplied by a labelled/semantic source; never inferred here). */
  procedureHistoryOnly?: boolean;
}

export interface SafetyEnvelopeDecision {
  state: SafetyEnvelopeState;
  action: SafetyEnvelopeAction;
  reasons: SafetyEnvelopeReason[];
}

/** answer kinds the downstream pipeline could produce */
export type AnswerKind = "PERSONALIZED_RECOMMENDATION" | "PROGRAMMING" | "STRENGTH" | "HYPERTROPHY" | "CATALOG" | "LOAD_PROGRESSION" | "PROGRAM_MUTATION" | "SAFE_FOR_USER_CLAIM" | "FITNESS_ACTION_MUTATION" | "GENERAL_EDUCATION" | "SAFETY_ABSTENTION";

/** concept ids (fitness-concepts) that denote a chronic / systemic condition for envelope policy 3.5 */
const CHRONIC_CONCEPTS: ReadonlySet<string> = new Set(["hypertension", "diabetes", "spine_back", "joint_osteoarthritis", "red_s"]);

const ALLOWED: Record<SafetyEnvelopeAction, ReadonlySet<AnswerKind>> = {
  ALLOW_NORMAL_FITNESS: new Set<AnswerKind>(["PERSONALIZED_RECOMMENDATION", "PROGRAMMING", "STRENGTH", "HYPERTROPHY", "CATALOG", "LOAD_PROGRESSION", "PROGRAM_MUTATION", "SAFE_FOR_USER_CLAIM", "FITNESS_ACTION_MUTATION", "GENERAL_EDUCATION", "SAFETY_ABSTENTION"]),
  GENERAL_INFORMATION_ONLY: new Set<AnswerKind>(["GENERAL_EDUCATION", "SAFETY_ABSTENTION"]),
  SAFE_ABSTAIN: new Set<AnswerKind>(["SAFETY_ABSTENTION"]),
};

export function answerKindAllowed(action: SafetyEnvelopeAction, kind: AnswerKind): boolean {
  return ALLOWED[action].has(kind);
}

export function evaluateSafetyEnvelope(input: SafetyEnvelopeInput): SafetyEnvelopeDecision {
  const r = input.resolution;
  const n = r.narrative;
  const personal = r.personal || !!n?.personal;
  const general = !!n?.general && !personal;
  const reasons: SafetyEnvelopeReason[] = [];
  const bodyStateSignals = (n?.symptomSignals.length ?? 0) + (n?.eventSignals.length ?? 0) + (n?.functionalSignals.length ?? 0);

  const historyOnly = !!input.procedureHistoryOnly && r.signals.length > 0 && r.signals.every((x) => x.cls === "POST_SURGICAL_STATE");
  const level = historyOnly ? "NONE" : r.level;
  if (historyOnly) reasons.push("PROCEDURE_HISTORY_ONLY");
  // chronic / systemic conditions only: the concept layer also tags plain injury / symptom concepts as NAMED_CONDITION; those are handled by the pain rules
  const named = r.signals.some((x) => x.cls === "NAMED_CONDITION" && (x.matched.startsWith("chronic") || x.matched.split(",").some((id) => CHRONIC_CONCEPTS.has(id.trim()))));
  // ordinary-discomfort classes only: anything else (e.g. LOCALISED_PAIN) is "not clearly an expected training response"
  const onlyOrdinary = r.signals.length === 0 || r.signals.every((x) => x.cls === "LOW_RISK_EXERCISE_DISCOMFORT" || x.cls === "NORMAL_TRAINING_FATIGUE");

  let state: SafetyEnvelopeState;
  let action: SafetyEnvelopeAction;

  if (level === "HIGH_RISK") {
    state = "SAFETY_RELEVANT";
    if (personal) { action = "SAFE_ABSTAIN"; reasons.push("HIGH_RISK_PERSONAL"); }
    else { action = "GENERAL_INFORMATION_ONLY"; reasons.push("HIGH_RISK_GENERAL_KNOWLEDGE"); }
  } else if (named && personal && !general && !n?.general) {
    // policy 3.5: a named condition is never auto-NORMAL for personalised prescription; unclear control / readiness => abstain
    state = "SAFETY_RELEVANT"; action = "SAFE_ABSTAIN"; reasons.push("NAMED_CONDITION_PERSONAL_READINESS");
  } else if (named && (n?.general || general || !personal)) {
    state = "SAFETY_RELEVANT"; action = "GENERAL_INFORMATION_ONLY"; reasons.push("NAMED_CONDITION_EDUCATIONAL");
  } else if (level === "CAUTION") {
    state = "SAFETY_RELEVANT";
    if (personal && n?.expectedTrainingResponse && onlyOrdinary) { action = "ALLOW_NORMAL_FITNESS"; state = "SAFE_CLEAR"; reasons.push("EXPECTED_TRAINING_RESPONSE"); }
    else if (personal) { action = "GENERAL_INFORMATION_ONLY"; reasons.push(n?.expectedTrainingResponse ? "CAUTION_NOT_CLEARLY_EXPECTED_RESPONSE" : "CAUTION_PERSONAL"); }
    else { action = "GENERAL_INFORMATION_ONLY"; reasons.push("CAUTION_GENERAL_KNOWLEDGE"); }
  } else if (personal && bodyStateSignals > 0 && !n?.expectedTrainingResponse && !general) {
    // personal/current body-state or event material that no named class explained: UNKNOWN is representable and never falls through
    state = "SAFETY_UNCERTAIN";
    action = "SAFE_ABSTAIN";
    reasons.push("PERSONAL_BODY_STATE_UNCLASSIFIED");
  } else {
    state = "SAFE_CLEAR";
    action = "ALLOW_NORMAL_FITNESS";
    reasons.push(n?.expectedTrainingResponse ? "EXPECTED_TRAINING_RESPONSE" : "NO_SAFETY_SIGNAL");
  }

  // classifier: escalate only
  if (input.classifierEscalates && action === "ALLOW_NORMAL_FITNESS") {
    state = "SAFETY_UNCERTAIN";
    action = personal ? "SAFE_ABSTAIN" : "GENERAL_INFORMATION_ONLY";
    reasons.push("CLASSIFIER_ESCALATION");
  }
  if (input.classifierSaysNormal && action !== "ALLOW_NORMAL_FITNESS") reasons.push("CLASSIFIER_DOWNGRADE_IGNORED");

  return { state, action, reasons };
}
