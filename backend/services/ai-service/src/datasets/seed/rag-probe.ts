/**
 * Read-only probes for the AWS DEV RAG window (M9.6-T7). Pure logic with an INJECTED store / embedder, so it is tested offline and run inside the temporary runner Lambda in AWS.
 *   probeStatus  — for every document of a prepared corpus: is its stable id PRESENT? plus the document count and the mapping of each index. Used to check counts after an ingest, to
 *                  find out what a timed-out bulk actually wrote BEFORE any retry (no blind retry), and to prove a second ingest created no duplicate.
 *   probeSearch  — real semantic retrieval: a NEW question is embedded as a `search_query` (the way V1 does) and searched in each index; returns ids, similarity, source metadata and a short
 *                  snippet, plus wall-clock timings (so a cold collection shows up as a slow first request). Nothing is written.
 * Results carry ids, counts, timings, metadata and a 160-character snippet of project dataset text — no vectors, no secrets.
 */
import type { IngestDoc } from "./rag-ingest-core";

export interface ProbeStore {
  countDocuments(index: string): Promise<number | null>;
  getDocument(index: string, id: string): Promise<{ found: boolean; id: string | null; via: string; payload: Record<string, unknown> | null }>;
  describeIndex(index: string): Promise<{ ok: boolean; dimension: number | null; error?: { status?: number; type?: string } }>;
  search(index: string, args: { vector: number[]; limit: number }): Promise<Array<{ id: string; similarity: number; payload?: Record<string, unknown> }>>;
}
export interface IndexStatus { index: string; expected: number; found: number; missingIds: string[]; count: number | null; countMatchesExpected: boolean | null; mappingOk: boolean; dimension: number | null; mappingError?: { status?: number; type?: string } }

export async function probeStatus(docs: IngestDoc[], store: ProbeStore, indexSuffix = ""): Promise<IndexStatus[]> {
  const byIndex = new Map<string, IngestDoc[]>();
  for (const d of docs) { const k = `${d.index}${indexSuffix}`; byIndex.set(k, [...(byIndex.get(k) ?? []), d]); }
  const out: IndexStatus[] = [];
  for (const [index, list] of byIndex) {
    const mapping = await store.describeIndex(index); const missing: string[] = []; let found = 0;
    if (mapping.ok) for (const d of list) { const r = await store.getDocument(index, d.id).catch(() => ({ found: false })); if (r.found) found++; else missing.push(d.id); } else missing.push(...list.map((d) => d.id));
    const count = mapping.ok ? await store.countDocuments(index) : null;
    out.push({ index, expected: list.length, found, missingIds: missing, count, countMatchesExpected: count === null ? null : count === list.length, mappingOk: mapping.ok, dimension: mapping.dimension, mappingError: mapping.error });
  }
  return out;
}

export interface SearchProbeHit { rank: number; id: string; similarity: number; title: string | null; sourceType: string | null; sourceUrl: string | null; evidenceLevel: string | null; documentId: string | null; sourceFile: string | null; snippet: string }
export interface SearchProbeIndexResult { index: string; ms: number; hits: SearchProbeHit[]; error?: { status?: number; type?: string } }
export interface SearchProbeResult { query: string; group: string; embedMs: number; perIndex: SearchProbeIndexResult[]; totalMs: number }
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);
const TITLE_KEYS = ["exerciseName", "titleVi", "title", "questionVi"], TEXT_KEYS = ["instructions", "contentVi", "content", "answerVi"];
export function toProbeHit(rank: number, h: { id: string; similarity: number; payload?: Record<string, unknown> }): SearchProbeHit {
  const p = h.payload ?? {}; const title = TITLE_KEYS.map((k) => str(p[k])).find(Boolean) ?? null; const text = TEXT_KEYS.map((k) => str(p[k])).find(Boolean) ?? "";
  return { rank, id: h.id, similarity: Number(h.similarity.toFixed(4)), title, sourceType: str(p.source_type), sourceUrl: str(p.source_url), evidenceLevel: str(p.evidence_level), documentId: str(p.document_id), sourceFile: str(p.source_file), snippet: text.replace(/\s+/g, " ").slice(0, 160) };
}
export async function probeSearch(queries: Array<{ q: string; group: string }>, indexes: string[], k: number, deps: { store: ProbeStore; embedQuery: (q: string) => Promise<number[]>; now?: () => number }): Promise<SearchProbeResult[]> {
  const now = deps.now ?? Date.now; const out: SearchProbeResult[] = [];
  for (const { q, group } of queries) {
    const t0 = now(); const e0 = now(); const vector = await deps.embedQuery(q); const embedMs = now() - e0; const perIndex: SearchProbeIndexResult[] = [];
    for (const index of indexes) {
      const s0 = now();
      try { const hits = await deps.store.search(index, { vector, limit: k }); perIndex.push({ index, ms: now() - s0, hits: hits.map((h, i) => toProbeHit(i + 1, h)) }); }
      catch (err) { const e = err as { statusCode?: number; meta?: { statusCode?: number }; message?: string }; perIndex.push({ index, ms: now() - s0, hits: [], error: { status: e?.statusCode ?? e?.meta?.statusCode, type: String(e?.message ?? "error").split(":")[0].slice(0, 60) } }); }
    }
    out.push({ query: q, group, embedMs, perIndex, totalMs: now() - t0 });
  }
  return out;
}
