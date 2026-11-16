/**
 * One-document AWS canary (M9.6-T6). Pure logic with an INJECTED store and embedder — the AWS window runs it inside a temporary runner Lambda, the tests run it against in-memory fakes.
 * It proves, step by step and stopping at the FIRST failure (so a failed canary can never lead into the full ingest):
 *   1 mapping accepted    ensureIndex creates `<index>_canary`; describeIndex reads back what the collection accepted (dimension / method / space type / knn)
 *   2 embedding           ONE embed call (Cohere multilingual v3 in AWS); the vector must be 1024-dimensional
 *   3 custom id + bulk    store.upsert (the pipeline's real path: a `bulk` index action with `_id`) writes revision 1
 *   4 searchable          bounded poll (NextGen refresh_interval is ~5 s; no fixed sleep is assumed) until count == 1 and the id is retrievable
 *   5 vector retrieval    knn search with the document's own vector: top hit must be the stable id
 *   6 metadata            the stored payload carries the source key, hash and revision
 *   7 re-upsert           the SAME id again with revision 2 and a changed payload field (the vector is reused: no second embedding call)
 *   8 idempotent          count is still 1, the document now shows revision 2, the vector search still returns the same single id
 * Nothing here logs or returns the document text or the vector; only ids, counts, status codes, timings.
 */
import type { IngestDoc } from "./rag-ingest-core";

export interface CanaryStore {
  ensureIndex(index: string, size?: number): Promise<{ size: number; created: boolean }>;
  upsert(index: string, points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>): Promise<void>;
  search(index: string, args: { vector: number[]; limit: number }): Promise<Array<{ id: string; similarity: number }>>;
  countDocuments(index: string): Promise<number | null>;
  describeIndex(index: string): Promise<{ ok: boolean; dimension: number | null; vector: unknown; knn: unknown; error?: { status?: number; type?: string } }>;
  getDocument(index: string, id: string): Promise<{ found: boolean; id: string | null; via: "get" | "search" | "none"; payload: Record<string, unknown> | null }>;
}
export interface CanaryDeps { store: CanaryStore; embed: (texts: string[]) => Promise<number[][]>; sleep?: (ms: number) => Promise<void>; now?: () => number; dimension?: number; pollIntervalMs?: number; pollMaxMs?: number }
export interface CanaryStep { step: string; ok: boolean; ms: number; detail?: Record<string, unknown>; error?: { status?: number; type?: string; message?: string } }
export interface CanaryResult { ok: boolean; index: string; documentId: string; documentKey: string; embedCalls: number; steps: CanaryStep[]; failedStep: string | null; totalMs: number }

const safeError = (err: unknown): CanaryStep["error"] => { const e = err as { statusCode?: number; meta?: { statusCode?: number }; message?: string }; return { status: e?.statusCode ?? e?.meta?.statusCode, type: String(e?.message ?? "error").split(":")[0].slice(0, 80) }; };

