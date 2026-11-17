-- Q1 (15/11/2026). ADDITIVE ONLY: one new enum value, no table / column / row touched.
--   kind GYM_DEBT   the part of a gym's share of a SUPPLEMENTARY membership refund (appeal won by the member after a refund) that the gym's AVAILABLE
--                   wallet could not fund. The member is still paid in full; the platform fronts the shortfall from its REVENUE wallet, and this row is the
--                   durable, idempotent record of what the gym owes back (party = GYM, the debtor; key GYM_CASE_APPEAL_SUPPLEMENT:<approvalId>#GYM_DEBT).
-- NO PartnerReceivable is created and nothing is recovered automatically: an admin decides how the debt is collected or waived.
ALTER TYPE "ContractUnpaidObligationKind" ADD VALUE IF NOT EXISTS 'GYM_DEBT';
