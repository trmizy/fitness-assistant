-- A4 (05/11/2026). ADDITIVE ONLY: one table, one trigger function. Replacement of an APPROVED Case decision that has had NO business, money or quota effect at all (design Q3 section 2).
--
-- A replacement is proposed by one admin and approved (or rejected) by a second, non-party admin. Approving it NEVER updates or deletes the old approval row (dispute_case_approvals stays append-only): it only
-- sends the Case back to FINDING_RECORDED (a mutable column of dispute_cases, CAS on its version) so a NEW proposal -> NEW approval can be made through the normal four-eyes path. While a replacement is pending,
-- the executor refuses 409 REPLACEMENT_PENDING. The table keeps the checks that proved "no effect" at proposal and at approval. History lives in dispute_case_events.
CREATE TABLE "dispute_case_decision_replacements" (
  "id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "old_approval_id" UUID NOT NULL,
  "session_id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "client_user_id" TEXT NOT NULL,
  "pt_user_id" TEXT NOT NULL,
  "proposed_by" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "checks_at_proposal" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by" TEXT,
  "approved_at" TIMESTAMPTZ(3),
  "approval_reason" TEXT,
  "checks_at_approval" JSONB,
  "rejected_by" TEXT,
  "rejected_at" TIMESTAMPTZ(3),
  "rejection_reason" TEXT,
  CONSTRAINT "dispute_case_decision_replacements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dispute_case_decision_replacements" ADD CONSTRAINT "dcdr_case_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_decision_replacements" ADD CONSTRAINT "dcdr_approval_fkey" FOREIGN KEY ("old_approval_id") REFERENCES "dispute_case_approvals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_decision_replacements" ADD CONSTRAINT "dcdr_reason_present" CHECK (length(btrim("reason")) > 0);
ALTER TABLE "dispute_case_decision_replacements" ADD CONSTRAINT "dcdr_approval_quad" CHECK (("approved_by" IS NULL) = ("approved_at" IS NULL) AND ("approved_by" IS NULL) = ("approval_reason" IS NULL) AND ("approved_by" IS NULL) = ("checks_at_approval" IS NULL));
ALTER TABLE "dispute_case_decision_replacements" ADD CONSTRAINT "dcdr_rejection_triple" CHECK (("rejected_by" IS NULL) = ("rejected_at" IS NULL) AND ("rejected_by" IS NULL) = ("rejection_reason" IS NULL));
ALTER TABLE "dispute_case_decision_replacements" ADD CONSTRAINT "dcdr_not_both" CHECK ("approved_at" IS NULL OR "rejected_at" IS NULL);
ALTER TABLE "dispute_case_decision_replacements" ADD CONSTRAINT "dcdr_four_eyes" CHECK (("approved_by" IS NULL OR "approved_by" <> "proposed_by") AND ("rejected_by" IS NULL OR "rejected_by" <> "proposed_by"));
ALTER TABLE "dispute_case_decision_replacements" ADD CONSTRAINT "dcdr_not_party" CHECK (
  "proposed_by" NOT IN ("client_user_id", "pt_user_id")
  AND ("approved_by" IS NULL OR "approved_by" NOT IN ("client_user_id", "pt_user_id"))
  AND ("rejected_by" IS NULL OR "rejected_by" NOT IN ("client_user_id", "pt_user_id"))
);

CREATE INDEX "dcdr_case_idx" ON "dispute_case_decision_replacements"("case_id", "created_at");
-- ONE live (undecided) replacement per Case, and an approval is replaced at most once.
CREATE UNIQUE INDEX "dcdr_one_live_per_case" ON "dispute_case_decision_replacements"("case_id") WHERE "approved_at" IS NULL AND "rejected_at" IS NULL;
CREATE UNIQUE INDEX "dcdr_one_replacement_per_approval" ON "dispute_case_decision_replacements"("old_approval_id") WHERE "approved_at" IS NOT NULL;

-- Append-only with TWO one-time stamps (approval quad, rejection triple): NULL -> value once, every other column unchanged; any other UPDATE and every DELETE is rejected.
CREATE FUNCTION dispute_case_decision_replacement_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND ROW(NEW."id", NEW."case_id", NEW."old_approval_id", NEW."session_id", NEW."contract_id", NEW."client_user_id", NEW."pt_user_id", NEW."proposed_by", NEW."reason", NEW."checks_at_proposal", NEW."created_at")
         IS NOT DISTINCT FROM
         ROW(OLD."id", OLD."case_id", OLD."old_approval_id", OLD."session_id", OLD."contract_id", OLD."client_user_id", OLD."pt_user_id", OLD."proposed_by", OLD."reason", OLD."checks_at_proposal", OLD."created_at")
     AND (OLD."approved_at" IS NULL OR ROW(NEW."approved_by", NEW."approved_at", NEW."approval_reason", NEW."checks_at_approval") IS NOT DISTINCT FROM ROW(OLD."approved_by", OLD."approved_at", OLD."approval_reason", OLD."checks_at_approval"))
     AND (OLD."rejected_at" IS NULL OR ROW(NEW."rejected_by", NEW."rejected_at", NEW."rejection_reason") IS NOT DISTINCT FROM ROW(OLD."rejected_by", OLD."rejected_at", OLD."rejection_reason"))
     AND ROW(NEW."approved_by", NEW."approved_at", NEW."approval_reason", NEW."checks_at_approval", NEW."rejected_by", NEW."rejected_at", NEW."rejection_reason")
         IS DISTINCT FROM ROW(OLD."approved_by", OLD."approved_at", OLD."approval_reason", OLD."checks_at_approval", OLD."rejected_by", OLD."rejected_at", OLD."rejection_reason") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispute_case_decision_replacement_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_decision_replacements"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_decision_replacement_guard();
