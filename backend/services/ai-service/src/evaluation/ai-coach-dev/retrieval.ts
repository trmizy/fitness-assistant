/** CPU fixture IO plus production V2 selection; exact excerpt identity is retained. */
import { z } from "zod";
import { retrieveV2, contentTerms, type V2Io, type V2Trace } from "../../llm/retrieval-v2";
import { buildKnowledgeSource, type RetrievedKnowledgeSource } from "../../llm/knowledge-source";
import { detectConcepts, conceptSupport, normalizeText } from "../../llm/fitness-concepts";
import { resolveSafetySignals } from "../../llm/safety-signals";
import { safetyGuard } from "../../llm/safety_guard";
import { EvidencePackSchema, type Source } from "../advisory-progress/experiment";
import { resolveExcerptSources } from "../advisory-progress/source-ablation-v3";

type SyntheticSource = Omit<Source, "sourceClass"> & { sourceClass: "SYNTHETIC_TEST_EXCERPT" };
export type Passage = { source: Source | SyntheticSource; excerpts: { id: string; text: string; locator: string; authorship?: "ORIGINAL_SCIENTIFIC_EXCERPT" | "ASSISTANT_SYNTHETIC_TEST" }[] };
const SupplementSchema = z.object({
  version: z.literal("dev-retrieval-supplement-v1"), authority: z.literal("IMPLEMENTER_DEV_ONLY_NOT_SCIENTIFIC_REVIEW"), basePackUnmodified: z.string(),
  scientificExcerptRolesEvaluationOnly: z.array(z.object({ sourceId: z.string(), excerptId: z.string(), roles: z.array(z.string()) }).strict()),
  syntheticDistractors: z.array(z.object({ id: z.string().regex(/^SYNTH_/), title: z.string(), text: z.string() }).strict()), limitations: z.array(z.string()),
}).strict();
export function scientificSources(corpus: Passage[]): Source[] {
  return corpus.flatMap((p) => p.source.sourceClass === "CURATED_EVIDENCE" ? [p.source] : []);
}
export function prepareCorpus(packValue: unknown, mapValue: unknown, supplementValue?: unknown): Passage[] {
  const pack = EvidencePackSchema.parse(packValue);
  const corpus: Passage[] = resolveExcerptSources(pack, mapValue).map((s) => ({ source: pack.sources.find((p) => p.id === s.id)!, excerpts: s.excerpts.map((e) => ({ ...e, authorship: "ORIGINAL_SCIENTIFIC_EXCERPT" as const })) }));
  if (supplementValue !== undefined) {
    const supplement = SupplementSchema.parse(supplementValue);
    for (const role of supplement.scientificExcerptRolesEvaluationOnly) if (!corpus.some((p) => p.source.id === role.sourceId && p.excerpts.some((e) => e.id === role.excerptId))) throw new Error("UnknownSupplementExcerpt");
    for (const d of supplement.syntheticDistractors) corpus.push({
      source: { id: d.id, sourceClass: "SYNTHETIC_TEST_EXCERPT", title: d.title, year: 0, doi: "", url: "https://example.invalid/dev/" + d.id,
        evidenceLevel: "synthetic_test_not_science", originalExcerpt: d.text, locator: "Assistant-authored fixture", supportedSummaryVi: "",
        applicability: "Not applicable to people", limitations: "Deliberately fictional distractor", checkedAt: "2026-11-01", checkedBy: "assistant", reviewScope: "No scientific review", humanReviewed: false },
      excerpts: [{ id: d.id + "_E1", text: d.text, locator: "Assistant-authored fixture", authorship: "ASSISTANT_SYNTHETIC_TEST" }],
    });
  }
  const ids = corpus.flatMap((p) => [p.source.id, ...p.excerpts.map((e) => e.id)]);
  if (new Set(ids).size !== ids.length) throw new Error("DuplicateCorpusIdentity");
  return corpus;
}
const pointId = (source: string, excerpt: string) => source + "::" + excerpt;
export function createFixtureIo(corpus: Passage[]) {
  const queries: string[] = []; let searches = 0;
  const io: V2Io = {
    async embed(text) { queries.push(text); return [queries.length - 1]; },
    async search(collection, vector, limit) {
      searches++;
      if (collection !== "fitness_evidence") return [];
      const query = queries[vector[0]] ?? "", terms = contentTerms(query);
      return corpus.flatMap((p) => p.excerpts.map((e) => {
        const words = new Set(contentTerms(e.text)); // title cannot make unrelated excerpt relevant
        const hits = terms.filter((t) => words.has(t)).length;
        return { id: pointId(p.source.id, e.id), similarity: hits ? 0.7 + 0.25 * hits / Math.max(terms.length, 1) : 0,
          payload: { document_id: p.source.id, chunk_id: e.id, title: p.source.title, content: e.text,
            source_type: p.source.sourceClass === "CURATED_EVIDENCE" ? "paper" : "synthetic_test", evidence_level: p.source.sourceClass === "CURATED_EVIDENCE" ? p.source.evidenceLevel : "unknown",
            source_url: p.source.url, published_year: p.source.year } };
      })).filter((h) => h.similarity > 0).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
    },
    toDoc(collection, payload, score, id) {
      return { id, source: collection, category: "dev-retrieval", score, pageContent: String(payload.content),
        metadata: { source_file: "DEV_LOCAL_REGISTRY", chunk_id: String(payload.chunk_id), knowledgeSource: buildKnowledgeSource(collection, payload, id) } };
    },
  };
  return { io, queries, counters: () => ({ fixtureSearches: searches, modelCalls: 0, vectorDbCalls: 0 }) };
}
export type RetrievalStatus = "FOUND" | "EMPTY_NO_MATCH" | "EMPTY_UNRESOLVED" | "EMPTY_OUT_OF_DOMAIN" | "EMPTY_SAFETY" | "UNAVAILABLE" | "DISABLED";
export type RetrievedEvidence = {
  status: RetrievalStatus; question: string; passages: Passage[]; trace: V2Trace | null;
  relevance: "V2_TOPIC_GATE_NOT_CLAIM_SUPPORT"; applicability: "REQUIRES_PERSONAL_CONTEXT_REVIEW"; claimSupport: "NOT_EVALUATED";
};
export function devRoute(question: string) {
  const signals = resolveSafetySignals(question), guard = safetyGuard.check(question), det = detectConcepts(question);
  const safety = signals.level !== "NONE" || det.safety || !["safe", "off_topic"].includes(guard.type);
  return { action: safety ? "SAFETY_HANDLING_REQUIRED" as const : "NORMAL" as const,
    disposition: safety ? "HANDOFF_TO_EXISTING_SAFETY_FLOW" as const : null,
    safetyLevel: signals.level, policyType: guard.type, finalSafetyAction: signals.finalSafetyAction ?? null };
}
export async function retrieveDevEvidence(question: string, corpus: Passage[], io: V2Io): Promise<RetrievedEvidence> {
  const base = { question, relevance: "V2_TOPIC_GATE_NOT_CLAIM_SUPPORT" as const, applicability: "REQUIRES_PERSONAL_CONTEXT_REVIEW" as const, claimSupport: "NOT_EVALUATED" as const };
  const det = detectConcepts(question), route = devRoute(question);
  if (route.action === "SAFETY_HANDLING_REQUIRED") return { ...base, status: "EMPTY_SAFETY", passages: [], trace: null };
  if (route.policyType === "off_topic" || det.status === "OUT_OF_DOMAIN") return { ...base, status: "EMPTY_OUT_OF_DOMAIN", passages: [], trace: null };
  if (["UNRESOLVED", "AMBIGUOUS"].includes(det.status)) return { ...base, status: "EMPTY_UNRESOLVED", passages: [], trace: null };
  let searchFailed = false;
  const guardedIo: V2Io = { ...io, async search(...args) { try { return await io.search(...args); } catch (e) { searchFailed = true; throw e; } } };
  try {
    const result = await retrieveV2(question, guardedIo);
    const passages = corpus.flatMap((p) => {
      if (p.source.sourceClass !== "CURATED_EVIDENCE") return [];
      const excerpts = p.excerpts.filter((e) => result.documents.some((d) => {
        const source = d.metadata.knowledgeSource as RetrievedKnowledgeSource | undefined;
        return d.id === pointId(p.source.id, e.id) && source?.sourceClass === "CURATED_EVIDENCE" && source.sourceId === p.source.id;
      }) && conceptSupport(normalizeText(e.text), det.concepts, { vietnamese: false }).supported.length > 0);
      return excerpts.length ? [{ source: p.source, excerpts }] : [];
    });
    return { ...base, status: searchFailed ? "UNAVAILABLE" : passages.length ? "FOUND" : "EMPTY_NO_MATCH", passages: searchFailed ? [] : passages, trace: result.trace };
  } catch { return { ...base, status: "UNAVAILABLE", passages: [], trace: null }; }
}
export function selectedSources(evidence: RetrievedEvidence): Source[] {
  return scientificSources(evidence.passages).map((s) => ({ ...s,
    originalExcerpt: evidence.passages.find((p) => p.source.id === s.id)!.excerpts.map((e) => e.text).join("\n"), supportedSummaryVi: "" }));
}
