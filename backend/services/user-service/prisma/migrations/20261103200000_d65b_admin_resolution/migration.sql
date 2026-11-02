-- D65-B (03/11/2026). ADDITIVE ONLY: two tables, two trigger functions. Nothing existing changes meaning.
--
-- The person-driven, four-eyes way out for ONE NO_SHOW session whose PT_NO_SHOW_COMPENSATION row is UNCONFIRMED (the ending HELD its value because the ledger never paid it).
-- The only action is the existing resolveUnconfirmedSessionMoney(contractId, sessionId, 'NOT_DELIVERED') under the existing key UNRESOLVED_SESSION:<sessionId>. There is no amount and no
-- outcome column a caller could choose.
--   d65b_resolutions         one PROPOSAL per session, ever; one-time APPROVAL stamp (second admin), one-time OUTCOME stamp (EXECUTED + the ledger reading after). Everything else is immutable.
--   d65b_resolution_events   APPEND-ONLY audit (who, when, why, evidence, ledger readings).

CREATE TABLE "d65b_resolutions" (
  "id" UUID NOT NULL,
  "session_id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "settlement_row_id" TEXT NOT NULL,
  "client_user_id" TEXT NOT NULL,
  "pt_user_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence_refs" TEXT[] NOT NULL,
  "proposed_by" TEXT NOT NULL,
  "ledger_before" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by" TEXT,
  "approved_at" TIMESTAMPTZ(3),
  "approval_reason" TEXT,
  "outcome" TEXT,
  "outcome_at" TIMESTAMPTZ(3),
  "ledger_after" JSONB,
  CONSTRAINT "d65b_resolutions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_row_fkey" FOREIGN KEY ("settlement_row_id") REFERENCES "session_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_evidence_present" CHECK (cardinality("evidence_refs") >= 1);
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_reason_present" CHECK (length(btrim("reason")) > 0);
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_approval_triple" CHECK (("approved_by" IS NULL) = ("approved_at" IS NULL) AND ("approved_by" IS NULL) = ("approval_reason" IS NULL));
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_four_eyes" CHECK ("approved_by" IS NULL OR "approved_by" <> "proposed_by");
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_party_not_proposer" CHECK ("proposed_by" <> "client_user_id" AND "proposed_by" <> "pt_user_id");
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_party_not_approver" CHECK ("approved_by" IS NULL OR ("approved_by" <> "client_user_id" AND "approved_by" <> "pt_user_id"));
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_outcome_values" CHECK ("outcome" IS NULL OR "outcome" = 'EXECUTED');
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_outcome_triple" CHECK (("outcome" IS NULL) = ("outcome_at" IS NULL) AND ("outcome" IS NULL) = ("ledger_after" IS NULL));
ALTER TABLE "d65b_resolutions" ADD CONSTRAINT "d65b_outcome_needs_approval" CHECK ("outcome" IS NULL OR "approved_at" IS NOT NULL);

CREATE UNIQUE INDEX "d65b_resolutions_session_id_key" ON "d65b_resolutions"("session_id");
CREATE UNIQUE INDEX "d65b_resolutions_settlement_row_id_key" ON "d65b_resolutions"("settlement_row_id");
CREATE INDEX "d65b_resolutions_contract_id_idx" ON "d65b_resolutions"("contract_id");

-- Append-only with TWO one-time stamps (approval triple, outcome triple): each goes from NULL to a value once, every other column unchanged. Any other UPDATE and every DELETE is rejected.
CREATE FUNCTION d65b_resolution_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND ROW(NEW."id", NEW."session_id", NEW."contract_id", NEW."settlement_row_id", NEW."client_user_id", NEW."pt_user_id", NEW."reason", NEW."evidence_refs", NEW."proposed_by", NEW."ledger_before", NEW."created_at")
         IS NOT DISTINCT FROM
         ROW(OLD."id", OLD."session_id", OLD."contract_id", OLD."settlement_row_id", OLD."client_user_id", OLD."pt_user_id", OLD."reason", OLD."evidence_refs", OLD."proposed_by", OLD."ledger_before", OLD."created_at")
     AND (OLD."approved_at" IS NULL OR ROW(NEW."approved_by", NEW."approved_at", NEW."approval_reason") IS NOT DISTINCT FROM ROW(OLD."approved_by", OLD."approved_at", OLD."approval_reason"))
     AND (OLD."outcome_at" IS NULL OR ROW(NEW."outcome", NEW."outcome_at", NEW."ledger_after") IS NOT DISTINCT FROM ROW(OLD."outcome", OLD."outcome_at", OLD."ledger_after"))
     AND ROW(NEW."approved_by", NEW."approved_at", NEW."approval_reason", NEW."outcome", NEW."outcome_at", NEW."ledger_after") IS DISTINCT FROM ROW(OLD."approved_by", OLD."approved_at", OLD."approval_reason", OLD."outcome", OLD."outcome_at", OLD."ledger_after") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER d65b_resolution_append_only
  BEFORE UPDATE OR DELETE ON "d65b_resolutions"
  FOR EACH ROW EXECUTE FUNCTION d65b_resolution_guard();

CREATE TABLE "d65b_resolution_events" (
  "id" UUID NOT NULL,
  "resolution_id" UUID NOT NULL,
  "settlement_row_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "actor_role" TEXT NOT NULL,
  "note" TEXT,
  "payload" JSONB,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "d65b_resolution_events_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "d65b_resolution_events" ADD CONSTRAINT "d65be_resolution_fkey" FOREIGN KEY ("resolution_id") REFERENCES "d65b_resolutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "d65b_resolution_events" ADD CONSTRAINT "d65be_row_fkey" FOREIGN KEY ("settlement_row_id") REFERENCES "session_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "d65b_resolution_events_idempotency_key_key" ON "d65b_resolution_events"("idempotency_key");
CREATE INDEX "d65b_resolution_events_resolution_id_created_at_idx" ON "d65b_resolution_events"("resolution_id", "created_at");

CREATE FUNCTION d65b_resolution_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER d65b_resolution_events_append_only
  BEFORE UPDATE OR DELETE ON "d65b_resolution_events"
  FOR EACH ROW EXECUTE FUNCTION d65b_resolution_reject_mutation();
