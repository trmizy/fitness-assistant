/** Explicit legacy view for D1 units. The full E2 envelope remains the candidate identity. */
import { AnalysisEnvelopeSchema } from "../ai-coach-dev/pipeline";
import { ClaimAnalysisSchema } from "./pipeline";
import { digest } from "../evaluation-kit/identity";

export function projectClaimAnalysis(candidate: unknown) {
  const full = ClaimAnalysisSchema.parse(candidate);
  const legacyView = AnalysisEnvelopeSchema.parse({ analysis: full.analysis, sourceLinks: full.sourceLinks });
  return { version: "claim-analysis-projection-v1" as const, fullCandidateHash: digest(candidate),
    legacyViewHash: digest(legacyView), legacyView, claimLinks: full.claimLinks, claimLinksHash: digest(full.claimLinks) };
}
export function analysisForLegacyChecks(candidate: unknown): unknown {
  return ClaimAnalysisSchema.safeParse(candidate).success ? projectClaimAnalysis(candidate).legacyView : candidate;
}
