/** Reuses production V2 selection logic; injected fixture IO has no network or model. */
import { retrieveV2, contentTerms, type V2Io, type V2Trace } from "../../llm/retrieval-v2";
import { buildKnowledgeSource, type RetrievedKnowledgeSource } from "../../llm/knowledge-source";
import { EvidencePackSchema, type Source } from "../advisory-progress/experiment";
import { resolveExcerptSources } from "../advisory-progress/source-ablation-v3";

export type Passage = { source: Source; excerpts: { id: string; text: string; locator: string }[] };
export function prepareCorpus(packValue: unknown, mapValue: unknown): Passage[] {
  const pack = EvidencePackSchema.parse(packValue);
  return resolveExcerptSources(pack, mapValue).map((s) => ({ source: pack.sources.find((p) => p.id === s.id)!, excerpts: s.excerpts }));
}

export function createFixtureIo(corpus: Passage[]) {
  const queries: string[] = [];
  let searches = 0;
  const io: V2Io = {
    async embed(text) { queries.push(text); return [queries.length - 1]; }, // opaque query handle, NOT embeddings
    async search(collection, vector, limit) {
      searches++;
      if (collection !== "fitness_evidence") return [];
      const terms = contentTerms(queries[vector[0]] ?? "");
      return corpus.map((p) => {
        const content = p.excerpts.map((e) => e.text).join("\n");
        const words = new Set(contentTerms(p.source.title + " " + content));
        const hits = terms.filter((t) => words.has(t)).length;
        return { id: p.source.id, similarity: hits ? 0.7 + 0.25 * hits / Math.max(terms.length, 1) : 0,
          payload: { document_id: p.source.id, title: p.source.title, content, source_type: "paper", evidence_level: p.source.evidenceLevel, source_url: p.source.url, published_year: p.source.year } };
      }).filter((h) => h.similarity > 0).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
    },
    toDoc(collection, payload, score, id) {
      return { id, source: collection, category: "scientific-evidence", score, pageContent: String(payload.content), metadata: { source_file: "DEV_LOCAL_REGISTRY", chunk_id: id, knowledgeSource: buildKnowledgeSource(collection, payload, id) } };
    },
  };
  return { io, queries, counters: () => ({ fixtureSearches: searches, modelCalls: 0, vectorDbCalls: 0 }) };
}

export type RetrievedEvidence = {
  status: "FOUND" | "EMPTY" | "UNAVAILABLE" | "DISABLED";
  question: string; passages: Passage[]; trace: V2Trace | null;
  relevance: "V2_TOPIC_GATE_NOT_CLAIM_SUPPORT";
  applicability: "REQUIRES_PERSONAL_CONTEXT_REVIEW";
  claimSupport: "NOT_EVALUATED";
};
export async function retrieveDevEvidence(question: string, corpus: Passage[], io: V2Io): Promise<RetrievedEvidence> {
  const base = { question, relevance: "V2_TOPIC_GATE_NOT_CLAIM_SUPPORT" as const, applicability: "REQUIRES_PERSONAL_CONTEXT_REVIEW" as const, claimSupport: "NOT_EVALUATED" as const };
  // V2 intentionally catches per-search failures; track them here so outages aren't labelled absence.
  let searchFailed = false;
  const guardedIo: V2Io = { ...io, async search(...args) { try { return await io.search(...args); } catch (e) { searchFailed = true; throw e; } } };
  try {
    const result = await retrieveV2(question, guardedIo);
    const passages = corpus.filter((p) => result.documents.some((d) => {
      const source = d.metadata.knowledgeSource as RetrievedKnowledgeSource | undefined;
      return source?.sourceClass === "CURATED_EVIDENCE" && source.sourceId === p.source.id;
    }));
    // No partial evidence survives an IO failure. Registry, not arbitrary search metadata, owns quotes.
    return { ...base, status: searchFailed ? "UNAVAILABLE" : passages.length ? "FOUND" : "EMPTY", passages: searchFailed ? [] : passages, trace: result.trace };
  } catch { return { ...base, status: "UNAVAILABLE", passages: [], trace: null }; }
}

/** V3 compatibility input: only selected quotes, never the full pack's unused summaries. */
export function selectedSources(evidence: RetrievedEvidence): Source[] {
  return evidence.passages.map((p) => ({ ...p.source, originalExcerpt: p.excerpts.map((e) => e.text).join("\n"), supportedSummaryVi: "" }));
}
