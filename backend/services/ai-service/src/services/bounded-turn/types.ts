/**
 * Phase 3 Batch 3 (docs/ai-product/phase3-batch3-multi-intent.md) — bounded, typed turn plan.
 * Not an autonomous planner: a fixed, allowlisted shape with hard limits, built FROM the already-
 * authoritative GlobalRouteResult (CI-V2's existing MULTI classification) — this layer never
 * decides routing, it only describes what to do with a route the real dispatcher already chose.
 */
import type { ReadTopic, RecommendTopic } from "../../conversational-intelligence/global/router";

export const MAX_READS = 2;
export const MAX_RECOMMENDATIONS = 1;
// Phase 3 Batch 4 (docs/ai-product/phase3-batch4-conversational-revision.md) replaces the Batch-3
// placeholder `never` with the real, allowlisted proposal kinds that batch actually implements —
// each one a revision of an EXISTING pending draft/recommendation, never a new persisted mutation.
// "Replace an exercise in the active WorkoutProgram going forward" (permanent template swap) still
// has no safe write path (same finding, reconfirmed) and is NOT in this list.
export const MAX_PROPOSALS = 0;

/** Mirrors ReadTopic 1:1 — never a free-form {tool,args} shape. */
export type ReadOperationKind = ReadTopic;
/** Mirrors RecommendTopic 1:1. */
export type RecommendationOperationKind = RecommendTopic;
export type ProposalOperationKind =
  | "REVISE_PENDING_WORKOUT_DRAFT" | "UPDATE_PENDING_PT_SEARCH_CONSTRAINTS" | "UPDATE_PENDING_PROGRAM_SEARCH_CONSTRAINTS";

export interface ReadOperation { kind: ReadOperationKind }
export interface RecommendationOperation { kind: RecommendationOperationKind }

export type BoundedTurnHandler = "EXISTING_MULTI" | "BOUNDED_EXECUTOR" | "UNSUPPORTED";

export interface BoundedTurnPlan {
  compositionType: "SINGLE" | "READ_READ" | "READ_RECOMMEND" | "RECOMMEND_ONLY" | "UNSUPPORTED";
  reads: ReadOperation[];
  recommendation?: RecommendationOperation;
  /** Who actually handles this plan. "EXISTING_MULTI" = global-turn.ts's own MULTI composer
   * already does the right thing (zero new code runs) — most compositions land here. */
  handledBy: BoundedTurnHandler;
  supported: boolean;
  reasonUnsupported?: string;
}
