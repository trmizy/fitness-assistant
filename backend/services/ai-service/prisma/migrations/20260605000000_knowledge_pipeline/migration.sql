-- Knowledge update pipeline metadata.
-- The application generates UUID text IDs to match the existing Prisma setup.

CREATE TYPE "KnowledgeSourceType" AS ENUM ('RSS', 'API', 'WEB', 'LOCAL');
CREATE TYPE "KnowledgeDocumentTopic" AS ENUM ('TRAINING', 'NUTRITION', 'RECOVERY', 'INJURY', 'GENERAL');
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('CRAWLED', 'CLEANED', 'SCORED', 'EMBEDDED', 'REJECTED', 'REVIEW');
CREATE TYPE "KnowledgePipelineRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
CREATE TYPE "KnowledgeReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "source_type" "KnowledgeSourceType" NOT NULL,
    "trust_tier" INTEGER NOT NULL DEFAULT 3,
    "crawl_cron" TEXT NOT NULL DEFAULT '0 2 * * *',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_crawled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "author" TEXT,
    "language" TEXT,
    "content_hash" TEXT NOT NULL,
    "raw_object_key" TEXT,
    "clean_text" TEXT,
    "topic" "KnowledgeDocumentTopic",
    "trust_score" DECIMAL(4,3),
    "quality_score" DECIMAL(4,3),
    "safety_flag" BOOLEAN NOT NULL DEFAULT false,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'CRAWLED',
    "rejection_reason" TEXT,
    "published_at" TIMESTAMP(3),
    "crawled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "token_count" INTEGER,
    "vector_id" TEXT NOT NULL,
    "embedded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_pipeline_runs" (
    "id" TEXT NOT NULL,
    "run_type" TEXT NOT NULL DEFAULT 'manual_local_evidence',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "docs_crawled" INTEGER NOT NULL DEFAULT 0,
    "docs_accepted" INTEGER NOT NULL DEFAULT 0,
    "docs_rejected" INTEGER NOT NULL DEFAULT 0,
    "docs_review" INTEGER NOT NULL DEFAULT 0,
    "status" "KnowledgePipelineRunStatus" NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "knowledge_pipeline_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_review_queue" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "reason" TEXT,
    "status" "KnowledgeReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_review_queue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_sources_base_url_key" ON "knowledge_sources"("base_url");
CREATE INDEX "knowledge_sources_is_active_idx" ON "knowledge_sources"("is_active");

CREATE UNIQUE INDEX "knowledge_documents_content_hash_key" ON "knowledge_documents"("content_hash");
CREATE INDEX "knowledge_documents_status_idx" ON "knowledge_documents"("status");
CREATE INDEX "knowledge_documents_topic_idx" ON "knowledge_documents"("topic");
CREATE INDEX "knowledge_documents_source_id_idx" ON "knowledge_documents"("source_id");
CREATE INDEX "knowledge_documents_content_hash_idx" ON "knowledge_documents"("content_hash");

CREATE UNIQUE INDEX "knowledge_chunks_document_id_chunk_index_key" ON "knowledge_chunks"("document_id", "chunk_index");
CREATE INDEX "knowledge_chunks_vector_id_idx" ON "knowledge_chunks"("vector_id");

CREATE INDEX "knowledge_pipeline_runs_started_at_idx" ON "knowledge_pipeline_runs"("started_at");
CREATE INDEX "knowledge_pipeline_runs_status_idx" ON "knowledge_pipeline_runs"("status");

CREATE INDEX "knowledge_review_queue_status_idx" ON "knowledge_review_queue"("status");
CREATE INDEX "knowledge_review_queue_document_id_idx" ON "knowledge_review_queue"("document_id");

ALTER TABLE "knowledge_documents"
  ADD CONSTRAINT "knowledge_documents_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_chunks"
  ADD CONSTRAINT "knowledge_chunks_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_review_queue"
  ADD CONSTRAINT "knowledge_review_queue_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "knowledge_sources" ("id", "name", "base_url", "source_type", "trust_tier")
VALUES
  ('source-local-evidence', 'Curated Local Evidence JSONL', 'local://data/processed/evidence', 'LOCAL', 1),
  ('source-nhanes-local', 'NHANES Local Body Composition Summary', 'local://data/processed/nhanes', 'LOCAL', 1),
  ('source-pubmed-eutils', 'PubMed E-utilities', 'https://eutils.ncbi.nlm.nih.gov', 'API', 1),
  ('source-who-nutrition', 'WHO Nutrition', 'https://www.who.int/nutrition', 'WEB', 1),
  ('source-acsm-topics', 'ACSM Trending Topics', 'https://www.acsm.org/education-resources/trending-topics-resources', 'WEB', 2),
  ('source-nsca-feed', 'NSCA Articles Feed', 'https://www.nsca.com/articles/feed', 'RSS', 2)
ON CONFLICT ("base_url") DO NOTHING;
