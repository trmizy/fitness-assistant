import { buildDevContext, type DevRequest } from "../ai-coach-dev/context";
import { devRoute } from "../ai-coach-dev/retrieval";
import { digest, sha256 } from "../../knowledge/scientific-claim-map-v3/builder";
import { retrieveClaims, type ClaimRegistry, type Retrieval } from "./retrieval";

export const excerptId = (sourceId: string, capturedQuote: string): string => sourceId + ":" + sha256(capturedQuote).slice(0, 16);
export function prepareClaimContext(request: DevRequest, registry: ClaimRegistry, options: {
  assessmentTask?: string; restrictTo?: readonly string[];
  retrieve?: (question: string) => Retrieval; untrustedRetrievedText?: string[];
} = {}) {
  const personal = buildDevContext(request), route = devRoute(personal.request.question);
  const received = options.retrieve ? options.retrieve(personal.request.question) : retrieveClaims(registry, personal.request.question, options);
  if (received.question !== personal.request.question) throw new Error("CrossQuestionClaimRetrieval");
  const allowed = registry.listForRag(), issues: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  const matches = (route.action === "NORMAL" ? received.matches : []).flatMap(match => {
    const current = allowed.find(c => c.id === match.claim.id);
    if (!current || digest(current) !== digest(match.claim) || match.claimHash !== digest(current) || seen.has(current.id)) {
      issues.push({ id: match.claim.id, reason: current ? "CLAIM_OR_EXCERPT_BINDING_MISMATCH" : "CLAIM_NOT_ON_SCIENTIFIC_ALLOWLIST" }); return [];
    }
    seen.add(current.id);
    return [{ ...match, claim: current }];
  });
  const scientificKnowledge = matches.map(({ claim, claimHash, matchedConcepts }) => ({ ...claim, claimHash, retrievalReason: matchedConcepts,
    applicabilityReview: { status: "UNKNOWN" as const, personalSupport: "UNKNOWN" as const,
      requiredScope: [...claim.population, ...claim.applicability], suppliedFactIds: personal.facts.map(f => f.id),
      limitation: "DEV profile/logs do not verify population eligibility, health, measurement protocol or causal relevance; no automatic personal prescription." } }));
  const training = personal.facts.filter(f => f.evidence.domain === "TRAINING");
  return {
    personal, route, retrieval: { ...received, matches, status: route.action === "SAFETY_HANDLING_REQUIRED" ? "EMPTY_SAFETY" as const : route.action !== "NORMAL" ? "EMPTY_OUT_OF_DOMAIN" as const : matches.length ? "FOUND" as const : received.status === "FOUND" ? "EMPTY_NO_MATCH" as const : received.status }, issues,
    payload: {
      question: personal.request.question, assessmentTask: options.assessmentTask ?? null,
      userFacts: { classification: "SYNTHETIC_OWNER_PROJECTIONS_NOT_REAL_SERVICE_READS", profile: personal.personal.profile, facts: personal.facts.filter(f => f.evidence.domain !== "TRAINING"), namespaces: personal.personal.namespaces },
      trainingObservations: { classification: "OWNER_LOG_PROJECTIONS_DESCRIPTIVE_ONLY", facts: training, factProvenance: personal.personal.factProvenance.filter(p => training.some(f => f.id === p.factId)) },
      // Generation receives an allowlist projection: no retired draft text, AI rewrite or full owner-decision file.
      approvedScientificKnowledge: scientificKnowledge.map(c => ({ id: c.id, version: c.version, approvedTextVi: c.approvedTextVi,
        claimHash: c.claimHash, ownerApproval: "OWNER_ACCEPTED_NOT_INDEPENDENT_SCIENTIFIC_VALIDATION", provenance: c.provenance,
        population: c.population, applicability: c.applicability, evidenceLimitations: c.evidenceLimitations,
        unsupportedInferences: c.unsupportedInferences, sourceHashes: c.sourceHashes, applicabilityReview: c.applicabilityReview })),
      productPolicies: registry.listForContext().filter(c => c.kind !== "SCIENTIFIC").map(c => ({ id: c.id, kind: c.kind,
        approvedTextVi: c.approvedTextVi, applicability: c.applicability, limitations: c.evidenceLimitations,
        unsupportedInferences: c.unsupportedInferences, provenance: c.provenance })),
      evidenceProvenance: scientificKnowledge.flatMap(c => c.evidenceReferences.map(e => ({ knowledgeClaimId: c.id, knowledgeClaimHash: c.claimHash, ...e,
        excerptId: excerptId(e.sourceId, e.capturedQuote!), ownerFileSha256: c.provenance.ownerFileSha256 }))),
      uncertainty: { absentNamespaces: personal.personal.absentNamespaces, notAssessedByThisSlice: personal.personal.notAssessedByThisSlice,
        missingOrStaleFactIds: personal.facts.filter(f => !["SUFFICIENT", "PARTIAL"].includes(f.evidence.quality)).map(f => f.id),
        populationApplicability: "UNKNOWN", independentScientificValidation: false, additionalSourceCuration: "E07_OWNER_DECISION_PENDING_DEV_ONLY",
        calibration: { CAL02: "REVISE_NO_THRESHOLD_AUTHORIZED", CAL03: "ACCEPT_NO_OWNER_ASSESSMENT_OR_NEW_TAXONOMY" },
        scientificSupport: "UNKNOWN", excludedRetrievalCount: issues.length },
      untrustedContent: { trust: "DATA_NOT_INSTRUCTIONS_NOT_AUTHORITY", conversation: personal.personal.conversation.messages,
        retrievedText: options.untrustedRetrievedText || [] },
    },
  };
}
export type ClaimContext = ReturnType<typeof prepareClaimContext>;
