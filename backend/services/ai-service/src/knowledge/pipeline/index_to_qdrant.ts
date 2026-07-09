import { getQdrantClient } from '../../repositories/qdrant';
import { llmService } from '../../services/llm.service';
import type { NormalizedResearchRecord } from '../types';
import { chunkResearchRecord } from './chunk';

const COLLECTION = process.env.RESEARCH_QDRANT_COLLECTION || 'fitness_evidence';

export async function indexResearchRecordsToQdrant(records: NormalizedResearchRecord[]): Promise<{ collection: string; chunks: number }> {
  const chunks = records.flatMap((record) => chunkResearchRecord(record));
  if (chunks.length === 0) return { collection: COLLECTION, chunks: 0 };

  const client = getQdrantClient();
  try {
    await client.getCollection(COLLECTION);
  } catch {
    await client.createCollection(COLLECTION, { vectors: { size: 768, distance: 'Cosine' } });
  }

  const points = [];
  for (const chunk of chunks) {
    const vector = await llmService.generateEmbedding(chunk.text);
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
        source_type: 'research_automation',
        source_file: 'data/research/normalized',
        chunk_id: chunk.metadata.chunk_id,
      },
    });
  }

  await client.upsert(COLLECTION, { wait: true, points });
  return { collection: COLLECTION, chunks: chunks.length };
}
