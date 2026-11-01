/** Independent review packet, not a second model or a semantic pass heuristic. */
import type { AdvisoryInput } from "../advisory-progress/experiment";
import type { AnalysisEnvelope } from "./pipeline";
import type { RetrievedEvidence } from "./retrieval";

export function prepareSemanticReview(input: AdvisoryInput, evidence: RetrievedEvidence, envelope: AnalysisEnvelope | null, raw: unknown) {
  return {
    status: "PENDING_INDEPENDENT_REVIEW" as const, scientificPass: null,
    scope: ["claim_excerpt_entailment", "personal_applicability", "alternative_explanations", "rationale", "usefulness"],
    question: input.question,
    availablePersonalFacts: input.facts,
    legacyOrInvalidCandidateForReview: envelope ? null : raw,
    claims: envelope?.analysis.claims.map((claim, claimIndex) => ({
      claimIndex, claim,
      referencedFacts: input.facts.filter((f) => claim.factIds.includes(f.id)),
      citedExcerpts: envelope.sourceLinks.filter((l) => l.claimIndex === claimIndex).flatMap((l) => {
        const passage = evidence.passages.find((p) => p.source.id === l.sourceId);
        return passage ? passage.excerpts.filter((e) => l.excerptIds.includes(e.id)).map((e) => ({ sourceId: passage.source.id, originalScientificExcerpt: e,
          sourceMetadata: { title: passage.source.title, doi: passage.source.doi, url: passage.source.url },
          assistantAuthoredInterpretation: { applicability: passage.source.applicability, limitations: passage.source.limitations, humanReviewed: passage.source.humanReviewed } })) : [];
      }),
      // Excerpt identity and retrieval relevance alone can never set these labels.
      sourceSupport: null, factSupport: null, personalApplicability: null, reviewerRationale: null,
    })) ?? [],
    otherSurfaces: envelope ? { conclusion: envelope.analysis.rationaleSummary, assessment: envelope.analysis.assessment, missingInformation: envelope.analysis.missingInformation } : null,
    rubric: {
      sourceSupport: ["SUPPORTED", "PARTIAL", "UNSUPPORTED", "NOT_APPLICABLE"],
      factSupport: ["SUPPORTED", "CONTRADICTED", "NOT_ESTABLISHED", "NOT_APPLICABLE"],
      personalApplicability: ["ESTABLISHED", "CONDITIONAL", "NOT_ESTABLISHED", "NOT_APPLICABLE"],
      requirement: "Reviewer must inspect exact quotes and scope, all personal claims and conclusion, identify missing alternative explanations, and provide rationale. No source citation is a correctness vote.",
    },
  };
}
