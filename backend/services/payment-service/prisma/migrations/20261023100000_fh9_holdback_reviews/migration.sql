-- FH-9 (owner decision): durable review items for the reserve kept in a contract's HOLDBACK after it ended.
-- Additive only. No existing row changes meaning; nothing is created for an existing contract (reviews are written only by the ending of a contract that holds money back).
CREATE TYPE "PtHoldbackReviewKind" AS ENUM ('OPEN_OBLIGATION', 'UNSECURED_DISPUTE', 'UNCOMPUTABLE');
CREATE TYPE "PtHoldbackReviewStatus" AS ENUM ('OPEN', 'SETTLED_VERIFIED', 'SETTLED_PARTIAL', 'NOT_VERIFIED', 'RELEASED_AUTO');

CREATE TABLE "pt_holdback_reviews" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "kind" "PtHoldbackReviewKind" NOT NULL,
    "status" "PtHoldbackReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reserve" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "related_ref" TEXT,
    "handler" TEXT,
    "review_by" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL DEFAULT 'SYSTEM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,
    "approved_by" TEXT,
    "approval_ref" TEXT,
    "verified_amount" DECIMAL(14,2),
    "released_to_pt" DECIMAL(14,2),
    "note" TEXT,
    CONSTRAINT "pt_holdback_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pt_holdback_reviews_key_key" ON "pt_holdback_reviews"("key");
CREATE INDEX "pt_holdback_reviews_transaction_id_idx" ON "pt_holdback_reviews"("transaction_id");
CREATE INDEX "pt_holdback_reviews_status_review_by_idx" ON "pt_holdback_reviews"("status", "review_by");
ALTER TABLE "pt_holdback_reviews" ADD CONSTRAINT "pt_holdback_reviews_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "pt_holdback_review_events" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "approved_by" TEXT NOT NULL,
    "approval_ref" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "reserve" DECIMAL(14,2) NOT NULL,
    "verified_amount" DECIMAL(14,2) NOT NULL,
    "released_to_pt" DECIMAL(14,2) NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pt_holdback_review_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pt_holdback_review_events_idempotency_key_key" ON "pt_holdback_review_events"("idempotency_key");
CREATE INDEX "pt_holdback_review_events_review_id_idx" ON "pt_holdback_review_events"("review_id");
ALTER TABLE "pt_holdback_review_events" ADD CONSTRAINT "pt_holdback_review_events_review_id_fkey"
  FOREIGN KEY ("review_id") REFERENCES "pt_holdback_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only audit trail (same function FH-8 created).
CREATE TRIGGER pt_holdback_review_events_append_only
  BEFORE UPDATE OR DELETE ON "pt_holdback_review_events"
  FOR EACH ROW EXECUTE FUNCTION fh8_reject_event_mutation();
