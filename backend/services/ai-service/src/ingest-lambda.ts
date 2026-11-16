/**
 * One-shot RAG ingest runner for a TEMPORARY, VPC-attached DEV Lambda (M9.6-T5). NOT wired to any existing function, trigger or route, and never deployed by CI: the AWS window creates a
 * separate throw-away function that reuses the existing `fitness-assistant-dev-ai-jobs-role` (Cohere embed + aoss access are already granted to it) and deletes the function afterwards.
 *
 * Event: { "args": ["--canary", "--dataset=exercises", "--corpus-file=/var/task/corpus/demo-corpus.jsonl", "--yes"] } — the same flags as the CLI (see datasets/seed/rag-ingest-runner.ts).
 * Returns only counts, index names and the manifest totals (no document text, no vectors, no secrets).
 */
import { ingestFromArgv } from "./ingest";

export async function handler(event: { args?: unknown }): Promise<Record<string, unknown>> {
  const args = Array.isArray(event?.args) && event.args.every((a) => typeof a === "string") ? (event.args as string[]) : null;
  if (!args) throw new Error('event.args must be an array of CLI flags, e.g. ["--dry-run", "--profile=demo"]');
  const r = await ingestFromArgv(args);
  return { totals: r.manifest.totals, indexes: r.manifest.indexes.map((i) => ({ index: i.index, documents: i.documents })), written: r.written, skipped: r.skipped };
}
