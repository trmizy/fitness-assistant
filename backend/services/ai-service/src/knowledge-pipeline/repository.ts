import { prisma } from '../repositories/conversation.repository';
import { DEFAULT_KNOWLEDGE_SOURCES } from './source-registry';
import { newId } from './hash';
import type { KnowledgeDocumentStatus, KnowledgeSource, PipelineCounters, ProcessedKnowledgeDocument, RawKnowledgeDocument } from './types';

type SourceRow = {
  id: string;
  name: string;
  base_url: string;
  source_type: string;
  trust_tier: number;
  is_active: boolean;
};

type DocumentRow = {
  id: string;
  status: KnowledgeDocumentStatus;
};

type PipelineRunRow = {
  id: string;
  run_type: string;
  started_at: Date;
  finished_at: Date | null;
  docs_crawled: number;
  docs_accepted: number;
  docs_rejected: number;
  docs_review: number;
  status: string;
};

type ReviewQueueRow = {
  id: string;
  document_id: string;
  reason: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  title: string | null;
  url: string;
  trust_score: number | null;
  topic: string | null;
  source_name: string;
};

type ReviewDocumentRow = {
  review_id: string;
  document_id: string;
  source_id: string;
  source_name: string;
  base_url: string;
  source_type: string;
  trust_tier: number;
  is_active: boolean;
  url: string;
  title: string | null;
  author: string | null;
  language: string | null;
  content_hash: string;
  raw_object_key: string | null;
  clean_text: string | null;
  topic: string | null;
  trust_score: number | null;
  quality_score: number | null;
  safety_flag: boolean;
  published_at: Date | null;
};

export type KnowledgePipelineRunSummary = {
  id: string;
  runType: string;
  startedAt: Date;
  finishedAt: Date | null;
  docsCrawled: number;
  docsAccepted: number;
  docsRejected: number;
  docsReview: number;
  status: string;
};

export type KnowledgeReviewQueueSummary = {
  id: string;
  documentId: string;
  reason: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  title: string | null;
  url: string;
  trustScore: number | null;
  topic: string | null;
  sourceName: string;
};

export type ReviewDocumentForEmbedding = {
  reviewId: string;
  documentId: string;
  source: KnowledgeSource;
  document: ProcessedKnowledgeDocument;
};

function mapSource(row: SourceRow): KnowledgeSource {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    sourceType: row.source_type as KnowledgeSource['sourceType'],
    trustTier: row.trust_tier,
    isActive: row.is_active,
  };
}

function mapPipelineRun(row: PipelineRunRow): KnowledgePipelineRunSummary {
  return {
    id: row.id,
    runType: row.run_type,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    docsCrawled: row.docs_crawled,
    docsAccepted: row.docs_accepted,
    docsRejected: row.docs_rejected,
    docsReview: row.docs_review,
    status: row.status,
  };
}

function mapReviewQueue(row: ReviewQueueRow): KnowledgeReviewQueueSummary {
  return {
    id: row.id,
    documentId: row.document_id,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    title: row.title,
    url: row.url,
    trustScore: row.trust_score === null ? null : Number(row.trust_score),
    topic: row.topic,
    sourceName: row.source_name,
  };
}

function mapReviewDocument(row: ReviewDocumentRow): ReviewDocumentForEmbedding {
  return {
    reviewId: row.review_id,
    documentId: row.document_id,
    source: {
      id: row.source_id,
      name: row.source_name,
      baseUrl: row.base_url,
      sourceType: row.source_type as KnowledgeSource['sourceType'],
      trustTier: row.trust_tier,
      isActive: row.is_active,
    },
    document: {
      sourceId: row.source_id,
      url: row.url,
      title: row.title ?? 'Untitled evidence',
      author: row.author,
      language: row.language ?? 'en',
      contentHash: row.content_hash,
      rawObjectKey: row.raw_object_key ?? '',
      cleanText: row.clean_text ?? '',
      sourceFile: row.raw_object_key ?? 'review_queue',
      tags: [],
      publishedAt: row.published_at,
      topic: (row.topic ?? 'GENERAL') as ProcessedKnowledgeDocument['topic'],
      trustScore: row.trust_score === null ? 0 : Number(row.trust_score),
      qualityScore: row.quality_score === null ? 0 : Number(row.quality_score),
      safetyFlag: row.safety_flag,
      rejectionReason: null,
    },
  };
}

