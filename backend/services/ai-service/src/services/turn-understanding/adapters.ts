/**
 * Phase 3 Batch 2 — adapters from each REAL existing turn representation into the canonical
 * UnifiedTurnUnderstanding. Pure, synchronous, deterministic functions only: no DB, no HTTP, no
 * LLM call. Each adapter uses ONLY the data its source representation already computed — it never
 * re-runs classification or asks a model "to populate both sides."
 */
import type { ConfirmationIntent } from "../confirmation-boundary";
import type { GlobalRoute, GlobalRouteResult } from "../../conversational-intelligence/global/router";
import type { PrimaryIntent, SemanticInterpretation } from "../../conversational-intelligence/schema";
import type { ContextNeed } from "../context-assembler";
import type { TurnDomain, TurnInterpretationSource, UnifiedTurnUnderstanding } from "./types";

// Shared by fromLegacyIntentKind (legacy `kind` strings) and fromGlobalRouteResult/
// fromSemanticInterpretation (workflow/workflowIntent strings) — the vocabularies genuinely
// overlap (CREATE_WORKOUT_PLAN, FIND_PT, ...), so one table, not two that could drift apart.
const WORKFLOW_OR_KIND_TO_DOMAIN: Record<string, TurnDomain> = {
  CREATE_WORKOUT_PLAN: "WORKOUT", WORKOUT_START: "WORKOUT", WORKOUT_SKIP: "WORKOUT", WORKOUT_CANCEL: "WORKOUT",
  SAVE_GENERATED_PLAN: "WORKOUT", CYCLE_COMPLETE: "WORKOUT", CYCLE_CANCEL: "WORKOUT", FIND_TRAINING_PROGRAM: "WORKOUT", PROGRAM: "WORKOUT",
  CREATE_NUTRITION_PLAN: "NUTRITION",
  PT: "PT", FIND_PT: "PT", HIRE_PT: "PT",
  CREATE_PLAN_BUNDLE: "GENERAL", CREATE_ROADMAP: "GENERAL", ROADMAP_STATUS: "GENERAL",
  ROADMAP_ADVANCE: "GENERAL", ROADMAP_REBUILD: "GENERAL", ROADMAP_ARCHIVE: "GENERAL",
  EVALUATE: "GENERAL", REVIEW: "GENERAL", SELECT: "GENERAL",
  UPDATE_GOAL: "GOAL",
};
function intentKindToDomain(kind: string | null | undefined): TurnDomain {
  if (!kind) return "UNKNOWN";
  return WORKFLOW_OR_KIND_TO_DOMAIN[kind] ?? "UNKNOWN";
}

const KIND_TO_PRIMARY_INTENT: Record<string, PrimaryIntent> = {
  CREATE_WORKOUT_PLAN: "START_WORKFLOW", CREATE_NUTRITION_PLAN: "START_WORKFLOW", CREATE_PLAN_BUNDLE: "START_WORKFLOW",
  PT: "START_WORKFLOW", PROGRAM: "START_WORKFLOW",
  SAVE_GENERATED_PLAN: "CONFIRM",
  WORKOUT_START: "START_WORKFLOW", WORKOUT_SKIP: "START_WORKFLOW", WORKOUT_CANCEL: "DISMISS",
  CYCLE_COMPLETE: "START_WORKFLOW", CYCLE_CANCEL: "DISMISS",
  ROADMAP_STATUS: "ANSWER_QUESTION", ROADMAP_ADVANCE: "START_WORKFLOW", ROADMAP_REBUILD: "START_WORKFLOW", ROADMAP_ARCHIVE: "DISMISS",
  REVIEW: "PROVIDE_INFORMATION", SELECT: "PROVIDE_INFORMATION",
  UPDATE_GOAL: "CORRECT_INFORMATION",
};
// A turn that MIGHT eventually need a HITL action proposal — never itself an executor (see
// UnifiedTurnUnderstanding.mutationIntent's own doc comment). Intentionally includes
// confirmation-shaped legacy kinds (SAVE_GENERATED_PLAN) precisely because those still route
// through the real confirmation boundary before anything persists.
const MUTATION_KINDS = new Set([
  "CREATE_WORKOUT_PLAN", "CREATE_NUTRITION_PLAN", "CREATE_PLAN_BUNDLE", "SAVE_GENERATED_PLAN", "PT", "PROGRAM",
  "WORKOUT_START", "WORKOUT_SKIP", "CYCLE_COMPLETE", "ROADMAP_ADVANCE", "ROADMAP_REBUILD", "UPDATE_GOAL",
]);

