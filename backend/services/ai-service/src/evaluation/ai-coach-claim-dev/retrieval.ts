import { conceptSupport, detectConcepts, normalizeText } from "../../llm/fitness-concepts";
import { devRoute } from "../ai-coach-dev/retrieval";
import { digest } from "../../knowledge/scientific-claim-map-v3/builder";
import { createClaimRegistry } from "../../knowledge/scientific-claim-map-v3/registry";
import type { ClaimV3 } from "../../knowledge/scientific-claim-map-v3/schema";

export type ClaimRegistry = ReturnType<typeof createClaimRegistry>;
export type ClaimMatch = { claim: ClaimV3; claimHash: string; matchedConcepts: string[]; lexicalOverlap: number };
export type Retrieval = {
  question: string; assessmentTask: string | null;
  status: "FOUND" | "EMPTY_NO_MATCH" | "EMPTY_UNRESOLVED" | "EMPTY_SAFETY" | "EMPTY_OUT_OF_DOMAIN";
  matches: ClaimMatch[]; excludedIds: string[];
  relevanceMethod: "EXISTING_CONCEPT_GATE_PLUS_LEXICAL_RANKING_NOT_SEMANTIC_SUPPORT";
  semanticSupport: "UNKNOWN";
};

/** Pure CPU search over E1's scientific allowlist; no corpus/network/model/vector defaults. */
export function retrieveClaims(registry: ClaimRegistry, question: string, options: { assessmentTask?: string; restrictTo?: readonly string[]; maxClaims?: number } = {}): Retrieval {
  if (!question.trim() || question.length > 3000 || (options.assessmentTask?.length || 0) > 300) throw new Error("InvalidClaimQuery");
  const maxClaims = options.maxClaims ?? 6;
  if (!Number.isInteger(maxClaims) || maxClaims < 1 || maxClaims > 6) throw new Error("InvalidClaimLimit");
  const pool = registry.listForRag(), ids = new Set(pool.map(c => c.id));
  const base = { question, assessmentTask: options.assessmentTask ?? null, matches: [] as ClaimMatch[],
    excludedIds: (options.restrictTo || []).filter(id => !ids.has(id)),
    relevanceMethod: "EXISTING_CONCEPT_GATE_PLUS_LEXICAL_RANKING_NOT_SEMANTIC_SUPPORT" as const, semanticSupport: "UNKNOWN" as const };
  const route = devRoute(question);
  if (route.action === "SAFETY_HANDLING_REQUIRED") return { ...base, status: "EMPTY_SAFETY" };
  if (route.action === "OUT_OF_DOMAIN_HANDLING_REQUIRED") return { ...base, status: "EMPTY_OUT_OF_DOMAIN" };
  const query = question + " " + (options.assessmentTask || ""), detection = detectConcepts(query);
  if (!detection.concepts.length) return { ...base, status: "EMPTY_UNRESOLVED" };
  const queryWords = new Set(normalizeText(query).trim().split(" ").filter(t => t.length >= 3));
  // Retain all explicit topics (e.g. tempo AND failure), rather than letting programming hide tempo.
  const specific = detection.concepts.filter(c => !["strength", "hypertrophy"].includes(c.id));
  const concepts = specific.length ? specific : detection.concepts;
  const matches = pool.filter(c => !options.restrictTo || options.restrictTo.includes(c.id)).flatMap(claim => {
    const text = normalizeText([claim.approvedTextVi, ...claim.evidenceReferences.map(e => e.capturedQuote)].join(" "));
    const approvedTopics = new Set(detectConcepts(claim.approvedTextVi!).concepts.map(c => c.id));
    const support = conceptSupport(text, concepts, { vietnamese: true });
    // A word in an excerpt is insufficient: organ "volumes" cannot stand in for training volume.
    const shared = support.supported.filter(c => approvedTopics.has(c.id));
    if (!shared.length) return [];
    const words = new Set(text.trim().split(" "));
    return [{ claim, claimHash: digest(claim), matchedConcepts: shared.map(c => c.id), lexicalOverlap: [...queryWords].filter(w => words.has(w)).length }];
  }).sort((a, b) => b.matchedConcepts.length - a.matchedConcepts.length || b.lexicalOverlap - a.lexicalOverlap || a.claim.id.localeCompare(b.claim.id)).slice(0, maxClaims);
  return { ...base, matches, status: matches.length ? "FOUND" : "EMPTY_NO_MATCH" };
}
