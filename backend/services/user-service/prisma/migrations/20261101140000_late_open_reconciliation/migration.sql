-- Final safety gate (01/11/2026). ADDITIVE ONLY: one enum, two tables, two trigger functions. Nothing existing changes meaning.
--
-- A session of an ORDINARY contract (never disputed, so it can never have a D-NEW-12 policy review of a Case) whose late-arrival compensation L is still OPEN at the ledger has its money step
-- refused by the ledger (LATE_OPEN_FLAG_REQUIRED) and parked NEEDS_HUMAN. This is the person-driven way out, with four eyes:
--   late_open_reconciliations        one PROPOSAL per parked settlement row: who, why, how it was verified, on what policy basis, with which evidence. It carries NO amount (the ledger computes
--                                    the money); one-time APPROVAL stamp by a second admin; one-time OUTCOME stamp (EXECUTED | REJECTED). Everything else is immutable.
--   late_open_reconciliation_events  APPEND-ONLY history (claim, proposal, approval, rejection, blocked, execution started / failed / done, notification).
-- It does NOT write dispute_case_policy_eligibility_reviews and never makes the D-NEW-12 guard pass.

CREATE TYPE "LateOpenReconciliationOutcome" AS ENUM ('EXECUTED', 'REJECTED');

CREATE TABLE "late_open_reconciliations" (
  "id" UUID NOT NULL,
  "session_id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "settlement_row_id" TEXT NOT NULL,
  "step_kind" TEXT NOT NULL,
  "late_key" TEXT NOT NULL,
  "assignee" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "verification_note" TEXT NOT NULL,
  "evidence_refs" TEXT[] NOT NULL,
  "policy_basis" TEXT NOT NULL,
  "proposed_by" TEXT NOT NULL,
  "approved_by" TEXT,
  "approved_at" TIMESTAMPTZ(3),
  "outcome" "LateOpenReconciliationOutcome",
  "outcome_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "late_open_reconciliations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "late_open_reconciliations" ADD CONSTRAINT "lor_row_fkey" FOREIGN KEY ("settlement_row_id") REFERENCES "session_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "late_open_reconciliations" ADD CONSTRAINT "lor_evidence_present" CHECK (cardinality("evidence_refs") >= 1);
ALTER TABLE "late_open_reconciliations" ADD CONSTRAINT "lor_text_present" CHECK (length(btrim("reason")) > 0 AND length(btrim("verification_note")) > 0 AND length(btrim("policy_basis")) > 0);
ALTER TABLE "late_open_reconciliations" ADD CONSTRAINT "lor_approval_pair" CHECK (("approved_by" IS NULL) = ("approved_at" IS NULL));
ALTER TABLE "late_open_reconciliations" ADD CONSTRAINT "lor_four_eyes" CHECK ("approved_by" IS NULL OR "approved_by" <> "proposed_by");
ALTER TABLE "late_open_reconciliations" ADD CONSTRAINT "lor_outcome_pair" CHECK (("outcome" IS NULL) = ("outcome_at" IS NULL));
ALTER TABLE "late_open_reconciliations" ADD CONSTRAINT "lor_outcome_vs_approval" CHECK (("outcome" IS DISTINCT FROM 'EXECUTED' OR "approved_at" IS NOT NULL) AND ("outcome" IS DISTINCT FROM 'REJECTED' OR "approved_at" IS NULL));

CREATE INDEX "lor_session_idx" ON "late_open_reconciliations"("session_id");
CREATE INDEX "lor_contract_idx" ON "late_open_reconciliations"("contract_id");
-- ONE live (not rejected) proposal per parked row: a second proposal is possible only after the first was rejected.
CREATE UNIQUE INDEX "lor_one_live_per_row" ON "late_open_reconciliations"("settlement_row_id") WHERE "outcome" IS DISTINCT FROM 'REJECTED';

-- Append-only, with TWO one-time stamps (approval, outcome): each goes from NULL to a value once, with every other column unchanged. Any other UPDATE and every DELETE is rejected.
CREATE FUNCTION late_open_reconciliation_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND ROW(NEW."id", NEW."session_id", NEW."contract_id", NEW."settlement_row_id", NEW."step_kind", NEW."late_key", NEW."assignee", NEW."reason", NEW."verification_note", NEW."evidence_refs", NEW."policy_basis", NEW."proposed_by", NEW."created_at")
         IS NOT DISTINCT FROM
         ROW(OLD."id", OLD."session_id", OLD."contract_id", OLD."settlement_row_id", OLD."step_kind", OLD."late_key", OLD."assignee", OLD."reason", OLD."verification_note", OLD."evidence_refs", OLD."policy_basis", OLD."proposed_by", OLD."created_at")
     AND (OLD."approved_at" IS NULL OR ROW(NEW."approved_by", NEW."approved_at") IS NOT DISTINCT FROM ROW(OLD."approved_by", OLD."approved_at"))
     AND (OLD."outcome_at" IS NULL OR ROW(NEW."outcome", NEW."outcome_at") IS NOT DISTINCT FROM ROW(OLD."outcome", OLD."outcome_at"))
     AND ROW(NEW."approved_by", NEW."approved_at", NEW."outcome", NEW."outcome_at") IS DISTINCT FROM ROW(OLD."approved_by", OLD."approved_at", OLD."outcome", OLD."outcome_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER late_open_reconciliation_append_only
  BEFORE UPDATE OR DELETE ON "late_open_reconciliations"
  FOR EACH ROW EXECUTE FUNCTION late_open_reconciliation_guard();

CREATE TABLE "late_open_reconciliation_events" (
  "id" UUID NOT NULL,
  "settlement_row_id" TEXT NOT NULL,
  "reconciliation_id" UUID,
  "session_id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "actor_role" TEXT NOT NULL,
  "note" TEXT,
  "payload" JSONB,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "late_open_reconciliation_events_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "late_open_reconciliation_events" ADD CONSTRAINT "lore_row_fkey" FOREIGN KEY ("settlement_row_id") REFERENCES "session_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "late_open_reconciliation_events" ADD CONSTRAINT "lore_reconciliation_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "late_open_reconciliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "lore_idempotency_key" ON "late_open_reconciliation_events"("idempotency_key");
CREATE INDEX "lore_row_idx" ON "late_open_reconciliation_events"("settlement_row_id", "created_at");
CREATE INDEX "lore_reconciliation_idx" ON "late_open_reconciliation_events"("reconciliation_id");

CREATE FUNCTION late_open_reconciliation_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER late_open_reconciliation_events_append_only
  BEFORE UPDATE OR DELETE ON "late_open_reconciliation_events"
  FOR EACH ROW EXECUTE FUNCTION late_open_reconciliation_reject_mutation();
