WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "document_id", COALESCE("reason", '')
      ORDER BY "id" DESC
    ) AS rn
  FROM "knowledge_review_queue"
  WHERE "status" = 'PENDING'
)
DELETE FROM "knowledge_review_queue" rq
USING ranked r
WHERE rq."id" = r."id"
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_review_queue_pending_document_reason_idx"
ON "knowledge_review_queue" ("document_id", (COALESCE("reason", '')))
WHERE "status" = 'PENDING';
