-- D65-B reject (04/11/2026). ADDITIVE: one three-column stamp (rejected_by, rejected_at, rejection_reason), the trigger function re-created to know that stamp, and the two per-session /
-- per-row UNIQUE indexes turned into PARTIAL unique indexes (WHERE rejected_at IS NULL): a rejected proposal frees its session for a new one; ONE live proposal per session at a time.
-- A rejected proposal can never have been approved (check) and never moves money. The approval stamp / the history of any proposal is never altered (same trigger rules).
ALTER TABLE "d65b_resolutions" ADD COLUMN "rejected_by" TEXT, ADD COLUMN "rejected_at" TIMESTAMPTZ(3), ADD COLUMN "rejection_reason" TEXT;
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_rejection_triple" CHECK (("rejected_by" IS NULL) = ("rejected_at" IS NULL) AND ("rejected_by" IS NULL) = ("rejection_reason" IS NULL));
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_rejection_four_eyes" CHECK ("rejected_by" IS NULL OR "rejected_by" <> "proposed_by");
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_rejection_not_party" CHECK ("rejected_by" IS NULL OR ("rejected_by" <> "client_user_id" AND "rejected_by" <> "pt_user_id"));
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_rejected_never_approved" CHECK ("rejected_at" IS NULL OR ("approved_at" IS NULL AND "outcome" IS NULL));
DROP INDEX "d65b_resolutions_session_id_key";
DROP INDEX "d65b_resolutions_settlement_row_id_key";
CREATE UNIQUE INDEX "d65b_one_live_per_session" ON "d65b_resolutions"("session_id") WHERE "rejected_at" IS NULL;
CREATE UNIQUE INDEX "d65b_one_live_per_row" ON "d65b_resolutions"("settlement_row_id") WHERE "rejected_at" IS NULL;
CREATE INDEX "d65b_resolutions_session_id_idx" ON "d65b_resolutions"("session_id");
CREATE INDEX "d65b_resolutions_settlement_row_id_idx" ON "d65b_resolutions"("settlement_row_id");

CREATE OR REPLACE FUNCTION d65b_resolution_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND ROW(NEW."id", NEW."session_id", NEW."contract_id", NEW."settlement_row_id", NEW."client_user_id", NEW."pt_user_id", NEW."reason", NEW."evidence_refs", NEW."proposed_by", NEW."ledger_before", NEW."created_at")
         IS NOT DISTINCT FROM
         ROW(OLD."id", OLD."session_id", OLD."contract_id", OLD."settlement_row_id", OLD."client_user_id", OLD."pt_user_id", OLD."reason", OLD."evidence_refs", OLD."proposed_by", OLD."ledger_before", OLD."created_at")
     AND (OLD."approved_at" IS NULL OR ROW(NEW."approved_by", NEW."approved_at", NEW."approval_reason") IS NOT DISTINCT FROM ROW(OLD."approved_by", OLD."approved_at", OLD."approval_reason"))
     AND (OLD."outcome_at" IS NULL OR ROW(NEW."outcome", NEW."outcome_at", NEW."ledger_after") IS NOT DISTINCT FROM ROW(OLD."outcome", OLD."outcome_at", OLD."ledger_after"))
     AND (OLD."rejected_at" IS NULL OR ROW(NEW."rejected_by", NEW."rejected_at", NEW."rejection_reason") IS NOT DISTINCT FROM ROW(OLD."rejected_by", OLD."rejected_at", OLD."rejection_reason"))
     AND ROW(NEW."approved_by", NEW."approved_at", NEW."approval_reason", NEW."outcome", NEW."outcome_at", NEW."ledger_after", NEW."rejected_by", NEW."rejected_at", NEW."rejection_reason")
         IS DISTINCT FROM ROW(OLD."approved_by", OLD."approved_at", OLD."approval_reason", OLD."outcome", OLD."outcome_at", OLD."ledger_after", OLD."rejected_by", OLD."rejected_at", OLD."rejection_reason") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
