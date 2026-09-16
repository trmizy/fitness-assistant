/**
 * DEPRECATED as an ingestion/chunking mechanism — do not add new callers.
 *
 * This writes directly into the shared `fitness_evidence` Qdrant
 * collection using the crude, no-overlap `chunkResearchRecord` chunker
 * (see the deprecation note in `./chunk.ts`), bypassing the trust-
 * scoring/safety-judge gate and Postgres bookkeeping
 * (`knowledge-pipeline/repository.ts`) that the production path applies
 * via `knowledge-pipeline/scoring.ts` + `knowledge-pipeline/safety-judge.ts`.
 *
 * Use `../../knowledge-pipeline/qdrant-writer.ts`
 * (`embedAndUpsertDocument`) instead, reached through
 * `knowledge-pipeline/service.ts`'s `run*Pipeline` functions — that is
 * the only path wired into the production BullMQ worker
 * (`knowledge-pipeline/worker.ts`) and HTTP routes
 * (`routes/internal.routes.ts`).
 *
 * Kept in place (not deleted) because `scripts/researchIndex.ts` still
 * calls this directly and may still be relied on externally
 * (`ENABLE_RESEARCH_AUTOMATION` / `researchScheduler.ts`). A safe
 * migration path for that script's approved records: reshape them to
 * the `{title, content, source_url, ...}` JSONL format under
 * `data/processed/evidence/` (see `knowledge-pipeline/local-evidence.ts`)
 * and run the existing `POST /internal/knowledge/local-evidence` route /
 * `runLocalEvidencePipeline()` instead of this file.
 *
 * See `docs/ai-agent-system-feasibility-audit.md` section 1.3 ("Two
 * competing ingestion pipelines") and `src/knowledge/README.md`.
 */
import { EMBEDDING_VECTOR_SIZE, assertEmbeddingDimension } from "../../services/embedding-config";
import { llmService } from "../../services/llm.service";
import { getVectorStore } from "../../vector-store/provider";
import type { NormalizedResearchRecord } from "../types";
import { chunkResearchRecord } from "./chunk";

const COLLECTION = process.env.RESEARCH_QDRANT_COLLECTION || "fitness_evidence";

export async function indexResearchRecordsToQdrant(
  records: NormalizedResearchRecord[],
): Promise<{ collection: string; chunks: number }> {
  const chunks = records.flatMap((record) => chunkResearchRecord(record));
  if (chunks.length === 0) return { collection: COLLECTION, chunks: 0 };

  const store = getVectorStore();
  const { size: collectionSize } = await store.ensureIndex(COLLECTION, EMBEDDING_VECTOR_SIZE);

  const points = [];
  for (const chunk of chunks) {
    const vector = await llmService.generateEmbedding(chunk.text, {
      inputType: "search_document",
    });
    assertEmbeddingDimension(vector, collectionSize);
    points.push({
      id: chunk.id,
      vector,
      payload: {
        text: chunk.text,
        title: chunk.metadata.title,
        source: chunk.metadata.source,
        source_url: chunk.metadata.source_url,
        doi: chunk.metadata.doi,
        pmid: chunk.metadata.pmid,
        year: chunk.metadata.year,
        date: chunk.metadata.date,
        topic: chunk.metadata.topic,
        category: chunk.metadata.topic,
        license: chunk.metadata.license,
        access_status: chunk.metadata.access_status,
        retrieved_at: chunk.metadata.retrieved_at,
        checksum: chunk.metadata.checksum,
        content_hash: chunk.metadata.content_hash,
        evidence_score: chunk.metadata.evidence_score,
        evidence_score_reason: chunk.metadata.evidence_score_reason,
        source_type: "research_automation",
        source_file: "data/research/normalized",
        chunk_id: chunk.metadata.chunk_id,
      },
    });
  }

  await store.upsert(COLLECTION, points);
  return { collection: COLLECTION, chunks: chunks.length };
}
