-- E5 (06/11/2026). ADDITIVE: a MONEY consequence of a won appeal whose finding ESTABLISHED an amount and a responsible party gets a FORMAL obligation at payment-service and becomes OBLIGATION_OPEN
-- (created, NOT paid: the financial axis stays unsettled until the obligation is settled). The status check gains this one value; nothing else changes.
ALTER TABLE "dispute_case_appeal_consequences" DROP CONSTRAINT "dc_consequence_status";
ALTER TABLE "dispute_case_appeal_consequences" ADD CONSTRAINT "dc_consequence_status" CHECK ("status" IN ('OPEN', 'RESOLVED', 'NEEDS_RECONCILIATION', 'OBLIGATION_OPEN'));
