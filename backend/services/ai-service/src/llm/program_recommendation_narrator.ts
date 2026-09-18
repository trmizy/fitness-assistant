import { z } from "zod";
import { logger, type AgentEvidence, type RecommendationNarration } from "@gym-coach/shared";
import { callLlmJson } from "./json_llm_call.util";
import {
  buildDefaultProgramSelection,
  buildProgramClaimCatalog,
  renderProgramNarrationFromClaims,
  type ProgramNarrationInputCandidate,
} from "./program_recommendation_claims";

const ENABLE_PROGRAM_RECOMMENDATION_NARRATION =
  process.env.ENABLE_PROGRAM_RECOMMENDATION_NARRATION !== "false";

// .strict() on both levels — same defense-in-depth as the PT Narrator's
// ClaimSelectionSchema (docs/recommendation-claim-catalog-design.md): an
// LLM response smuggling an extra free-form field (e.g. a "summary" string
// alongside selectedClaimIds) fails the whole batch's Zod parse rather than
// being silently accepted, so `callLlmJson` falls back to the deterministic
// default selection and the injected text never reaches a candidate.
const ProgramClaimSelectionSchema = z.object({
  selections: z.array(z.object({
    candidateId: z.string().min(1),
    selectedClaimIds: z.array(z.string().min(1)).max(8),
  }).strict()).max(10),
}).strict();

function buildPrompt(candidates: ProgramNarrationInputCandidate[], catalogs: Map<string, ReturnType<typeof buildProgramClaimCatalog>>): string {
  return [
    "You choose claim IDs for Vietnamese training-program recommendation cards.",
    "Never write user-facing prose. Never invent scores, outcomes, equipment, safety, medical, or schedule facts.",
    "Return JSON only: {\"selections\":[{\"candidateId\":\"...\",\"selectedClaimIds\":[\"...\"]}]}",
    "Pick 4-7 useful claim IDs per candidate from that candidate's own catalog.",
    JSON.stringify({
      candidates: candidates.map(c => ({
        id: c.program.id,
        name: c.program.name,
        score: c.compatibility.total,
        components: c.compatibility.components,
        availableClaimIds: catalogs.get(c.program.id)?.map(claim => ({ id: claim.id, type: claim.type })) ?? [],
      })),
    }),
  ].join("\n");
}

export async function narrateProgramRecommendations(
  candidates: ProgramNarrationInputCandidate[],
  evidence: AgentEvidence[],
  opts: { userId: string },
): Promise<{ narrations: RecommendationNarration[]; usedFallback: boolean }> {
  if (candidates.length === 0) return { narrations: [], usedFallback: false };
  const catalogs = new Map(candidates.map(c => [c.program.id, buildProgramClaimCatalog(c, evidence)]));
  if (!ENABLE_PROGRAM_RECOMMENDATION_NARRATION) {
    return {
      narrations: candidates.map(c => renderProgramNarrationFromClaims(c.program.id, catalogs.get(c.program.id) ?? [], buildDefaultProgramSelection(catalogs.get(c.program.id) ?? []))),
      usedFallback: true,
    };
  }

  const result = await callLlmJson(buildPrompt(candidates, catalogs), ProgramClaimSelectionSchema, {
    userId: opts.userId,
    phase: "program_recommendation_claim_selection",
    numPredict: 600,
    attempts: 2,
    logPrefix: "[program-recommendation-narrator]",
  }).catch(err => {
    logger.warn({ err: (err as Error)?.message, userId: opts.userId }, "[program-recommendation-narrator] LLM selection failed; using fallback");
    return null;
  });

  const selectionByCandidate = new Map((result?.selections ?? []).map(s => [s.candidateId, s.selectedClaimIds]));
  const narrations: RecommendationNarration[] = [];
  let usedFallback = false;
  for (const candidate of candidates) {
    const catalog = catalogs.get(candidate.program.id) ?? [];
    const catalogIds = new Set(catalog.map(claim => claim.id));
    const selected = (selectionByCandidate.get(candidate.program.id) ?? []).filter(id => catalogIds.has(id));
    const finalIds = selected.length ? selected : buildDefaultProgramSelection(catalog);
    if (!selected.length) usedFallback = true;
    narrations.push(renderProgramNarrationFromClaims(candidate.program.id, catalog, finalIds));
  }
  return { narrations, usedFallback };
}
