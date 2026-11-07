-- D-NEW-12, contract-level review (Ngai, 03/11/2026): a policy review of ONE contract WITHOUT a Case. Non-disputed transactions must not be globally blocked, and a fake Case must not be needed.
-- Relaxes one NOT NULL, adds one nullable column and one append-only audit table. Every existing row (all case-level) keeps its meaning; assertPolicyEligibility reads the same table and is unchanged.
ALTER TABLE "dispute_case_policy_eligibility_reviews" ALTER COLUMN "case_id" DROP NOT NULL;
ALTER TABLE "dispute_case_policy_eligibility_reviews" ADD COLUMN "evidence_refs" JSONB;

-- A case-level row cites >= 1 evidence row of its case (as before); a contract-level row (no case) cites >= 1 server-resolved reference instead. Exactly one of the two shapes.
ALTER TABLE "dispute_case_policy_eligibility_reviews" DROP CONSTRAINT "dc_policy_review_evidence_present";
ALTER TABLE "dispute_case_policy_eligibility_reviews" ADD CONSTRAINT "dc_policy_review_evidence_present" CHECK (
  (case_id IS NOT NULL AND evidence_refs IS NULL AND cardinality("evidence_ids") >= 1)
  OR (case_id IS NULL AND evidence_refs IS NOT NULL AND jsonb_typeof(evidence_refs) = 'array' AND jsonb_array_length(evidence_refs) >= 1)
);

-- The one-time approval stamp stays the ONLY allowed UPDATE; evidence_refs joins the columns that must stay unchanged.
CREATE OR REPLACE FUNCTION dispute_case_policy_review_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."approved_by" IS NULL AND NEW."approved_by" IS NOT NULL AND NEW."approved_at" IS NOT NULL
     AND ROW(NEW."id", NEW."case_id", NEW."contract_id", NEW."result", NEW."evidence_ids", NEW."evidence_refs", NEW."reasoning", NEW."proposed_by", NEW."supersedes_id", NEW."created_at")
         IS NOT DISTINCT FROM
         ROW(OLD."id", OLD."case_id", OLD."contract_id", OLD."result", OLD."evidence_ids", OLD."evidence_refs", OLD."reasoning", OLD."proposed_by", OLD."supersedes_id", OLD."created_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "dispute_policy_review_events" (
  "id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "contract_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "actor_role" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "idempotency_key" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispute_policy_review_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dispute_policy_review_events_idempotency_key_key" ON "dispute_policy_review_events"("idempotency_key");
CREATE INDEX "dispute_policy_review_events_review_id_created_at_idx" ON "dispute_policy_review_events"("review_id", "created_at");
CREATE INDEX "dispute_policy_review_events_contract_id_created_at_idx" ON "dispute_policy_review_events"("contract_id", "created_at");
ALTER TABLE "dispute_policy_review_events" ADD CONSTRAINT "dispute_policy_review_events_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "dispute_case_policy_eligibility_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION dispute_policy_review_event_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER dispute_policy_review_events_append_only
  BEFORE UPDATE OR DELETE ON "dispute_policy_review_events"
  FOR EACH ROW EXECUTE FUNCTION dispute_policy_review_event_reject_mutation();
