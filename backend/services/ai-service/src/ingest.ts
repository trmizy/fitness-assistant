/**
 * RAG ingest CLI. Logic lives in datasets/seed/rag-ingest-core.ts (pure: sources, selection, stable ids, manifest) and datasets/seed/rag-ingest-runner.ts (arguments + the ingest loop with
 * an injected store / embedder). This file only wires the real vector store and embedder — LAZILY, and only for a non-dry run, so `--dry-run` never loads AWS code or calls anything.
 *
 *   npx tsx src/ingest.ts --dry-run --profile=demo --manifest=../../../.dev/m96-t5/manifest.json     # review first: documents, ids, tokens, cost
 *   npx tsx src/ingest.ts --profile=demo --canary --dataset=exercises --yes                           # one document into exercises_canary
 *   npx tsx src/ingest.ts --profile=demo --check-empty --yes                                          # the demo corpus (exercises + knowledge + evidence; FAQ = 0)
 *   npx tsx src/ingest.ts                                                                            # legacy: every valid record of exercises, knowledge, faq (needs --yes on OpenSearch / Bedrock)
 * See rag-ingest-runner.ts for every flag. Document ids are now STABLE (derived from the document's own key), so re-running overwrites instead of duplicating; data ingested earlier
 * with the old numeric row-index ids is not recognised as the same documents.
 */
import { parseIngestArgs, runIngest, type IngestStore } from "./datasets/seed/rag-ingest-runner";

export async function ingestFromArgv(argv: string[]) {
  const args = parseIngestArgs(argv);
  if (args.dryRun) {
    return runIngest(args);
  }
  const [{ getVectorStore }, { embedDocuments, EMBED_BATCH_SIZE }, { EMBEDDING_VECTOR_SIZE, EMBEDDING_PROVIDER }] = await Promise.all([
    import("./vector-store/provider"),
    import("./datasets/seed/embedding-backoff"),
    import("./services/embedding-config"),
  ]);
  const store = getVectorStore();
  console.log(`Vector store: ${store.provider}; embedding provider: ${EMBEDDING_PROVIDER}; dimension ${EMBEDDING_VECTOR_SIZE}`);
  return runIngest(args, {
    store: store as unknown as IngestStore,
    embed: embedDocuments,
    batchSize: EMBED_BATCH_SIZE,
    dimension: EMBEDDING_VECTOR_SIZE,
    requireConfirmation: store.provider === "opensearch", // a write into OpenSearch (AWS) needs an explicit --yes; the established local Qdrant + Bedrock-embedding flow (scripts/dev/local-bedrock.ps1) is unchanged
  });
}

if (require.main === module) {
  ingestFromArgv(process.argv.slice(2)).catch((error) => {
    console.error("❌ Ingestion failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
