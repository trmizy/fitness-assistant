/**
 * Phase 3 Batch 2 (docs/ai-product/phase3-batch2-unified-turn.md) — the canonical, read-only
 * description of "what did this turn mean and which mechanism decided it," for observability and
 * future orchestration. This is NOT a router: nothing here picks a route, starts a workflow, or
 * authorizes a mutation. It is constructed AFTER the existing, hardened dispatch chain
 * (confirmation boundary -> global CI route -> workflow slot orchestration -> legacy kind
 * dispatch) has already decided, from whichever raw representation that chain actually produced.
 *
 * Every field type is reused verbatim from its real source — see the mapping table in the
 * accompanying doc. Nothing here is a fabricated or guessed shape.
 */
import type { ConfirmationIntent } from "../confirmation-boundary";
import type { GlobalRoute, ReadTopic, RecommendTopic } from "../../conversational-intelligence/global/router";
import type {
  PrimaryIntent, RequestedAction, SemanticEntity, SemanticCorrection, SemanticReference, SemanticAmbiguity,
} from "../../conversational-intelligence/schema";
import type { ContextNeed } from "../context-assembler";

export type TurnDomain = "WORKOUT" | "NUTRITION" | "PT" | "PROFILE" | "GOAL" | "KNOWLEDGE" | "GENERAL" | "UNKNOWN";

/** "MERGED" added to the brief's own suggested list — SemanticInterpretation.source really has this
 * third value today; dropping it would be a real information loss, not a simplification. */
export type TurnInterpretationSource =
  | "DETERMINISTIC" | "GLOBAL_RULE" | "WORKFLOW_SLOT" | "LLM_FALLBACK"
  | "CONFIRMATION_BOUNDARY" | "LEGACY_SPECIALIST" | "MERGED" | "UNKNOWN";

/** Which raw mechanism actually governed this turn — preserved verbatim, never re-derived. */
export type TurnRouteClass =
  | { kind: "CONFIRMATION"; confirmationIntent: ConfirmationIntent }
  | { kind: "GLOBAL_ROUTE"; route: GlobalRoute; topic?: ReadTopic | RecommendTopic | "GOAL_CHANGE"; workflow?: string; multi?: GlobalRoute[] }
  | { kind: "LEGACY_INTENT"; intentKind: string | null }
  | { kind: "WORKFLOW_SLOT" }
  | { kind: "UNKNOWN" };

export interface UnifiedTurnUnderstanding {
  /** schema.ts's existing 9-value PrimaryIntent enum, reused as-is — not a new overloaded enum. */
  primaryIntent: PrimaryIntent;
  /** Only ever populated from an existing GlobalRouteResult.parts (MULTI) — never invented. Batch 3's
   * bounded multi-intent orchestration is the first thing allowed to ACT on more than the primary one. */
  secondaryIntents: PrimaryIntent[];
  routeClass: TurnRouteClass;
  domain: TurnDomain;
  entities: SemanticEntity[];
  corrections: SemanticCorrection[];
  references: SemanticReference[];
  requestedAction?: RequestedAction;
  confidence: number;
  ambiguity: SemanticAmbiguity[];
  interpretationSource: TurnInterpretationSource;
  /** Never an authorization to execute — see confirmationIntent/the existing confirmation boundary,
   * which alone decides whether a write may happen. This only flags "this turn may eventually need
   * a HITL action proposal," for future diagnostics. */
  mutationIntent: boolean;
  confirmationIntent?: ConfirmationIntent;
  /** Descriptive only (Batch 1's ContextNeed, reused) — constructing this NEVER triggers a fetch. */
  contextNeeds?: ContextNeed[];
  diagnostics: { reason?: string; conflictsWith?: string };
}