/** The path that actually governs today's real default traffic (CONVERSATIONAL_INTELLIGENCE_V2 is
 * off by default — docs/research/workout-plan-bpm/02-as-is-process.md:8-10). entities/corrections/
 * references are honestly [] — the legacy regex parser never extracts these; not fabricated. */
export function fromLegacyIntentKind(kind: string | null): UnifiedTurnUnderstanding {
  return {
    primaryIntent: kind ? (KIND_TO_PRIMARY_INTENT[kind] ?? "UNKNOWN") : "UNKNOWN",
    secondaryIntents: [],
    routeClass: { kind: "LEGACY_INTENT", intentKind: kind },
    domain: intentKindToDomain(kind),
    entities: [], corrections: [], references: [],
    confidence: kind ? 1 : 0,
    ambiguity: kind ? [] : [{ field: "intent", reason: "no legacy intent kind matched this message" }],
    interpretationSource: "DETERMINISTIC",
    mutationIntent: MUTATION_KINDS.has(kind ?? ""),
    diagnostics: {},
  };
}

/** The confirmation boundary is a special safety boundary, not a generic semantic intent (brief
 * §12) — this adapter never lets a model-generated anything bypass it; it only describes what the
 * ALREADY-anchored, already-deterministic classifyConfirmationUtterance decided. */
export function fromConfirmationBoundary(intent: ConfirmationIntent): UnifiedTurnUnderstanding {
  return {
    primaryIntent: intent === "CONFIRM" ? "CONFIRM" : "ANSWER_QUESTION",
    secondaryIntents: [],
    routeClass: { kind: "CONFIRMATION", confirmationIntent: intent },
    domain: "GENERAL",
    entities: [], corrections: [], references: [],
    confidence: 1,
    ambiguity: [],
    interpretationSource: "CONFIRMATION_BOUNDARY",
    mutationIntent: intent === "CONFIRM",
    confirmationIntent: intent,
    diagnostics: {},
  };
}

const ROUTE_TO_PRIMARY_INTENT: Record<GlobalRoute, PrimaryIntent> = {
  READ_STATE: "ANSWER_QUESTION", RECOMMEND: "ASK_RECOMMENDATION", WRITE_ACTION: "PROVIDE_INFORMATION",
  START_WORKFLOW: "START_WORKFLOW", KNOWLEDGE_QA: "ANSWER_QUESTION", SLOT_ANSWER: "PROVIDE_INFORMATION",
  CORRECTION: "CORRECT_INFORMATION", CANCEL: "DISMISS", SWITCH_WORKFLOW: "START_WORKFLOW",
  REFERENCE: "PROVIDE_INFORMATION", EXPLAIN_AND_PROPOSE: "ASK_RECOMMENDATION", NEGATE_ACTION: "DISMISS",
  MULTI: "UNKNOWN", UNKNOWN: "UNKNOWN",
};
const MUTATION_ROUTES = new Set<GlobalRoute>(["START_WORKFLOW", "WRITE_ACTION", "CORRECTION", "SWITCH_WORKFLOW", "EXPLAIN_AND_PROPOSE"]);
const TOPIC_TO_DOMAIN: Record<string, TurnDomain> = {
  PT_STATUS: "PT", CONTRACT_STATUS: "PT", HIRE_PT: "PT", PT: "PT",
  PROGRAM_STATUS: "WORKOUT", PROGRAM: "WORKOUT", SCHEDULE: "WORKOUT", SESSIONS: "WORKOUT",
  NUTRITION_TARGET: "NUTRITION", NUTRITION_PROGRAM: "NUTRITION", MEALS: "NUTRITION",
  GOAL: "GOAL", TARGET_WEIGHT: "GOAL", GOAL_CHANGE: "GOAL",
  PROFILE_FACT: "PROFILE", ROADMAP_STATUS: "GENERAL",
};
// Descriptive only (brief §19/§14) — this NEVER triggers assembleContext itself; a future
// consumer decides whether/when to actually call it. Deliberately sparse: only the clear,
// single-domain READ cases get a suggestion, everything else is left undefined.
const DOMAIN_TO_CONTEXT_NEEDS: Partial<Record<TurnDomain, ContextNeed[]>> = {
  NUTRITION: ["ACTIVE_NUTRITION_GOAL"], WORKOUT: ["CURRENT_WORKOUT_PROGRAM"], GOAL: ["FITNESS_GOAL"], PROFILE: ["PROFILE"],
};

