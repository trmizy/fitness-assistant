/**
 * One-shot RAG ingest runner for a TEMPORARY, VPC-attached DEV Lambda (M9.6-T5/T6). NOT wired to any existing function, trigger or route, and never deployed by CI: the AWS window creates a
 * separate throw-away function that reuses the existing `fitness-assistant-dev-ai-jobs-role` (Cohere embed + aoss access are already granted to it) and deletes the function afterwards.
 *
 * Event (ingest):  { "args": ["--dry-run", "--profile=demo", "--corpus-file=/tmp/c.jsonl"], "corpusJsonl"?: "<exported corpus text>" }
 *                  The same flags as the CLI (see datasets/seed/rag-ingest-runner.ts). `corpusJsonl`, when present, is written to /tmp/c.jsonl first (hash-checked when read), so the zip needs no data files.
 * Event (canary):  { "mode": "canary", "corpusJsonl": "<exported corpus text>", "canaryKey"?: "Hanging Knee Tucks", "indexSuffix"?: "_canary" } — one document, see datasets/seed/rag-canary.ts.
 * Event (status):  { "mode": "status", "corpusJsonl": "..." } — per index: expected / found ids, missing ids, count, mapping dimension (read-only; also the check to run after a timed-out bulk BEFORE any retry).
 * Event (search):  { "mode": "search", "queries": [{ "q": "...", "group": "..." }], "indexes"?: [...], "k"?: 5 } — read-only semantic retrieval with a search_query embedding, with timings (rag-probe.ts).
 * Event (warm):    { "mode": "warm", "query"?, "indexes"?, "attemptTimeoutMs"?, "pollIntervalMs"?, "maxWaitMs"?, "requiredConsecutivePasses"? } — read-only pre-warm + bounded polling with V1's 5 s per-call limit (rag-warmup.ts).
 * Returns only counts, index names, ids, timings and status codes (no document text, no vectors, no secrets).
 */
import * as fs from "node:fs";
import { ingestFromArgv } from "./ingest";
import { runCanary, type CanaryStore } from "./datasets/seed/rag-canary";
import { parseCorpusText } from "./datasets/seed/rag-ingest-runner";

interface Event {
  args?: unknown; mode?: unknown; queries?: unknown; indexes?: unknown; k?: unknown; corpusJsonl?: unknown; canaryKey?: unknown; indexSuffix?: unknown;
  // warm mode (narrowed where used: typeof string / finite number, clamped)
  query?: unknown; attemptTimeoutMs?: unknown; pollIntervalMs?: unknown; maxWaitMs?: unknown; requiredConsecutivePasses?: unknown;
}
const DEFAULT_CANARY_KEY = "Hanging Knee Tucks";
const DEFAULT_WARM_QUERY = "Lịch tập tại nhà cho người mới bắt đầu và lượng protein mỗi ngày";

