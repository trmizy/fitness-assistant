/**
 * One-shot RAG ingest runner for a TEMPORARY, VPC-attached DEV Lambda (M9.6-T5/T6). NOT wired to any existing function, trigger or route, and never deployed by CI: the AWS window creates a
 * separate throw-away function that reuses the existing `fitness-assistant-dev-ai-jobs-role` (Cohere embed + aoss access are already granted to it) and deletes the function afterwards.
 *
 * Event (ingest):  { "args": ["--dry-run", "--profile=demo", "--corpus-file=/tmp/c.jsonl"], "corpusJsonl"?: "<exported corpus text>" }
 *                  The same flags as the CLI (see datasets/seed/rag-ingest-runner.ts). `corpusJsonl`, when present, is written to /tmp/c.jsonl first (hash-checked when read), so the zip needs no data files.
 * Event (canary):  { "mode": "canary", "corpusJsonl": "<exported corpus text>", "canaryKey"?: "Hanging Knee Tucks", "indexSuffix"?: "_canary" } — one document, see datasets/seed/rag-canary.ts.
 * Returns only counts, index names, ids, timings and status codes (no document text, no vectors, no secrets).
 */
import * as fs from "node:fs";
import { ingestFromArgv } from "./ingest";
import { runCanary, type CanaryStore } from "./datasets/seed/rag-canary";
import { parseCorpusText } from "./datasets/seed/rag-ingest-runner";

interface Event { args?: unknown; mode?: unknown; corpusJsonl?: unknown; canaryKey?: unknown; indexSuffix?: unknown }
const DEFAULT_CANARY_KEY = "Hanging Knee Tucks";

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
  const args = Array.isArray(event?.args) && event.args.every((a) => typeof a === "string") ? (event.args as string[]) : null;
  if (!args) throw new Error('event.args must be an array of CLI flags, e.g. ["--dry-run", "--profile=demo"]');
  if (typeof event.corpusJsonl === "string") fs.writeFileSync("/tmp/c.jsonl", event.corpusJsonl);
  const r = await ingestFromArgv(args);
  return { totals: r.manifest.totals, indexes: r.manifest.indexes.map((i) => ({ index: i.index, documents: i.documents })), written: r.written, skipped: r.skipped, verified: r.verified };
}
