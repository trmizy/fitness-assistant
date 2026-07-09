import { logger } from '@gym-coach/shared';
import { getQdrantClient } from '../repositories/qdrant';
import { llmService } from '../services/llm.service';
import { chunkText } from './chunking';
import { KNOWLEDGE_PIPELINE } from './config';
import { stableUuid } from './hash';
import { knowledgeRepository } from './repository';
import type { KnowledgeSource, ProcessedKnowledgeDocument } from './types';

export type SemanticDuplicateMatch = {
  score: number;
  vectorId: string;
  documentId: string | null;
  title: string | null;
};

async function ensureEvidenceCollection(): Promise<void> {
  const client = getQdrantClient();
  try {
    await client.getCollection(KNOWLEDGE_PIPELINE.collection);
  } catch {
    await client.createCollection(KNOWLEDGE_PIPELINE.collection, {
      vectors: { size: KNOWLEDGE_PIPELINE.vectorSize, distance: 'Cosine' },
    });
    logger.info({ collection: KNOWLEDGE_PIPELINE.collection }, 'Created knowledge Qdrant collection');
  }
}

export async function findSemanticDuplicateDocument(
  documentId: string,
  doc: ProcessedKnowledgeDocument,
): Promise<SemanticDuplicateMatch | null> {
  await ensureEvidenceCollection();

  try {
    const vector = await llmService.generateEmbedding([
      doc.title,
      doc.cleanText.slice(0, 1800),
      doc.tags.join(' '),
    ].join('\n'));

    const matches = await getQdrantClient().search(KNOWLEDGE_PIPELINE.collection, {
      vector,
      limit: 3,
      with_payload: true,
    });

    for (const match of matches) {
      const score = typeof match.score === 'number' ? match.score : 0;
      const payload = (match.payload ?? {}) as Record<string, unknown>;
      const matchedDocumentId = payload.document_id ? String(payload.document_id) : null;
      if (matchedDocumentId === documentId) continue;
      if (score >= KNOWLEDGE_PIPELINE.semanticDuplicateThreshold) {
        return {
          score,
          vectorId: String(match.id),
          documentId: matchedDocumentId,
          title: payload.title ? String(payload.title) : null,
        };
      }
    }
  } catch (err) {
    logger.warn({ err, documentId }, 'Semantic duplicate check skipped');
  }

  return null;
}

export async function embedAndUpsertDocument(
  documentId: string,
  doc: ProcessedKnowledgeDocument,
  source: KnowledgeSource,
): Promise<number> {
  await ensureEvidenceCollection();
  await knowledgeRepository.deleteChunksForDocument(documentId);

  const chunks = chunkText(doc.cleanText);
  let embedded = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const vectorId = stableUuid(`${doc.contentHash}:${index}`);
    const vector = await llmService.generateEmbedding([doc.title, chunk.text, doc.tags.join(' ')].join('\n'));

    await getQdrantClient().upsert(KNOWLEDGE_PIPELINE.collection, {
      wait: true,
      points: [{
        id: vectorId,
        vector,
          payload: {
            title: doc.title,
            source_type: doc.sourceType ?? 'curated_summary',
            category: doc.topic.toLowerCase(),
            content: chunk.text,
            text: chunk.text,
            topic: doc.topic,
            source_url: doc.url,
            evidence_level: doc.evidenceLevel ?? 'unknown',
            tags: doc.tags,
          chunk_index: index,
          total_chunks: chunks.length,
          extraction_method: 'knowledge_update_pipeline',
          created_from: 'knowledge_update_pipeline',
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
      }],
    });

    await knowledgeRepository.insertChunk(documentId, index, chunk.text, chunk.tokenCount, vectorId);
    embedded += 1;
  }

  await knowledgeRepository.markEmbedded(documentId);
  return embedded;
}
