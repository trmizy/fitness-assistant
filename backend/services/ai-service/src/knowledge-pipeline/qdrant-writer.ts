import { logger } from "@gym-coach/shared";
import { assertEmbeddingDimension } from "../services/embedding-config";
import { llmService } from "../services/llm.service";
import { getVectorStore } from "../vector-store/provider";
import { chunkText } from "./chunking";
import { KNOWLEDGE_PIPELINE } from "./config";
import { stableUuid } from "./hash";
import { knowledgeRepository } from "./repository";
import type { KnowledgeSource, ProcessedKnowledgeDocument } from "./types";

export type SemanticDuplicateMatch = {
  score: number;
  vectorId: string;
  documentId: string | null;
  title: string | null;
};

/**
 * Creates the knowledge collection at the configured vector size
 * (KNOWLEDGE_VECTOR_SIZE) when missing, and throws
 * VectorDimensionMismatchError when an existing collection has a different
 * size — so a 768-dim collection is never written with 1024-dim vectors (or
 * the reverse). The existing collection is never deleted or recreated here.
 */
async function ensureEvidenceCollection(): Promise<number> {
  const store = getVectorStore();
  const { size, created } = await store.ensureIndex(
    KNOWLEDGE_PIPELINE.collection,
    KNOWLEDGE_PIPELINE.vectorSize,
  );
  if (created) {
    logger.info(
      { provider: store.provider, index: KNOWLEDGE_PIPELINE.collection, vectorSize: size },
      "Created knowledge vector index",
    );
  }
  return size;
}

export async function findSemanticDuplicateDocument(
  documentId: string,
  doc: ProcessedKnowledgeDocument,
): Promise<SemanticDuplicateMatch | null> {
  const collectionSize = await ensureEvidenceCollection();

  try {
    // Document-to-document similarity: both sides are stored documents.
    const vector = await llmService.generateEmbedding(
      [doc.title, doc.cleanText.slice(0, 1800), doc.tags.join(" ")].join("\n"),
      { inputType: "search_document" },
    );
    assertEmbeddingDimension(vector, collectionSize);

    const matches = await getVectorStore().search(KNOWLEDGE_PIPELINE.collection, {
      vector,
      limit: 3,
    });

    for (const match of matches) {
      const score = match.similarity;
      const payload = (match.payload ?? {}) as Record<string, unknown>;
      const matchedDocumentId = payload.document_id
        ? String(payload.document_id)
        : null;
      if (matchedDocumentId === documentId) continue;
      if (score >= KNOWLEDGE_PIPELINE.semanticDuplicateThreshold) {
        return {
          score,
          vectorId: match.id,
          documentId: matchedDocumentId,
          title: payload.title ? String(payload.title) : null,
        };
      }
    }
  } catch (err) {
    logger.warn({ err, documentId }, "Semantic duplicate check skipped");
  }

  return null;
}

export async function embedAndUpsertDocument(
  documentId: string,
  doc: ProcessedKnowledgeDocument,
  source: KnowledgeSource,
): Promise<number> {
  const collectionSize = await ensureEvidenceCollection();
  await knowledgeRepository.deleteChunksForDocument(documentId);

  const chunks = chunkText(doc.cleanText);
  let embedded = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const vectorId = stableUuid(`${doc.contentHash}:${index}`);
    const vector = await llmService.generateEmbedding(
      [doc.title, chunk.text, doc.tags.join(" ")].join("\n"),
      { inputType: "search_document" },
    );
    // Guards every provider, including Ollama, whose model is not pinned to a
    // known size the way Bedrock Cohere is.
    assertEmbeddingDimension(vector, collectionSize);

    await getVectorStore().upsert(KNOWLEDGE_PIPELINE.collection, [
      {
        id: vectorId,
        vector,
        payload: {
            title: doc.title,
            source_type: doc.sourceType ?? "curated_summary",
            category: doc.topic.toLowerCase(),
            content: chunk.text,
            text: chunk.text,
            topic: doc.topic,
            source_url: doc.url,
            evidence_level: doc.evidenceLevel ?? "unknown",
            tags: doc.tags,
            chunk_index: index,
            total_chunks: chunks.length,
            extraction_method: "knowledge_update_pipeline",
            created_from: "knowledge_update_pipeline",
            source_file: doc.sourceFile,
            chunk_id: `${documentId}:${index}`,
            document_id: documentId,
            source_name: source.name,
            source_tier: source.trustTier,
            trust_score: doc.trustScore,
            quality_score: doc.qualityScore,
            language: doc.language,
            published_at: doc.publishedAt?.toISOString() ?? null,
        },
      },
    ]);

    await knowledgeRepository.insertChunk(
      documentId,
      index,
      chunk.text,
      chunk.tokenCount,
      vectorId,
    );
    embedded += 1;
  }

  await knowledgeRepository.markEmbedded(documentId);
  return embedded;
}
