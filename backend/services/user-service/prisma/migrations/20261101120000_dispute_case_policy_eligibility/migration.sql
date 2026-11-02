-- D-NEW-12 guard (B-1 release gate, 01/11/2026). ADDITIVE ONLY: one enum, one table, one trigger function. Nothing existing changes meaning.
-- A review says, for ONE contract and on the evidence of ONE case, whether the contract falls under the CURRENT dispute policy (ELIGIBLE_CURRENT_POLICY) or under a
-- historical exception that a person must settle separately (EXCEPTION_APPLIES). The guard (assertPolicyEligibility) lets a ruling through only when the newest APPROVED review
-- of the contract is ELIGIBLE_CURRENT_POLICY. No default, no "all", no date rule: a contract with no approved review is simply not eligible.
CREATE TYPE "DisputeCasePolicyEligibilityResult" AS ENUM ('ELIGIBLE_CURRENT_POLICY', 'EXCEPTION_APPLIES');

CREATE TABLE "dispute_case_policy_eligibility_reviews" (
  "id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "contract_id" TEXT NOT NULL,
  "result" "DisputeCasePolicyEligibilityResult" NOT NULL,
  "evidence_ids" UUID[] NOT NULL,
  "reasoning" TEXT NOT NULL,
  "proposed_by" TEXT NOT NULL,
  "approved_by" TEXT,
  "approved_at" TIMESTAMPTZ(3),
  "supersedes_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispute_case_policy_eligibility_reviews_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dispute_case_policy_eligibility_reviews" ADD CONSTRAINT "dc_policy_review_case_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_policy_eligibility_reviews" ADD CONSTRAINT "dc_policy_review_supersedes_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "dispute_case_policy_eligibility_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_policy_eligibility_reviews" ADD CONSTRAINT "dc_policy_review_evidence_present" CHECK (cardinality("evidence_ids") >= 1);
ALTER TABLE "dispute_case_policy_eligibility_reviews" ADD CONSTRAINT "dc_policy_review_reasoning_present" CHECK (length(btrim("reasoning")) > 0);
ALTER TABLE "dispute_case_policy_eligibility_reviews" ADD CONSTRAINT "dc_policy_review_approval_pair" CHECK (("approved_by" IS NULL) = ("approved_at" IS NULL));
ALTER TABLE "dispute_case_policy_eligibility_reviews" ADD CONSTRAINT "dc_policy_review_four_eyes" CHECK ("approved_by" IS NULL OR "approved_by" <> "proposed_by");

CREATE INDEX "dc_policy_review_contract_idx" ON "dispute_case_policy_eligibility_reviews"("contract_id", "approved_at");
CREATE INDEX "dc_policy_review_case_idx" ON "dispute_case_policy_eligibility_reviews"("case_id");

-- Append-only, with ONE exception that keeps the approval on the row it approves: the one-time stamp (approved_by / approved_at) from NULL to a value with every other column
-- unchanged. Any other UPDATE, and every DELETE, is rejected (same message as dispute_case_reject_mutation in the Slice 1 migration).
CREATE FUNCTION dispute_case_policy_review_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."approved_by" IS NULL AND NEW."approved_by" IS NOT NULL AND NEW."approved_at" IS NOT NULL
     AND ROW(NEW."id", NEW."case_id", NEW."contract_id", NEW."result", NEW."evidence_ids", NEW."reasoning", NEW."proposed_by", NEW."supersedes_id", NEW."created_at")
         IS NOT DISTINCT FROM
         ROW(OLD."id", OLD."case_id", OLD."contract_id", OLD."result", OLD."evidence_ids", OLD."reasoning", OLD."proposed_by", OLD."supersedes_id", OLD."created_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispute_case_policy_review_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_policy_eligibility_reviews"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_policy_review_guard();
