import type { AgentPreferences, GoalIntent, PTCandidate, CompatibilityScore, HistoricalSummary, AgentEvidence } from "./fitness-agent";

/**
 * Formalized typed shape for what the codebase already assembles ad hoc
 * across fitness-agent.service.ts's PT/program recommendation path — see
 * docs/ai-agent-system-target-architecture.md §5 ("Typed context
 * objects") and docs/ai-agent-system-feasibility-audit.md §15 (gap
 * analysis: "Enterprise context ... Formalization only").
 *
 * This is a NAMING/TYPING exercise on top of already-real runtime data —
 * not a new data-fetching mechanism. Every field here already exists as
 * an ad hoc variable somewhere in fitness-agent.service.ts; this type
 * exists so a new consumer (the Recommendation Narrator, see
 * fitness-agent-narration.ts) has one typed contract to depend on instead
 * of reaching into orchestrator internals.
 *
 * Ownership reminder (see CLAUDE.md "Source of Truth"): every field here
 * is a READ of enterprise data owned elsewhere (user-service,
 * fitness-service). This type is never itself persisted as a row anywhere
 * — it is a request-scoped, in-memory assembly, same as it is today.
 */
export interface UserFitnessContextSummary {
  goal: string | null;
  days: number[];
  sessionMinutes: number;
  budgetVnd: number | null;
  reviewRequired: boolean;
  injuries: string[];
  equipment: string[];
}

export interface EnterpriseContext {
  /** From fitnessAgentTools.getUserFitnessContext() — already real. */
  user: UserFitnessContextSummary;
  /**
   * From the confirmed goal-image / text-goal flow (GoalIntentSchema,
   * persisted via POST /profile/agent/goal). Optional: a text-only user
   * with no confirmed visual goal has this undefined, and every consumer
   * MUST treat that as "no goal context available", never as a reason to
   * block — see docs/ai-agent-system-feasibility-audit.md §13
   * ("Do NOT make image input mandatory").
   */
  goal?: GoalIntent;
  /** From fitnessAgentTools.findPTCandidates() — unranked, eligibility-filtered. */
  ptCandidates: PTCandidate[];
  /** From fitnessAgentTools.findTrainingPrograms() — unranked, eligibility-filtered. */
  programCandidates: Array<{
    id: string; name: string; goal: string; daysPerWeek: number; durationWeeks: number;
    estimatedMinutes: number; experienceLevel: string; focusMuscles: string[];
    fingerprint: string; dataOrigin: "REAL" | "SYNTHETIC"; days: unknown[];
  }>;
  /** Request timestamp — lets a consumer detect a stale-context bug if this object is ever cached longer than one turn (it must not be). */
  generatedAt: string;
}

export interface RankedPTRecommendation {
  candidateId: string;
  compatibility: CompatibilityScore;
  history: HistoricalSummary;
  evidenceUsed: AgentEvidence[];
}

/**
 * The bounded, validated output of the (optional) Recommendation
 * Narrator — see fitness-agent-narration.ts. `narration` is undefined
 * whenever the narrator didn't run or its output failed validation; in
 * both cases the caller MUST fall back to the existing deterministic
 * why-strings, exactly as it does today. The recommendation flow must
 * remain fully functional with `narration` always undefined — the LLM is
 * additive, never required.
 */
export interface RecommendationNarration {
  candidateId: string;
  summary: string;
  strengths: string[];
  tradeoffs: string[];
  historicalEvidenceSummary?: string;
  scientificEvidenceSummary?: string;
  uncertainty: string[];
  /** Evidence ids (AgentEvidence.id) the narration actually cited — used by the validator to reject an unsupported citation. */
  evidenceRefs: string[];
}

export interface RecommendationResult {
  ranked: RankedPTRecommendation[];
  narrations: RecommendationNarration[];
  /** true whenever ANY narration was dropped by the validator and the caller fell back to template why-strings for that candidate. */
  usedNarrationFallback: boolean;
}

export function buildEnterpriseContext(input: {
  user: UserFitnessContextSummary;
  goal?: GoalIntent;
  ptCandidates: PTCandidate[];
  programCandidates: EnterpriseContext["programCandidates"];
}): EnterpriseContext {
  return { ...input, generatedAt: new Date().toISOString() };
}
