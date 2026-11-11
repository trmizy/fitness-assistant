/**
 * Phase 3 Batch 3 — the only new EXECUTABLE behavior this batch adds. Given a plan the pure
 * planner marked "BOUNDED_EXECUTOR" (today: exactly one composition — READ + RECOMMEND(PT/
 * PROGRAM)), calls the SAME, unmodified, already-exported scoring/narration primitives the
 * existing single-intent PT/PROGRAM search already uses — a second caller, never a rewrite.
 *
 * Dependency-injected (not imported from fitness-agent.service.ts) on purpose: that file exports
 * this executor's caller, so importing `fitnessAgentDeps` directly here would be circular. The
 * caller passes its own already-existing `fitnessAgentDeps` object through, which is also exactly
 * how this stays test-stubbable with the SAME convention every other test in this file already
 * uses (reassigning a property on that one shared object).
 *
 * Never creates a FitnessAgentAction — it is an inline, same-turn answer, not the start of a
 * selectable search session; a user who wants to actually act on it is pointed at the existing
 * dedicated flow. It DOES persist a `fitnessRecommendation` row (Phase 3 Batch 5 fix — see the doc
 * comment on `executeBoundedTurn` below for the demonstrated E2E defect this closes).
 */
import { randomUUID } from "node:crypto";
import { logger, scorePT, scoreTrainingProgramV2, AgentPreferencesSchema, FITNESS_SCORING, PROGRAM_SCORING_V2, type AgentPreferences, type AgentEvidence } from "@gym-coach/shared";
import { prisma } from "../../repositories/conversation.repository";
import type { AgentIdentity } from "../fitness-agent-tools";
import { readState } from "../../conversational-intelligence/global/readers";
import type { ReadTopic } from "../../conversational-intelligence/global/router";
import type { BoundedTurnPlan } from "./types";

/** The slice of fitnessAgentDeps this executor actually needs — structurally typed so the
 * caller's own `fitnessAgentDeps` object satisfies it without this file importing that module. */
export interface BoundedTurnDeps {
  tools: {
    getUserFitnessContext: (identity: AgentIdentity) => Promise<{ profile: any; coach: unknown }>;
    findPTCandidates: (identity: AgentIdentity, preferences: AgentPreferences) => Promise<{ candidates: any[] }>;
    findTrainingPrograms: (identity: AgentIdentity, preferences: AgentPreferences) => Promise<{ programs: any[] }>;
    getScientificEvidence: (goal: string) => any[];
  };
  narrateRecommendations: (ranked: any[], evidence: any[], ctx: { userId: string; goalIntent?: any }) => Promise<{ narrations: any[]; usedFallback: boolean }>;
  narrateProgramRecommendations: (ranked: any[], evidence: any[], ctx: { userId: string }) => Promise<{ narrations: any[]; usedFallback: boolean }>;
}

async function resolvePreferences(identity: AgentIdentity, deps: BoundedTurnDeps): Promise<{ context: any; preferences: AgentPreferences } | null> {
  const context = await deps.tools.getUserFitnessContext(identity);
  const parsed = AgentPreferencesSchema.safeParse({
    goal: context.profile.goal ?? undefined,
    days: context.profile.days?.length ? context.profile.days : undefined,
    sessionMinutes: context.profile.sessionMinutes,
    budgetVnd: context.profile.budgetVnd ?? undefined,
  });
  if (!parsed.success || !parsed.data.goal || !parsed.data.days?.length) return null;
  return { context, preferences: parsed.data };
}

