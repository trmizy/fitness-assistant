-- E5 (06/11/2026). ADDITIVE ONLY: a formal obligation created after a WON APPEAL. Two enum values and two nullable columns.
--   kind APPEAL_AWARD            the obligation exists because an approved appeal finding ESTABLISHED an amount and a responsible party (validated by user-service, never free text)
--   action CREATE_FROM_APPEAL    the append-only event that records its creation (actor = the deciding reviewer, approvalRef = the consequence id)
--   responsible_party            who is responsible (PT | GYM | PLATFORM); `party` stays "who it is owed to" (CLIENT)
--   source_ref                   the dispute-case consequence id it came from (the idempotency key is APPEAL_OBLIGATION:<consequenceId>)
-- NO money moves: no wallet, ledger entry or ledger operation is written. It is settled only by the existing FH-8 lifecycle (verified external payment) or a decision of a person.
ALTER TYPE "ContractUnpaidObligationKind" ADD VALUE IF NOT EXISTS 'APPEAL_AWARD';
ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'CREATE_FROM_APPEAL';
ALTER TABLE "contract_unpaid_obligations" ADD COLUMN "responsible_party" TEXT;
ALTER TABLE "contract_unpaid_obligations" ADD COLUMN "source_ref" TEXT;
ALTER TABLE "contract_unpaid_obligations" ADD CONSTRAINT "cuo_responsible_party_values" CHECK ("responsible_party" IS NULL OR "responsible_party" IN ('PT', 'GYM', 'PLATFORM'));
ALTER TABLE "contract_unpaid_obligations" ADD CONSTRAINT "cuo_appeal_award_has_party" CHECK ("kind"::text <> 'APPEAL_AWARD' OR ("responsible_party" IS NOT NULL AND "source_ref" IS NOT NULL));
