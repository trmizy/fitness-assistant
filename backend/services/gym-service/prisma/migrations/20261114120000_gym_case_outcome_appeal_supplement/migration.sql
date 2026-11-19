-- Q5 (owner approved 14/11/2026): an appeal reviewed AFTER the refund was executed can end with a supplementary refund of the difference.
-- Additive only: one new outcome value. No table, column or row is touched.
ALTER TYPE "GymCaseOutcome" ADD VALUE IF NOT EXISTS 'REFUND_APPEAL_SUPPLEMENT';