// extractGoalIntentGrounding is a small, pure, categorical-only extractor (no numeric fields) —
// inlined here rather than imported to avoid a second import path into llm/recommendation_narrator
// purely for one helper; mirrors that module's own documented behavior exactly (narration-input
// grounding only, never informs scoring).
function extractGoalIntentGrounding(raw: unknown): { focusMuscles?: string[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const focusMuscles = (raw as { focusMuscles?: unknown }).focusMuscles;
  return Array.isArray(focusMuscles) ? { focusMuscles: focusMuscles.filter((m): m is string => typeof m === "string") } : null;
}

interface ComposedRecommendation { text: string; candidateIds: string[]; evidence: AgentEvidence[] }

async function composePtRecommendation(identity: AgentIdentity, preferences: AgentPreferences, context: any, deps: BoundedTurnDeps): Promise<ComposedRecommendation | null> {
  if (!preferences.budgetVnd) return null; // incomplete preferences — fall back, never guess a budget
  const retrieval = await deps.tools.findPTCandidates(identity, preferences).catch(() => null);
  if (!retrieval || retrieval.candidates.length === 0) return null;
  const ranked = retrieval.candidates
    .map((pt) => ({ pt, compatibility: scorePT(pt, preferences) }))
    .sort((a, b) => b.compatibility.total - a.compatibility.total || a.pt.id.localeCompare(b.pt.id))
    .slice(0, 3); // a short inline composite answer, not the full search card list
  const evidence = deps.tools.getScientificEvidence(preferences.goal!); // resolvePreferences already required goal to be set
  const goalIntent = extractGoalIntentGrounding((context.profile as { goalIntent?: unknown }).goalIntent);
  const narrationResult = await deps.narrateRecommendations(
    ranked.map((r) => ({ candidate: r.pt, compatibility: r.compatibility, history: r.pt.history })), evidence, { userId: identity.userId, goalIntent },
  ).catch((err) => { logger.warn({ err: (err as Error)?.message }, "[bounded-turn] PT narration failed; using static fallback"); return { narrations: [], usedFallback: true }; });
  const narrationById = new Map(narrationResult.narrations.map((n: any) => [n.candidateId, n]));
  const lines = ranked.map(({ pt }) => {
    const narration: any = narrationById.get(pt.id);
    const why = narration?.summary ?? "chuyên môn và lịch trống phù hợp mục tiêu hiện tại của bạn";
    return `${pt.name} (${why})`;
  });
  return {
    text: `Mình tìm thấy ${lines.length} PT phù hợp hơn: ${lines.join("; ")}. Nhắn "tìm PT cho tôi" nếu bạn muốn xem đầy đủ và chọn.`,
    candidateIds: ranked.map((r) => r.pt.id), evidence,
  };
}

async function composeProgramRecommendation(identity: AgentIdentity, preferences: AgentPreferences, context: any, deps: BoundedTurnDeps): Promise<ComposedRecommendation | null> {
  const retrieval = await deps.tools.findTrainingPrograms(identity, preferences).catch(() => null);
  if (!retrieval || retrieval.programs.length === 0) return null;
  const goalIntent = extractGoalIntentGrounding((context.profile as { goalIntent?: unknown }).goalIntent);
  const ranked = retrieval.programs
    .map((program) => ({ program, compatibility: scoreTrainingProgramV2(program, preferences, { userExperience: context.profile.experience, goalIntentFocusMuscles: goalIntent?.focusMuscles }) }))
    .sort((a, b) => b.compatibility.total - a.compatibility.total || a.program.id.localeCompare(b.program.id))
    .slice(0, 3);
  const evidence = deps.tools.getScientificEvidence(preferences.goal!); // resolvePreferences already required goal to be set
  const narrationResult = await deps.narrateProgramRecommendations(
    ranked.map((r) => ({ program: r.program, compatibility: r.compatibility })), evidence, { userId: identity.userId },
  ).catch((err) => { logger.warn({ err: (err as Error)?.message }, "[bounded-turn] program narration failed; using static fallback"); return { narrations: [], usedFallback: true }; });
  const narrationById = new Map(narrationResult.narrations.map((n: any) => [n.candidateId, n]));
  const lines = ranked.map(({ program }) => {
    const narration: any = narrationById.get(program.id);
    const why = narration?.summary ?? "phù hợp mục tiêu, trình độ và số ngày bạn tập được";
    return `${program.name} (${why})`;
  });
  return {
    text: `Mình tìm thấy ${lines.length} chương trình tập phù hợp hơn: ${lines.join("; ")}. Nhắn "tìm chương trình tập cho tôi" nếu bạn muốn xem đầy đủ và chọn.`,
    candidateIds: ranked.map((r) => r.program.id), evidence,
  };
}

/**
 * Returns null on ANY incompleteness/failure — the caller's own existing "offer to search
 * separately" text remains the safe fallback; this function never fabricates a partial answer.
 *
 * Phase 3 Batch 5 defect (found by the unified-coach E2E suite, journey 3): a PT/PROGRAM
 * recommendation that originated from THIS composite could never be revised by Batch 4's
 * revision module ("PT đầu tiên đắt quá, dưới 2 triệu thôi" / "Không thích người thứ hai"),
 * because this function never persisted a `fitnessRecommendation` row at all (Batch 3's own
 * report flagged this exact gap in §10 as a deferred "if missing, introduce the smallest scoped
 * mechanism" item). Fixed here with the smallest addition: persist the SAME shape the standalone
 * recommend flow already writes, using the SAME candidateIds order the composed text lists, so a
 * later ordinal reference ("người thứ hai") resolves to the right candidate.
 */
export async function executeBoundedTurn(plan: BoundedTurnPlan, identity: AgentIdentity, question: string, sessionId: string, deps: BoundedTurnDeps): Promise<{ answer: string; blocks: never[] } | null> {
  if (plan.handledBy !== "BOUNDED_EXECUTOR" || !plan.recommendation) return null;
  const resolved = await resolvePreferences(identity, deps).catch(() => null);
  if (!resolved) return null;
  const { context, preferences } = resolved;

  const kind = plan.recommendation.kind;
  const recommendation = kind === "PT"
    ? await composePtRecommendation(identity, preferences, context, deps).catch(() => null)
    : kind === "PROGRAM"
      ? await composeProgramRecommendation(identity, preferences, context, deps).catch(() => null)
      : null;
  if (!recommendation) return null;

  await prisma.fitnessRecommendation.create({ data: {
    id: randomUUID(), userId: identity.userId, sessionId, type: kind,
    contextSnapshot: { preferences, excludeIds: [] },
    candidateIds: recommendation.candidateIds,
    scoringVersion: kind === "PT" ? FITNESS_SCORING.version : PROGRAM_SCORING_V2.version,
    similarityVersion: FITNESS_SCORING.similarityVersion,
    evidenceIds: recommendation.evidence.map((e) => e.id), historicalJourneyIds: [],
    result: { type: kind === "PT" ? "PT_RECOMMENDATIONS" : "PROGRAM_RECOMMENDATIONS", candidates: recommendation.candidateIds.map((id) => ({ id })) },
  } }).catch((err) => { logger.warn({ err: (err as Error)?.message }, "[bounded-turn] failed to persist the composite recommendation snapshot; revision follow-ups won't find it this turn"); });

  const readTexts = (await Promise.all(plan.reads.map(async (r) => {
    const result = await readState(r.kind as ReadTopic, identity, question, { getUserFitnessContext: deps.tools.getUserFitnessContext }).catch(() => null);
    return result?.text ?? null;
  }))).filter((t): t is string => !!t);
  // Truthful partial failure (brief §20/§34): if the READ itself couldn't be answered, still
  // return the real recommendation rather than discarding the whole composite silently.
  return { answer: [...readTexts, recommendation.text].join("\n\n"), blocks: [] };
}