export async function handler(event: Event): Promise<Record<string, unknown>> {
  if (event?.mode === "canary") {
    if (typeof event.corpusJsonl !== "string" || !event.corpusJsonl.trim()) throw new Error("canary needs event.corpusJsonl (the exported corpus text)");
    const key = typeof event.canaryKey === "string" ? event.canaryKey : DEFAULT_CANARY_KEY; const suffix = typeof event.indexSuffix === "string" ? event.indexSuffix : "_canary";
    const doc = parseCorpusText(event.corpusJsonl, "event").flatMap((l) => l.docs).find((d) => d.key === key);
    if (!doc) throw new Error(`canary document "${key}" is not in the supplied corpus`);
    const [{ OpenSearchVectorStore }, { embedDocuments }, { EMBEDDING_VECTOR_SIZE }] = await Promise.all([import("./vector-store/opensearch-vector-store"), import("./datasets/seed/embedding-backoff"), import("./services/embedding-config")]);
    const store = new OpenSearchVectorStore() as unknown as CanaryStore;
    return { ...(await runCanary(doc, suffix, { store, embed: embedDocuments, dimension: EMBEDDING_VECTOR_SIZE })) };
  }
  if (event?.mode === "warm") {
    // Read-only pre-warm of the OpenSearch collection (rag-warmup.ts): one Cohere embedding, then bounded polling that mirrors V1's per-collection getMapping + search with V1's 5 s limit.
    const query = typeof event.query === "string" && event.query.trim() ? event.query.trim().slice(0, 300) : DEFAULT_WARM_QUERY;
    const indexes = Array.isArray(event.indexes) && event.indexes.length > 0 && event.indexes.length <= 6 && event.indexes.every((i) => typeof i === "string" && /^[a-z0-9_]{1,64}$/.test(i)) ? (event.indexes as string[]) : ["exercises", "fitness_knowledge", "fitness_evidence", "fitness_faq"];
    const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
    const [{ OpenSearchVectorStore }, { runWarmup }, { embedTextsWithCohere }] = await Promise.all([import("./vector-store/opensearch-vector-store"), import("./datasets/seed/rag-warmup"), import("./services/bedrock.client")]);
    const store = new OpenSearchVectorStore() as unknown as import("./datasets/seed/rag-warmup").WarmupStore;
    const embedQuery = async (q: string) => (await embedTextsWithCohere([q], "search_query", { timeoutMs: 60_000 }))[0];
    return { mode: "warm", result: await runWarmup({ indexes, emptyOkIndexes: ["fitness_faq"], query, attemptTimeoutMs: num(event.attemptTimeoutMs, 1000, 30_000), pollIntervalMs: num(event.pollIntervalMs, 500, 10_000), maxWaitMs: num(event.maxWaitMs, 5000, 600_000), requiredConsecutivePasses: num(event.requiredConsecutivePasses, 1, 5) }, { store, embedQuery }) };
  }
  if (event?.mode === "status" || event?.mode === "search") {
    // validate the event BEFORE any AWS client is created
    const docs = event.mode === "status" ? (typeof event.corpusJsonl === "string" ? parseCorpusText(event.corpusJsonl, "event").flatMap((l) => l.docs) : (() => { throw new Error("status needs event.corpusJsonl"); })()) : [];
    const queries = Array.isArray(event.queries) ? (event.queries as Array<{ q?: unknown; group?: unknown }>).filter((x) => typeof x?.q === "string").map((x) => ({ q: String(x.q), group: String(x.group ?? "") })) : [];
    if (event.mode === "search" && (queries.length === 0 || queries.length > 20)) throw new Error("search needs 1..20 event.queries");
    const { OpenSearchVectorStore } = await import("./vector-store/opensearch-vector-store"); const { probeStatus, probeSearch } = await import("./datasets/seed/rag-probe"); const store = new OpenSearchVectorStore() as unknown as import("./datasets/seed/rag-probe").ProbeStore;
    if (event.mode === "status") return { mode: "status", documents: docs.length, indexes: await probeStatus(docs, store) };
    const indexes = Array.isArray(event.indexes) && event.indexes.every((i) => typeof i === "string") ? (event.indexes as string[]) : ["exercises", "fitness_knowledge", "fitness_faq", "fitness_evidence"];
    const { embedTextsWithCohere } = await import("./services/bedrock.client");
    const embedQuery = async (q: string) => (await embedTextsWithCohere([q], "search_query", { timeoutMs: 60_000 }))[0];
    return { mode: "search", results: await probeSearch(queries, indexes, typeof event.k === "number" ? Math.min(10, Math.max(1, event.k)) : 5, { store, embedQuery }) };
  }
  const args = Array.isArray(event?.args) && event.args.every((a) => typeof a === "string") ? (event.args as string[]) : null;
  if (!args) throw new Error('event.args must be an array of CLI flags, e.g. ["--dry-run", "--profile=demo"]');
  if (typeof event.corpusJsonl === "string") fs.writeFileSync("/tmp/c.jsonl", event.corpusJsonl);
  const r = await ingestFromArgv(args);
  return { totals: r.manifest.totals, indexes: r.manifest.indexes.map((i) => ({ index: i.index, documents: i.documents })), written: r.written, skipped: r.skipped, verified: r.verified };
}
