-- Vòng 4 / Phase E3 — a notice-period termination for gym<->PT collaborations. Null = no
-- pending termination (today's exact behavior, unchanged); a caller passing an explicit future
-- date leaves status ACCEPTED (existing affiliation/roster display unaffected) until that date,
-- while activeRates() refuses new referral/rate lookups against the row immediately.
ALTER TABLE "gym_pt_collaborations" ADD COLUMN "effective_at" TIMESTAMP(3);