export async function runCanary(doc: IngestDoc, indexSuffix: string, deps: CanaryDeps): Promise<CanaryResult> {
  const { store, embed } = deps; const dimension = deps.dimension ?? 1024; const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))); const now = deps.now ?? Date.now;
  const interval = deps.pollIntervalMs ?? 2000, maxWait = deps.pollMaxMs ?? 60_000;
  const index = `${doc.index}${indexSuffix}`; const steps: CanaryStep[] = []; const t0 = now(); let embedCalls = 0;
  const result = (failed: string | null): CanaryResult => ({ ok: failed === null, index, documentId: doc.id, documentKey: doc.key, embedCalls, steps, failedStep: failed, totalMs: now() - t0 });
  /** runs one step; a throw or `ok:false` ends the canary at this step */
  const step = async (name: string, fn: () => Promise<{ ok: boolean; detail?: Record<string, unknown> }>): Promise<boolean> => {
    const s0 = now();
    try { const r = await fn(); steps.push({ step: name, ok: r.ok, ms: now() - s0, detail: r.detail }); return r.ok; }
    catch (err) { steps.push({ step: name, ok: false, ms: now() - s0, error: safeError(err) }); return false; }
  };
  const poll = async (probe: () => Promise<boolean>): Promise<{ ok: boolean; waitedMs: number; attempts: number }> => {
    const p0 = now(); let attempts = 0;
    for (;;) { attempts++; if (await probe().catch(() => false)) return { ok: true, waitedMs: now() - p0, attempts }; if (now() - p0 >= maxWait) return { ok: false, waitedMs: now() - p0, attempts }; await sleep(interval); }
  };
  let vector: number[] = [];

  if (!(await step("mapping_accepted", async () => {
    const created = await store.ensureIndex(index, dimension); const d = await store.describeIndex(index);
    return { ok: d.ok && d.dimension === dimension, detail: { created: created.created, dimension: d.dimension, vectorMapping: d.vector, knn: d.knn, describeError: d.error } };
  }))) return result("mapping_accepted");
  if (!(await step("embedding_1024", async () => { embedCalls++; const [v] = await embed([doc.text]); vector = v ?? []; return { ok: vector.length === dimension, detail: { dimensions: vector.length, finite: vector.every(Number.isFinite) } }; }))) return result("embedding_1024");

  const rev = (n: number): Record<string, unknown> => ({ ...doc.payload, canary: true, canary_revision: n, canary_content_hash: doc.contentHash });
  if (!(await step("upsert_bulk_custom_id", async () => { await store.upsert(index, [{ id: doc.id, vector, payload: rev(1) }]); return { ok: true, detail: { id: doc.id, action: "bulk index with _id" } }; }))) return result("upsert_bulk_custom_id");

  if (!(await step("searchable", async () => {
    const r = await poll(async () => (await store.countDocuments(index)) === 1 && (await store.getDocument(index, doc.id)).found);
    return { ok: r.ok, detail: { waitedMs: r.waitedMs, attempts: r.attempts, assumedRefreshMs: 5000, maxWaitMs: maxWait } };
  }))) return result("searchable");

  if (!(await step("vector_retrieval", async () => {
    const r = await poll(async () => (await store.search(index, { vector, limit: 3 }))[0]?.id === doc.id); const hits = await store.search(index, { vector, limit: 3 });
    return { ok: r.ok && hits[0]?.id === doc.id, detail: { topId: hits[0]?.id ?? null, topSimilarity: hits[0]?.similarity ?? null, hits: hits.length, waitedMs: r.waitedMs } };
  }))) return result("vector_retrieval");

  if (!(await step("metadata_roundtrip", async () => {
    const d = await store.getDocument(index, doc.id); const p = d.payload ?? {};
    return { ok: d.found && d.id === doc.id && p.canary_revision === 1 && p.document_id === doc.key && p.canary_content_hash === doc.contentHash, detail: { _id: d.id, via: d.via, canary_revision: p.canary_revision ?? null, document_id: p.document_id ?? null, dataset: p.corpus_dataset ?? null, source_file: p.source_file ?? null } };
  }))) return result("metadata_roundtrip");

  const before = await store.countDocuments(index);
  if (!(await step("reupsert_same_id", async () => { await store.upsert(index, [{ id: doc.id, vector, payload: rev(2) }]); return { ok: true, detail: { id: doc.id, countBefore: before } }; }))) return result("reupsert_same_id");

  if (!(await step("idempotent_update", async () => {
    const r = await poll(async () => (await store.getDocument(index, doc.id)).payload?.canary_revision === 2);
    const count = await store.countDocuments(index); const d = await store.getDocument(index, doc.id); const hits = await store.search(index, { vector, limit: 3 });
    return { ok: r.ok && count === 1 && before === 1 && d.payload?.canary_revision === 2 && hits.length === 1 && hits[0].id === doc.id, detail: { countBefore: before, countAfter: count, revisionAfter: d.payload?.canary_revision ?? null, sameIdOnly: hits.length === 1 && hits[0].id === doc.id, waitedMs: r.waitedMs } };
  }))) return result("idempotent_update");
  return result(null);
}
