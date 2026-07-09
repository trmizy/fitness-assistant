import dotenv from 'dotenv';
import type { RetrievalDocument } from '../llm/types';

dotenv.config();

const COLLECTION = process.env.KNOWLEDGE_QDRANT_COLLECTION || 'fitness_evidence';
const EVIDENCE_QUERY = process.env.KNOWLEDGE_RAG_TEST_QUERY ||
  'bioelectrical impedance analysis body composition fat-free mass fat mass total body water standardized measurement conditions';
const CHAT_QUERY = process.env.KNOWLEDGE_RAG_TEST_CHAT_QUERY ||
  'Bioelectrical impedance analysis BIA body composition measurement conditions';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readCount(value: unknown): number {
  const data = asRecord(value);
  const count = Number(data.points_count ?? data.vectors_count ?? data.indexed_vectors_count ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function docSummary(doc: RetrievalDocument): Record<string, unknown> {
  return {
    id: doc.id,
    score: Number(doc.score.toFixed(4)),
    title: doc.metadata.title,
    sourceUrl: doc.metadata.source_url,
    evidenceLevel: doc.metadata.evidence_level,
    category: doc.category,
  };
}

async function main(): Promise<void> {
  const [{ getQdrantClient }, { llmService }, { retriever }] = await Promise.all([
    import('../repositories/qdrant'),
    import('../services/llm.service'),
    import('../llm/retriever'),
  ]);

  const qdrant = getQdrantClient();
  let collectionInfo;
  try {
    collectionInfo = await qdrant.getCollection(COLLECTION);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Qdrant collection unavailable for RAG test: ${COLLECTION}. Start Qdrant and run knowledge ingestion first. ${message}`);
  }
  const pointCount = readCount(collectionInfo);

  if (pointCount <= 0) {
    throw new Error(`${COLLECTION} exists but has no points. Run knowledge:pipeline with embedding first.`);
  }

  const evidenceDocs = await retriever.retrieveEvidence([EVIDENCE_QUERY]);
  if (evidenceDocs.length === 0) {
    const vector = await llmService.generateEmbedding(EVIDENCE_QUERY);
    const rawMatches = await qdrant.search(COLLECTION, {
      vector,
      limit: 3,
      with_payload: true,
    });
    const debug = rawMatches.map((match) => {
      const payload = asRecord(match.payload);
      return {
        score: typeof match.score === 'number' ? Number(match.score.toFixed(4)) : null,
        title: payload.title,
        sourceUrl: payload.source_url,
      };
    });
    throw new Error(`Retriever returned no evidence docs. Raw Qdrant matches: ${JSON.stringify(debug)}`);
  }

  const invalidEvidence = evidenceDocs.find((doc) => {
    const sourceUrl = doc.metadata.source_url;
    return doc.source !== `qdrant:${COLLECTION}` ||
      !doc.metadata.title ||
      typeof sourceUrl !== 'string' ||
      !/^https?:\/\//i.test(sourceUrl);
  });
  if (invalidEvidence) {
    throw new Error(`Evidence doc is missing expected metadata: ${JSON.stringify(docSummary(invalidEvidence))}`);
  }

  const chatResult = await retriever.retrieveForChat(CHAT_QUERY);
  const chatEvidenceDocs = chatResult.documents.filter((doc) => doc.source === `qdrant:${COLLECTION}`);
  if (chatEvidenceDocs.length === 0) {
    throw new Error(`Chat retrieval did not include ${COLLECTION} evidence for the BIA query.`);
  }

  console.log(JSON.stringify({
    status: 'PASS',
    collection: COLLECTION,
    pointCount,
    evidenceQuery: EVIDENCE_QUERY,
    evidenceDocs: evidenceDocs.map(docSummary),
    chatQuery: CHAT_QUERY,
    chatEvidenceDocs: chatEvidenceDocs.map(docSummary),
  }, null, 2));
}

main().catch((err) => {
  console.error('FAIL knowledge:test-rag');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
