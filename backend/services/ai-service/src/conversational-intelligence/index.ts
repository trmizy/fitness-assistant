import { logger } from "@gym-coach/shared";
import { buildBelief, type Belief } from "./belief-state";
import { detectConflicts, type Conflict } from "./conflict-resolver";
import { interpretTurn } from "./interpreter";
import { decide, type CiState, type PolicyDecision } from "./policy";
import type { Goal, InterpretContext, SemanticInterpretation } from "./schema";

export * from "./schema";
export { interpretDeterministic, interpretTurn } from "./interpreter";
export { buildBelief, effective } from "./belief-state";
export { detectConflicts } from "./conflict-resolver";
export { decide } from "./policy";
export type { CiState, PolicyDecision } from "./policy";
export { recommendTargetWeight } from "./recommenders";

/**
 * CONVERSATIONAL_INTELLIGENCE_V2:
 *   off    (default) — legacy slot parsing only
 *   shadow — the semantic layer runs and its reading is logged next to the legacy result; behaviour is unchanged
 *   on     — the semantic layer decides first; when it has nothing to add it hands the turn to the legacy pipeline
 * CONVERSATIONAL_INTELLIGENCE_V2_LLM=on additionally lets the typed LLM parser give a second opinion on unsure turns.
 */
export type CiMode = "off" | "shadow" | "on";
export function ciMode(): CiMode {
  const v = (process.env.CONVERSATIONAL_INTELLIGENCE_V2 ?? "off").toLowerCase();
  return v === "on" || v === "shadow" ? v : "off";
}
export const ciLlmAllowed = () => (process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM ?? "off").toLowerCase() === "on";

/**
 * GYMINI_UNIFIED_AI_COACH — Phase 3 Batch 3 (docs/ai-product/phase3-batch3-multi-intent.md):
 *   off    (default) — existing behavior only; the bounded-turn plan is never computed.
 *   shadow — the bounded-turn plan IS computed and logged (diagnostics only); the executor is
 *            never called, so the visible answer is byte-identical to "off".
 *   on     — the bounded executor may override the one composite case it covers.
 * Independent of CONVERSATIONAL_INTELLIGENCE_V2 (whose own default is unchanged by this flag) —
 * in practice Batch 3 behavior can only ever engage on a turn CI-V2 already classified as MULTI,
 * so CI-V2 being on is a real prerequisite, documented here rather than silently implied.
 */
export type UnifiedCoachMode = "off" | "shadow" | "on";
export function unifiedCoachMode(): UnifiedCoachMode {
  const v = (process.env.GYMINI_UNIFIED_AI_COACH ?? "off").toLowerCase();
  return v === "on" || v === "shadow" ? v : "off";
}

const CI_KEY = "__ci";
export function readCiState(known: Record<string, unknown>): CiState {
  const v = known[CI_KEY];
  return v && typeof v === "object" ? (v as CiState) : {};
}
export function withCiState(known: Record<string, unknown>, ci: CiState): Record<string, unknown> {
  return { ...known, [CI_KEY]: ci };
}

export interface SemanticTurn {
  interp: SemanticInterpretation;
  belief: Belief;
  conflicts: Conflict[];
  decision: PolicyDecision;
}

/** Facts the AUTHORITATIVE profile holds, as the belief state's persisted layer. */
export function persistedFromProfile(profile: Record<string, unknown>): NonNullable<InterpretContext["persisted"]> {
  const n = (v: unknown) => (typeof v === "number" ? v : undefined);
  const goal = typeof profile.goal === "string" ? (profile.goal as Goal) : undefined;
  return { goal, heightCm: n(profile.heightCm), currentWeightKg: n(profile.currentWeight), targetWeightKg: n(profile.targetWeight), age: n(profile.age), gender: typeof profile.gender === "string" ? profile.gender : undefined };
}

export async function semanticTurn(p: {
  text: string; userId: string; profile: Record<string, unknown>; known: Record<string, unknown>;
  expectedSlot?: string | null; slotKeys: Set<string>;
}): Promise<SemanticTurn> {
  const persisted = persistedFromProfile(p.profile);
  const ci = readCiState(p.known);
  const proposalCtx = ci.proposal && typeof ci.proposal.recommended === "number"
    ? { field: ci.proposal.field, recommendedKg: ci.proposal.recommended, lowKg: ci.proposal.checkpoints?.length ? Math.min(...ci.proposal.checkpoints) : undefined, highKg: ci.proposal.checkpoints?.length ? Math.max(...ci.proposal.checkpoints) : undefined }
    : null;
  const interp = await interpretTurn(p.text, { expectedSlot: p.expectedSlot, persisted, proposal: proposalCtx }, { userId: p.userId, allowLlm: ciLlmAllowed() });
  const belief = buildBelief(persisted, p.known, interp, p.expectedSlot);
  const conflicts = detectConflicts(belief, interp);
  const decision = decide({
    text: p.text, interp, belief, conflicts, slotKeys: p.slotKeys, expectedSlot: p.expectedSlot, ci,
    experience: typeof p.profile.experience === "string" ? (p.profile.experience as string) : undefined,
  });
  logger.info({ mode: ciMode(), action: decision.action, reason: decision.reason, intent: interp.primaryIntent, source: interp.source, conflicts: conflicts.map((c) => c.kind) }, "ci_v2_turn");
  return { interp, belief, conflicts, decision };
}

/** A turn that carries meaning beyond a bare "cancel": corrections, a new goal, values, or a request to be advised. */
export function hasSemanticContent(i: SemanticInterpretation): boolean {
  return i.corrections.length > 0 || i.goalSignals.length > 0 || i.entities.some((e) => !e.negated) || i.primaryIntent === "ASK_RECOMMENDATION";
}