export const knowledgeRepository = {
  async ensureDefaultSources(): Promise<void> {
    for (const source of DEFAULT_KNOWLEDGE_SOURCES) {
      await prisma.$executeRaw`
        INSERT INTO "knowledge_sources" ("id", "name", "base_url", "source_type", "trust_tier")
        VALUES (${source.id}, ${source.name}, ${source.baseUrl}, CAST(${source.sourceType} AS "KnowledgeSourceType"), ${source.trustTier})
        ON CONFLICT ("base_url") DO UPDATE SET
          "name" = EXCLUDED."name",
          "source_type" = EXCLUDED."source_type",
          "trust_tier" = EXCLUDED."trust_tier",
          "is_active" = true
      `;
    }
  },

  async findSourceById(id: string): Promise<KnowledgeSource | null> {
    const rows = await prisma.$queryRaw<SourceRow[]>`
      SELECT "id", "name", "base_url", "source_type", "trust_tier", "is_active"
      FROM "knowledge_sources"
      WHERE "id" = ${id}
      LIMIT 1
    `;
    return rows[0] ? mapSource(rows[0]) : null;
  },

  async createPipelineRun(runType: string): Promise<string> {
    const id = newId();
    await prisma.$executeRaw`
      INSERT INTO "knowledge_pipeline_runs" ("id", "run_type", "status")
      VALUES (${id}, ${runType}, 'RUNNING')
    `;
    return id;
  },

  async finishPipelineRun(runId: string, status: 'SUCCESS' | 'FAILED', counters: PipelineCounters): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "knowledge_pipeline_runs"
      SET
        "status" = CAST(${status} AS "KnowledgePipelineRunStatus"),
        "finished_at" = CURRENT_TIMESTAMP,
        "docs_crawled" = ${counters.crawled},
        "docs_accepted" = ${counters.accepted},
        "docs_rejected" = ${counters.rejected},
        "docs_review" = ${counters.review}
      WHERE "id" = ${runId}
    `;
  },

  async insertDocumentIfNew(doc: RawKnowledgeDocument, force: boolean): Promise<{ id: string; inserted: boolean }> {
    const existing = await prisma.$queryRaw<DocumentRow[]>`
      SELECT "id", "status"
      FROM "knowledge_documents"
      WHERE "content_hash" = ${doc.contentHash}
      LIMIT 1
    `;

    if (existing[0] && !force) {
      return { id: existing[0].id, inserted: false };
    }

    if (existing[0] && force) {
      await prisma.$executeRaw`
        UPDATE "knowledge_documents"
        SET
          "url" = ${doc.url},
          "title" = ${doc.title},
          "author" = ${doc.author},
          "language" = ${doc.language},
          "raw_object_key" = ${doc.rawObjectKey},
          "clean_text" = ${doc.cleanText},
          "status" = 'CRAWLED',
          "rejection_reason" = NULL,
          "safety_flag" = false,
          "processed_at" = NULL,
          "crawled_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${existing[0].id}
      `;
      await this.deleteChunksForDocument(existing[0].id);
      return { id: existing[0].id, inserted: true };
    }

    const id = newId();
    await prisma.$executeRaw`
      INSERT INTO "knowledge_documents" (
        "id", "source_id", "url", "title", "author", "language", "content_hash",
        "raw_object_key", "clean_text", "published_at", "status"
      )
      VALUES (
        ${id}, ${doc.sourceId}, ${doc.url}, ${doc.title}, ${doc.author}, ${doc.language}, ${doc.contentHash},
        ${doc.rawObjectKey}, ${doc.cleanText}, ${doc.publishedAt}, 'CRAWLED'
      )
    `;
    return { id, inserted: true };
  },

  async markProcessed(documentId: string, doc: ProcessedKnowledgeDocument, status: KnowledgeDocumentStatus): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "knowledge_documents"
      SET
        "topic" = CAST(${doc.topic} AS "KnowledgeDocumentTopic"),
        "trust_score" = ${doc.trustScore},
        "quality_score" = ${doc.qualityScore},
        "safety_flag" = ${doc.safetyFlag},
        "status" = CAST(${status} AS "KnowledgeDocumentStatus"),
        "rejection_reason" = ${doc.rejectionReason ?? null},
        "processed_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${documentId}
    `;
  },

  async addReviewItem(documentId: string, reason: string): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO "knowledge_review_queue" ("id", "document_id", "reason", "status")
      SELECT ${newId()}, ${documentId}, ${reason}, 'PENDING'
      WHERE NOT EXISTS (
        SELECT 1
        FROM "knowledge_review_queue"
        WHERE "document_id" = ${documentId}
          AND "status" = 'PENDING'
          AND COALESCE("reason", '') = COALESCE(${reason}, '')
      )
    `;
  },

  async deleteChunksForDocument(documentId: string): Promise<void> {
    await prisma.$executeRaw`
      DELETE FROM "knowledge_chunks"
      WHERE "document_id" = ${documentId}
    `;
  },

  async insertChunk(documentId: string, chunkIndex: number, text: string, tokenCount: number, vectorId: string): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO "knowledge_chunks" ("id", "document_id", "chunk_index", "text", "token_count", "vector_id")
      VALUES (${newId()}, ${documentId}, ${chunkIndex}, ${text}, ${tokenCount}, ${vectorId})
      ON CONFLICT ("document_id", "chunk_index") DO UPDATE SET
        "text" = EXCLUDED."text",
        "token_count" = EXCLUDED."token_count",
        "vector_id" = EXCLUDED."vector_id",
        "embedded_at" = CURRENT_TIMESTAMP
    `;
  },

  async markEmbedded(documentId: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "knowledge_documents"
      SET "status" = 'EMBEDDED'
      WHERE "id" = ${documentId}
    `;
  },

  async markSourceCrawled(sourceId: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "knowledge_sources"
      SET "last_crawled_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${sourceId}
    `;
  },

  async listPipelineRuns(limit = 10): Promise<KnowledgePipelineRunSummary[]> {
    const rows = await prisma.$queryRaw<PipelineRunRow[]>`
      SELECT
        "id", "run_type", "started_at", "finished_at",
        "docs_crawled", "docs_accepted", "docs_rejected", "docs_review", "status"
      FROM "knowledge_pipeline_runs"
      ORDER BY "started_at" DESC
      LIMIT ${limit}
    `;
    return rows.map(mapPipelineRun);
  },

  async listReviewQueue(limit = 20): Promise<KnowledgeReviewQueueSummary[]> {
    const rows = await prisma.$queryRaw<ReviewQueueRow[]>`
      SELECT
        rq."id",
        rq."document_id",
        rq."reason",
        rq."status",
        rq."reviewed_by",
        rq."reviewed_at",
        d."title",
        d."url",
        d."trust_score",
        d."topic",
        s."name" AS "source_name"
      FROM "knowledge_review_queue" rq
      JOIN "knowledge_documents" d ON d."id" = rq."document_id"
      JOIN "knowledge_sources" s ON s."id" = d."source_id"
      WHERE rq."status" = 'PENDING'
      ORDER BY rq."id" DESC
      LIMIT ${limit}
    `;
    return rows.map(mapReviewQueue);
  },

  async getReviewDocument(reviewId: string): Promise<ReviewDocumentForEmbedding | null> {
    const rows = await prisma.$queryRaw<ReviewDocumentRow[]>`
      SELECT
        rq."id" AS "review_id",
        d."id" AS "document_id",
        s."id" AS "source_id",
        s."name" AS "source_name",
        s."base_url",
        s."source_type",
        s."trust_tier",
        s."is_active",
        d."url",
        d."title",
        d."author",
        d."language",
        d."content_hash",
        d."raw_object_key",
        d."clean_text",
        d."topic",
        d."trust_score",
        d."quality_score",
        d."safety_flag",
        d."published_at"
      FROM "knowledge_review_queue" rq
      JOIN "knowledge_documents" d ON d."id" = rq."document_id"
      JOIN "knowledge_sources" s ON s."id" = d."source_id"
      WHERE rq."id" = ${reviewId}
        AND rq."status" = 'PENDING'
      LIMIT 1
    `;
    return rows[0] ? mapReviewDocument(rows[0]) : null;
  },

  async approveReviewItem(reviewId: string, reviewedBy: string | null): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "knowledge_review_queue"
      SET "status" = 'APPROVED',
          "reviewed_by" = ${reviewedBy},
          "reviewed_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${reviewId}
    `;
    await prisma.$executeRaw`
      UPDATE "knowledge_documents"
      SET "status" = 'SCORED',
          "rejection_reason" = NULL,
          "processed_at" = CURRENT_TIMESTAMP
      WHERE "id" = (
        SELECT "document_id" FROM "knowledge_review_queue" WHERE "id" = ${reviewId}
      )
    `;
  },

  async rejectReviewItem(reviewId: string, reviewedBy: string | null, reason: string | null): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "knowledge_review_queue"
      SET "status" = 'REJECTED',
          "reviewed_by" = ${reviewedBy},
          "reviewed_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${reviewId}
    `;
    await prisma.$executeRaw`
      UPDATE "knowledge_documents"
      SET "status" = 'REJECTED',
          "rejection_reason" = ${reason ?? 'rejected_by_reviewer'},
          "processed_at" = CURRENT_TIMESTAMP
      WHERE "id" = (
        SELECT "document_id" FROM "knowledge_review_queue" WHERE "id" = ${reviewId}
      )
    `;
  },
};
