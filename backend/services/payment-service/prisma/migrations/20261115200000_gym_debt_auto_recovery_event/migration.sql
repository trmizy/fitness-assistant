-- FIX3-PAY (15/11/2026). ADDITIVE ONLY: one new enum value, no table / column / row touched.
--   action RECOVER_FROM_INCOME   the append-only record that an open GYM_DEBT obligation was repaid (in whole or in part) from the gym's next AVAILABLE income,
--                                inside the same DB transaction as that income (actor SYSTEM:GYM_DEBT_AUTO_RECOVERY, approvalRef = the income's ledger entry id,
--                                idempotency key GYM_DEBT_RECOVERY:<obligationId>:<entryId>). The obligation moves paid/unpaid; fully repaid -> PAID_VIA_LEDGER.
ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'RECOVER_FROM_INCOME';
