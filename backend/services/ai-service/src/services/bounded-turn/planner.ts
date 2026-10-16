/**
 * Phase 3 Batch 3 — pure, synchronous bounded-turn planner. Zero I/O, zero LLM calls, zero DB
 * access — it only looks at a GlobalRouteResult the real dispatcher (global-turn.ts) already
 * produced and decides which existing mechanism should handle it. It never classifies text
 * itself and never re-derives a route — classifyGlobal/global-turn.ts remain the sole routing
 * authority (brief §4).
 */
import type { GlobalRouteResult } from "../../conversational-intelligence/global/router";
import {
  MAX_READS, MAX_RECOMMENDATIONS,
  type BoundedTurnPlan, type BoundedTurnHandler, type ReadOperation, type RecommendationOperation,
  type ReadOperationKind, type RecommendationOperationKind,
} from "./types";

const PT_OR_PROGRAM_RECOMMEND = new Set<string>(["PT", "PROGRAM"]);

export function planBoundedTurn(route: GlobalRouteResult): BoundedTurnPlan {
  if (route.route !== "MULTI" || !route.parts?.length) {
    // Not a compound turn at all — the existing single-clause dispatch already owns it entirely.
    return { compositionType: "SINGLE", reads: [], handledBy: "EXISTING_MULTI", supported: true };
  }

  const parts = route.parts;
  const reads: ReadOperation[] = parts
    .filter((p) => p.route === "READ_STATE" && p.topic)
    .map((p) => ({ kind: p.topic as ReadOperationKind }));
  const recommendParts = parts.filter((p) => p.route === "RECOMMEND" && p.topic);

  if (reads.length > MAX_READS || recommendParts.length > MAX_RECOMMENDATIONS) {
    return {
      compositionType: "UNSUPPORTED", reads, handledBy: "UNSUPPORTED", supported: false,
      reasonUnsupported: `exceeds bounded limits (reads=${reads.length}/${MAX_READS}, recommendations=${recommendParts.length}/${MAX_RECOMMENDATIONS}) — left to the existing MULTI composer's own graceful degradation`,
    };
  }

  const recommendation: RecommendationOperation | undefined = recommendParts[0]?.topic
    ? { kind: recommendParts[0].topic as RecommendationOperationKind }
    : undefined;
  const isPtOrProgramRecommend = !!recommendation && PT_OR_PROGRAM_RECOMMEND.has(recommendation.kind);

  let compositionType: BoundedTurnPlan["compositionType"];
  if (reads.length > 0 && recommendation) compositionType = "READ_RECOMMEND";
  else if (reads.length >= 2) compositionType = "READ_READ";
  else if (recommendation) compositionType = "RECOMMEND_ONLY";
  else compositionType = "SINGLE";

  // The one real gap this batch closes (docs/ai-product/phase3-batch3-multi-intent.md): every
  // other composition already works via global-turn.ts's own MULTI composer — only a
  // READ + RECOMMEND(PT/PROGRAM) composite was previously reduced to an "offer to search
  // separately" instead of a real inline recommendation.
  const handledBy: BoundedTurnHandler = isPtOrProgramRecommend && reads.length >= 1 ? "BOUNDED_EXECUTOR" : "EXISTING_MULTI";

  return { compositionType, reads, recommendation, handledBy, supported: true };
}
