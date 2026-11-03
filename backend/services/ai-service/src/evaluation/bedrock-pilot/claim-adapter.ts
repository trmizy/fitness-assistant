/** E2 preparation/verification adapter. CPU only; no provider, vector or database defaults. */
import { prepareClaimContext, excerptId, type ClaimContext } from "../ai-coach-claim-dev/context";
import { buildClaimPrompt, gateInput, verifyClaimAnalysis } from "../ai-coach-claim-dev/pipeline";
import { retrieveClaims, type ClaimRegistry } from "../ai-coach-claim-dev/retrieval";
import type { DevRequest } from "../ai-coach-dev/context";
import type { Arm, PolicyVariant } from "../ai-coach-dev/pipeline";
import type { Passage } from "../ai-coach-dev/retrieval";

export function prepareClaimPilot(request: DevRequest, registry: ClaimRegistry, arm: Arm, policy: PolicyVariant) {
  if (!["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"].includes(arm) || policy !== "MINIMAL") throw new Error("UnsupportedClaimPilotDesign");
  // Bounded warmup policy: preserve complete scope/excerpts for two ranked claims; never raise the token cap.
  const context = prepareClaimContext(request, registry, arm === "LAYERED_CONTEXT" ? { restrictTo: [] } : {
    retrieve: question => retrieveClaims(registry, question, { maxClaims: 2 }),
  });
  const input = gateInput(context), prompt = buildClaimPrompt(context);
  const passages: Passage[] = input.sources.map(source => ({ source: { ...source,
    applicability: context.retrieval.matches.filter(m => m.claim.evidenceReferences.some(e => e.sourceId === source.id))
      .map(m => `[${m.claim.id}] ${[...m.claim.population, ...m.claim.applicability].join("; ")}`).join("\n"),
    limitations: context.retrieval.matches.filter(m => m.claim.evidenceReferences.some(e => e.sourceId === source.id))
      .map(m => `[${m.claim.id}] ${[...m.claim.evidenceLimitations, ...m.claim.unsupportedInferences].join("; ")}`).join("\n"),
  }, excerpts: context.retrieval.matches.flatMap(m => m.claim.evidenceReferences)
    .filter(e => e.kind === "PRIMARY_SCIENTIFIC" && e.sourceId === source.id)
    .map(e => ({ id: excerptId(e.sourceId, e.capturedQuote!), text: e.capturedQuote!, locator: e.locator, authorship: "ORIGINAL_SCIENTIFIC_EXCERPT" as const }))
    .filter((e, i, all) => all.findIndex(p => p.id === e.id) === i) }));
  return { prompt, input, evidence: { passages }, claimContext: context, safetyHandling: context.route };
}

export function verifyClaimPilot(context: ClaimContext, candidate: unknown) {
  const e2 = verifyClaimAnalysis(context, candidate);
  return { blocked: e2.release === "BLOCKED", scientificPass: null, generationCalls: 0,
    blockerScopes: {
      structuredInvariant: e2.grounding.contentIssues.filter(i => i.severity === "HARD" && i.scope === "STRUCTURED_INVARIANT"),
      narrowTextHeuristic: e2.grounding.contentIssues.filter(i => i.severity === "HARD" && i.scope === "NARROW_TEXT_HEURISTIC"),
    }, e2 };
}