/** Covers the CI-V2-on cross-domain READ/RECOMMEND/interruption path (global/global-turn.ts). */
export function fromGlobalRouteResult(result: GlobalRouteResult, opts: { llmInvoked: boolean } = { llmInvoked: false }): UnifiedTurnUnderstanding {
  const isMulti = result.route === "MULTI" && !!result.parts?.length;
  const primaryIntent = isMulti ? (ROUTE_TO_PRIMARY_INTENT[result.parts![0].route] ?? "UNKNOWN") : (ROUTE_TO_PRIMARY_INTENT[result.route] ?? "UNKNOWN");
  const secondaryIntents = isMulti ? result.parts!.slice(1).map((p) => ROUTE_TO_PRIMARY_INTENT[p.route] ?? "UNKNOWN") : [];
  const domain: TurnDomain = result.topic
    ? (TOPIC_TO_DOMAIN[result.topic] ?? "GENERAL")
    : result.route === "KNOWLEDGE_QA" ? "KNOWLEDGE"
    : result.workflow ? intentKindToDomain(result.workflow)
    : "UNKNOWN";
  const interpretationSource: TurnInterpretationSource = opts.llmInvoked ? "LLM_FALLBACK" : "GLOBAL_RULE";
  const needs = primaryIntent === "ANSWER_QUESTION" ? DOMAIN_TO_CONTEXT_NEEDS[domain] : undefined;
  return {
    primaryIntent, secondaryIntents,
    routeClass: { kind: "GLOBAL_ROUTE", route: result.route, topic: result.topic, workflow: result.workflow, multi: result.multi },
    domain,
    entities: [], corrections: [], references: [], // GlobalRouteResult carries no entity/correction/reference list of its own
    confidence: result.confidence,
    ambiguity: [], // no structured ambiguity array on this representation — not fabricated
    interpretationSource,
    mutationIntent: MUTATION_ROUTES.has(result.route),
    contextNeeds: needs,
    diagnostics: { reason: result.reason },
  };
}

/** Covers the CI-V2 goal-change/slot-filling path (interpreter.ts::interpretDeterministic /
 * agent-workflow/orchestrator.ts::handleSemanticTurn). Near-identity mapping — the source type
 * already IS close to the canonical shape (this is exactly why it was chosen as the canonical
 * entities/corrections/references representation, not a new one). */
export function fromSemanticInterpretation(interp: SemanticInterpretation): UnifiedTurnUnderstanding {
  const domain: TurnDomain = interp.workflowIntent ? intentKindToDomain(interp.workflowIntent) : (interp.goalSignals.length ? "GOAL" : "UNKNOWN");
  const interpretationSource: TurnInterpretationSource = interp.source === "LLM" ? "LLM_FALLBACK" : interp.source === "MERGED" ? "MERGED" : "DETERMINISTIC";
  const mutationIntent =
    interp.primaryIntent === "CONFIRM" || interp.primaryIntent === "CORRECT_INFORMATION" ||
    interp.primaryIntent === "START_WORKFLOW" || interp.primaryIntent === "REVISE_WORKFLOW" ||
    (!!interp.requestedAction && ["PROPOSE_CHANGE", "REVISE", "CONFIRM", "EXECUTE_AFTER_CONFIRM"].includes(interp.requestedAction));
  return {
    primaryIntent: interp.primaryIntent,
    secondaryIntents: [],
    routeClass: { kind: "WORKFLOW_SLOT" },
    domain,
    entities: interp.entities,
    corrections: interp.corrections,
    references: interp.references,
    requestedAction: interp.requestedAction,
    confidence: interp.confidence,
    ambiguity: interp.ambiguities,
    interpretationSource,
    mutationIntent,
    confirmationIntent: interp.primaryIntent === "CONFIRM" ? "CONFIRM" : undefined,
    diagnostics: {},
  };
}

/** Pure shadow-comparison helper (brief §23) — implemented and unit-tested, NOT wired into the
 * live dispatcher this batch (see docs/ai-product/phase3-batch2-unified-turn.md's "remaining gaps"
 * — safely exposing SemanticInterpretation out of agent-workflow/orchestrator.ts's internals would
 * need a larger, more invasive change than "observe only" justifies here). No production decision
 * may depend on this function's output. */
export function compareUnderstandings(a: UnifiedTurnUnderstanding, b: UnifiedTurnUnderstanding): { aligned: boolean; reason: string } {
  if (a.primaryIntent !== b.primaryIntent) return { aligned: false, reason: `primaryIntent differs: ${a.primaryIntent} vs ${b.primaryIntent}` };
  if (a.domain !== b.domain) return { aligned: false, reason: `domain differs: ${a.domain} vs ${b.domain}` };
  return { aligned: true, reason: "primaryIntent and domain agree" };
}
